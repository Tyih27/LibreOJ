#include <string>
#include <vector>
#include <list>
#include <set>
#include <algorithm>
#include <map>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <cctype>

#include <filesystem>

#include <unistd.h>
#include <sys/types.h>
#include <signal.h>

#include <fmt/format.h>
#include <fmt/ostream.h>
#if FMT_VERSION >= 90000
#include <fmt/std.h>
#endif

#include "utils.h"
#include "cgroup.h"

using std::string;
using std::vector;
using std::list;
using std::map;
using std::ifstream;
using std::ofstream;
namespace fs = std::filesystem;
using fmt::format;

static bool IsEmpty(const string &str)
{
    auto f = [](unsigned char const c) { return std::isspace(c); };
    return std::all_of(str.begin(), str.end(), f);
}

CgroupInfo::CgroupInfo(const string &controller, const string &group)
    : Controller(controller), Group(group)
{
    if (IsEmpty(controller))
    {
        throw std::invalid_argument("Controller name cannot be empty!");
    }
    else if (IsEmpty(group))
    {
        throw std::invalid_argument("Group name cannot be empty!");
    }
}

// Look for the unified cgroup v2 hierarchy. Only cgroup v2 is supported: the
// v1 hierarchy used to be discovered by scanning /proc/cgroups and
// /proc/mounts, which is no longer needed.
map<string, vector<fs::path>> InitializeCgroup()
{
    map<string, vector<fs::path>> cgroup_mnt;

    const fs::path root = "/sys/fs/cgroup";
    const fs::path controllersFile = root / "cgroup.controllers";
    if (!fs::exists(controllersFile))
    {
        throw std::runtime_error(
            "simple-sandbox requires cgroup v2 (unified hierarchy), but " + controllersFile.string() +
            " does not exist. cgroup v1 is no longer supported.");
    }

    ifstream ifs(controllersFile);
    std::set<string> controllers;
    string token;
    while (ifs >> token)
        controllers.insert(token);
    if (controllers.find("memory") == controllers.end())
    {
        throw std::runtime_error(
            "simple-sandbox requires cgroup v2 with the memory controller enabled, but \"memory\" is not listed in " +
            controllersFile.string() + ".");
    }

    // Under cgroup v2 every controller lives in the same unified hierarchy, so
    // the logical controllers all resolve to the same mount point. The map
    // shape is kept so GetPath() (and thus the rest of the API) is unchanged.
    for (const string &controller : {"memory", "cpuacct", "pids"})
    {
        cgroup_mnt[controller].push_back(root);
    }

    return cgroup_mnt;
}

// Initialized lazily on first use: throwing from a global constructor while
// the native addon is being loaded cannot be turned into a JS exception.
static const map<string, vector<fs::path>> &GetCgroupMounts()
{
    static const map<string, vector<fs::path>> cgroup_mnt = InitializeCgroup();
    return cgroup_mnt;
}

static const fs::path &GetPath(const string &controller)
{
    const auto &mounts = GetCgroupMounts();
    auto mnts = mounts.find(controller);
    if (mnts == mounts.end())
    {
        throw std::invalid_argument((format("Controller {} does not exist.", controller)));
    }
    return (mnts->second)[0];
}

static fs::path EnsureGroup(const CgroupInfo &info)
{
    fs::path groupDirectory = GetPath(info.Controller) / info.Group;
    if (!fs::exists(groupDirectory) || !fs::is_directory(groupDirectory))
    {
        throw std::runtime_error((format("Path {} is not valid (does not exist or is not a directory).", groupDirectory)));
    }
    return groupDirectory;
}

template <typename T>
static void WriteFile(const fs::path &path, T val, bool overwrite)
{
    ofstream ofs;
    ofs.exceptions(std::ios::failbit | std::ios::badbit);
    auto flags = ofstream::out | (overwrite ? ofstream::trunc : ofstream::app);
    ofs.open(path, flags);
    ofs << val << std::endl;
}

static void ReadArray64(const fs::path &path, list<int64_t> &cc)
{
    ifstream ifs;
    // No fail bit; just ignore when failed.
    ifs.exceptions(std::ios::badbit);
    ifs.open(path);
    cc.clear();
    int64_t val;
    while (ifs >> val)
    {
        cc.push_back(val);
    }
}

static int64_t ReadInt64(const fs::path &path)
{
    ifstream ifs;
    ifs.exceptions(std::ios::failbit | std::ios::badbit);
    ifs.open(path);
    int64_t val;
    ifs >> val;
    return val;
}

// Translate a v1-style property name into its cgroup v2 counterpart. Unknown
// names are passed through unchanged.
static string TranslateProperty(const string &property)
{
    if (property == "tasks")
        return "cgroup.procs";
    if (property == "memory.limit_in_bytes")
        return "memory.max";
    if (property == "memory.memsw.max_usage_in_bytes")
        return "memory.peak";
    return property;
}

// Make sure the parent exposes the controllers the child group needs. Only the
// missing tokens are added: rewriting already enabled ones can fail with EBUSY.
static void EnableChildControllers(const fs::path &parent)
{
    fs::path controlFile = parent / "cgroup.subtree_control";
    if (!fs::exists(controlFile))
        return;

    std::set<string> enabled;
    {
        ifstream ifs(controlFile);
        string token;
        while (ifs >> token)
            enabled.insert(token);
    }

    string toAdd;
    for (const string &controller : {"memory", "pids", "cpu"})
    {
        if (enabled.find(controller) == enabled.end())
            toAdd += "+" + controller + " ";
    }
    if (toAdd.empty())
        return;

    toAdd.pop_back(); // Drop the trailing space.
    WriteFile(controlFile, toAdd, true);
}

// Remove an empty cgroup directory, retrying briefly because processes killed
// through cgroup.kill may take a moment to actually exit.
static void RemoveDirectory(const fs::path &directory)
{
    std::error_code ec;
    for (int attempt = 0; attempt < 50; attempt++)
    {
        fs::remove(directory, ec);
        if (!ec || !fs::exists(directory))
            return;
        usleep(10 * 1000); // 10ms
    }
    throw std::runtime_error((format("Failed to remove cgroup {}: {}", directory, ec.message())));
}

void CreateGroup(const CgroupInfo &info)
{
    const fs::path parent = GetPath(info.Controller);
    fs::path groupDirectory = parent / info.Group;

    if (fs::exists(groupDirectory))
    {
        if (!fs::is_directory(groupDirectory))
        {
            throw std::runtime_error((format("Path {} has already been used and is not a directory.", groupDirectory)));
        }

        // The caller may hit a stale group (e.g. after a retry reusing the same
        // name). cgroup v2 cannot reset cpu.stat or memory.peak in place, so a
        // genuinely fresh group is guaranteed by killing its members, dropping
        // the directory and recreating it.
        CgroupInfo existing(info.Controller, info.Group);
        KillGroupMembers(existing);
        RemoveDirectory(groupDirectory);
    }

    EnableChildControllers(parent);

    std::error_code ec;
    fs::create_directories(groupDirectory, ec);
    if (ec)
    {
        throw std::runtime_error((format("Failed to create cgroup {}: {}", groupDirectory, ec.message())));
    }
}

int64_t ReadGroupProperty(const CgroupInfo &info, const string &property)
{
    auto groupDir = EnsureGroup(info);

    if (property == "cpuacct.usage")
    {
        // cgroup v2 reports cumulative CPU time as usage_usec (microseconds)
        // inside cpu.stat. Callers expect nanoseconds.
        auto stats = ReadGroupPropertyMap(info, "cpu.stat");
        auto usage = stats.find("usage_usec");
        if (usage == stats.end())
        {
            throw std::runtime_error((format("The cpu.stat of {} does not contain usage_usec.", groupDir)));
        }
        return usage->second * 1000;
    }

    return ReadInt64(groupDir / TranslateProperty(property));
}

list<int64_t> ReadGroupPropertyArray(const CgroupInfo &info, const string &property)
{
    auto groupDir = EnsureGroup(info);
    list<int64_t> val;
    ReadArray64(groupDir / TranslateProperty(property), val);
    return val;
}

map<string, int64_t> ReadGroupPropertyMap(const CgroupInfo &info, const string &property)
{
    auto groupDir = EnsureGroup(info);
    map<string, int64_t> result;
    ifstream ifs;
    ifs.exceptions(std::ios::badbit);
    ifs.open(groupDir / TranslateProperty(property));
    string name;
    int64_t val;
    while (ifs >> name >> val)
    {
        result.insert(std::pair<string, int64_t>(name, val));
    }

    // The JavaScript side reads memory.stat["cache"]; on cgroup v2 the
    // corresponding field is called "file".
    if (property == "memory.stat")
    {
        auto file = result.find("file");
        if (file != result.end() && result.find("cache") == result.end())
        {
            result.insert(std::pair<string, int64_t>("cache", file->second));
        }
    }

    return result;
}

void KillGroupMembers(const CgroupInfo &info)
{
    auto groupDir = EnsureGroup(info);

    // cgroup v2 provides an atomic kill file. Prefer it when available.
    fs::path killFile = groupDir / "cgroup.kill";
    if (fs::exists(killFile))
    {
        try
        {
            WriteFile(killFile, int64_t(1), true);
            return;
        }
        catch (...)
        {
            // Fall through to the per-pid path.
        }
    }

    auto v = ReadGroupPropertyArray(info, "tasks");
    for (auto &item : v)
    {
        (void)kill((pid_t)item, SIGKILL);
    }
}

void RemoveCgroup(const CgroupInfo &info)
{
    fs::path groupDir = GetPath(info.Controller) / info.Group;
    // All unified controllers share one directory, so this may already be gone
    // when called for the second or third controller.
    if (!fs::exists(groupDir))
        return;

    KillGroupMembers(info);
    RemoveDirectory(groupDir);
}

void WriteGroupProperty(const CgroupInfo &info, const string &property, int64_t val, bool overwrite)
{
    auto groupDir = EnsureGroup(info);

    if (property == "tasks")
        return WriteFile(groupDir / "cgroup.procs", val, overwrite);

    if (property == "memory.limit_in_bytes")
    {
        if (val < 0)
            return WriteFile(groupDir / "memory.max", string("max"), overwrite);
        return WriteFile(groupDir / "memory.max", val, overwrite);
    }

    if (property == "memory.memsw.limit_in_bytes")
    {
        // cgroup v2 cannot express a combined memory+swap cap. Emulate the v1
        // semantic (memory + swap <= val) with memory.max = val and swap off.
        if (val < 0)
            return WriteFile(groupDir / "memory.swap.max", string("max"), overwrite);
        WriteFile(groupDir / "memory.max", val, overwrite);
        return WriteFile(groupDir / "memory.swap.max", int64_t(0), overwrite);
    }

    if (property == "memory.memsw.max_usage_in_bytes")
    {
        // Try to reset the peak. memory.peak is writable on recent kernels; on
        // older ones this is a no-op and the freshly created group already
        // starts at zero.
        try
        {
            WriteFile(groupDir / "memory.peak", val, overwrite);
        }
        catch (...)
        {
        }
        return;
    }

    if (property == "cpuacct.usage")
    {
        // cpu.stat is read-only in cgroup v2 and the group is freshly created,
        // so the cumulative value already starts at zero.
        return;
    }

    if (property == "pids.max")
    {
        if (val < 0)
            return WriteFile(groupDir / "pids.max", string("max"), overwrite);
        return WriteFile(groupDir / "pids.max", val, overwrite);
    }

    return WriteFile(groupDir / property, val, overwrite);
}

void WriteGroupProperty(const CgroupInfo &info, const string &property, const string &val, bool overwrite)
{
    auto groupDir = EnsureGroup(info);

    if (property == "tasks")
        return WriteFile(groupDir / "cgroup.procs", val, overwrite);

    if (property == "memory.limit_in_bytes")
        return WriteFile(groupDir / "memory.max", val, overwrite);

    if (property == "memory.memsw.limit_in_bytes")
    {
        if (val == "max")
            return WriteFile(groupDir / "memory.swap.max", val, overwrite);
        WriteFile(groupDir / "memory.max", val, overwrite);
        return WriteFile(groupDir / "memory.swap.max", string("0"), overwrite);
    }

    if (property == "memory.memsw.max_usage_in_bytes")
    {
        try
        {
            WriteFile(groupDir / "memory.peak", val, overwrite);
        }
        catch (...)
        {
        }
        return;
    }

    if (property == "cpuacct.usage")
        return;

    if (property == "pids.max")
        return WriteFile(groupDir / "pids.max", val, overwrite);

    return WriteFile(groupDir / property, val, overwrite);
}

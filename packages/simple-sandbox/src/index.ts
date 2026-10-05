import { SandboxParameter } from './interfaces';
import nativeAddon from './nativeAddon';
import { SandboxProcess } from './sandboxProcess';
import { existsSync, readFileSync } from 'fs';
import * as randomString from 'randomstring';
import * as path from 'path';

export * from './interfaces';

// The sandbox requires the cgroup v2 (unified) hierarchy with the memory
// controller available. On a v2 host /sys/fs/cgroup is the unified root and
// lists the controllers in cgroup.controllers.
const CGROUP_V2_CONTROLLERS = '/sys/fs/cgroup/cgroup.controllers';
if (!existsSync(CGROUP_V2_CONTROLLERS)) {
    throw new Error(
        `Your linux kernel doesn't support cgroup v2. simple-sandbox needs cgroup v2 (unified) with the memory ` +
        `controller enabled, but ${CGROUP_V2_CONTROLLERS} does not exist.`
    );
}

const availableControllers = readFileSync(CGROUP_V2_CONTROLLERS, 'utf8').split(/\s+/).filter(Boolean);
if (!availableControllers.includes('memory')) {
    throw new Error(
        `Your linux kernel doesn't have the memory controller enabled in cgroup v2. simple-sandbox needs cgroup v2 ` +
        `(unified) with the memory controller enabled, but "memory" is not listed in ${CGROUP_V2_CONTROLLERS}.`
    );
}

const MAX_RETRY_TIMES = 20;
export function startSandbox(parameter: SandboxParameter): SandboxProcess {
    const doStart = () => {
        const actualParameter = Object.assign({}, parameter);
        actualParameter.cgroup = path.join(actualParameter.cgroup, randomString.generate(9));
        const startResult: { pid: number; execParam: ArrayBuffer } = nativeAddon.startSandbox(actualParameter);
        return new SandboxProcess(actualParameter, startResult.pid, startResult.execParam);
    };

    let retryTimes = MAX_RETRY_TIMES;
    while (1) {
        try {
            return doStart();
        } catch (e) {
            // Retry if the child process fails
            if ("message" in e && typeof e.message === "string" && e.message.startsWith("The child process ")) {
                if (retryTimes-- > 0)
                    continue;
            }

            throw e;
        }
    }
};

export function getUidAndGidInSandbox(rootfs: string, username: string): { uid: number; gid: number } {
    try {
        return nativeAddon.getUidAndGidInSandbox(rootfs, username);
    } catch (e) {
        throw e;
    }
}

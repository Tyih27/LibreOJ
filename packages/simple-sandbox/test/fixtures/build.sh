#!/bin/sh
# Build the static test fixtures and assemble the minimal rootfs used by the
# root-only behavior tests (test/sandbox.behavior.js).
#
#   sh test/fixtures/build.sh [rootfs-dir]
#
# The default rootfs is test/fixtures/rootfs (a generated artifact). The
# preferred builder is `gcc -static`; when static libc is unavailable the
# script falls back to a downloadable static busybox and says so.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
rootfs=${1:-"$here/rootfs"}
cc=${CC:-gcc}

mkdir -p "$rootfs/etc" "$rootfs/bin" "$rootfs/tmp"

cat > "$rootfs/etc/passwd" <<'EOF'
root:x:0:0:root:/root:/bin/sh
sandbox:x:1000:1000:sandbox:/tmp:/bin/sh
EOF

cc_static_ok=1
for name in exit_ok mem_hog fork_many busy_loop; do
    if ! "$cc" -static -O2 -s -o "$rootfs/bin/$name" "$here/$name.c" 2>/dev/null; then
        cc_static_ok=0
        break
    fi
    chmod 755 "$rootfs/bin/$name"
done

if [ "$cc_static_ok" = "1" ]; then
    echo "build.sh: built static fixtures with '$cc -static' into $rootfs"
    exit 0
fi

# Fallback: a statically linked busybox. The shell-based fixtures cannot
# observe the memory limit directly, but the time and (best effort) process
# limits still work.
echo "build.sh: '$cc -static' unavailable; falling back to static busybox" >&2

busybox="$rootfs/bin/busybox"
if [ ! -x "$busybox" ]; then
    url=${BUSYBOX_URL:-"https://busybox.net/downloads/binaries/1.35.0-x86_64-linux-musl/busybox"}
    echo "build.sh: downloading $url" >&2
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$url" -o "$busybox"
    elif command -v wget >/dev/null 2>&1; then
        wget -qO "$busybox" "$url"
    else
        echo "build.sh: need curl or wget to download busybox" >&2
        exit 1
    fi
    chmod 755 "$busybox"
fi

for applet in sh sleep true; do
    ln -sf busybox "$rootfs/bin/$applet"
done

cat > "$rootfs/bin/exit_ok" <<'EOF'
#!/bin/sh
exit 0
EOF

cat > "$rootfs/bin/busy_loop" <<'EOF'
#!/bin/sh
while :; do :; done
EOF

# Best effort: spawn as many sleeping children as the pids controller allows.
cat > "$rootfs/bin/fork_many" <<'EOF'
#!/bin/sh
i=0
while [ "$i" -lt 64 ]; do
    sleep 60 &
    i=$((i + 1))
done
exit 0
EOF

# busybox cannot allocate anonymous memory directly; burn CPU instead so the
# memory test at least does not hang forever.
cat > "$rootfs/bin/mem_hog" <<'EOF'
#!/bin/sh
while :; do :; done
EOF

chmod 755 "$rootfs/bin/exit_ok" "$rootfs/bin/busy_loop" "$rootfs/bin/fork_many" "$rootfs/bin/mem_hog"

echo "build.sh: assembled busybox-based rootfs at $rootfs (memory/process assertions are best effort)" >&2

# LibreOJ Sandbox RootFS

The Sandbox RootFS is the compiler filesystem mounted by LibreOJ Judge machines. It is based on Ubuntu 22.04 and
contains GCC, Clang, OpenJDK, Kotlin, Free Pascal, Python, Swift, Rust, Go, GHC, C#, F#, and testlib.

## Build

Building requires a Linux host with root privileges, `arch-chroot`, and `debootstrap`:

```bash
export ROOTFS_PATH=/absolute/output/rootfs
export MIRROR=http://archive.ubuntu.com/ubuntu
sudo --preserve-env ./bootstrap.sh
```

`bootstrap.sh` deletes and recreates `ROOTFS_PATH`. Do not point it at a filesystem containing other data.

## Reproducibility

The recipe uses mutable package repositories and floating installers for several language toolchains, so two builds
can contain different package versions. Treat an output as a development image unless its repositories, downloads,
toolchain versions, digest, and provenance are independently pinned and verified.

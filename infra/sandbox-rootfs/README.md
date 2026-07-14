# LibreOJ Sandbox RootFS

This directory contains the privileged Linux recipe for the compiler root filesystem used by LibreOJ judge machines.
It is infrastructure source, not a pnpm package.

The current recipe is based on Ubuntu 22.04 and installs GCC, Clang, OpenJDK, Kotlin, Free Pascal, Python, Swift,
Rust, Go, GHC, C#, F#, and a pinned testlib header.

## Build

The build requires a Linux host with root privileges, `arch-chroot`, and `debootstrap`:

```bash
export ROOTFS_PATH=/absolute/output/rootfs
export MIRROR=http://archive.ubuntu.com/ubuntu
sudo --preserve-env ./bootstrap.sh
```

`bootstrap.sh` deletes and recreates `ROOTFS_PATH`. Never point it at an existing filesystem that must be retained.

## Reproducibility status

This historical recipe still uses mutable package repositories and floating installers for several language
toolchains. It must not be treated as reproducible or promoted automatically. Before producing a new judge image,
pin repository snapshots and toolchain versions, replace deprecated APT key management, validate every download, and
publish the resulting rootfs with a digest and provenance metadata.

#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Build the macOS engine VM for one architecture: a read-only squashfs root
# filesystem (OpenModelica, gcc, MSL, the command agent) and a Linux kernel,
# plus vfkit, the helper that boots them with Apple's Virtualization framework.
#
#   packaging/engine/build-macos-guest.sh arm64|amd64 OUT_DIR
#
# Needs Docker (for arm64 on an x86 machine: binfmt/qemu) and squashfs-tools.
# Set EXTRA_CA_FILE and HTTPS_PROXY to build behind a TLS-inspecting proxy.
set -euo pipefail
ARCH=${1:?usage: build-macos-guest.sh arm64|amd64 OUT_DIR}
OUT=${2:?usage: build-macos-guest.sh arm64|amd64 OUT_DIR}
OM_VERSION=${OM_VERSION:-1.27.1}
MSL_VERSION=${MSL_VERSION:-4.1.0}
VFKIT_VERSION=${VFKIT_VERSION:-v0.6.4}
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"; docker rm -f "gradara-guest-$ARCH" >/dev/null 2>&1 || true' EXIT

cp -r "$here/guest/." "$work/"
if [ -n "${EXTRA_CA_FILE:-}" ]; then cp "$EXTRA_CA_FILE" "$work/extra-ca.crt"; else : > "$work/extra-ca.crt"; fi
network=(); [ -n "${HTTPS_PROXY:-}" ] && network=(--network host)
docker build "${network[@]}" --platform "linux/$ARCH" --build-arg "OM_VERSION=$OM_VERSION" --build-arg "MSL_VERSION=$MSL_VERSION" \
  --build-arg "HTTPS_PROXY=${HTTPS_PROXY:-}" -t "gradara-guest:$ARCH" "$work"
docker create --platform "linux/$ARCH" --name "gradara-guest-$ARCH" "gradara-guest:$ARCH" /sbin/gradara-init >/dev/null
mkdir -p "$work/root"
docker export "gradara-guest-$ARCH" | tar -x -C "$work/root" --numeric-owner
rm -rf "$OUT"; mkdir -p "$OUT/licenses"
kver=$(cat "$work/root/boot/kernel.version")
# Apple silicon boots only an uncompressed arm64 Image; Intel takes the bzImage as is.
if [ "$ARCH" = arm64 ] && gzip -t "$work/root/boot/kernel" 2>/dev/null; then
  gunzip -c "$work/root/boot/kernel" > "$OUT/kernel"
else
  cp "$work/root/boot/kernel" "$OUT/kernel"
fi
# vfkit's Linux boot requires an initrd. An empty one makes the kernel mount the
# squashfs root itself (all the drivers it needs are built in).
python3 - "$OUT/initrd" <<'PY'
import gzip, sys
# A newc cpio archive with only the trailer entry.
name = b'TRAILER!!!\0'
header = b'070701' + b'00000000' * 11 + b'%08X' % len(name) + b'00000000'
entry = header + name
entry += b'\0' * (-len(entry) % 4)
with gzip.open(sys.argv[1], 'wb', 9) as out:
    out.write(entry + b'\0' * (-len(entry) % 512))
PY
cp "$work/root/usr/share/doc/gradara-engine-packages.txt" "$OUT/packages.txt"
for f in "$work"/root/usr/share/doc/*/copyright; do cp "$f" "$OUT/licenses/$(basename "$(dirname "$f")").copyright"; done
for f in "$work"/root/opt/modelica/Modelica*/Resources/Licenses/*; do [ -f "$f" ] && cp "$f" "$OUT/licenses/"; done
[ -f "$work/root/usr/share/doc/linux-kernel.copyright" ] && cp "$work/root/usr/share/doc/linux-kernel.copyright" "$OUT/licenses/linux.copyright"
rm -rf "$work/root/boot" "$work/root/.dockerenv"
# Docker leaves these as bind-mount placeholders; the VM gets its own.
: > "$work/root/etc/hostname"; : > "$work/root/etc/resolv.conf"
mksquashfs "$work/root" "$OUT/rootfs.img" -comp zstd -Xcompression-level 19 -b 1M -noappend -all-root -quiet
curl -fsSL -o "$OUT/vfkit" "https://github.com/crc-org/vfkit/releases/download/$VFKIT_VERSION/vfkit"
chmod 755 "$OUT/vfkit"
curl -fsSL -o "$OUT/licenses/vfkit.LICENSE" "https://raw.githubusercontent.com/crc-org/vfkit/$VFKIT_VERSION/LICENSE"
# OSMC-PL: the full license and the chosen usage mode travel with the engine.
curl -fsSL -o "$OUT/OSMC-License.txt" "https://raw.githubusercontent.com/OpenModelica/OpenModelica/v$OM_VERSION/OSMC-License.txt"
sed "s/<version>/$OM_VERSION/" "$here/OSMC-USAGE-MODE.txt" > "$OUT/OSMC-USAGE-MODE.txt"
cat > "$OUT/manifest.json" <<JSON
{"engine": "openmodelica", "version": "$OM_VERSION", "msl": "$MSL_VERSION", "platform": "macos", "arch": "$ARCH",
 "kernel": "kernel", "initrd": "initrd", "kernelVersion": "$kver", "rootfs": "rootfs.img", "vfkit": "vfkit", "vfkitVersion": "$VFKIT_VERSION",
 "omc": "/usr/bin/omc", "gcc": "/usr/bin/gcc", "library": "/opt/modelica", "agentPort": 1024}
JSON
ls -la "$OUT"; du -sh "$OUT"

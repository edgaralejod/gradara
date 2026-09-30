#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Build the relocatable Linux engine bundle: OpenModelica (omc) from the official
# Ubuntu 22.04 packages, the shared libraries a gcc-only system lacks, and the
# Modelica Standard Library, preinstalled. Run as root on Ubuntu 22.04 (a CI
# runner or an ubuntu:22.04 container); the output runs on newer releases too.
#
#   packaging/engine/build-linux.sh OUT_DIR
#
# Layout of OUT_DIR (becomes resources/engine in the installers):
#   bin/omc, lib/<triple>/omc/ (OpenModelica and bundled libraries),
#   include/omc, share/omc, lib/omlibrary (MSL), manifest.json, packages.txt
set -euo pipefail
OUT=${1:?usage: build-linux.sh OUT_DIR}
OM_VERSION=${OM_VERSION:-1.27.1}
MSL_VERSION=${MSL_VERSION:-4.1.0}
export DEBIAN_FRONTEND=noninteractive
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

sudo_() { if [ "$(id -u)" = 0 ]; then "$@"; else sudo "$@"; fi; }

sudo_ apt-get update -qq
sudo_ apt-get install -y -qq --no-install-recommends curl gnupg ca-certificates file binutils gcc libc6-dev python3 >/dev/null
curl -fsSL https://build.openmodelica.org/apt/openmodelica.asc | sudo_ gpg --dearmor --yes -o /usr/share/keyrings/openmodelica-keyring.gpg
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/openmodelica-keyring.gpg] https://build.openmodelica.org/apt $VERSION_CODENAME release" \
  | sudo_ tee /etc/apt/sources.list.d/openmodelica.list >/dev/null
sudo_ apt-get update -qq
triple=$(gcc -dumpmachine)

# 1. OpenModelica itself (the omc package's heavy dependencies are not needed: gcc compiles).
mkdir -p "$work/om" "$work/deps"
(cd "$work/om" && apt-get download "omc=$OM_VERSION-1" "omc-common=$OM_VERSION-1" "libomc=$OM_VERSION-1" "libomcsimulation=$OM_VERSION-1" >/dev/null)

# 2. Runtime libraries OpenModelica needs beyond glibc, the gcc runtime, zlib and
#    OpenSSL, plus GNU make (omc builds each simulation with a makefile).
here=$(cd "$(dirname "$0")" && pwd)
deps=$(python3 "$here/resolve_deps.py" libomc libomcsimulation make)
deps=$(echo "$deps" | grep -vE '^(libomc|libomcsimulation|omc-common)$')
echo "Bundling: $(echo $deps)"
(cd "$work/deps" && apt-get download $deps >/dev/null)

rm -rf "$OUT"; mkdir -p "$OUT"
stage="$work/stage"; mkdir -p "$stage"
for deb in "$work"/om/*.deb; do dpkg -x "$deb" "$stage"; done
cp -a "$stage/usr/." "$OUT/"
rm -rf "$OUT/share/doc"
# GNU make, next to omc (the engine puts bin/ first on PATH).
dpkg -x "$(ls "$work"/deps/make_*.deb)" "$work/make"
cp "$work/make/usr/bin/make" "$OUT/bin/make"
omlib="$OUT/lib/$triple/omc"
dep_stage="$work/depstage"; mkdir -p "$dep_stage"
for deb in "$work"/deps/*.deb; do dpkg -x "$deb" "$dep_stage"; done
# Flatten every shared object (following symlinks, including the BLAS/LAPACK
# alternatives subfolders) into OpenModelica's library folder.
find "$dep_stage" \( -type f -o -type l \) -name '*.so*' | while read -r so; do
  name=$(basename "$so")
  [ -e "$omlib/$name" ] || cp -L "$so" "$omlib/$name"
done

# Simulations link with -llapack -lblas: provide the unversioned names.
for lib in lapack blas; do cp "$omlib/lib$lib.so.3" "$omlib/lib$lib.so"; done

# The installers copy files, not symlinks: replace every symlink with its target.
find "$OUT" -type l | while read -r link; do
  target=$(readlink -f "$link"); rm "$link"
  if [ -e "$target" ]; then cp -a --remove-destination "$target" "$link"; fi
done

{
  echo "# OpenModelica $OM_VERSION engine bundle for $triple, built on $PRETTY_NAME"
  for deb in "$work"/om/*.deb "$work"/deps/*.deb; do
    dpkg-deb -f "$deb" Package Version Source Homepage | paste -sd' ' -
  done
} > "$OUT/packages.txt"
# Copyright files of every bundled package, for the installers' license texts.
mkdir -p "$OUT/share/licenses"
for root in "$stage" "$dep_stage"; do
  for f in "$root"/usr/share/doc/*/copyright; do
    [ -f "$f" ] && cp "$f" "$OUT/share/licenses/$(basename "$(dirname "$f")").copyright"
  done
done

# 3. The Modelica Standard Library, installed by omc itself into the bundle.
export OPENMODELICAHOME="$OUT" LD_LIBRARY_PATH="$omlib" PATH="$OUT/bin:$PATH"
export HOME="$work/home"; mkdir -p "$HOME"
mkdir -p "$work/msl" && cd "$work/msl"
printf 'installPackage(Modelica, "%s", exactMatch=true);\ngetErrorString();\n' "$MSL_VERSION" > install.mos
"$OUT/bin/omc" install.mos
mkdir -p "$OUT/lib/omlibrary"
cp -a "$HOME/.openmodelica/libraries/." "$OUT/lib/omlibrary/"
rm -f "$OUT/lib/omlibrary/index.json" "$OUT/lib/omlibrary/index.mos"
# omc unpacks packages owner-only; the installed app is owned by root and run by users.
chmod -R a+rX "$OUT"
ls "$OUT/lib/omlibrary"

# OSMC-PL: the full license and the chosen usage mode travel with the engine.
curl -fsSL -o "$OUT/OSMC-License.txt" "https://raw.githubusercontent.com/OpenModelica/OpenModelica/v$OM_VERSION/OSMC-License.txt"
sed "s/<version>/$OM_VERSION/" "$here/OSMC-USAGE-MODE.txt" > "$OUT/OSMC-USAGE-MODE.txt"

cat > "$OUT/manifest.json" <<JSON
{"engine": "openmodelica", "version": "$OM_VERSION", "msl": "$MSL_VERSION", "platform": "linux", "arch": "$(dpkg --print-architecture)",
 "omc": "bin/omc", "library": "lib/omlibrary", "libraries": "lib/$triple/omc", "compiler": "system gcc"}
JSON
du -sh "$OUT"

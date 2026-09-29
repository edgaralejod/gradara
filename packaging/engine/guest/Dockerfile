# SPDX-License-Identifier: Apache-2.0
# Root filesystem and kernel of the engine VM that runs OpenModelica on macOS.
# build-macos-guest.sh turns the image into a read-only squashfs disk plus a
# kernel that vfkit boots with Apple's Virtualization framework. The VM has no
# network device; it only sees Gradara's data folder (virtio-fs) and talks to
# the app over vsock.
FROM ubuntu:24.04
ARG OM_VERSION=1.27.1
ARG MSL_VERSION=4.1.0
ARG HTTPS_PROXY=
ENV DEBIAN_FRONTEND=noninteractive
# Optional extra CA (for building behind a TLS-inspecting proxy); empty in CI.
COPY extra-ca.crt /usr/local/share/ca-certificates/extra-ca.crt
RUN set -eux; \
    if [ -n "$HTTPS_PROXY" ]; then echo "Acquire::https::Proxy \"$HTTPS_PROXY\";" > /etc/apt/apt.conf.d/99proxy; fi; \
    if [ -s /usr/local/share/ca-certificates/extra-ca.crt ]; then echo 'Acquire::https::CAInfo "/usr/local/share/ca-certificates/extra-ca.crt";' >> /etc/apt/apt.conf.d/99proxy; \
      else rm /usr/local/share/ca-certificates/extra-ca.crt; fi; \
    apt-get update -qq; \
    apt-get install -y -qq --no-install-recommends ca-certificates curl gnupg; \
    update-ca-certificates; \
    curl -fsSL https://build.openmodelica.org/apt/openmodelica.asc | gpg --dearmor -o /usr/share/keyrings/openmodelica-keyring.gpg; \
    echo "deb [signed-by=/usr/share/keyrings/openmodelica-keyring.gpg] https://build.openmodelica.org/apt noble release" > /etc/apt/sources.list.d/openmodelica.list; \
    apt-get update -qq; \
    apt-get install -y -qq --no-install-recommends gcc libc6-dev make python3 kmod \
      "libomc=$OM_VERSION-1" "libomcsimulation=$OM_VERSION-1" "omc-common=$OM_VERSION-1" libblas3 liblapack3; \
    mkdir -p /tmp/pkgs; cd /tmp/pkgs; \
    # The omc package itself only adds /usr/bin/omc; its dependencies (clang, cmake) are not needed.
    apt-get download "omc=$OM_VERSION-1"; dpkg -x omc_*.deb /tmp/omc; cp /tmp/omc/usr/bin/omc /usr/bin/omc; \
    triple=$(gcc -dumpmachine); \
    ln -sf liblapack.so.3 /usr/lib/$triple/liblapack.so; ln -sf libblas.so.3 /usr/lib/$triple/libblas.so; \
    # Kernel: the Ubuntu generic kernel builds in virtio-blk/pci/console, squashfs and devtmpfs;
    # only virtio-fs and vsock are modules, so no initramfs is needed.
    kpkg=$(apt-cache depends linux-image-virtual | awk '/Depends: linux-image-[0-9]/{print $2}'); \
    kver=${kpkg#linux-image-}; \
    apt-get download "$kpkg" "linux-modules-$kver"; \
    mkdir -p /tmp/k; for d in linux-image-*.deb linux-modules-*.deb; do dpkg -x "$d" /tmp/k; done; \
    mkdir -p /boot; cp /tmp/k/boot/vmlinuz-$kver /boot/kernel; echo "$kver" > /boot/kernel.version; \
    for m in fs/fuse/virtiofs net/vmw_vsock/vsock net/vmw_vsock/vmw_vsock_virtio_transport_common net/vmw_vsock/vmw_vsock_virtio_transport; do \
      src=$(ls /tmp/k/lib/modules/$kver/kernel/$m.ko*); mkdir -p "/lib/modules/$kver/kernel/$(dirname $m)"; cp "$src" "/lib/modules/$kver/kernel/$(dirname $m)/"; \
    done; \
    cp /tmp/k/lib/modules/$kver/modules.order /tmp/k/lib/modules/$kver/modules.builtin* /lib/modules/$kver/ 2>/dev/null || true; \
    depmod "$kver"; \
    mkdir -p /tmp/k/copyright; for d in /tmp/k/usr/share/doc/*/copyright; do cp "$d" /usr/share/doc/linux-kernel.copyright 2>/dev/null || true; done; \
    # The Modelica Standard Library, installed by omc, kept read-only in /opt/modelica.
    mkdir -p /tmp/msl && cd /tmp/msl; \
    printf 'installPackage(Modelica, "%s", exactMatch=true);\ngetErrorString();\n' "$MSL_VERSION" > install.mos; \
    HOME=/tmp/msl omc install.mos; \
    mkdir -p /opt/modelica; cp -a /tmp/msl/.openmodelica/libraries/. /opt/modelica/; \
    rm -f /opt/modelica/index.json /opt/modelica/index.mos; ls /opt/modelica; \
    # Package inventory for the license notices.
    dpkg-query -W -f '${Package} ${Version} ${source:Package}\n' > /usr/share/doc/gradara-engine-packages.txt; \
    echo "omc $OM_VERSION-1 openmodelica" >> /usr/share/doc/gradara-engine-packages.txt; \
    echo "linux-image $kver linux" >> /usr/share/doc/gradara-engine-packages.txt; \
    apt-get purge -y -qq curl gnupg; apt-get autoremove -y -qq; \
    rm -rf /var/lib/apt/lists/* /var/cache/apt /tmp/* /etc/apt/apt.conf.d/99proxy \
      /usr/share/man /usr/share/info /usr/share/locale /usr/share/lintian /usr/share/i18n; \
    find /usr/share/doc -mindepth 1 -maxdepth 1 -type d -exec sh -c 'for f in "$1"/*; do [ "$(basename "$f")" = copyright ] || rm -rf "$f"; done' _ {} \; ; \
    mkdir -p /data /opt/gradara
COPY init /sbin/gradara-init
COPY agent.py /opt/gradara/agent.py
RUN chmod 755 /sbin/gradara-init && python3 -m py_compile /opt/gradara/agent.py

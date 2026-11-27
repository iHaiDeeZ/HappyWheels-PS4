#!/usr/bin/env bash
# Mesa for the PS4 app: OpenGL ES on Zink on the kit's RADV, through the ps4gl frontend (a window on
# VideoOut via a headless kopper swapchain; OpenCE Halo's, used by Etterna). All static.
#
# Source: a snapshot of OrbisWeb's Mesa (~/wisp-build/src/mesa, branch wisp-egl: the kit's 26.0.8 + PS4
# series + Etterna's Zink commits + OrbisWeb's futex/rwlock/Zink fixes, its uncommitted part exported to
# Wisp/patches/mesa/wisp-egl-uncommitted.patch), copied so OrbisWeb's work never changes ours.
#   bash scripts/build-mesa.sh [snapshot]     (snapshot: take OrbisWeb's Mesa again)
set -euo pipefail
source "$(dirname "$0")/env.sh"
source "$HOME/ps4-kit/toolchain/env.sh"
SRC="$HB/src/mesa"
B="$HB/build/mesa"
CROSS="$PSB/mesa-ps4-cross.ini"
# meson and the host tools as OrbisWeb's env.sh has them; .pc files of the PS4 sysroots only
export PATH="$PSB/host-tools/bin:$PSB/mesa-venv/bin:$WISP_BUILD/host/bin:$PATH"
export PKG_CONFIG_LIBDIR="$WISP_BUILD/sysroot/lib/pkgconfig:$WISP_BUILD/sysroot/libdata/pkgconfig:$WISP_BUILD/sysroot/share/pkgconfig:$PS4_SYSROOT/lib/pkgconfig:$PS4_SYSROOT/libdata/pkgconfig"
export PKG_CONFIG_SYSROOT_DIR=""
unset PKG_CONFIG_PATH
WISP_MESA="$WISP_BUILD/src/mesa"
PATCH="${MESA_PATCH:-/mnt/e/PS4 Projects/Wisp/patches/mesa/wisp-egl-uncommitted.patch}"   # (OrbisWeb's patches/mesa)
exec > >(tee -a "$HB/logs/mesa.log") 2>&1
echo "=== $(date '+%F %T') build-mesa ${1:-}"

if [ "${1:-}" = snapshot ] || [ ! -f "$SRC/.hw-snapshot" ]; then
    rm -rf "$SRC" "$B"
    mkdir -p "$SRC"
    commit="$(git -C "$WISP_MESA" rev-parse HEAD)"
    git -C "$WISP_MESA" archive "$commit" | tar -x -C "$SRC"
    (cd "$SRC" && patch -p1 --forward < "$PATCH")
    { echo "commit $commit"; echo "patch $(sha1sum < "$PATCH" | cut -c1-40)"; } > "$SRC/.hw-snapshot"
    echo "mesa: snapshot of OrbisWeb's $commit + its uncommitted patch"
fi
BUILD_ID="$(sha1sum < "$SRC/.hw-snapshot" | cut -c1-40)"

if [ ! -f "$B/build.ninja" ]; then
    meson setup "$B" "$SRC" -Dbuildtype=release -Db_ndebug=true -Ddefault_library=static -Dvulkan-drivers=amd \
        -Dgallium-drivers=zink -Dplatforms= -Dllvm=disabled -Damd-use-llvm=false -Dopengl=true -Dgles1=disabled \
        -Dgles2=enabled -Dglx=disabled -Degl=disabled -Dgbm=disabled -Dglvnd=disabled -Dzstd=disabled \
        -Dexpat=disabled -Dxmlconfig=disabled -Dvalgrind=disabled -Dlibunwind=disabled -Dlmsensors=disabled \
        -Dbuild-tests=false -Dshader-cache=enabled -Dvulkan-layers= -Dtools= -Dvideo-codecs= \
        -Dspirv-tools=disabled -Dperfetto=false -Dselinux=false -Dgallium-va=disabled -Dgallium-rusticl=false \
        -Dgallium-extra-hud=false -Dps4-gl=true -Dradv-build-id="$BUILD_ID" --cross-file="$CROSS" \
        > "$B.setup.log" 2>&1 || { tail -40 "$B.setup.log"; exit 1; }
fi
ninja -C "$B" -t targets all 2>/dev/null | cut -d: -f1 | grep '\.a$' | sort > "$B/.targets"
grep -v -e '/tests\?/' -e 'gtest' "$B/.targets" > "$B/.hw-libs"
ninja -C "$B" -j"${MESA_JOBS:-8}" $(cat "$B/.hw-libs")
echo "mesa: $(wc -l < "$B/.hw-libs") libraries in $B"
grep -c ps4gl "$B/.hw-libs" >/dev/null && echo "mesa: ps4gl frontend built"

#!/usr/bin/env bash
# The PS4 package: eboot (runtime/, -DH5_PS4=ON) + the browser layer + the app scripts.
#   HW_VERSION=00.01 [HW_EDITION=online|steam] bash scripts/build-ps4.sh [build|stage|pkg|all]
# online (the default): no game files; the app downloads the site's game (app/online.js).
# steam: the game's files from the user's own copy ($HW_GAME/resources/webroot, never in the repository).
# Needs: scripts/build-host-deps.sh vorbis (the vorbis sources), scripts/pack-jsc.sh, scripts/build-mesa.sh.
set -euo pipefail
source "$(dirname "$0")/env.sh"
source "$HOME/ps4-kit/toolchain/env.sh"
VERSION="${HW_VERSION:-00.01}"
EDITION="${HW_EDITION:-online}"
TITLE_ID=HAPW00001
case "$EDITION" in online) PKG_NAME="HappyWheels-v$VERSION.pkg" ;; steam) PKG_NAME="HappyWheels-Steam-v$VERSION.pkg" ;;
    *) echo "HW_EDITION: online or steam"; exit 2 ;; esac
what="${1:-all}"
b="$HB/build/ps4"
S="$HB/stage"
exec > >(tee -a "$HB/logs/ps4-$VERSION.log") 2>&1
echo "=== $(date '+%F %T') build-ps4 $what v$VERSION ($EDITION)"

do_build() {
    if [ ! -f "$b/build.ninja" ]; then
        ps4_cmake -S "$HW/runtime" -B "$b" -G Ninja -DCMAKE_BUILD_TYPE=Release -DH5_PS4=ON \
            -DHB="$HB" -DWISP_BUILD="$WISP_BUILD"
    fi
    ninja -C "$b" -j"${PS4_JOBS:-8}"
    mkdir -p "$HB/oelf"
    cp "$b/h5" "$HB/oelf/h5-v$VERSION.elf"
    ls -la "$b/h5_eboot/eboot.bin"
}

# app/steam.js sends the Steam build's user agent: stop if the user's copy is another version
check_identity() {
    local asar="$HW_GAME/resources/app.asar" exe="$HW_GAME/Happy Wheels.exe" want=() w missing=0
    want+=("$(grep -aoE 'HappyWheels/[0-9.]+ \([0-9.]+; [0-9a-f]+\)' "$asar" | head -1)")
    want+=("happy-wheels/$(grep -aoE '"version": *"[^"]+"' "$asar" | head -1 | sed -E 's/.*"([^"]+)"$/\1/')")
    want+=("$(grep -aoE 'Chrome/[0-9]+\.[0-9.]+' "$exe" | head -1)" "$(grep -aoE 'Electron/[0-9]+\.[0-9.]+' "$exe" | head -1)")
    for w in "${want[@]}"; do
        if [ -z "$w" ] || ! grep -qF "$w" "$HW/app/steam.js"; then echo "app/steam.js SHELL_UA lacks '$w' (the game copy's)"; missing=1; fi
    done
    [ "$missing" = 0 ] || { echo "update SHELL_UA in app/steam.js for this copy of the game"; exit 1; }
    echo "game identity: ${want[*]}"
}

do_stage() {
    if [ "$EDITION" = steam ]; then check_identity; fi
    mkdir -p "$S/sce_sys" "$S/h5" "$S/app"
    cp "$b/h5_eboot/eboot.bin" "$S/eboot.bin"
    cp "${HW_ICON:-$HW_GAME/resources/icon.png}" "$S/sce_sys/icon0.png"
    rsync -a --delete "$HW/runtime/js/" "$S/h5/js/"
    rsync -a --delete "$HW/runtime/fonts/" "$S/h5/fonts/"
    cp -u "$WISP_BUILD/sysroot/share/icu/77.1/icudt77l.dat" "$S/h5/"
    cp "$HW/runtime/ca-certificates.crt" "$S/h5/"   # (HTTPS: the Mozilla CA list, as Debian ships it)
    rsync -a --delete "$HW/app/" "$S/app/"
    echo "$VERSION" > "$S/app/version.txt"   # (the quick menu shows it)
    if [ "$EDITION" = steam ]; then rsync -a --delete "$HW_GAME/resources/webroot/" "$S/webroot/"; else rm -rf "$S/webroot"; fi
    du -sh "$S"
}

do_pkg() {
    mkdir -p "$HW/out"
    local made
    made="$(bash "$HOME/ps4-kit/scripts/make-pkg.sh" "$S" "$TITLE_ID" "Happy Wheels" "$VERSION" HAPPYWHEELS "$HB/pkg" | tail -1)"
    cp "$made" "$HW/out/$PKG_NAME"
    ls -la "$HW/out/$PKG_NAME"
}

case "$what" in
    build) do_build ;;
    stage) do_stage ;;
    pkg) do_pkg ;;
    all) do_build; do_stage; do_pkg ;;
    *) echo "usage: $0 [build|stage|pkg|all]"; exit 2 ;;
esac

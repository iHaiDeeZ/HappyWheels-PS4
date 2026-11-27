#!/usr/bin/env bash
# The PC test build's dependencies (WSL, no sudo needed):
#   1. ICU 77 (static) from OrbisWeb's ICU source        -> $HOST
#   2. WebKit at OrbisWeb's commit, as a plain snapshot   -> $HB/src/WebKit (git archive: OrbisWeb's repo is untouched)
#   3. JavaScriptCore, WebKit's JSCOnly port (static)     -> $HB/build/jsc-host
#   bash scripts/build-host-deps.sh [icu|webkit-src|jsc|all]
set -euo pipefail
source "$(dirname "$0")/env.sh"
what="${1:-all}"
exec > >(tee -a "$HB/logs/host-deps.log") 2>&1
echo "=== $(date '+%F %T') build-host-deps $what"

build_icu() {
    [ -f "$HOST/lib/libicuuc.a" ] && { echo "icu: already in $HOST"; return; }
    local b="$HB/build/icu-host"
    rm -rf "$b"; mkdir -p "$b"; cd "$b"
    CC=clang CXX=clang++ CXXFLAGS="-O2 -fPIC" CFLAGS="-O2 -fPIC" \
        "$WISP_BUILD/src/icu/source/runConfigureICU" Linux --prefix="$HOST" \
        --enable-static --disable-shared --disable-tests --disable-samples --disable-extras \
        --disable-icuio --disable-layoutex --with-data-packaging=static
    make -j"$JOBS"
    make install
    echo "icu: installed in $HOST"
}

webkit_src() {
    local dst="$HB/src/WebKit"
    if [ -f "$dst/.hw-commit" ] && [ "$(cat "$dst/.hw-commit")" = "$WEBKIT_COMMIT" ]; then
        echo "webkit-src: $WEBKIT_COMMIT already in $dst"; return
    fi
    rm -rf "$dst"; mkdir -p "$dst"
    git -C "$WISP_BUILD/src/WebKit" archive "$WEBKIT_COMMIT" | tar -x -C "$dst"
    echo "$WEBKIT_COMMIT" > "$dst/.hw-commit"
    echo "webkit-src: $WEBKIT_COMMIT -> $dst"
}

build_jsc() {
    local b="$HB/build/jsc-host"
    # (WPE's release tree has no Tools/Scripts/hmaptool: header maps off)
    if [ ! -f "$b/build.ninja" ]; then
        rm -rf "$b"
        cmake -S "$HB/src/WebKit" -B "$b" -G Ninja \
            -DPORT=JSCOnly -DCMAKE_BUILD_TYPE=Release \
            -DENABLE_STATIC_JSC=ON -DUSE_THIN_ARCHIVES=OFF \
            -DDEVELOPER_MODE=OFF -DENABLE_API_TESTS=OFF -DENABLE_TOOLS=OFF \
            -DENABLE_REMOTE_INSPECTOR=OFF -DUSE_LIBBACKTRACE=OFF \
            -DUSE_HEADER_MAPS=OFF \
            -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ \
            -DICU_ROOT="$HOST" -DICU_INCLUDE_DIR="$HOST/include" \
            -DICU_UC_LIBRARY_RELEASE="$HOST/lib/libicuuc.a" \
            -DICU_I18N_LIBRARY_RELEASE="$HOST/lib/libicui18n.a" \
            -DICU_DATA_LIBRARY_RELEASE="$HOST/lib/libicudata.a" \
            -DCMAKE_CXX_FLAGS="-Wno-unused-command-line-argument"
    fi
    # (the jsc shell is left out: its link lists ICU's data library before uc)
    ninja -C "$b" -j"$JOBS" JavaScriptCore
    # the JIT tiers are a CMake object library that static users link object by object: one archive of them
    find "$b/Source/JavaScriptCore/CMakeFiles/JavaScriptCoreJIT.dir" -name '*.o' | sort > "$b/jit-objects.txt"
    rm -f "$b/lib/libJavaScriptCoreJIT.a"
    ar rcs "$b/lib/libJavaScriptCoreJIT.a" $(cat "$b/jit-objects.txt")
    ls -la "$b"/lib/*.a
    echo "jsc: built in $b ($(wc -l < "$b/jit-objects.txt") JIT objects archived)"
}

build_vorbis() {
    [ -f "$HOST/lib/libvorbisfile.a" ] && { echo "vorbis: already in $HOST"; return; }
    local b="$HB/build/vorbis-host"
    rm -rf "$b"; mkdir -p "$b"; cd "$b"
    tar -xf "$WISP_BUILD/src/libogg-1.3.6.tar.xz"
    tar -xf "$WISP_BUILD/src/libvorbis-1.3.7.tar.xz"
    (cd libogg-1.3.6 && CC=clang CFLAGS="-O2 -fPIC" ./configure --prefix="$HOST" --disable-shared --enable-static && make -j"$JOBS" && make install)
    (cd libvorbis-1.3.7 && CC=clang CFLAGS="-O2 -fPIC" ./configure --prefix="$HOST" --disable-shared --enable-static \
        --disable-docs --disable-examples --disable-oggtest --with-ogg="$HOST" && make -j"$JOBS" && make install)
    echo "vorbis: installed in $HOST"
}

case "$what" in
    icu) build_icu ;;
    webkit-src) webkit_src ;;
    jsc) build_jsc ;;
    vorbis) build_vorbis ;;
    all) build_icu; webkit_src; build_jsc; build_vorbis ;;
    *) echo "usage: $0 [icu|webkit-src|jsc|vorbis|all]"; exit 2 ;;
esac

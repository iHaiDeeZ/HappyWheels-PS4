#!/usr/bin/env bash
# The PC test build of the runtime: $HB/build/host/h5-host
#   bash scripts/build-host.sh            (configure once, then build)
#   bash scripts/run-host.sh [seconds]    (runs the game headless, see platform_host.cpp)
set -euo pipefail
source "$(dirname "$0")/env.sh"
b="$HB/build/host"
if [ ! -f "$b/build.ninja" ]; then
    cmake -S "$HW/runtime" -B "$b" -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo \
        -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ \
        -DHB="$HB" -DWISP_BUILD="$WISP_BUILD"
fi
ninja -C "$b" 2>&1 | tail -n 60
ls -la "$b/h5-host"

#!/usr/bin/env bash
# Runs the game on the PC test build, headless: log in $HB/run/data/h5.log, screenshots in $HB/run/data/shots.
#   bash scripts/run-host.sh [seconds] [shot times, e.g. 5,10,20] [pad script, e.g. "8000:b0=1;8150:b0=0"]
# HW_EDITION=steam runs the user's Steam copy; the default (online) has no game files: the site's game,
# downloaded to the data folder (H5_NET_MAP + scripts/net-mock.py stand in for the site without the internet)
set -uo pipefail
source "$(dirname "$0")/env.sh"
secs="${1:-20}"
shots="${2:-5,10,15,20}"
pad="${3:-}"
mkdir -p "$HB/run/data"
rm -rf "$HB/run/data/shots"
export H5_RUN_SECONDS="$secs" H5_SHOT_AT="$shots" H5_PAD="$pad" H5_PAD_CONNECTED=1
if [ "${HW_EDITION:-online}" = steam ]; then game="$HW_GAME/resources/webroot"; else game="$HB/run/no-game"; mkdir -p "$game"; fi
export H5_GAME="$game" H5_RUNTIME="$HW/runtime" H5_APP="$HW/app" H5_DATA="$HB/run/data"
export MESA_SHADER_CACHE_DIR="$HB/run/mesa-cache"
timeout $((secs + 30)) "$HB/build/host/h5-host" > "$HB/run/stdout.txt" 2>&1
echo "exit: $?"
ls "$HB/run/data/shots" 2>/dev/null

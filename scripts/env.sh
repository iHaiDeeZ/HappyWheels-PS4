# Happy Wheels PS4: paths shared by the build scripts (source this file)
#   HW   the project (this repository, on E:)
#   HB   the build tree in WSL's own file system (fast, ext4)
export HW="${HW:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)}"
export HB="${HB:-$HOME/hw-build}"
export HW_GAME="${HW_GAME:-/mnt/e/PS4 Projects/Happy Wheels}"   # your Steam copy (HW_EDITION=steam only)
export WISP_BUILD="${WISP_BUILD:-$HOME/wisp-build}"             # OrbisWeb's tree: WebKit, Mesa, Skia, ICU
export WEBKIT_COMMIT="${WEBKIT_COMMIT:-1bdaefb5}"                 # OrbisWeb's WebKit (branch wisp) we build against
export HOST="$HB/host"                                            # PC test build's prefix
export JOBS="${JOBS:-$(nproc)}"
mkdir -p "$HB/src" "$HB/build" "$HB/logs" "$HOST"

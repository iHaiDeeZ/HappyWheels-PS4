#!/usr/bin/env bash
# JavaScriptCore for the PS4 app: the objects of OrbisWeb's JIT WebKit build (~/wisp-build/build/webkit-jit:
# JavaScriptCore + its JIT, the LLInt, WTF, bmalloc, with OrbisWeb's PS4 patches), copied into one ordinary
# archive ($HB/ps4/lib/libh5jsc.a) so a later OrbisWeb build never changes ours.
#   bash scripts/pack-jsc.sh
set -euo pipefail
source "$(dirname "$0")/env.sh"
source "$HOME/ps4-kit/toolchain/env.sh"
W="$WISP_BUILD/build/webkit-jit"
OUT="$HB/ps4/lib"
mkdir -p "$OUT" "$HB/ps4/jsc"
list="$HB/ps4/jsc/objects.txt"
grep -E '/(JavaScriptCore|JavaScriptCoreJIT|LowLevelInterpreterLib|WTF|bmalloc)\.dir/' "$W/wisp-objects.txt" > "$list"
n=$(wc -l < "$list")
[ "$n" -gt 100 ] || { echo "only $n JSC objects listed in $W/wisp-objects.txt"; exit 1; }
missing=0
while read -r o; do [ -f "$o" ] || { echo "missing $o"; missing=$((missing + 1)); }; done < "$list"
[ "$missing" = 0 ] || exit 1
rm -f "$OUT/libh5jsc.a"
llvm-ar-$CLANG_VER rcs "$OUT/libh5jsc.a" @"$list"
grep -m1 -o 'webkit[^ ]*' "$W/CMakeCache.txt" > /dev/null || true
{ echo "from $W"; echo "objects $n"; date '+%F %T'; git -C "$WISP_BUILD/src/WebKit" log --oneline -1; } > "$HB/ps4/jsc/SOURCE"
ls -la "$OUT/libh5jsc.a"
echo "jsc: $n objects archived"

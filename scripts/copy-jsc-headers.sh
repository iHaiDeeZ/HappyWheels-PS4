#!/usr/bin/env bash
# JavaScriptCore's C API headers (public + the few private ones the runtime uses) into
# runtime/third_party/jsc-api/JavaScriptCore, from the WebKit snapshot we build against.
set -euo pipefail
source "$(dirname "$0")/env.sh"
src="$HB/src/WebKit/Source/JavaScriptCore/API"
dst="$HW/runtime/third_party/jsc-api/JavaScriptCore"
mkdir -p "$dst"
for h in JavaScript.h JSBase.h JSContextRef.h JSObjectRef.h JSStringRef.h JSTypedArray.h JSValueRef.h \
         WebKitAvailability.h JSBasePrivate.h JSContextRefPrivate.h JSObjectRefPrivate.h JSHeapFinalizerPrivate.h \
         JSMarkingConstraintPrivate.h JSWeakPrivate.h JSStringRefPrivate.h; do
    if [ -f "$src/$h" ]; then cp "$src/$h" "$dst/$h"; else echo "(no $h)"; fi
done
echo "$WEBKIT_COMMIT" > "$dst/WEBKIT_COMMIT"
ls "$dst"

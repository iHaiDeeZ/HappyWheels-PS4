# Happy Wheels for PS4: design

A standalone PS4 app (its own pkg, title id HAPW00001, no browser UI) that runs Happy Wheels (an HTML5
game) on a small runtime of our own: no WebKit, one process. The runtime is written to be reused for other
HTML5/Electron games later. Two editions, by what the pkg carries (`app/main.js` decides):

- **Online** (the default since v00.06, `HW_EDITION=online`): no game files in the pkg. The game as
  totaljerkface.com runs it in its own page (`/happy-wheels-js/index.tjf`, the `<iframe>` of
  `/happy_wheels.tjf`): `version.json` names the current scripts (`js/dependencies.<hash>.js`,
  `js/index.<hash>.js`), the game then loads `assets-<hash>/...`. `app/online.js` mounts that URL prefix
  on `<data>/web/` as a downloading mount: a file not there yet is fetched once and kept (names change with
  content). Each start fetches only `version.json`, so a new version on the site plays at the next start;
  offline, the kept version plays; older scripts and asset folders are removed once a newer one runs. The
  site's build is newer than Steam's (1.99.3 on 2026-11-26) but has no controller code: `app/controls.js`.
- **Steam** (`HW_EDITION=steam`): the user's Steam copy's `resources/webroot` in the pkg, the page its
  Electron shell serves (`app/steam.js`), its own controller support. A new Steam version: copy it over the
  old one, update `SHELL_UA` in `app/steam.js` (the build stops with the values to use), test on the PC.

## What the game needs from a "browser"

- JavaScript: ~6.5 MB of ES2017+ (webpack). `index.js` is a `Function()` wrapper that needs `atob`,
  `TextDecoder`, `new Function`, and `location.href` matching `https://totaljerkface.com...`.
- WebGL 1 (PixiJS 6.5 has no canvas fallback; it takes WebGL 1 when `webgl2` is null) with stencil.
- Canvas 2D for text (Pixi `Text`, `TextMetrics` reads pixels back) and a few game uses.
- Images: PNG atlases (three sizes: full, `@0.6x`, `@0.3x`), three SVG icons.
- Fonts: six OpenType (CFF) fonts through `FontFace` / CSS `@font-face`.
- Audio: Howler on Web Audio: one audio sprite (`audiosprite.big.mp3` 7.5 MB / `.ogg` 15 MB),
  gain, fades, rate, stereo pan.
- Input: the Gamepad API with `mapping === "standard"` (game: bindings + a menu pointer), pointer
  events (its pad pointer dispatches synthetic ones), keyboard events by `keyCode`.
- Storage: `localStorage` (options, progress); downloaded levels through `window.hwNative.downloads`.
- Network (later): POSTs to `https://totaljerkface.com/*.hw` for the level browser, replays, login.
- A hidden `<textarea>` for text entry (level search, level names, login).
- Video (later): `blood_preview.mp4` in the options.

## Architecture

```
 eboot.bin (one process)
 ├─ main thread: the event loop
 │   ├─ JavaScriptCore (C API): one VM, one global object = window
 │   ├─ js/prelude.js: the browser layer in JavaScript (DOM nodes, events, timers' JS side,
 │   │   XHR/fetch, Image, FontFace, Web Audio objects, Gamepad, localStorage, location...)
 │   ├─ natives (C++): GL calls, canvas 2D (Skia), image/font/audio decode requests, files,
 │   │   timers, logging, pad state, IME, storage
 │   └─ each frame: platform events -> finished async work -> due timers -> requestAnimationFrame
 │       callbacks -> present (blit the WebGL canvas framebuffer to the window, swap)
 ├─ worker threads: file reads, PNG/SVG decode, MP3/OGG decode (results posted to the loop)
 └─ audio thread: Web Audio graph (sources -> gains/panners -> master) -> sceAudioOut 48 kHz
```

Rules of the split: semantics that are just bookkeeping live in `prelude.js` (fast to change, testable on
the PC); anything with pixels, samples, files or the GPU is native. Natives take plain values (numbers,
strings, typed arrays, handles), never DOM objects.

### JavaScriptCore

- PS4: the objects of OrbisWeb's JIT WebKit build (`~/wisp-build/build/webkit-jit`: JavaScriptCore,
  JIT, LLInt, WTF, bmalloc, with all the PS4 patches: OSAllocatorPS4, 128 MiB JIT pool in system
  flexible memory, polling traps, GC signal 29) copied into our own archive (`scripts/pack-jsc.sh`), so
  an OrbisWeb rebuild never changes ours. Environment as OrbisWeb's web process: `ps4_exec_probe`,
  `JSC_jitMemoryReservationSize`, `JSC_usePollingTraps`, `JSC_SIGNAL_FOR_GC=29`, concurrent GC when the
  signal check passes. ICU data read into the heap (`udata_setCommonData`).
- PC test build: WebKit's JSCOnly port from the same source (`scripts/build-host-deps.sh`, own worktree).
- Only the public C API (`JavaScriptCore/JavaScript.h` + a few private headers): no config headers.

### Graphics

- PS4: Mesa Zink on RADV through the `ps4gl` frontend (OpenCE Halo's, used by Etterna): a 1920x1080
  window on VideoOut and an OpenGL ES 3 context. Mesa from OrbisWeb's tree (it has the frontend plus the
  futex, rwlock and Zink use-after-free fixes), built with the frontend on and EGL off.
- WebGL 1 on GLES 3: GLSL ES 1.00 shaders compile as they are. A texture made without pixels
  (`texImage2D(..., null)`, a render texture) is zeroed, as WebGL promises: GLES leaves the memory as it
  was, which on the PS4 showed other textures' pixels in a level's never-drawn background tiles (v00.06). The canvas's drawing buffer is an FBO
  (RGBA8 + depth24/stencil8) of the canvas size; present blits it to the window (any canvas size, any
  render scale). Extensions Pixi uses are core in GLES 3 (VAOs, instancing, uint indices, derivatives).
- PC test build: EGL pbuffer from WSLg's Mesa, frames written as PNG on request.

### Canvas 2D

Skia (raster, CPU), from OrbisWeb's WebKit build on the PS4 (`libSkia.a`, FreeType for CFF fonts).
Canvases upload to textures straight from their pixels.

### Images, fonts, audio

- PNG: stb_image on worker threads (libpng later if decode time shows); premultiply / flip at upload as
  `UNPACK_*_WEBGL` says. SVG: Skia's SVG module.
- SVG whose `<foreignObject>` holds HTML (the editor's help panels: `data:image/svg+xml,` URLs written
  over several lines, `<b>`, `<u>`, `<br/>` in a styled div): Skia has no HTML, so `js/htmlimage.js` lays
  the text out (inline styles, line breaks, blocks, CSS half-leading) and draws it with the 2D canvas.
- Fonts: OTF bytes handed to Skia's font manager by family name. Arial, Helvetica and sans-serif are
  Liberation Sans (runtime/fonts, regular and bold: Arial's metrics, so text wraps as on Windows);
  unknown families fall back to Noto Sans.
- Audio: minimp3 (the game's MP3 sprite) / stb_vorbis; a small Web Audio graph (buffer source, gain,
  stereo panner, equal-power panner, AudioParam automation) mixed on its own thread; PS4 output
  `sceAudioOut` 48 kHz stereo on user 255 (system).

### Input

- `scePad` -> `navigator.getGamepads()[0]`: id "Wireless Controller (STANDARD GAMEPAD Vendor: 054c
  Product: 09cc)", mapping "standard", 17 buttons in W3C order (touch pad = 8, Share is the system's),
  axes LX LY RX RY. `gamepadconnected` / `gamepaddisconnected` events.
- The game's own pad code then does the rest (bindings, menu pointer, pause).
- Text entry: focusing a `<textarea>`/`<input>` opens the PS4 keyboard (`sceImeDialog`); its text comes
  back as `input` events.

### The online edition's controller (app/controls.js)

The site's build reads only the keyboard. Its play session keeps readable field names (`inputAllowed`,
`paused`, `frames`, `m_world`, `_character`), so an `Object.prototype` setter for `inputAllowed` catches
each session as it starts. While one drives (its frame count moves, not paused, input allowed, not a
replay) `ui.pageMode()` says 'play' and the pad is the keys, laid out as the Steam build's controller
defaults: R2 ArrowUp, L2 ArrowDown, D-pad / left stick ArrowLeft/Right (D-pad up/down too), Cross Space,
L1 Shift, R1 Ctrl, Circle Z, touch pad tap C (camera). Options is Tab anywhere (the site's build opens its
menu on Tab; Esc does nothing there). The game's input layer listens on `document` (keydown/keyup).
Everywhere else the selector and pointer below do the menus.

### The runtime's own controls (runtime/js/overlay.js, app/gameui.js)

Drawn over the presented frame: `gl.cpp` keeps a list of quads (2D canvases uploaded as textures, or
plain colours) and draws them in screen pixels after blitting the page's canvas, with the page's GL state
saved and put back.

- Pointer: the game's controller cursor is a `position:fixed` `<div>` with an SVG arrow (left/top,
  opacity '1' when shown); the runtime paints no DOM, so the overlay draws that arrow where the div is.
  Where the game has no controller pointer (the level editor) the runtime has its own: a mouse sending
  trusted pointer/mouse events, moved by the touch pad (anywhere but gameplay) and the left stick (where
  the game reads no stick), Cross as its button, the right stick as the wheel.
- D-pad selector: Pixi's interactive objects (the InteractionManager is caught by an
  `Object.prototype` setter for `interactionDOMElement` before `dependencies.js` runs) that Pixi's own
  hit test finds at their centre, on the picture, smaller than 60% of it; the D-pad moves between them,
  the chosen one is framed and hovered with the mouse, Cross clicks it. Moving the stick gives the pointer
  back to the game. The frame hugs what the option shows (`imageOpaqueBounds` of its images and text,
  drawn shapes; not invisible hit rectangles or transparent margins), follows it every frame, and is a
  rounded white line with a blue glow (a 9-slice texture) that glides between options.
  This game marks every button with `buttonMode`; its Flash layer gives all interactive things (tooltips,
  dialog backdrops) the same listeners, so only `buttonMode` ones count when a screen has any. The chosen
  option stays chosen while Pixi's hit test at the pointer finds it (hovering can make it fail the
  targets' own checks) or while one at the same place replaces it. A page that reads no controller gets an
  option chosen by itself (the top layer's middle one); a dialog drawn over the screen takes the choice;
  after Cross clicks, options that weren't there before are the next screen. Up/down past the last option
  scrolls (a wheel event). While the page plays, the pointer leaves the picture (no hover look, no
  tooltip). The store badges on the title screen are no targets.
  Up/down out of a scrolled list (an option inside a masked container) scrolls it first, and the row that
  comes into view is the choice; at the list's end the move goes on. Cost: a full look at the options walks
  the scene and hit-tests each one (12-16 ms on the PC in the level browser), so it happens at most once a
  frame, a D-pad press reuses one up to 400 ms old, and between full looks (one a second) a check is only
  Pixi's hit test at the pointer. Options clipped out of sight by their list's mask are passed over first.
- Who owns a button: `js/input.js` notes every button/axis the page reads; the D-pad belongs to the game
  while it reads it (gameplay), and the runtime hides from the page the buttons it is using.
- Quick menu: hold the touch pad (a tap still reaches the game as its button 8). The page's frame
  callbacks wait while it is open. Settings in `/data/HappyWheels/runtime-settings.json`: frame counter
  (frames the page drew per second, ms of script+draw per frame), pointer size and speed, selector.

### Storage, files, network

- The page is `https://totaljerkface.com/__hw_app__/index.html` (as in the Electron shell); URLs under
  `/__hw_app__/` are files under `/app0/webroot/`.
- `localStorage` -> `/data/HappyWheels/localStorage.json` (written after changes, at most every 2 s).
- `window.hwNative`: exit, fullscreen (always on), downloads (`/data/HappyWheels/downloads/<id>/`),
  no steam/friends/auth (the game checks for them).
- Online: the game's levels come from its site (`POST https://totaljerkface.com/get_level.hw`, form data:
  `get_featured`, `get_all`, `get_record` for a level's data...), so XHR/fetch to other hosts go to
  `src/net.cpp`: libcurl + OpenSSL (the kit's) on six threads, connections/DNS/TLS sessions shared, one
  cookie jar (`/data/HappyWheels/cookies.txt`), certificates from `h5/ca-certificates.crt` (the Mozilla
  list as Debian ships it); PS4 host names through the kit's getaddrinfo wrapper (libSceNet's resolver).
  Requests carry what a browser showing the page sends (UA, Origin, Referer). Telemetry hosts (Sentry) are
  never contacted. A download (`J.download`, the downloading mounts) is written by the network thread to
  `<file>.part` and renamed only when whole and answered 200; download paths must be in the data folder.
  The PC build's `H5_NET_MAP` + `scripts/net-mock.py <answers> 18081 <mirror>` stand in for the site
  without the internet (a mirror folder of the site's files; misses are logged to fetch from Windows).

## Game files

Online edition: none in the pkg or the repository; the console downloads them from the site. Steam
edition: copied from the user's own Steam install at build time (`resources/webroot`) into the pkg. Never
in the repository, never in a release.

## Milestones

1. PC: JavaScriptCore + prelude boot the game's scripts to its asset loading (no GPU).
2. PC: WebGL, canvas 2D, images -> the main menu as PNG frames.
3. PS4: eboot with JIT, ps4gl, pad, audio -> main menu on the console, pad works.
4. Gameplay: physics speed, 30/60 fps, saves, memory over long sessions.
5. Keyboard (IME), downloaded levels, online level browser.
6. Release: source only, game files from the user's copy.

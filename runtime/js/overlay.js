// h5 runtime: its own controls over the page, drawn above the presented frame (gl.cpp's overlay natives):
//  - the pointer: the page's own controller cursor (the runtime paints no DOM, so it draws it here), or the
//    runtime's pointer, a mouse moved with the touch pad (and the left stick where the page reads no stick)
//  - the D-pad selector: jumps between the things that can be clicked (J.ui.targets); Cross clicks
//  - the quick menu (hold the touch pad): the frame counter and these controls' settings
// The app tells it where the page's cursor is and what can be clicked (app/gameui.js). Which buttons the page
// listens to comes from what it reads (js/input.js, J.pad); the runtime takes only buttons the page leaves alone.
(function (H5) {
'use strict';
const G = globalThis;
const J = H5.js;
const N = H5.gl;
if (!N || !N.available || !N.overlayDraw) return;
const P = J.pad;
const raw = H5.padState;   // [connected, timestamp, buttons x17, axes x4, touches, touch x, touch y, touch id]

const ui = J.ui = {
    pageCursor: null,   // () => null | {x, y}: the page's own pointer in client px, while it shows one
    targets: null,      // () => [{key, x, y, w, h, layer?, top?}] in client px: what the selector can pick; top:
                        // in the top layer (layer: which), as a dialog opened over the screen
    menuItems: [],      // the app's own quick menu entries: {label, value?() -> text, change?(step), action?()}
    fontFamily: 'sans-serif',
    boldFontFamily: 'sans-serif',
    version: '',        // shown in the quick menu
    toast: null,        // (text, ms): a short message at the bottom of the screen
    pageMode: null,     // () => 'play' | null: an app that knows when its game is being played says so
    menuOpen: () => menu.open,
    closeMenu: () => closeMenu(),
};

// ---------------------------------------------------------------- the controller
const CROSS = 0, CIRCLE = 1, TOUCH = 8, OPTIONS = 9, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;
const DIRS = [UP, DOWN, LEFT, RIGHT];
const bit = i => 1 << i;
const DPAD = bit(UP) | bit(DOWN) | bit(LEFT) | bit(RIGHT);
const ALL_BUTTONS = 0x1ffff;
const RECENT = 20;      // frames: a button the page read this recently is one it listens to
const HOLD_MS = 500;    // the touch pad held this long opens the quick menu
let down = 0, before = 0;   // the controller's buttons now and in the last frame (bits)
const pressed = i => (down >> i) & 1;
const pressedNow = i => ((down & ~before) >> i) & 1;
const releasedNow = i => ((before & ~down) >> i) & 1;
const reads = i => P.frame - P.buttonRead[i] < RECENT;
const readsAxis = i => P.frame - P.axisRead[i] < RECENT;
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const wrap = (v, n) => ((v % n) + n) % n;

// What the page does with the controller, from what it reads: 'play' when it reads the D-pad (a game's own
// controls), 'menu' when it reads the stick or Cross but not the D-pad (its own pointer), 'free' otherwise
// (nothing read: a level editor made for a mouse, a loading screen).
function pageMode()
{
    // an app that knows its game better says so (ui.pageMode: 'play' while the player drives, else null)
    const known = ui.pageMode ? ui.pageMode() : null;
    if (known) return known;
    if (reads(UP) || reads(DOWN) || reads(LEFT) || reads(RIGHT)) return 'play';
    if (readsAxis(0) || readsAxis(1) || reads(CROSS)) return 'menu';
    return 'free';
}

// ---------------------------------------------------------------- settings (<data>/runtime-settings.json)
const SETTINGS_PATH = H5.paths.data + '/runtime-settings.json';
const POINTER_SIZES = [['Small', 1.5], ['Medium', 2], ['Large', 3]];
const POINTER_SPEEDS = [['Slow', 0.6], ['Normal', 1], ['Fast', 1.6]];
const settings = { frameCounter: false, pointerSize: 1, pointerSpeed: 1, selector: true };
try { Object.assign(settings, JSON.parse(H5.readText(SETTINGS_PATH) || '{}')); } catch (e) { }
settings.pointerSize = clamp(settings.pointerSize | 0, 0, POINTER_SIZES.length - 1);
settings.pointerSpeed = clamp(settings.pointerSpeed | 0, 0, POINTER_SPEEDS.length - 1);
const saveSettings = () => H5.writeFile(SETTINGS_PATH, JSON.stringify(settings));

// ---------------------------------------------------------------- screen and page coordinates
let screen = [1920, 1080, 0, 0, 1920, 1080];   // presentRect(): screen w, h; where the page's canvas shows
let canvasRect = null;                          // that canvas's client rectangle
function updateMapping()
{
    screen = N.presentRect();
    const c = J.mainCanvas;
    const r = c && c.getBoundingClientRect();
    canvasRect = r && r.width > 0 && r.height > 0 ? r : null;
}
function toScreen(x, y)
{
    const r = canvasRect;
    if (!r) return [x * screen[0] / (G.innerWidth || screen[0]), y * screen[1] / (G.innerHeight || screen[1])];
    return [screen[2] + (x - r.left) / r.width * screen[4], screen[3] + (y - r.top) / r.height * screen[5]];
}
function toClient(x, y)
{
    const r = canvasRect;
    if (!r) return [x * (G.innerWidth || screen[0]) / screen[0], y * (G.innerHeight || screen[1]) / screen[1]];
    return [r.left + (x - screen[2]) / screen[4] * r.width, r.top + (y - screen[3]) / screen[5] * r.height];
}

// ---------------------------------------------------------------- drawing: 2D canvases as overlay textures
let nextTexture = 1;
class Sprite {
    constructor() { this.id = nextTexture++; this.canvas = G.document.createElement('canvas'); this.ctx = null; this.w = 0; this.h = 0; }
    // the context, cleared, for a w x h picture
    begin(w, h) {
        w = Math.max(1, Math.ceil(w));
        h = Math.max(1, Math.ceil(h));
        if (w !== this.canvas.width) this.canvas.width = w;
        if (h !== this.canvas.height) this.canvas.height = h;
        const ctx = this.ctx || (this.ctx = this.canvas.getContext('2d'));
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, w, h);
        this.w = w;
        this.h = h;
        return ctx;
    }
    commit() { N.overlayTexture(this.id, J.sourceHandle(this.canvas)); }
    draw(x, y, alpha = 1) { N.overlayDraw(this.id, Math.round(x), Math.round(y), this.w, this.h, 1, 1, 1, alpha); }
}
const fill = (x, y, w, h, r, g, b, a) => N.overlayDraw(0, x, y, w, h, r, g, b, a);
const font = (px, bold) => (bold ? 'bold ' : '') + px + 'px ' + (bold ? ui.boldFontFamily : ui.fontFamily);
const ACCENT = '#ffc928';

// a PlayStation button's symbol in a dark disc, centred on (x, y)
function buttonIcon(ctx, x, y, which)
{
    ctx.save();
    ctx.fillStyle = '#2b2b33';
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (which === 'cross') {
        ctx.strokeStyle = '#8ab4ff';
        ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y + 6);
        ctx.moveTo(x + 6, y - 6); ctx.lineTo(x - 6, y + 6);
    } else if (which === 'circle') {
        ctx.strokeStyle = '#ff7a7a';
        ctx.arc(x, y, 7, 0, Math.PI * 2);
    } else {   // 'leftright': the D-pad's sides
        ctx.fillStyle = '#e8e8e8';
        ctx.moveTo(x - 9, y); ctx.lineTo(x - 3, y - 6); ctx.lineTo(x - 3, y + 6); ctx.closePath();
        ctx.moveTo(x + 9, y); ctx.lineTo(x + 3, y - 6); ctx.lineTo(x + 3, y + 6); ctx.closePath();
        ctx.fill();
        ctx.restore();
        return;
    }
    ctx.stroke();
    ctx.restore();
}

// ---------------------------------------------------------------- the pointer picture (the page's arrow)
const pointer = { sprite: new Sprite(), scale: 0, pad: 0 };
function pointerSprite()
{
    const scale = POINTER_SIZES[settings.pointerSize][1];
    if (pointer.scale === scale) return pointer.sprite;
    pointer.scale = scale;
    const line = Math.max(1.5, scale);
    const pad = pointer.pad = Math.ceil(line) + 1;
    const ctx = pointer.sprite.begin(14 * scale + pad * 2, 21 * scale + pad * 2);
    const pts = [0, 0, 0, 17, 4, 13, 6, 19, 9, 18, 7, 12, 12, 12];   // the page's SVG arrow, 14 x 21
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) ctx.lineTo(pad + pts[i] * scale, pad + pts[i + 1] * scale);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineJoin = 'miter';
    ctx.lineWidth = line;
    ctx.strokeStyle = '#000000';
    ctx.stroke();
    pointer.sprite.commit();
    return pointer.sprite;
}

// ---------------------------------------------------------------- the runtime's pointer: a mouse
const mouse = {
    x: 960, y: 540,     // screen px
    shown: false,       // drawn; Cross is its button
    buttons: 0,
    inside: false,      // pointerover sent
    touchId: -1, touchX: 0, touchY: 0,
    wheelAt: 0,
};
function mouseEvent(type, extra)
{
    const target = J.mainCanvas || G.document.body;
    if (!target) return;
    const [cx, cy] = toClient(mouse.x, mouse.y);
    const init = {
        bubbles: true, cancelable: true, composed: true, view: G, detail: 0,
        clientX: cx, clientY: cy, screenX: Math.round(mouse.x), screenY: Math.round(mouse.y),
        button: 0, buttons: mouse.buttons, pointerId: 1, pointerType: 'mouse', isPrimary: true,
        pressure: mouse.buttons ? 0.5 : 0,
    };
    if (extra) Object.assign(init, extra);
    const Ctor = type.startsWith('pointer') ? G.PointerEvent : type === 'wheel' ? G.WheelEvent : G.MouseEvent;
    J.fire(target, new Ctor(type, init));
}
function enterCanvas()
{
    if (mouse.inside) return;
    mouse.inside = true;
    mouseEvent('pointerover');
    mouseEvent('pointerenter', { bubbles: false });
    mouseEvent('mouseover');
    mouseEvent('mouseenter', { bubbles: false });
}
function leaveCanvas()
{
    if (!mouse.inside) return;
    mouse.inside = false;
    mouseEvent('pointerout');
    mouseEvent('pointerleave', { bubbles: false });
    mouseEvent('mouseout');
    mouseEvent('mouseleave', { bubbles: false });
}
// the mouse to (x, y) in screen px, as a hand on a mouse moves it
function moveMouse(x, y)
{
    x = clamp(x, 0, screen[0] - 1);
    y = clamp(y, 0, screen[1] - 1);
    const mx = Math.round(x) - Math.round(mouse.x), my = Math.round(y) - Math.round(mouse.y);
    mouse.x = x;
    mouse.y = y;
    if (!mx && !my && mouse.inside) return;
    enterCanvas();
    mouseEvent('pointermove', { button: -1, movementX: mx, movementY: my });
    mouseEvent('mousemove', { movementX: mx, movementY: my });
}
// a jump: two moves, so that a page comparing positions sees the mouse move even onto the same spot
function jumpMouse(x, y)
{
    moveMouse(x + 3, y);
    moveMouse(x, y);
}
function pressMouse(isDown)
{
    if (!!mouse.buttons === isDown) return;
    enterCanvas();
    mouse.buttons = isDown ? 1 : 0;
    if (H5.platform === 'host' && ui.hitAtPointer) {   // (the PC test build: what the press lands on)
        const hit = ui.hitAtPointer();
        H5.log(1, 'ui: mouse ' + (isDown ? 'down' : 'up') + ' at ' + Math.round(mouse.x) + ',' + Math.round(mouse.y) + ' on ' +
            (hit ? (hit.constructor && hit.constructor.name) + (hit.name ? ' "' + hit.name + '"' : '') : 'nothing'));
    }
    if (isDown) {
        mouseEvent('pointerdown');
        mouseEvent('mousedown');
    } else {
        mouseEvent('pointerup');
        mouseEvent('mouseup');
        mouseEvent('click', { detail: 1 });
    }
}

// ---------------------------------------------------------------- the D-pad selector
const sel = {
    on: false,          // the D-pad was the last thing used: Cross clicks the chosen target
    key: null,
    rect: null,         // the chosen target, client px
    checkAt: 0,         // the next check that it is still there
    dir: -1, repeatAt: 0,
    autoAt: 0,          // the next look for something to select by itself
    fullAt: 0,          // the next full look at the page's options (in between: is the choice still there)
    pending: null,      // a move waiting for the list it scrolled: {dir, at}
    layer: null,        // the top layer last seen
    auto: false,        // the choice was the runtime's, not the D-pad's
    clickAt: 0,         // Cross clicked the choice then: what wasn't there before it is the next screen
    before: null,       // the targets then
};
const cost = { calls: 0, ms: 0, at: 0 };   // (the PC test build logs what finding targets costs)
let frameNo = 0;
const scan = { frame: -1, at: 0, list: null };   // (one look at the page's options a frame at most: it walks the scene)
// (maxAge ms: a look that recent will do: the D-pad held down moves 9 times a second)
function targetList(maxAge)
{
    if (!ui.targets) return [];
    const now = H5.now();
    if (scan.list && (scan.frame === frameNo || (maxAge && now - scan.at < maxAge))) return scan.list;
    scan.list = findTargets();
    scan.frame = frameNo;
    scan.at = now;
    return scan.list;
}
function findTargets()
{
    try {
        const t0 = H5.now();
        const list = ui.targets() || [];
        if (H5.platform === 'host') {
            cost.calls++; cost.ms += H5.now() - t0;
            if (t0 - cost.at > 5000) { if (cost.calls) H5.log(1, 'ui: targets: ' + cost.calls + ' scans, ' + (cost.ms / cost.calls).toFixed(1) + ' ms each, ' + list.length + ' found'); cost.calls = 0; cost.ms = 0; cost.at = t0; }
        }
        // on the picture (not parked off it), and not the page's backdrop: something covering most of the
        // picture is no button
        const r = canvasRect || { left: 0, top: 0, width: G.innerWidth, height: G.innerHeight };
        const area = r.width * r.height;
        return list.filter(t => {
            const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
            // (and no scroll bars: tall and thin; the D-pad scrolls a list itself)
            return t.w * t.h < area * 0.6 && cx >= r.left && cy >= r.top && cx < r.left + r.width && cy < r.top + r.height &&
                !(t.h > t.w * 5 && t.w < 60);
        });
    } catch (e) {
        J.reportError(e, 'ui targets');
        return [];
    }
}
const centreOf = t => [t.x + t.w / 2, t.y + t.h / 2];
// (leftFirst: of two about as near, the one to the left or above: where a dialog keeps its OK)
function nearest(list, x, y, leftFirst)
{
    let best = null, bestD = Infinity;
    for (const t of list) {
        const [cx, cy] = centreOf(t);
        let d = Math.hypot(cx - x, cy - y);
        if (leftFirst) d += (cx + cy) * 0.05;
        if (d < bestD) { bestD = d; best = t; }
    }
    return best;
}
// the target in direction dir (0 up, 1 down, 2 left, 3 right) from `from`: the closest one ahead, things in
// line with it first
function inDirection(list, from, dir)
{
    const [fx, fy] = centreOf(from);
    const vertical = dir < 2, sign = dir === 0 || dir === 2 ? -1 : 1;
    let best = null, bestScore = Infinity;
    for (const t of list) {
        if (t.key === from.key) continue;
        const [tx, ty] = centreOf(t);
        const along = (vertical ? ty - fy : tx - fx) * sign;
        if (along <= 2) continue;
        // the gap between the two across the direction (0 when they overlap)
        const gap = vertical ? Math.max(0, Math.max(from.x, t.x) - Math.min(from.x + from.w, t.x + t.w))
            : Math.max(0, Math.max(from.y, t.y) - Math.min(from.y + from.h, t.y + t.h));
        const off = Math.abs(vertical ? tx - fx : ty - fy);
        const score = along + gap * 3 + off * 0.25;
        if (score < bestScore) { bestScore = score; best = t; }
    }
    return best;
}
// the chosen target in this list: itself, or what took its place (a game that builds a button anew shows
// the new one where the old one was); else, while the pointer is over it, the chosen one as it is (hovering
// can change a button so that it fails the targets' checks: a tooltip, a picture swapped)
function currentIn(list)
{
    if (!sel.on || !sel.key) return null;
    const same = list.find(t => t.key === sel.key);
    if (same) return same;
    const r = sel.rect;
    if (r) {
        const [cx, cy] = centreOf(r);
        const twin = list.find(t => { const [tx, ty] = centreOf(t); return Math.abs(tx - cx) < 6 && Math.abs(ty - cy) < 6 &&
            Math.abs(t.w - r.w) < Math.max(8, r.w * 0.2) && Math.abs(t.h - r.h) < Math.max(8, r.h * 0.2); });
        if (twin) { sel.key = twin.key; return twin; }
    }
    if (ui.targetRect && ui.isHovered && ui.isHovered(sel.key)) {
        const now = ui.targetRect(sel.key);
        if (now) return Object.assign({ key: sel.key, top: true }, now);
    }
    return null;
}
function choose(t, auto)
{
    sel.auto = !!auto;
    sel.on = true;
    sel.key = t.key;
    sel.rect = { x: t.x, y: t.y, w: t.w, h: t.h };
    mouse.shown = false;
    const [cx, cy] = centreOf(t);
    const [sx, sy] = toScreen(cx, cy);
    jumpMouse(sx, sy);
    H5.log(1, 'ui: selector at ' + Math.round(sx) + ',' + Math.round(sy) + ' (' + Math.round(t.w) + 'x' + Math.round(t.h) + ')');
    if (H5.platform === 'host' && ui.describe) ui.describe(t.key);   // (the PC test build: what it is)
}
function navigate(dir)
{
    if (H5.platform === 'host' && ui.dumpTargets) ui.dumpTargets();   // (the PC test build: what it sees)
    if (sel.pending) return;   // (a list still scrolling)
    const list = targetList(400);
    if (!list.length) return;
    const current = currentIn(list);
    let next;
    if (current) {
        next = inDirection(list, current, dir);
        // up or down out of a scrolled list, or past the last option: scroll what is under it first; a moment
        // later the row that came into view is the choice, or (the list at its end) the move goes on
        if (dir < 2 && (current.list ? !next || next.list !== current.list : !next)) {
            enterCanvas();
            mouseEvent('wheel', { deltaY: dir === 0 ? -100 : 100, deltaMode: 0 });
            sel.pending = { dir, at: H5.now() + 150 };
            return;
        }
    } else {
        // start where the pointer is
        const [x, y] = toClient(mouse.x, mouse.y);
        next = nearest(list, x, y);
    }
    if (next) choose(next);
}
function finishScroll(now)
{
    const p = sel.pending;
    if (!p || now < p.at) return;
    sel.pending = null;
    scan.list = null;   // (the list has moved)
    const list = targetList();
    const current = currentIn(list);
    if (!current) return;
    const within = current.list ? list.filter(t => t.list === current.list) : list;
    const next = inDirection(within, current, p.dir) || inDirection(list, current, p.dir);
    if (next) choose(next);
}
// the chosen target moves or goes (a click opened another screen): follow it, or take the nearest one
function checkTarget(now)
{
    if (!sel.on || now < sel.checkAt) return;
    sel.checkAt = now + 200;
    const clicked = sel.before && now - sel.clickAt < 3000;
    // the usual case, the choice still there under the pointer: no full look but once a second
    if (!clicked && now < sel.fullAt && sel.key && ui.isHovered && ui.isHovered(sel.key)) return;
    sel.fullAt = now + 1000;
    const list = targetList();
    const current = currentIn(list);
    // a dialog opened over the screen: the choice goes into it
    const layer = list.length ? list[0].layer || null : null;
    const newLayer = layer !== sel.layer;
    sel.layer = layer;
    if (newLayer && current && !current.top && list.some(t => t.top)) { choose(firstPick(list), true); return; }
    // a click a moment ago: options that weren't there then are the screen it opened (the old one can take
    // a while to go), unless the D-pad has moved since
    if (clicked) {
        const fresh = list.filter(t => !sel.before.has(t.key));
        if (fresh.length && (!current || sel.auto || sel.before.has(current.key))) {
            const pick = firstPick(fresh);
            if (!current || pick.key !== current.key) { choose(pick, true); return; }
        }
    } else {
        sel.before = null;
    }
    if (current) {
        if (!ui.targetRect) sel.rect = { x: current.x, y: current.y, w: current.w, h: current.h };
        return;
    }
    // gone: on a new screen its first choice, else (the same screen, changed) the one nearest where it was
    const [x, y] = sel.rect ? centreOf(sel.rect) : toClient(mouse.x, mouse.y);
    const next = list.length ? (newLayer ? firstPick(list) : nearest(list, x, y)) : null;
    if (next) {
        choose(next, true);
    } else {
        sel.key = null;
        sel.rect = null;
    }
}
// each frame: where the chosen target shows now (buttons grow and slide as they are hovered); the mouse
// stays on it
function followTarget(moveTheMouse)
{
    if (!sel.on || !sel.key) return;
    if (ui.targetRect) {
        const r = ui.targetRect(sel.key);
        if (!r) return;   // (gone: checkTarget takes the nearest one)
        sel.rect = r;
    }
    const r = sel.rect;
    if (!moveTheMouse || !r || mouse.buttons) return;
    const [mx, my] = toClient(mouse.x, mouse.y);
    if (mx < r.x || my < r.y || mx > r.x + r.w || my > r.y + r.h) {
        const [sx, sy] = toScreen(r.x + r.w / 2, r.y + r.h / 2);
        moveMouse(sx, sy);
    }
}
// what to choose on a screen or a dialog that just showed: in its top layer, the option nearest that layer's
// middle (of two about as near, the one to the left or above)
function firstPick(list)
{
    const top = list.filter(t => t.top);
    const of = top.length ? top : list;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of of) { x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y); x1 = Math.max(x1, t.x + t.w); y1 = Math.max(y1, t.y + t.h); }
    return nearest(of, (x0 + x1) / 2, (y0 + y1) / 2, true);
}
// a page with no pointer of its own: its menus show with an option chosen, as a console game's do; not while
// the runtime's pointer is out
function autoSelect(now, pageHasCursor)
{
    if (sel.on || mouse.shown || pageHasCursor || now < sel.autoAt) return;
    sel.autoAt = now + 250;
    const list = targetList();
    if (!list.length) return;
    sel.layer = list[0].layer || null;
    choose(firstPick(list), true);
}
function selectorInput(now)
{
    let dir = -1;
    for (let i = 0; i < 4; i++) if (pressedNow(DIRS[i])) dir = i;
    if (dir >= 0) {
        sel.dir = dir;
        sel.repeatAt = now + 380;
    } else if (sel.dir >= 0 && pressed(DIRS[sel.dir])) {
        if (now >= sel.repeatAt) {
            dir = sel.dir;
            sel.repeatAt = now + 110;
        }
    } else {
        sel.dir = -1;
    }
    if (dir >= 0) navigate(dir);
}

// ---------------------------------------------------------------- the selection frame
// A rounded white line with a soft blue light around it, a little outside what the chosen option shows; it
// glides from option to option and swells a moment on each new one. One small picture drawn as nine parts
// (corners as they are, sides and middle stretched), so any size and every frame costs nothing to draw.
const FRAME_T = 72, FRAME_PAD = 16, FRAME_CORNER = 32, FRAME_GAP = 5;
const frame = { sprite: new Sprite(), ready: false, shown: false, key: null, x: 0, y: 0, w: 0, h: 0, at: 0, changed: 0 };
function frameTexture()
{
    if (frame.ready) return;
    frame.ready = true;
    const T = FRAME_T, P = FRAME_PAD, R = 14;
    const ctx = frame.sprite.begin(T, T);
    if (H5.platform === 'host') {   // (the PC test build's canvas draws no curves: straight lines, to see where)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(P - 1, P - 1, T - P * 2 + 2, 3);
        ctx.fillRect(P - 1, T - P - 2, T - P * 2 + 2, 3);
        ctx.fillRect(P - 1, P - 1, 3, T - P * 2 + 2);
        ctx.fillRect(T - P - 2, P - 1, 3, T - P * 2 + 2);
        frame.sprite.commit();
        return;
    }
    ctx.save();
    ctx.shadowColor = 'rgba(90, 190, 255, 1)';
    ctx.shadowBlur = 14;
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(150, 215, 255, 0.9)';
    ctx.beginPath();
    ctx.roundRect(P, P, T - P * 2, T - P * 2, R);
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(P, P, T - P * 2, T - P * 2, R);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.beginPath();
    ctx.roundRect(P + 2, P + 2, T - P * 2 - 4, T - P * 2 - 4, R - 2);
    ctx.fill();
    frame.sprite.commit();
}
// the picture stretched over (x, y, w, h), the line on that rectangle's edge
function nineSlice(x, y, w, h, alpha)
{
    const T = FRAME_T, C = FRAME_CORNER, P = FRAME_PAD, mid = T - C * 2;
    x -= P; y -= P; w += P * 2; h += P * 2;
    if (w < C * 2) { x -= (C * 2 - w) / 2; w = C * 2; }
    if (h < C * 2) { y -= (C * 2 - h) / 2; h = C * 2; }
    const cols = [[x, C, 0, C], [x + C, w - C * 2, C, mid], [x + w - C, C, T - C, C]];
    const rows = [[y, C, 0, C], [y + C, h - C * 2, C, mid], [y + h - C, C, T - C, C]];
    for (const [rx, rw, sx, sw] of cols) {
        for (const [ry, rh, sy, sh] of rows) {
            if (rw > 0 && rh > 0) N.overlayDraw(frame.sprite.id, rx, ry, rw, rh, 1, 1, 1, alpha, sx, sy, sw, sh);
        }
    }
}
function drawFrame(now)
{
    const dt = frame.at ? Math.min(0.1, (now - frame.at) / 1000) : 0;
    frame.at = now;
    if (menu.open || !sel.on || !sel.rect) {
        frame.shown = false;
        return;
    }
    frameTexture();
    const [x0, y0] = toScreen(sel.rect.x, sel.rect.y);
    const [x1, y1] = toScreen(sel.rect.x + sel.rect.w, sel.rect.y + sel.rect.h);
    const g = FRAME_GAP;
    const tx = x0 - g, ty = y0 - g, tw = x1 - x0 + g * 2, th = y1 - y0 + g * 2;
    if (!frame.shown) {
        Object.assign(frame, { x: tx, y: ty, w: tw, h: th, shown: true, changed: now, key: sel.key });
    } else if (frame.key !== sel.key) {
        frame.key = sel.key;
        frame.changed = now;
    }
    const k = 1 - Math.exp(-dt * 22);   // the glide
    frame.x += (tx - frame.x) * k;
    frame.y += (ty - frame.y) * k;
    frame.w += (tw - frame.w) * k;
    frame.h += (th - frame.h) * k;
    const age = (now - frame.changed) / 1000;
    const swell = age < 0.24 ? Math.sin(age / 0.24 * Math.PI) * 4 : 0;
    const alpha = 0.84 + 0.16 * Math.sin(now / 240);
    nineSlice(frame.x - swell, frame.y - swell, frame.w + swell * 2, frame.h + swell * 2, alpha);
}

// ---------------------------------------------------------------- the quick menu
const menu = { open: false, index: 0, sprite: new Sprite(), dirty: true, confirm: -1, confirmUntil: 0, dir: -1, repeatAt: 0, keepHidden: 0 };
const MENU_W = 660, ROW_H = 58, HEAD_H = 92, FOOT_H = 70;
function menuEntries()
{
    const onOff = v => v ? 'On' : 'Off';
    return [
        { label: 'Resume', action: closeMenu },
        { label: 'Frame counter', value: () => onOff(settings.frameCounter), change: () => { settings.frameCounter = !settings.frameCounter; } },
        { label: 'Pointer size', value: () => POINTER_SIZES[settings.pointerSize][0], change: d => { settings.pointerSize = wrap(settings.pointerSize + d, POINTER_SIZES.length); } },
        { label: 'Pointer speed', value: () => POINTER_SPEEDS[settings.pointerSpeed][0], change: d => { settings.pointerSpeed = wrap(settings.pointerSpeed + d, POINTER_SPEEDS.length); } },
        { label: 'D-pad selector', value: () => onOff(settings.selector), change: () => { settings.selector = !settings.selector; if (!settings.selector) sel.on = false; } },
        ...ui.menuItems,
        { label: 'Restart game', confirm: true, action: () => { H5.log(1, 'ui: restart from the quick menu'); J.flushStorage && J.flushStorage(); H5.reload(); } },
        { label: 'Quit game', confirm: true, action: () => { H5.log(1, 'ui: quit from the quick menu'); J.flushStorage && J.flushStorage(); H5.exit(0); } },
    ];
}
function openMenu()
{
    menu.open = true;
    J.pausePage = true;   // the game waits behind the menu
    menu.index = 0;
    menu.confirm = -1;
    menu.dir = -1;
    menu.dirty = true;
    pressMouse(false);
    H5.log(1, 'ui: quick menu opened');
}
function closeMenu()
{
    menu.open = false;
    J.pausePage = false;
    menu.keepHidden = down;   // buttons still held stay away from the page until let go
    H5.log(1, 'ui: quick menu closed');
}
function renderMenu()
{
    const items = menuEntries();
    menu.index = wrap(menu.index, items.length);
    const h = HEAD_H + items.length * ROW_H + FOOT_H;
    const ctx = menu.sprite.begin(MENU_W, h);
    ctx.fillStyle = 'rgba(20, 20, 26, 0.95)';
    ctx.beginPath();
    ctx.roundRect(0, 0, MENU_W, h, 20);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(1, 1, MENU_W - 2, h - 2, 19);
    ctx.stroke();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = font(34, true);
    ctx.fillText('Quick Menu', 40, HEAD_H / 2 - 4);
    ctx.fillStyle = ACCENT;
    ctx.fillRect(40, HEAD_H - 24, 64, 5);
    if (ui.version) {
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.font = font(22, false);
        ctx.fillText(ui.version, MENU_W - 40, HEAD_H / 2 - 4);
    }
    items.forEach((it, i) => {
        const y = HEAD_H + i * ROW_H;
        const chosen = i === menu.index;
        if (chosen) {
            ctx.fillStyle = ACCENT;
            ctx.beginPath();
            ctx.roundRect(22, y + 4, MENU_W - 44, ROW_H - 8, 12);
            ctx.fill();
        }
        const ink = chosen ? '#17171c' : '#f0f0f0';
        ctx.fillStyle = ink;
        ctx.textAlign = 'left';
        ctx.font = font(28, chosen);
        const asking = menu.confirm === i;
        ctx.fillText(asking ? it.label + '? Press again' : it.label, 44, y + ROW_H / 2 + 1);
        if (it.value) {
            const v = String(it.value());
            ctx.textAlign = 'right';
            const right = MENU_W - 44 - (chosen ? 22 : 0);
            ctx.fillText(v, right, y + ROW_H / 2 + 1);
            if (chosen) {   // the arrows that change it
                const w = ctx.measureText(v).width;
                const cy = y + ROW_H / 2;
                ctx.beginPath();
                ctx.moveTo(right - w - 22, cy); ctx.lineTo(right - w - 12, cy - 8); ctx.lineTo(right - w - 12, cy + 8); ctx.closePath();
                ctx.moveTo(right + 20, cy); ctx.lineTo(right + 10, cy - 8); ctx.lineTo(right + 10, cy + 8); ctx.closePath();
                ctx.fill();
            }
        }
    });
    // the buttons it answers to
    const fy = h - FOOT_H / 2;
    ctx.font = font(22, false);
    ctx.textAlign = 'left';
    let x = 44;
    for (const [icon, text] of [['cross', 'Select'], ['leftright', 'Change'], ['circle', 'Back']]) {
        buttonIcon(ctx, x + 15, fy, icon);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.fillText(text, x + 38, fy + 1);
        x += 38 + ctx.measureText(text).width + 34;
    }
    menu.sprite.commit();
    menu.dirty = false;
}
function menuInput(now)
{
    const items = menuEntries();
    const lx = raw[19], ly = raw[20];
    const dir = pressed(UP) || ly < -0.6 ? 0 : pressed(DOWN) || ly > 0.6 ? 1 : pressed(LEFT) || lx < -0.6 ? 2 : pressed(RIGHT) || lx > 0.6 ? 3 : -1;
    let step = -1;
    if (dir !== menu.dir) {
        menu.dir = dir;
        menu.repeatAt = now + 380;
        step = dir;
    } else if (dir >= 0 && now >= menu.repeatAt) {
        menu.repeatAt = now + 120;
        step = dir;
    }
    const item = items[wrap(menu.index, items.length)];
    if (step === 0 || step === 1) {
        menu.index = wrap(menu.index + (step ? 1 : -1), items.length);
        menu.confirm = -1;
        menu.dirty = true;
    } else if ((step === 2 || step === 3) && item.change) {
        item.change(step === 3 ? 1 : -1);
        saveSettings();
        menu.dirty = true;
    }
    if (pressedNow(CROSS)) {
        if (item.confirm) {
            if (menu.confirm === menu.index && now < menu.confirmUntil) {
                item.action();
            } else {
                menu.confirm = menu.index;
                menu.confirmUntil = now + 3000;
            }
        } else if (item.action) {
            item.action();
        } else if (item.change) {
            item.change(1);
            saveSettings();
        }
        menu.dirty = true;
    }
    if (menu.confirm >= 0 && now >= menu.confirmUntil) {
        menu.confirm = -1;
        menu.dirty = true;
    }
    if (pressedNow(CIRCLE) || pressedNow(OPTIONS)) closeMenu();
}

// ---------------------------------------------------------------- the touch pad button: tap or hold
const touch = { downAt: -1, held: false, ignore: false, tapFrames: 0 };
function touchButton(now)
{
    if (pressedNow(TOUCH)) {
        touch.downAt = now;
        touch.held = false;
        touch.ignore = false;
        if (menu.open) {   // a press closes the menu
            closeMenu();
            touch.ignore = true;
        }
    }
    if (pressed(TOUCH) && touch.downAt >= 0 && !touch.held && !touch.ignore && now - touch.downAt >= HOLD_MS) {
        touch.held = true;
        openMenu();
    }
    if (releasedNow(TOUCH)) {
        // a tap is the page's: its button pressed for a moment
        if (touch.downAt >= 0 && !touch.held && !touch.ignore) touch.tapFrames = 6;
        touch.downAt = -1;
    }
}

// ---------------------------------------------------------------- the frame counter
const counter = { sprite: new Sprite(), text: '', last: null, at: 0 };
function frameCounter(now)
{
    if (!settings.frameCounter) {
        counter.last = null;
        return;
    }
    if (counter.last && now - counter.at < 500) return;
    const s = H5.frameStats();   // running totals: [frames shown, frames the page drew, ms of script+draw]
    if (counter.last) {
        const seconds = (now - counter.at) / 1000;
        const shown = s[0] - counter.last[0], drawn = s[1] - counter.last[1], work = s[2] - counter.last[2];
        const fps = Math.round(drawn / seconds) + ' FPS';
        const ms = (shown ? work / shown : 0).toFixed(1) + ' ms';
        if (fps + ms !== counter.text) {
            counter.text = fps + ms;
            const c0 = counter.sprite.begin(1, 1);
            c0.font = font(28, true);
            const w = Math.max(c0.measureText(fps).width, 70) + 36;
            const ctx = counter.sprite.begin(w, 76);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
            ctx.beginPath();
            ctx.roundRect(0, 0, w, 76, 12);
            ctx.fill();
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.fillStyle = '#ffffff';
            ctx.font = font(28, true);
            ctx.fillText(fps, 18, 27);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.font = font(20, false);
            ctx.fillText(ms, 18, 55);
            counter.sprite.commit();
        }
    }
    counter.last = s;
    counter.at = now;
}

// ---------------------------------------------------------------- messages
const toast = { sprite: new Sprite(), until: 0, ms: 0, start: 0 };
ui.toast = function (text, ms = 2500) {
    const c0 = toast.sprite.begin(1, 1);
    c0.font = font(26, false);
    const w = c0.measureText(text).width + 56;
    const ctx = toast.sprite.begin(w, 62);
    ctx.fillStyle = 'rgba(20, 20, 26, 0.9)';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, 62, 31);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = font(26, false);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, w / 2, 32);
    toast.sprite.commit();
    const now = H5.now();
    if (!(toast.until > now)) toast.start = now;   // (one already showing changes its words without fading in again)
    toast.ms = ms;
    toast.until = now + ms;
};

// ---------------------------------------------------------------- each frame
let pageCursorShown = false;
let pointerSource = 'none';
let lastMode = '';
let lastFrame = 0;

// (the PC test build: what the overlay's own work costs a frame)
const own = { before: 0, after: 0, frames: 0, at: 0 };
function ownCost(which, t0)
{
    if (H5.platform !== 'host') return;
    own[which] += H5.now() - t0;
    if (which === 'after' && ++own.frames >= 300) {
        H5.log(1, 'ui: overlay ' + (own.before / own.frames).toFixed(1) + ' ms before, ' + (own.after / own.frames).toFixed(1) + ' ms after the page, a frame');
        own.before = own.after = own.frames = 0;
    }
}
// before the page's frame: what the controller does, and what the page may see of it
J.beforeFrame.push(now => { const t0 = H5.now(); beforePage(now); ownCost('before', t0); });
function beforePage(now)
{
    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    before = down;
    down = 0;
    frameNo++;
    if (raw[0] > 0) for (let i = 0; i < 17; i++) if (raw[2 + i] > 0.5) down |= bit(i);
    updateMapping();
    touchButton(now);
    const mode = pageMode();
    if (mode !== lastMode) {
        lastMode = mode;
        H5.log(1, 'ui: the page ' + (mode === 'play' ? 'plays (it reads the D-pad)' : mode === 'menu' ? 'has its own pointer' : 'reads no controller'));
    }

    // the page's own pointer: when it appears, it is the pointer again
    const pc = ui.pageCursor ? ui.pageCursor() : null;
    if (pc) {
        if (!pageCursorShown) {
            sel.on = false;
            mouse.shown = false;
        }
        [mouse.x, mouse.y] = toScreen(pc.x, pc.y);
    }
    pageCursorShown = !!pc;

    if (menu.open) {
        menuInput(now);
    } else if (mode === 'play') {
        // the page's own controls: nothing of the runtime's but the menu; the pointer leaves the picture (a
        // button it rests on would keep its hover look, its tooltip)
        sel.on = false;
        mouse.shown = false;
        pressMouse(false);
        leaveCanvas();
    } else {
        // the mouse: the touch pad, and the left stick where the page reads no stick
        let dx = 0, dy = 0;
        const speed = POINTER_SPEEDS[settings.pointerSpeed][1];
        if (raw[23] > 0) {
            const id = raw[26];
            if (id === mouse.touchId) {
                dx += (raw[24] - mouse.touchX) * 1919 * 1.3 * speed;
                dy += (raw[25] - mouse.touchY) * 941 * 1.3 * speed;
            }
            mouse.touchId = id;
            mouse.touchX = raw[24];
            mouse.touchY = raw[25];
        } else {
            mouse.touchId = -1;
        }
        if (mode === 'free') {
            const lx = raw[19], ly = raw[20], m = Math.hypot(lx, ly);
            if (m > 0.2) {
                const v = Math.pow((Math.min(m, 1) - 0.2) / 0.8, 2) * 1500 * speed * dt;
                dx += lx / m * v;
                dy += ly / m * v;
            }
        }
        if (Math.abs(dx) >= 0.5 || Math.abs(dy) >= 0.5) {
            mouse.shown = true;
            sel.on = false;
            moveMouse(mouse.x + dx, mouse.y + dy);
        }
        // the right stick scrolls, where the page reads no stick
        if (mode === 'free' && mouse.shown && Math.abs(raw[22]) > 0.4 && now >= mouse.wheelAt) {
            mouse.wheelAt = now + 110;
            enterCanvas();
            mouseEvent('wheel', { deltaY: Math.sign(raw[22]) * 100, deltaMode: 0 });
        }
        if (settings.selector) {
            selectorInput(now);
            finishScroll(now);
            if (mode === 'free') autoSelect(now, !!pc);   // (a page that reads the stick moves its own pointer)
            checkTarget(now);
            followTarget(true);
        }
        // Cross is the mouse's button while the runtime has the pointer
        if (sel.on || mouse.shown) {
            if (pressedNow(CROSS) && (mouse.shown || sel.rect)) {
                pressMouse(true);
                if (sel.on) { sel.clickAt = now; sel.before = new Set(targetList().map(t => t.key)); sel.checkAt = now + 120; }
            }
            if (!pressed(CROSS)) pressMouse(false);
        } else {
            pressMouse(false);
        }
    }

    // what the page sees
    let hide = 0, hideAxes = 0, press = 0;
    if (menu.open) {
        hide = ALL_BUTTONS;
        hideAxes = 0xf;
    } else {
        menu.keepHidden &= down;
        hide |= menu.keepHidden;
        if (sel.on) hide |= DPAD | bit(CROSS);
        if (mouse.shown && mode !== 'play') hide |= bit(CROSS);
        if (mouse.shown && mode === 'free') hideAxes = 0xf;
        if (touch.tapFrames > 0) {
            press |= bit(TOUCH);
            touch.tapFrames--;
        }
    }
    if (pressed(TOUCH)) hide |= bit(TOUCH);   // the touch pad's button is the page's only as a tap
    P.hideButtons = hide & ~press;
    P.hideAxes = hideAxes;
    P.pressButtons = press;
}

// after the page's frame: the overlay's picture
J.afterFrame.push(now => { const t0 = H5.now(); afterPage(now); ownCost('after', t0); });
function afterPage(now)
{
    updateMapping();
    frameCounter(now);
    N.overlayBegin();
    // the selection
    followTarget(false);
    drawFrame(now);
    // the pointer: the page's own, else the runtime's
    if (!menu.open) {
        const pc = ui.pageCursor ? ui.pageCursor() : null;
        let at = null;
        if (pc) at = toScreen(pc.x, pc.y);
        else if (mouse.shown && !sel.on) at = [mouse.x, mouse.y];
        const source = pc ? 'the page’s' : at ? 'the runtime’s' : 'none';
        if (source !== pointerSource) {
            pointerSource = source;
            H5.log(1, 'ui: pointer: ' + source + (at ? ' at ' + Math.round(at[0]) + ',' + Math.round(at[1]) : ''));
        }
        if (at) {
            const s = pointerSprite();
            s.draw(at[0] - pointer.pad, at[1] - pointer.pad);
        }
    }
    if (settings.frameCounter && counter.text) counter.sprite.draw(36, 30);
    if (toast.until > now) {
        const left = toast.until - now;
        const a = Math.min(1, left / 400, (now - toast.start) / 200 + 0.0001);
        toast.sprite.draw((screen[0] - toast.sprite.w) / 2, screen[1] - 150, Math.max(0, a));
    }
    if (menu.open) {
        if (menu.dirty) renderMenu();
        fill(0, 0, screen[0], screen[1], 0, 0, 0, 0.5);
        menu.sprite.draw((screen[0] - menu.sprite.w) / 2, (screen[1] - menu.sprite.h) / 2);
    }
}

})(globalThis.__h5);

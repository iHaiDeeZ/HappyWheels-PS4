// Happy Wheels on h5: what the runtime's controls (js/overlay.js) need to know about the game.
//  - its controller cursor: a fixed <div> with an SVG arrow, moved with style.left/top and shown with
//    style.opacity '1' (the runtime paints no DOM, so the overlay draws the arrow where the div is)
//  - what can be clicked, for the D-pad selector: Pixi's interactive objects, found through its
//    InteractionManager (caught as it sets its interactionDOMElement, before the game's scripts run)
(function (H5) {
'use strict';
const G = globalThis;
const J = H5.js;
const ui = J.ui;
if (!ui) return;

ui.fontFamily = '"HelveticaNeueLT Std Med", "HelveticaNeueLT Std", sans-serif';
ui.boldFontFamily = '"HelveticaNeueLT Std Bold", "HelveticaNeueLT Std", sans-serif';
const version = H5.readText(H5.paths.app + '/version.txt');
if (version) ui.version = 'v' + version.trim();

// ---------------------------------------------------------------- Pixi's InteractionManager
let im = null;
Object.defineProperty(Object.prototype, 'interactionDOMElement', {
    configurable: true,
    get() { return undefined; },
    set(v) {
        Object.defineProperty(this, 'interactionDOMElement', { value: v, writable: true, enumerable: true, configurable: true });
        if (!im && typeof this.hitTest === 'function' && typeof this.processInteractive === 'function') {
            im = this;
            delete Object.prototype.interactionDOMElement;
            H5.log(1, 'ui: Pixi\'s interaction manager found');
        }
    },
});

// ---------------------------------------------------------------- the game's controller cursor
let cursorEl = null, cursorScanAt = 0;
function findCursor()
{
    if (cursorEl && cursorEl.isConnected) return cursorEl;
    cursorEl = null;
    const now = H5.now();
    if (now < cursorScanAt || !G.document.body) return null;
    cursorScanAt = now + 500;
    for (const el of G.document.body.children) {
        const s = el.style;
        if (el.localName === 'div' && s.position === 'fixed' && String(s.zIndex) === '99999') {
            cursorEl = el;
            H5.log(1, 'ui: the game\'s controller cursor found');
            break;
        }
    }
    return cursorEl;
}
ui.pageCursor = function () {
    const el = findCursor();
    if (!el || el.style.opacity !== '1') return null;
    return { x: parseFloat(el.style.left) || 0, y: parseFloat(el.style.top) || 0 };
};

// ---------------------------------------------------------------- what can be clicked
const CLICK_EVENTS = ['click', 'pointertap', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'tap', 'rightclick'];
const isButton = o => !!(o.buttonMode || o.cursor === 'pointer');
function clickable(o)
{
    if (isButton(o)) return true;
    const ev = o._events;
    if (ev) for (const k of CLICK_EVENTS) if (ev[k]) return true;
    return false;
}
// the title screen's store badges (Steam, App Store, Google Play): links out of the game, nothing on a PS4
const NOT_HERE = new Set(['steamButton', 'appButton', 'googlePlayAppButton']);
function inside(parent, o)
{
    for (let p = o; p; p = p.parent) if (p === parent) return true;
    return false;
}
// ---------------------------------------------------------------- what an option shows
// The selector frames what a button shows, not its box: images and text by their opaque pixels (their
// pictures often have transparent margins, text has padding), shapes by what they draw, nothing for the
// invisible hit rectangles buttons carry. In Pixi's global px; null when nothing shows.
const opaqueCache = new WeakMap();   // base texture -> Map(frame -> {id, r})
// the opaque part of a texture's frame, as fractions of the frame; undefined when the pixels can't be read
function textureOpaque(tex)
{
    const bt = tex.baseTexture;
    const src = bt && bt.resource && bt.resource.source;
    const handle = src ? J.sourceHandle(src) : null;
    if (!handle || !bt.width || !bt.height) return undefined;
    const f = tex.frame;
    let per = opaqueCache.get(bt);
    if (!per) opaqueCache.set(bt, per = new Map());
    const key = f.x + ',' + f.y + ',' + f.width + ',' + f.height;
    const kept = per.get(key);
    if (kept && kept.id === bt.dirtyId) return kept.r;
    const sx = (src.naturalWidth || src.width) / bt.width, sy = (src.naturalHeight || src.height) / bt.height;
    const pw = Math.max(1, Math.ceil(f.width * sx)), ph = Math.max(1, Math.ceil(f.height * sy));
    const b = H5.imageOpaqueBounds(handle, Math.floor(f.x * sx), Math.floor(f.y * sy), pw, ph);
    const r = b ? [b[0] / pw, b[1] / ph, b[2] / pw, b[3] / ph] : null;
    per.set(key, { id: bt.dirtyId, r });
    return r;
}
function addRect(acc, x0, y0, x1, y1)
{
    if (!(x1 > x0 && y1 > y0)) return;
    if (!acc.r) acc.r = [x0, y0, x1, y1];
    else acc.r = [Math.min(acc.r[0], x0), Math.min(acc.r[1], y0), Math.max(acc.r[2], x1), Math.max(acc.r[3], y1)];
}
// a local rectangle through a world transform, as the box around it
function addTransformed(acc, m, x0, y0, x1, y1)
{
    const xs = [m.a * x0 + m.c * y0 + m.tx, m.a * x1 + m.c * y0 + m.tx, m.a * x0 + m.c * y1 + m.tx, m.a * x1 + m.c * y1 + m.tx];
    const ys = [m.b * x0 + m.d * y0 + m.ty, m.b * x1 + m.d * y0 + m.ty, m.b * x0 + m.d * y1 + m.ty, m.b * x1 + m.d * y1 + m.ty];
    addRect(acc, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
}
function shows(o, acc)
{
    if (!o.visible || o.renderable === false || o.worldAlpha < 0.05 || o.isMask) return;
    const inner = o.mask && o.mask.getBounds ? { r: null } : acc;
    const tex = o.texture;
    if (o.tilePosition && o.anchor && o.worldTransform) {   // a tiling sprite: its own size
        const w = o._width || 0, h = o._height || 0;
        addTransformed(inner, o.worldTransform, -o.anchor.x * w, -o.anchor.y * h, (1 - o.anchor.x) * w, (1 - o.anchor.y) * h);
    } else if (tex && tex.orig && o.anchor && o.worldTransform) {   // a sprite or a text
        const orig = tex.orig, trim = tex.trim;
        const x0 = (trim ? trim.x : 0) - o.anchor.x * orig.width, y0 = (trim ? trim.y : 0) - o.anchor.y * orig.height;
        const w = trim ? trim.width : orig.width, h = trim ? trim.height : orig.height;
        const fr = textureOpaque(tex);
        if (fr !== null && w > 1 && h > 1) {   // (a 1x1 texture: an empty container's stand-in)
            const r = fr || [0, 0, 1, 1];
            addTransformed(inner, o.worldTransform, x0 + r[0] * w, y0 + r[1] * h, x0 + r[2] * w, y0 + r[3] * h);
        }
    } else if (o.geometry && o.geometry.graphicsData) {   // shapes: only the ones drawn visibly
        const drawn = o.geometry.graphicsData.some(d => (d.fillStyle && d.fillStyle.visible && d.fillStyle.alpha > 0.05) ||
            (d.lineStyle && d.lineStyle.visible && d.lineStyle.width > 0 && d.lineStyle.alpha > 0.05));
        if (drawn) {
            const lb = o.geometry.bounds;
            if (lb && lb.maxX > lb.minX) addTransformed(inner, o.worldTransform, lb.minX, lb.minY, lb.maxX, lb.maxY);
        }
    }
    if (o.children) for (const c of o.children) shows(c, inner);
    if (inner !== acc && inner.r) {   // clipped by its mask
        const m = o.mask.getBounds();
        addRect(acc, Math.max(inner.r[0], m.x), Math.max(inner.r[1], m.y), Math.min(inner.r[2], m.x + m.width), Math.min(inner.r[3], m.y + m.height));
    }
}
function shownBounds(o)
{
    const acc = { r: null };
    shows(o, acc);
    return acc.r;   // [x0, y0, x1, y1]
}

// Pixi px -> client px for the renderer's canvas
function mapping()
{
    const r = im && im.renderer;
    const root = r && r._lastObjectRendered;
    const view = r && r.view;
    if (!root || !view || !view.width) return null;
    const rect = view.getBoundingClientRect();
    const res = r.resolution || 1;
    return { root, rect, view: [view.width / res, view.height / res], kx: rect.width / (view.width / res), ky: rect.height / (view.height / res) };
}
const toClient = (m, b) => ({ x: m.rect.left + b[0] * m.kx, y: m.rect.top + b[1] * m.ky, w: (b[2] - b[0]) * m.kx, h: (b[3] - b[1]) * m.ky });

ui.targets = function () {
    const m = mapping();
    if (!m) return [];
    const root = m.root;
    const point = im.mouse && im.mouse.global ? im.mouse.global.clone() : { x: 0, y: 0 };
    const hits = (o, x, y) => { point.x = x; point.y = y; const hit = im.hitTest(point, root); return hit && inside(o, hit); };
    const found = [];
    // (clip: what the masks above it leave of the picture, and the innermost masked thing: a scrolled list.
    // Options clipped out of sight are passed over before Pixi's hit test, which costs a walk of the scene)
    const view = m.view;
    (function walk(o, clip, clipper) {
        if (!o.visible) return;
        if (o.mask && o.mask.getBounds) {
            const mb = o.mask.getBounds();
            clip = [Math.max(clip[0], mb.x), Math.max(clip[1], mb.y), Math.min(clip[2], mb.x + mb.width), Math.min(clip[3], mb.y + mb.height)];
            if (!(clip[2] > clip[0] && clip[3] > clip[1])) return;
            clipper = o;
        }
        if (o.interactive && clickable(o) && !NOT_HERE.has(o.name)) {
            const b = o.getBounds();
            if (b.width >= 4 && b.height >= 4 && b.x < clip[2] && b.y < clip[3] && b.x + b.width > clip[0] && b.y + b.height > clip[1]) {
                // what it shows (its box when nothing shows); there and on top: Pixi's own hit test finds it
                // (or something inside it) at the middle of what it shows, or of its box
                const s = shownBounds(o) || [b.x, b.y, b.x + b.width, b.y + b.height];
                const cx = (s[0] + s[2]) / 2, cy = (s[1] + s[3]) / 2;
                if (cx >= clip[0] && cy >= clip[1] && cx < clip[2] && cy < clip[3] &&
                    (hits(o, cx, cy) || hits(o, b.x + b.width / 2, b.y + b.height / 2)))
                    found.push({ o, s, clipper });
            }
        }
        if (o.interactiveChildren === false || !o.children) return;
        for (const c of o.children) walk(c, clip, clipper);
    })(root, [0, 0, view[0], view[1]], null);
    // this game marks each of its buttons (buttonMode: the hand cursor); its Flash layer gives every
    // interactive thing the same listeners, tooltips and backdrops too. A screen without one such mark
    // (parts of the editor) keeps the rest.
    if (found.some(f => isButton(f.o))) for (let i = found.length - 1; i >= 0; i--) if (!isButton(found[i].o)) found.splice(i, 1);
    const out = [];
    const holds = (a, b) => b[0] >= a[0] - 1 && b[1] >= a[1] - 1 && b[2] <= a[2] + 1 && b[3] <= a[3] + 1;
    // the top layer: the last one drawn (a dialog opened over the screen) and the others in the smallest
    // thing holding it and another one
    let layer = root;
    if (found.length) {
        for (let p = found[found.length - 1].o.parent; p && p !== root; p = p.parent) {
            if (found.filter(g => inside(p, g.o)).length >= 2) { layer = p; break; }
        }
    }
    for (const f of found) {
        // a clickable thing inside another: the inner one is the button
        if (found.some(g => g !== f && g.o !== f.o && inside(f.o, g.o))) continue;
        // a bare picture behind other buttons (a dialog's backdrop, there to catch clicks): no button
        if (!(f.o.children && f.o.children.length) && found.some(g => g !== f && holds(f.s, g.s))) continue;
        out.push(Object.assign({ key: f.o, layer, top: inside(layer, f.o), list: f.clipper }, toClient(m, f.s)));
    }
    return out;
};

// where a chosen target shows now (each frame: buttons grow and slide as they are hovered); null if it went
ui.targetRect = function (o) {
    const m = mapping();
    if (!m || !o || !o.visible) return null;
    if (!inside(m.root, o)) return null;
    const s = shownBounds(o);
    if (s) return toClient(m, s);
    const b = o.getBounds();
    return toClient(m, [b.x, b.y, b.x + b.width, b.y + b.height]);
};

// the pointer is on it (or on something inside it) and it still takes clicks: Pixi's own hit test where the
// pointer is (its "over" flags go stale on a button that stops being interactive)
ui.isHovered = function (o) {
    const m = mapping();
    if (!m || !o || !o.interactive || !o.worldVisible || !im.mouse || !im.mouse.global) return false;
    const hit = im.hitTest(im.mouse.global.clone(), m.root);
    return !!hit && inside(o, hit);
};

// what Pixi finds under the pointer, for the log (the PC test build calls it on each press)
ui.hitAtPointer = function () {
    const m = mapping();
    if (!m || !im.mouse || !im.mouse.global) return null;
    return im.hitTest(im.mouse.global.clone(), m.root);
};

// one target's make-up, for the log (the PC test build calls it for each choice)
ui.describe = function (o) {
    const line = (n, depth) => {
        const b = n.getBounds();
        const tex = n.texture && n.texture.orig ? ' tex ' + n.texture.orig.width + 'x' + n.texture.orig.height : '';
        const ha = n.hitArea ? ' hitArea ' + JSON.stringify({ x: n.hitArea.x, y: n.hitArea.y, w: n.hitArea.width, h: n.hitArea.height, r: n.hitArea.radius }) : '';
        H5.log(1, '    ' + '  '.repeat(depth) + (n.constructor && n.constructor.name) + (n.name ? ' "' + n.name + '"' : '') +
            ' ' + Math.round(b.x) + ',' + Math.round(b.y) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height) +
            ' a=' + (+n.alpha).toFixed(2) + (n.visible ? '' : ' hidden') + (n.renderable === false ? ' notRenderable' : '') +
            (n.interactive ? ' interactive' : '') + (n.isMask ? ' mask' : '') + tex + ha + (n.text !== undefined ? ' text="' + String(n.text).slice(0, 30) + '"' : ''));
        if (depth < 4 && n.children) for (const c of n.children.slice(0, 12)) line(c, depth + 1);
    };
    line(o, 0);
};

// a list of what the selector sees, for the log (the PC test build calls it on each D-pad press)
ui.dumpTargets = function () {
    const list = ui.targets();
    H5.log(1, 'ui: ' + list.length + ' targets');
    for (const t of list) {
        const o = t.key;
        const events = o._events ? Object.keys(o._events).join(',') : '';
        H5.log(1, '  ' + (o.constructor && o.constructor.name) + ' ' + Math.round(t.x) + ',' + Math.round(t.y) + ' ' +
            Math.round(t.w) + 'x' + Math.round(t.h) + (o.name ? ' "' + o.name + '"' : '') + (o.buttonMode ? ' buttonMode' : '') + ' [' + events + ']');
    }
    // every interactive object, and why it is not a target
    const r = im && im.renderer, root = r && r._lastObjectRendered;
    if (!root) return;
    const point = im.mouse.global.clone();
    let n = 0;
    (function walk(o, depth) {
        if (!o.visible) return;
        if (o.interactive && n < 60) {
            n++;
            const b = o.getBounds();
            point.x = b.x + b.width / 2;
            point.y = b.y + b.height / 2;
            const hit = im.hitTest(point, root);
            const events = o._events ? Object.keys(o._events).join(',') : '';
            H5.log(1, '  [interactive d' + depth + '] ' + Math.round(b.x) + ',' + Math.round(b.y) + ' ' + Math.round(b.width) + 'x' +
                Math.round(b.height) + (o.buttonMode ? ' buttonMode' : '') + (o.cursor ? ' cursor=' + o.cursor : '') +
                (o.hitArea ? ' hitArea' : '') + ' children=' + (o.children ? o.children.length : 0) +
                ' hit=' + (hit === o ? 'self' : hit ? (inside(o, hit) ? 'inside' : 'other') : 'none') +
                (o.interactiveChildren === false ? ' noChildren' : '') + ' [' + events + ']');
        }
        if (o.interactiveChildren === false || !o.children) return;
        for (const c of o.children) walk(c, depth + 1);
    })(root, 0);
};

})(globalThis.__h5);

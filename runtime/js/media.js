// h5 browser layer: images, fonts, <audio>/<video>.
(function (H5) {
'use strict';
const G = globalThis;
const J = H5.js;
const def = J.def;

// ---------------------------------------------------------------- images
class HTMLImageElement extends G.HTMLElement {
    constructor(tag) {
        super(tag || 'img');
        this._handle = null;
        this._natural = { w: 0, h: 0 };
        this._complete = true;
        this._loadSeq = 0;
        this._currentSrc = '';
    }
    get src() { const s = this.getAttribute('src'); return s ? J.resolveURL(s) || s : ''; }
    set src(v) { this.setAttribute('src', v); }
    get currentSrc() { return this._currentSrc; }
    get crossOrigin() { return this.getAttribute('crossorigin'); }
    set crossOrigin(v) { if (v === null) this.removeAttribute('crossorigin'); else this.setAttribute('crossorigin', v); }
    get alt() { return this.getAttribute('alt') || ''; }
    set alt(v) { this.setAttribute('alt', v); }
    get decoding() { return this.getAttribute('decoding') || 'auto'; }
    set decoding(v) { this.setAttribute('decoding', v); }
    get loading() { return this.getAttribute('loading') || 'eager'; }
    set loading(v) { this.setAttribute('loading', v); }
    get srcset() { return this.getAttribute('srcset') || ''; }
    set srcset(v) { this.setAttribute('srcset', v); }
    get referrerPolicy() { return ''; }
    set referrerPolicy(v) {}
    get width() { const a = this.getAttribute('width'); return a !== null ? parseInt(a, 10) : this._natural.w; }
    set width(v) { this.setAttribute('width', v); }
    get height() { const a = this.getAttribute('height'); return a !== null ? parseInt(a, 10) : this._natural.h; }
    set height(v) { this.setAttribute('height', v); }
    get naturalWidth() { return this._natural.w; }
    get naturalHeight() { return this._natural.h; }
    get complete() { return this._complete; }
    _intrinsicSize() { return { w: this.width, h: this.height }; }
    _attributeChanged(name, value) {
        if (name === 'src') this._load(value === null ? '' : J.resolveURL(value) || value);
    }
    _load(url) {
        const seq = ++this._loadSeq;
        this._handle = null;
        this._natural = { w: 0, h: 0 };
        this._currentSrc = url;
        if (!url) { this._complete = true; return; }
        this._complete = false;
        const done = (handle, w, h) => {
            if (seq !== this._loadSeq) return;
            this._complete = true;
            if (handle) {
                this._handle = handle;
                this._natural = { w, h };
                J.layoutChanged();
                J.fire(this, new G.Event('load'));
            } else {
                J.fire(this, new G.Event('error'));
            }
            if (this._decodeWaiters) { for (const [ok, fail] of this._decodeWaiters) handle ? ok() : fail(new G.DOMException('The source image cannot be decoded.', 'EncodingError')); this._decodeWaiters = null; }
        };
        const path = J.urlToPath(url);
        if (path) {
            J.ensureLocal(url, path, ok => {
                if (seq !== this._loadSeq) return;
                if (ok) H5.imageDecodeFile(J.request(done), path);
                else done(null);
            });
            return;
        }
        J.loadBytes(url, (bytes, info) => {
            if (seq !== this._loadSeq) return;
            if (!bytes) { done(null); return; }
            // an SVG with HTML in a <foreignObject>: drawn by js/htmlimage.js
            const html = J.htmlInSVG(bytes, info && info.type);
            if (html) { done(html.handle, html.width, html.height); return; }
            H5.imageDecodeBytes(J.request(done), bytes, url.slice(0, 120));
        });
    }
    decode() {
        if (this._complete) return this._handle ? Promise.resolve() : Promise.reject(new G.DOMException('The source image cannot be decoded.', 'EncodingError'));
        return new Promise((ok, fail) => { (this._decodeWaiters = this._decodeWaiters || []).push([ok, fail]); });
    }
}
J.defineTag(['img'], HTMLImageElement, 'HTMLImageElement');
def(G, 'Image', function Image(w, h) {
    const img = J.document.createElement('img');
    if (w !== undefined) img.width = w;
    if (h !== undefined) img.height = h;
    return img;
});
G.Image.prototype = HTMLImageElement.prototype;

// pixels of a drawable source: a native handle (image, 2D canvas) for drawImage / texImage2D
J.sourceHandle = function (src) {
    if (!src) return null;
    if (src instanceof HTMLImageElement) return src._handle;
    if (src._h5Source) return src._h5Source();   // canvas, ImageBitmap, ImageData (canvas2d.js)
    return null;
};
class ImageBitmap {
    constructor(handle, w, h) { this._handle = handle; this._w = w; this._h = h; }
    get width() { return this._w; }
    get height() { return this._h; }
    close() { this._handle = null; }
    _h5Source() { return this._handle; }
}
def(G, 'ImageBitmap', ImageBitmap);
J.ImageBitmap = ImageBitmap;
// (no createImageBitmap: Pixi then loads textures through <img>, without workers)

// ---------------------------------------------------------------- fonts
const faces = [];
let pendingLoads = 0;
let readyResolve = null;
let readyPromise = Promise.resolve();
function parseWeight(w) { if (w === undefined || w === null) return 400; if (w === 'bold') return 700; if (w === 'normal') return 400; const n = parseInt(w, 10); return isNaN(n) ? 400 : n; }
class FontFace {
    constructor(family, source, descriptors = {}) {
        this.family = String(family).replace(/^["']|["']$/g, '');
        this.style = descriptors.style || 'normal';
        this.weight = String(descriptors.weight || 'normal');
        this.stretch = descriptors.stretch || 'normal';
        this.unicodeRange = descriptors.unicodeRange || 'U+0-10FFFF';
        this.display = descriptors.display || 'auto';
        this._source = source;
        this._status = 'unloaded';
        this._loaded = null;
    }
    get status() { return this._status; }
    get loaded() { return this._loaded || (this._loaded = new Promise((ok, fail) => { this._ok = ok; this._fail = fail; })); }
    load() {
        if (this._status === 'loaded' || this._status === 'loading') return this.loaded;
        const p = this.loaded;
        this._status = 'loading';
        pendingLoads++;
        if (pendingLoads === 1) readyPromise = new Promise(r => { readyResolve = r; });
        const finish = ok => {
            this._status = ok ? 'loaded' : 'error';
            if (ok) this._ok(this); else this._fail(new G.DOMException('A network error occurred.', 'NetworkError'));
            if (--pendingLoads === 0 && readyResolve) { readyResolve(fontSet); readyResolve = null; }
        };
        const register = bytes => {
            const ok = !!bytes && H5.c2d.registerFont(this.family, bytes, parseWeight(this.weight), /italic|oblique/.test(this.style));
            if (!ok) H5.log(2, 'font "' + this.family + '" not registered');
            else H5.log(0, 'font "' + this.family + '" registered (' + bytes.length + ' bytes)');
            J.layoutChanged();   // text measured in it changes
            finish(ok);
        };
        const src = this._source;
        if (src instanceof ArrayBuffer || ArrayBuffer.isView(src)) { setTimeout(() => register(J.toBytes(src)), 0); return p; }
        const m = /url\(\s*(['"]?)([^'")]+)\1\s*\)/.exec(String(src));
        const url = m ? m[2] : String(src);
        J.loadBytes(J.resolveURL(url, this._base || J.pageURL) || url, bytes => register(bytes));
        return p;
    }
}
def(G, 'FontFace', FontFace);
const fontSet = Object.assign(new J.EventTarget(), {
    get size() { return faces.length; },
    get status() { return pendingLoads ? 'loading' : 'loaded'; },
    get ready() { return readyPromise.then(() => fontSet); },
    onloading: null, onloadingdone: null, onloadingerror: null,
    add(face) { if (!faces.includes(face)) faces.push(face); if (face._status === 'unloaded') face.load(); return fontSet; },
    delete(face) { const i = faces.indexOf(face); if (i >= 0) faces.splice(i, 1); return i >= 0; },
    has(face) { return faces.includes(face); },
    clear() { faces.length = 0; },
    forEach(cb, t) { faces.slice().forEach(f => cb.call(t, f, f, fontSet)); },
    values() { return faces.slice()[Symbol.iterator](); },
    keys() { return faces.slice()[Symbol.iterator](); },
    entries() { return faces.map(f => [f, f])[Symbol.iterator](); },
    [Symbol.iterator]() { return faces.slice()[Symbol.iterator](); },
    check(font) { const fam = J.parseFontFamily(font); return !fam || faces.some(f => f.family === fam && f._status === 'loaded') || !faces.some(f => f.family === fam); },
    load(font) {
        const fam = J.parseFontFamily(font);
        const list = faces.filter(f => f.family === fam);
        return Promise.all(list.map(f => f.load())).then(() => list);
    },
});
def(J.document, 'fonts', fontSet);
J.parseFontFamily = function (font) {
    const m = /(?:\d+(?:\.\d+)?(?:px|pt|em|rem|%)\s*(?:\/\s*\S+\s*)?)(.+)$/.exec(String(font));
    const fam = (m ? m[1] : String(font)).split(',')[0].trim();
    return fam.replace(/^["']|["']$/g, '');
};

// CSS: only @font-face rules matter here
J.applyCSS = function (text, baseURL, done) {
    const re = /@font-face\s*\{([^}]*)\}/g;
    let m;
    const loads = [];
    while ((m = re.exec(String(text)))) {
        const body = m[1];
        const get = k => { const r = new RegExp(k + '\\s*:\\s*([^;]+)').exec(body); return r ? r[1].trim() : null; };
        const family = get('font-family');
        const src = get('src');
        if (!family || !src) continue;
        const url = /url\(\s*(['"]?)([^'")]+)\1\s*\)/.exec(src);
        if (!url) continue;
        const face = new FontFace(family.replace(/^["']|["']$/g, ''), 'url(' + (J.resolveURL(url[2], baseURL) || url[2]) + ')', { weight: get('font-weight') || 'normal', style: get('font-style') || 'normal' });
        fontSet.add(face);
        loads.push(face.loaded.catch(() => null));
    }
    if (done) Promise.all(loads).then(() => done());
};

// ---------------------------------------------------------------- <audio>, <video>: no media playback (sound is Web Audio)
class HTMLMediaElement extends G.HTMLElement {
    constructor(tag) {
        super(tag);
        this._paused = true; this._volume = 1; this._muted = false; this._time = 0; this._rate = 1;
    }
    get src() { const s = this.getAttribute('src'); return s ? J.resolveURL(s) || s : ''; }
    set src(v) { this.setAttribute('src', v); }
    get currentSrc() { return this.src; }
    get paused() { return this._paused; }
    get ended() { return false; }
    get duration() { return NaN; }
    get currentTime() { return this._time; }
    set currentTime(v) { this._time = Number(v) || 0; }
    get volume() { return this._volume; }
    set volume(v) { this._volume = Math.min(1, Math.max(0, Number(v))); }
    get muted() { return this._muted; }
    set muted(v) { this._muted = !!v; }
    get defaultMuted() { return false; }
    get playbackRate() { return this._rate; }
    set playbackRate(v) { this._rate = Number(v) || 1; }
    get defaultPlaybackRate() { return 1; }
    get loop() { return this.hasAttribute('loop'); }
    set loop(v) { this.toggleAttribute('loop', !!v); }
    get autoplay() { return this.hasAttribute('autoplay'); }
    set autoplay(v) { this.toggleAttribute('autoplay', !!v); }
    get preload() { return this.getAttribute('preload') || 'auto'; }
    set preload(v) { this.setAttribute('preload', v); }
    get controls() { return this.hasAttribute('controls'); }
    set controls(v) { this.toggleAttribute('controls', !!v); }
    get crossOrigin() { return this.getAttribute('crossorigin'); }
    set crossOrigin(v) { this.setAttribute('crossorigin', v); }
    get readyState() { return 0; }
    get networkState() { return 3; }
    get error() { return null; }
    get seeking() { return false; }
    get buffered() { return { length: 0, start: () => 0, end: () => 0 }; }
    get played() { return { length: 0, start: () => 0, end: () => 0 }; }
    get seekable() { return { length: 0, start: () => 0, end: () => 0 }; }
    get textTracks() { return []; }
    get audioTracks() { return []; }
    canPlayType(type) {
        type = String(type).toLowerCase();
        if (/ogg|vorbis|oga/.test(type) && !/opus|theora/.test(type)) return 'probably';
        return '';
    }
    load() { }
    play() { H5.log(0, 'media: play() of <' + this.localName + '> ' + this.src + ' (no media playback)'); return Promise.reject(new G.DOMException('The element has no supported sources.', 'NotSupportedError')); }
    pause() { this._paused = true; }
    fastSeek(t) { this._time = t; }
    addTextTrack() { return {}; }
    captureStream() { return null; }
    setSinkId() { return Promise.resolve(); }
}
Object.assign(HTMLMediaElement, { HAVE_NOTHING: 0, HAVE_METADATA: 1, HAVE_CURRENT_DATA: 2, HAVE_FUTURE_DATA: 3, HAVE_ENOUGH_DATA: 4, NETWORK_EMPTY: 0, NETWORK_IDLE: 1, NETWORK_LOADING: 2, NETWORK_NO_SOURCE: 3 });
def(G, 'HTMLMediaElement', HTMLMediaElement);
J.defineTag(['audio'], class HTMLAudioElement extends HTMLMediaElement { constructor(tag) { super(tag || 'audio'); } }, 'HTMLAudioElement');
J.defineTag(['video'], class HTMLVideoElement extends HTMLMediaElement {
    constructor(tag) { super(tag || 'video'); }
    get videoWidth() { return 0; }
    get videoHeight() { return 0; }
    get poster() { return this.getAttribute('poster') || ''; }
    set poster(v) { this.setAttribute('poster', v); }
    get playsInline() { return true; }
    set playsInline(v) {}
    getVideoPlaybackQuality() { return { droppedVideoFrames: 0, totalVideoFrames: 0 }; }
    requestVideoFrameCallback() { return 0; }
    _intrinsicSize() { return { w: 300, h: 150 }; }
}, 'HTMLVideoElement');
J.defineTag(['source'], class HTMLSourceElement extends G.HTMLElement { get src() { return this.getAttribute('src') || ''; } set src(v) { this.setAttribute('src', v); } get type() { return this.getAttribute('type') || ''; } set type(v) { this.setAttribute('type', v); } }, 'HTMLSourceElement');
def(G, 'Audio', function Audio(src) { const a = J.document.createElement('audio'); if (src !== undefined) a.src = src; return a; });
G.Audio.prototype = G.HTMLAudioElement.prototype;
def(G, 'MediaSource', undefined);
def(G, 'MediaRecorder', undefined);

})(globalThis.__h5);

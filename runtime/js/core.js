// h5 browser layer: core. Internals shared by the other files live on __h5.js (J); nothing here is
// enumerable on window except the web APIs themselves.
(function (H5) {
'use strict';
const G = globalThis;
const J = H5.js = {};

// web APIs put on window; finish.js makes their prototypes' members enumerable, as WebIDL has them (pages
// find members with for...in: the game's domain lock enumerates window, document and location)
J.classes = [];
function def(obj, name, value) {
    Object.defineProperty(obj, name, { value, writable: true, configurable: true, enumerable: false });
    if (obj === globalThis && typeof value === 'function' && value.prototype && /^[A-Z]/.test(name)) J.classes.push(value);
}
J.def = def;
J.getter = function (obj, name, get, set) {
    Object.defineProperty(obj, name, { get, set, configurable: true, enumerable: true });
};

// ---------------------------------------------------------------- the global object is the window
def(G, 'window', G);
def(G, 'self', G);
def(G, 'frames', G);
def(G, 'top', G);
def(G, 'parent', G);
def(G, 'opener', null);
def(G, 'closed', false);
def(G, 'name', '');
def(G, 'length', 0);

// ---------------------------------------------------------------- console
function describe(v, depth, seen) {
    if (v === null) return 'null';
    const t = typeof v;
    if (t === 'string') return depth ? JSON.stringify(v) : v;
    if (t === 'number' || t === 'boolean' || t === 'undefined' || t === 'bigint') return String(v);
    if (t === 'symbol') return v.toString();
    if (t === 'function') return '[function ' + (v.name || 'anonymous') + ']';
    if (v instanceof Error) return (v.name || 'Error') + ': ' + v.message + (v.stack ? '\n' + v.stack : '');
    seen = seen || new Set();
    if (seen.has(v)) return '[circular]';
    if (depth > 2) return Array.isArray(v) ? '[array ' + v.length + ']' : '[object ' + (v.constructor && v.constructor.name || 'Object') + ']';
    seen.add(v);
    try {
        if (Array.isArray(v)) return '[' + v.slice(0, 20).map(x => describe(x, (depth || 0) + 1, seen)).join(', ') + (v.length > 20 ? ', ...' : '') + ']';
        if (ArrayBuffer.isView(v)) return v.constructor.name + '(' + v.length + ')';
        if (v.nodeType && v.nodeName) return '<' + v.nodeName.toLowerCase() + (v.id ? '#' + v.id : '') + '>';
        const keys = Object.keys(v).slice(0, 20);
        return (v.constructor && v.constructor !== Object ? v.constructor.name + ' ' : '') + '{' +
            keys.map(k => k + ': ' + describe(v[k], (depth || 0) + 1, seen)).join(', ') + (Object.keys(v).length > 20 ? ', ...' : '') + '}';
    } catch (e) {
        return '[object]';
    } finally {
        seen.delete(v);
    }
}
function format(args) {
    let out = [];
    let i = 0;
    if (typeof args[0] === 'string' && args[0].indexOf('%') >= 0) {
        let first = args[0].replace(/%[sdifoOc%]/g, m => {
            if (m === '%%') return '%';
            if (m === '%c') { i++; return ''; }
            const a = args[++i];
            if (m === '%d' || m === '%i') return String(parseInt(a, 10));
            if (m === '%f') return String(Number(a));
            return describe(a, 1);
        });
        out.push(first);
        i++;
    }
    for (; i < args.length; i++) out.push(describe(args[i], 0));
    return out.join(' ');
}
J.describe = describe;
const timersByLabel = new Map(), counts = new Map();
let groupDepth = 0;
function emit(level, args) {
    H5.log(level, '  '.repeat(groupDepth) + format(args));
}
const consoleObject = {
    log(...a) { emit(1, a); },
    info(...a) { emit(1, a); },
    debug(...a) { emit(0, a); },
    warn(...a) { emit(2, a); },
    error(...a) { emit(3, a); },
    trace(...a) { emit(1, a.concat([new Error('trace').stack])); },
    dir(v) { emit(1, [v]); },
    dirxml(v) { emit(1, [v]); },
    table(v) { emit(1, [v]); },
    assert(cond, ...a) { if (!cond) emit(3, ['Assertion failed:'].concat(a)); },
    group(...a) { if (a.length) emit(1, a); groupDepth++; },
    groupCollapsed(...a) { if (a.length) emit(1, a); groupDepth++; },
    groupEnd() { if (groupDepth > 0) groupDepth--; },
    time(label = 'default') { timersByLabel.set(label, H5.now()); },
    timeLog(label = 'default', ...a) { const t = timersByLabel.get(label); if (t !== undefined) emit(1, [label + ': ' + (H5.now() - t).toFixed(1) + ' ms'].concat(a)); },
    timeEnd(label = 'default') { const t = timersByLabel.get(label); if (t !== undefined) { emit(1, [label + ': ' + (H5.now() - t).toFixed(1) + ' ms']); timersByLabel.delete(label); } },
    count(label = 'default') { const n = (counts.get(label) || 0) + 1; counts.set(label, n); emit(1, [label + ': ' + n]); },
    countReset(label = 'default') { counts.delete(label); },
    clear() {},
    profile() {}, profileEnd() {}, timeStamp() {},
};
def(G, 'console', consoleObject);

// ---------------------------------------------------------------- errors reaching the top
J.reportError = function (error, where) {
    const msg = error && error.message !== undefined ? error.message : String(error);
    H5.log(3, 'uncaught' + (where ? ' (' + where + ')' : '') + ': ' + describe(error, 0));
    if (J.dispatchErrorEvent) {
        try { J.dispatchErrorEvent(error, msg); } catch (e) { /* the handler threw */ }
    }
};
def(G, 'reportError', e => J.reportError(e, 'reportError'));

// ---------------------------------------------------------------- async natives: hooks.complete(id, ...)
const pending = new Map();
let nextRequest = 1;
J.request = function (callback) {
    const id = nextRequest++;
    pending.set(id, callback);
    return id;
};
H5.hooks.complete = function (id, ...results) {
    const callback = pending.get(id);
    if (!callback) return;
    pending.delete(id);
    try { callback(...results); } catch (e) { J.reportError(e, 'async completion'); }
};

// ---------------------------------------------------------------- timers
// a binary heap of {due, seq, id}; the timer table keeps what to run
const heap = [];
const timers = new Map();
let timerSeq = 1;
function heapPush(item) {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p].due < item.due || (heap[p].due === item.due && heap[p].seq < item.seq)) break;
        heap[i] = heap[p]; i = p;
    }
    heap[i] = item;
}
function heapPop() {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
        let i = 0;
        for (;;) {
            const l = i * 2 + 1, r = l + 1;
            let m = i;
            const cand = (a, b) => a.due < b.due || (a.due === b.due && a.seq < b.seq);
            let best = last;
            if (l < heap.length && cand(heap[l], best)) { m = l; best = heap[l]; }
            if (r < heap.length && cand(heap[r], best)) { m = r; best = heap[r]; }
            if (m === i) break;
            heap[i] = heap[m]; i = m;
        }
        heap[i] = last;
    }
    return top;
}
function addTimer(fn, delay, args, repeat) {
    if (typeof fn !== 'function') {
        const code = String(fn);
        fn = function () { (0, eval)(code); };
    }
    delay = Math.max(0, Number(delay) || 0);
    const id = timerSeq++;
    const t = { fn, args, delay: repeat ? Math.max(delay, 1) : delay, repeat, due: H5.now() + delay };
    timers.set(id, t);
    heapPush({ due: t.due, seq: id, id });
    return id;
}
function clearTimer(id) { timers.delete(id); }
def(G, 'setTimeout', (fn, delay, ...args) => addTimer(fn, delay, args, false));
def(G, 'setInterval', (fn, delay, ...args) => addTimer(fn, delay, args, true));
def(G, 'clearTimeout', clearTimer);
def(G, 'clearInterval', clearTimer);
def(G, 'setImmediate', (fn, ...args) => addTimer(fn, 0, args, false));
def(G, 'clearImmediate', clearTimer);
def(G, 'queueMicrotask', fn => { Promise.resolve().then(() => { try { fn(); } catch (e) { J.reportError(e, 'microtask'); } }); });
def(G, 'requestIdleCallback', (cb, opts) => addTimer(() => cb({ didTimeout: false, timeRemaining: () => 8 }), 1, [], false));
def(G, 'cancelIdleCallback', clearTimer);

// the loop: run what is due; return when the next timer is due (ms) or -1
H5.hooks.tick = function (now) {
    let ran = 0;
    while (heap.length && heap[0].due <= now && ran < 1000) {
        const item = heapPop();
        const t = timers.get(item.id);
        if (!t || t.due !== item.due) continue;
        ran++;
        if (t.repeat) {
            t.due = Math.max(now, t.due + t.delay);
            heapPush({ due: t.due, seq: timerSeq++, id: item.id });
        } else {
            timers.delete(item.id);
        }
        try { t.fn.apply(G, t.args); } catch (e) { J.reportError(e, 'timer'); }
    }
    while (heap.length && !timers.has(heap[0].id)) heapPop();
    return heap.length ? heap[0].due : -1;
};

// ---------------------------------------------------------------- frames
let frameCallbacks = new Map();
let frameSeq = 1;
J.beforeFrame = [];   // functions(now) run before the page's callbacks (input, keyboard)
J.afterFrame = [];    // ... and after (choosing the shown canvas)
def(G, 'requestAnimationFrame', cb => { const id = frameSeq++; frameCallbacks.set(id, cb); return id; });
def(G, 'cancelAnimationFrame', id => { frameCallbacks.delete(id); });
def(G, 'webkitRequestAnimationFrame', G.requestAnimationFrame);
def(G, 'webkitCancelAnimationFrame', G.cancelAnimationFrame);
J.pausePage = false;   // the runtime's quick menu is open: the page's frame callbacks wait
H5.hooks.frame = function (now) {
    for (const f of J.beforeFrame) { try { f(now); } catch (e) { J.reportError(e, 'frame (runtime)'); } }
    if (!J.pausePage) {
        const callbacks = frameCallbacks;
        frameCallbacks = new Map();
        for (const cb of callbacks.values()) {
            try { cb(now); } catch (e) { J.reportError(e, 'requestAnimationFrame'); }
        }
    }
    for (const f of J.afterFrame) { try { f(now); } catch (e) { J.reportError(e, 'frame (runtime)'); } }
};

// ---------------------------------------------------------------- performance
const timeOrigin = H5.wallNow() - H5.now();
const perfEntries = [];
const performanceObject = {
    now: () => H5.now(),
    timeOrigin,
    timing: { navigationStart: timeOrigin, fetchStart: timeOrigin, domLoading: timeOrigin, loadEventEnd: timeOrigin },
    navigation: { type: 0, redirectCount: 0 },
    memory: { jsHeapSizeLimit: 2147483648, totalJSHeapSize: 268435456, usedJSHeapSize: 134217728 },
    mark(name) { const e = { name, entryType: 'mark', startTime: H5.now(), duration: 0 }; perfEntries.push(e); if (perfEntries.length > 500) perfEntries.shift(); return e; },
    measure(name) { return { name, entryType: 'measure', startTime: 0, duration: 0 }; },
    getEntries: () => perfEntries.slice(),
    getEntriesByName: n => perfEntries.filter(e => e.name === n),
    getEntriesByType: t => perfEntries.filter(e => e.entryType === t),
    clearMarks() {}, clearMeasures() {}, clearResourceTimings() {}, setResourceTimingBufferSize() {},
    addEventListener() {}, removeEventListener() {},
    toJSON() { return { timeOrigin }; },
};
def(G, 'performance', performanceObject);
def(G, 'PerformanceObserver', class PerformanceObserver {
    constructor(cb) { this.cb = cb; }
    observe() {} disconnect() {} takeRecords() { return []; }
    static get supportedEntryTypes() { return []; }
});

// ---------------------------------------------------------------- base64, text
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64R = new Int16Array(256).fill(-1);
for (let i = 0; i < 64; i++) B64R[B64.charCodeAt(i)] = i;
B64R['-'.charCodeAt(0)] = 62; B64R['_'.charCodeAt(0)] = 63;
J.base64ToBytes = function (s) {
    s = String(s).replace(/[\t\n\f\r =]/g, '');
    const out = new Uint8Array(Math.floor(s.length * 3 / 4));
    let o = 0, buf = 0, bits = 0;
    for (let i = 0; i < s.length; i++) {
        const v = B64R[s.charCodeAt(i) & 255];
        if (v < 0) throw new DOMExceptionLike('The string contains invalid characters.', 'InvalidCharacterError');
        buf = (buf << 6) | v; bits += 6;
        if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 255; }
    }
    return o === out.length ? out : out.subarray(0, o);
};
J.bytesToBase64 = function (b) {
    let s = '';
    let i = 0;
    for (; i + 2 < b.length; i += 3) {
        const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
        s += B64[n >> 18] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
    }
    if (i < b.length) {
        const n = (b[i] << 16) | ((i + 1 < b.length ? b[i + 1] : 0) << 8);
        s += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + '=';
    }
    return s;
};
class DOMExceptionLike extends Error {
    constructor(message, name) { super(message); this.name = name || 'Error'; }
}
J.DOMExceptionLike = DOMExceptionLike;
def(G, 'atob', s => {
    const b = J.base64ToBytes(s);
    let out = '';
    for (let i = 0; i < b.length; i += 8192) out += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
    return out;
});
def(G, 'btoa', s => {
    s = String(s);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c > 255) throw new DOMExceptionLike('The string contains characters outside of the Latin1 range.', 'InvalidCharacterError');
        b[i] = c;
    }
    return J.bytesToBase64(b);
});

J.utf8Encode = function (s) {
    s = String(s);
    const out = new Uint8Array(s.length * 3);
    let o = 0;
    for (let i = 0; i < s.length; i++) {
        let c = s.charCodeAt(i);
        if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
            const d = s.charCodeAt(i + 1);
            if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
            else c = 0xfffd;
        } else if (c >= 0xd800 && c < 0xe000) c = 0xfffd;
        if (c < 0x80) out[o++] = c;
        else if (c < 0x800) { out[o++] = 0xc0 | (c >> 6); out[o++] = 0x80 | (c & 63); }
        else if (c < 0x10000) { out[o++] = 0xe0 | (c >> 12); out[o++] = 0x80 | ((c >> 6) & 63); out[o++] = 0x80 | (c & 63); }
        else { out[o++] = 0xf0 | (c >> 18); out[o++] = 0x80 | ((c >> 12) & 63); out[o++] = 0x80 | ((c >> 6) & 63); out[o++] = 0x80 | (c & 63); }
    }
    return out.slice(0, o);
};
J.utf8Decode = function (b) {
    let out = '';
    const parts = [];
    let i = 0;
    const n = b.length;
    if (n >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
    let codes = [];
    for (; i < n;) {
        let c = b[i++];
        if (c >= 0x80) {
            if (c >= 0xf0 && i + 2 < n + 0) { c = ((c & 7) << 18) | ((b[i] & 63) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63); i += 3; }
            else if (c >= 0xe0 && i + 1 < n + 0) { c = ((c & 15) << 12) | ((b[i] & 63) << 6) | (b[i + 1] & 63); i += 2; }
            else if (c >= 0xc0 && i < n) { c = ((c & 31) << 6) | (b[i] & 63); i += 1; }
            else c = 0xfffd;
        }
        if (c >= 0x10000) { c -= 0x10000; codes.push(0xd800 + (c >> 10), 0xdc00 + (c & 1023)); }
        else codes.push(c);
        if (codes.length >= 8192) { parts.push(String.fromCharCode.apply(null, codes)); codes = []; }
    }
    if (codes.length) parts.push(String.fromCharCode.apply(null, codes));
    out = parts.join('');
    return out;
};
J.toBytes = function (data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return J.utf8Encode(String(data));
};
def(G, 'TextEncoder', class TextEncoder {
    get encoding() { return 'utf-8'; }
    encode(s = '') { return J.utf8Encode(s); }
    encodeInto(s, dest) { const b = J.utf8Encode(s); const n = Math.min(b.length, dest.length); dest.set(b.subarray(0, n)); return { read: s.length, written: n }; }
});
def(G, 'TextDecoder', class TextDecoder {
    constructor(label = 'utf-8', opts = {}) {
        const l = String(label).toLowerCase();
        this._enc = (l === 'utf-16le' || l === 'utf-16') ? 'utf-16le' : (l === 'latin1' || l === 'iso-8859-1' || l === 'ascii' || l === 'us-ascii' || l === 'windows-1252') ? 'latin1' : 'utf-8';
        this.fatal = !!opts.fatal; this.ignoreBOM = !!opts.ignoreBOM;
    }
    get encoding() { return this._enc; }
    decode(data) {
        if (data === undefined) return '';
        const b = J.toBytes(data);
        if (this._enc === 'utf-8') return J.utf8Decode(b);
        let s = '';
        if (this._enc === 'latin1') { for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return s; }
        const u = new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.byteLength & ~1)));
        for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
        return s;
    }
});

// ---------------------------------------------------------------- structuredClone, crypto
function clone(v, seen) {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return seen.get(v);
    let out;
    if (v instanceof Date) out = new Date(v.getTime());
    else if (v instanceof RegExp) out = new RegExp(v.source, v.flags);
    else if (v instanceof ArrayBuffer) out = v.slice(0);
    else if (ArrayBuffer.isView(v)) out = new v.constructor(v);
    else if (v instanceof Map) { out = new Map(); seen.set(v, out); v.forEach((x, k) => out.set(clone(k, seen), clone(x, seen))); return out; }
    else if (v instanceof Set) { out = new Set(); seen.set(v, out); v.forEach(x => out.add(clone(x, seen))); return out; }
    else if (Array.isArray(v)) { out = []; seen.set(v, out); for (let i = 0; i < v.length; i++) out[i] = clone(v[i], seen); return out; }
    else { out = {}; seen.set(v, out); for (const k of Object.keys(v)) out[k] = clone(v[k], seen); return out; }
    seen.set(v, out);
    return out;
}
def(G, 'structuredClone', v => clone(v, new Map()));
def(G, 'crypto', {
    getRandomValues(a) { return H5.random(a); },
    randomUUID() {
        const b = H5.random(new Uint8Array(16));
        b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
        const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
        return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
    },
});

// ---------------------------------------------------------------- URLs
// a URL string as the URL standard reads it: no C0 controls or spaces at either end, no tabs or newlines
// anywhere (a data: URL written over several lines is one line)
const cleanURL = s => String(s).replace(/^[\u0000- ]+|[\u0000- ]+$/g, '').replace(/[\t\n\r]/g, '');
function parseURL(s) {
    s = cleanURL(s);
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/s.exec(s);
    if (!m) return null;
    const scheme = m[1].toLowerCase();
    let rest = m[2];
    const u = { protocol: scheme + ':', username: '', password: '', hostname: '', port: '', pathname: '', search: '', hash: '', opaque: false };
    const hashAt = rest.indexOf('#');
    if (hashAt >= 0) { u.hash = rest.slice(hashAt); rest = rest.slice(0, hashAt); if (u.hash === '#') u.hash = ''; }
    if (rest.startsWith('//')) {
        rest = rest.slice(2);
        let end = rest.search(/[/?]/);
        if (end < 0) end = rest.length;
        let auth = rest.slice(0, end);
        rest = rest.slice(end);
        const at = auth.lastIndexOf('@');
        if (at >= 0) { const cred = auth.slice(0, at).split(':'); u.username = cred[0]; u.password = cred.slice(1).join(':'); auth = auth.slice(at + 1); }
        const pm = /^(\[[^\]]*\]|[^:]*)(?::(\d*))?$/.exec(auth);
        u.hostname = (pm ? pm[1] : auth).toLowerCase();
        u.port = pm && pm[2] ? pm[2] : '';
        if ((scheme === 'https' && u.port === '443') || (scheme === 'http' && u.port === '80')) u.port = '';
    } else if (scheme !== 'file') {
        u.opaque = true;
    }
    const q = rest.indexOf('?');
    if (q >= 0) { u.search = rest.slice(q); rest = rest.slice(0, q); if (u.search === '?') u.search = ''; }
    u.pathname = u.opaque ? rest : normalizePath(rest || '/');
    return u;
}
function normalizePath(p) {
    const out = [];
    const parts = p.split('/');
    for (let i = 0; i < parts.length; i++) {
        const s = parts[i];
        if (s === '..') { if (out.length > 1) out.pop(); if (i === parts.length - 1) out.push(''); }
        else if (s === '.') { if (i === parts.length - 1) out.push(''); }
        else out.push(s);
    }
    let r = out.join('/');
    if (!r.startsWith('/')) r = '/' + r;
    return r;
}
function resolveURL(input, base) {
    input = cleanURL(input);
    const abs = parseURL(input);
    if (abs) return abs;
    if (!base) return null;
    const b = typeof base === 'string' ? parseURL(base) : base;
    if (!b || b.opaque) return null;
    const u = Object.assign({}, b, { search: '', hash: '' });
    if (input.startsWith('//')) return parseURL(b.protocol + input);
    let rest = input;
    const hashAt = rest.indexOf('#');
    if (hashAt >= 0) { u.hash = rest.slice(hashAt); rest = rest.slice(0, hashAt); if (u.hash === '#') u.hash = ''; }
    const q = rest.indexOf('?');
    if (q >= 0) { u.search = rest.slice(q); rest = rest.slice(0, q); if (u.search === '?') u.search = ''; }
    if (rest === '') { u.pathname = b.pathname; if (q < 0) u.search = b.search; return u; }
    if (rest.startsWith('/')) u.pathname = normalizePath(rest);
    else u.pathname = normalizePath(b.pathname.slice(0, b.pathname.lastIndexOf('/') + 1) + rest);
    return u;
}
J.resolveURL = (input, base) => { const u = resolveURL(input, base === undefined ? J.pageURL : base); return u ? urlString(u) : null; };
function urlHost(u) { return u.hostname + (u.port ? ':' + u.port : ''); }
function urlOrigin(u) {
    if (u.protocol === 'blob:') { const inner = parseURL(u.pathname); return inner ? urlOrigin(inner) : 'null'; }
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.protocol + '//' + urlHost(u) : 'null';
}
function urlString(u) {
    if (u.opaque) return u.protocol + u.pathname + u.search + u.hash;
    const cred = u.username ? u.username + (u.password ? ':' + u.password : '') + '@' : '';
    return u.protocol + '//' + cred + urlHost(u) + u.pathname + u.search + u.hash;
}
J.urlParts = s => parseURL(String(s));

class URLSearchParams {
    constructor(init) {
        this._list = [];
        if (init === undefined || init === null) return;
        if (typeof init === 'string') {
            const s = init.startsWith('?') ? init.slice(1) : init;
            for (const part of s.split('&')) {
                if (!part) continue;
                const eq = part.indexOf('=');
                const dec = x => { try { return decodeURIComponent(x.replace(/\+/g, ' ')); } catch (e) { return x; } };
                this._list.push(eq < 0 ? [dec(part), ''] : [dec(part.slice(0, eq)), dec(part.slice(eq + 1))]);
            }
        } else if (init instanceof URLSearchParams) this._list = init._list.map(p => p.slice());
        else if (typeof init[Symbol.iterator] === 'function') for (const [k, v] of init) this._list.push([String(k), String(v)]);
        else for (const k of Object.keys(init)) this._list.push([k, String(init[k])]);
    }
    append(k, v) { this._list.push([String(k), String(v)]); this._changed(); }
    delete(k) { this._list = this._list.filter(p => p[0] !== k); this._changed(); }
    get(k) { const p = this._list.find(p => p[0] === k); return p ? p[1] : null; }
    getAll(k) { return this._list.filter(p => p[0] === k).map(p => p[1]); }
    has(k) { return this._list.some(p => p[0] === k); }
    set(k, v) {
        const i = this._list.findIndex(p => p[0] === k);
        if (i < 0) this._list.push([String(k), String(v)]);
        else { this._list[i][1] = String(v); this._list = this._list.filter((p, j) => j <= i || p[0] !== k); }
        this._changed();
    }
    sort() { this._list.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0); this._changed(); }
    forEach(cb, thisArg) { for (const [k, v] of this._list) cb.call(thisArg, v, k, this); }
    keys() { return this._list.map(p => p[0])[Symbol.iterator](); }
    values() { return this._list.map(p => p[1])[Symbol.iterator](); }
    entries() { return this._list.map(p => p.slice())[Symbol.iterator](); }
    [Symbol.iterator]() { return this.entries(); }
    get size() { return this._list.length; }
    toString() {
        const enc = s => encodeURIComponent(s).replace(/%20/g, '+').replace(/[!'()~]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
        return this._list.map(([k, v]) => enc(k) + '=' + enc(v)).join('&');
    }
    _changed() { if (this._url) { const s = this.toString(); this._url._u.search = s ? '?' + s : ''; } }
}
def(G, 'URLSearchParams', URLSearchParams);

class URL {
    constructor(input, base) {
        let b;
        if (base !== undefined) {
            b = parseURL(String(base instanceof URL ? base.href : base));
            if (!b) throw new TypeError("Failed to construct 'URL': Invalid base URL");
        }
        const u = resolveURL(String(input instanceof URL ? input.href : input), b);
        if (!u) throw new TypeError("Failed to construct 'URL': Invalid URL");
        this._u = u;
    }
    get href() { return urlString(this._u); }
    set href(v) { const u = parseURL(String(v)); if (!u) throw new TypeError('Invalid URL'); this._u = u; }
    get protocol() { return this._u.protocol; }
    set protocol(v) { this._u.protocol = String(v).replace(/:?$/, ':'); }
    get host() { return urlHost(this._u); }
    set host(v) { const [h, p] = String(v).split(':'); this._u.hostname = h; this._u.port = p || ''; }
    get hostname() { return this._u.hostname; }
    set hostname(v) { this._u.hostname = String(v); }
    get port() { return this._u.port; }
    set port(v) { this._u.port = String(v); }
    get pathname() { return this._u.pathname; }
    set pathname(v) { this._u.pathname = normalizePath(String(v)); }
    get search() { return this._u.search; }
    set search(v) { v = String(v); this._u.search = v && !v.startsWith('?') ? '?' + v : v === '?' ? '' : v; this._params = null; }
    get hash() { return this._u.hash; }
    set hash(v) { v = String(v); this._u.hash = v && !v.startsWith('#') ? '#' + v : v === '#' ? '' : v; }
    get username() { return this._u.username; }
    set username(v) { this._u.username = String(v); }
    get password() { return this._u.password; }
    set password(v) { this._u.password = String(v); }
    get origin() { return urlOrigin(this._u); }
    get searchParams() {
        if (!this._params) { this._params = new URLSearchParams(this._u.search); this._params._url = this; }
        return this._params;
    }
    toString() { return this.href; }
    toJSON() { return this.href; }
    static canParse(input, base) { try { new URL(input, base); return true; } catch (e) { return false; } }
    static parse(input, base) { try { return new URL(input, base); } catch (e) { return null; } }
}
def(G, 'URL', URL);
def(G, 'webkitURL', URL);

// ---------------------------------------------------------------- location, history
J.pageURL = 'h5://app/index.html';
J.setPageURL = function (url) { J.pageURL = String(url); };
const locationObject = {
    get href() { return J.pageURL; },
    set href(v) { J.navigate(v); },
    get protocol() { return parseURL(J.pageURL).protocol; },
    get host() { return urlHost(parseURL(J.pageURL)); },
    get hostname() { return parseURL(J.pageURL).hostname; },
    get port() { return parseURL(J.pageURL).port; },
    get pathname() { return parseURL(J.pageURL).pathname; },
    get search() { return parseURL(J.pageURL).search; },
    set search(v) { const u = new URL(J.pageURL); u.search = v; J.navigate(u.href); },
    get hash() { return parseURL(J.pageURL).hash; },
    set hash(v) { const u = new URL(J.pageURL); u.hash = v; J.pageURL = u.href; if (J.fireHashChange) J.fireHashChange(); },
    get origin() { return urlOrigin(parseURL(J.pageURL)); },
    get ancestorOrigins() { return []; },
    assign(v) { J.navigate(v); },
    replace(v) { J.navigate(v); },
    reload() { H5.log(1, 'page: location.reload()'); H5.reload(); },
    toString() { return J.pageURL; },
};
J.navigate = function (v) {
    const target = J.resolveURL(v);
    const cur = parseURL(J.pageURL), next = target && parseURL(target);
    if (next && cur && next.protocol === cur.protocol && next.hostname === cur.hostname && next.pathname === cur.pathname && next.search === cur.search) {
        J.pageURL = target;   // only the fragment moved
        if (J.fireHashChange) J.fireHashChange();
        return;
    }
    H5.log(2, 'page: navigation to ' + target + ' (not followed: this app has one page)');
    if (J.openExternal) J.openExternal(target);
};
Object.defineProperty(G, 'location', { get: () => locationObject, set: v => J.navigate(v), configurable: true, enumerable: true });
let historyState = null;
const historyObject = {
    get length() { return 1; },
    get state() { return historyState; },
    scrollRestoration: 'auto',
    pushState(state, title, url) { historyState = state; if (url !== undefined && url !== null) { const t = J.resolveURL(url); if (t) J.pageURL = t; } },
    replaceState(state, title, url) { historyState = state; if (url !== undefined && url !== null) { const t = J.resolveURL(url); if (t) J.pageURL = t; } },
    back() {}, forward() {}, go() {},
};
def(G, 'history', historyObject);

// ---------------------------------------------------------------- misc window methods
def(G, 'alert', m => H5.log(2, 'alert: ' + m));
def(G, 'confirm', m => { H5.log(2, 'confirm (answered yes): ' + m); return true; });
def(G, 'prompt', (m, d) => { H5.log(2, 'prompt (answered with the default): ' + m); return d === undefined ? '' : String(d); });
def(G, 'print', () => {});
def(G, 'stop', () => {});
def(G, 'focus', () => {});
def(G, 'blur', () => {});
def(G, 'close', () => { H5.log(1, 'page: window.close()'); H5.exit(0); });
def(G, 'scroll', () => {});
def(G, 'scrollTo', () => {});
def(G, 'scrollBy', () => {});
def(G, 'moveTo', () => {});
def(G, 'resizeTo', () => {});
def(G, 'getSelection', () => ({ rangeCount: 0, removeAllRanges() {}, addRange() {}, toString: () => '', empty() {} }));
def(G, 'open', (url, target) => {
    const t = J.resolveURL(url);
    H5.log(2, 'page: window.open(' + t + ') (not followed)');
    if (J.openExternal) J.openExternal(t);
    return null;
});
J.getter(G, 'isSecureContext', () => true);
J.getter(G, 'origin', () => locationObject.origin);
J.getter(G, 'devicePixelRatio', () => 1);
J.getter(G, 'scrollX', () => 0);
J.getter(G, 'scrollY', () => 0);
J.getter(G, 'pageXOffset', () => 0);
J.getter(G, 'pageYOffset', () => 0);
J.getter(G, 'screenX', () => 0);
J.getter(G, 'screenY', () => 0);
J.getter(G, 'screenLeft', () => 0);
J.getter(G, 'screenTop', () => 0);

})(globalThis.__h5);

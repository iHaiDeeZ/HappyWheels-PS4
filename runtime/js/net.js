// h5 browser layer: loading. URLs under a mounted prefix are files (the game's own, or a site's kept on the
// console: a downloading mount fills a missing file from the network first); blob: and data: URLs are local
// too; other hosts go to J.netRequest (src/net.cpp).
// Also Blob, File, FileReader, fetch, XMLHttpRequest, FormData, WebSocket (refuses), localStorage.
(function (H5) {
'use strict';
const G = globalThis;
const J = H5.js;
const def = J.def;

// ---------------------------------------------------------------- where URLs go
const mounts = [];   // [prefix URL, folder, downloads]
// opts.download: a file not in the folder yet comes from the URL itself, once (for sites whose files keep
// their names only while their content stays: hashed names)
J.mount = function (prefix, folder, opts) {
    mounts.push([String(prefix), String(folder), !!(opts && opts.download)]);
    mounts.sort((a, b) => b[0].length - a[0].length);
};
const blocked = new Set();
J.blockHosts = function (hosts) { for (const h of hosts) blocked.add(String(h).toLowerCase()); };
J.urlToPath = function (url) {
    const clean = String(url).split('#')[0].split('?')[0];
    for (const [prefix, folder] of mounts) {
        if (clean.startsWith(prefix)) {
            let rest = clean.slice(prefix.length);
            try { rest = decodeURIComponent(rest); } catch (e) { /* keep as is */ }
            if (rest.split('/').includes('..')) return null;
            return folder + rest;
        }
    }
    return null;
};
// a mounted URL's file, there before callback(true) (downloaded when its mount downloads and it isn't yet);
// callback(false, {status, error}) when it can't be had
const fetching = new Map();   // path -> callbacks waiting for its download
J.downloadStats = { pending: 0, files: 0, bytes: 0, failed: 0 };
J.ensureLocal = function (url, path, callback) {
    const clean = String(url).split('#')[0].split('?')[0];
    const m = mounts.find(m => clean.startsWith(m[0]));
    if (!m || !m[2] || H5.exists(path)) { callback(true); return; }
    const waiting = fetching.get(path);
    if (waiting) { waiting.push(callback); return; }
    fetching.set(path, [callback]);
    J.downloadStats.pending++;
    J.download(clean, path, (ok, info) => {
        J.downloadStats.pending--;
        if (ok) { J.downloadStats.files++; J.downloadStats.bytes += info.bytes || 0; } else J.downloadStats.failed++;
        const list = fetching.get(path) || [];
        fetching.delete(path);
        for (const cb of list) { try { cb(ok, info); } catch (e) { J.reportError(e, 'download ' + clean); } }
    });
};
// GET url into the file at path (written whole or not at all): callback(ok, {status, bytes, error})
J.download = function (url, path, callback) {
    if (!H5.netRequest) { setTimeout(() => callback(false, { status: 0, error: 'offline' }), 0); return; }
    const sent = H5.netRequest(J.request(r => {
        if (!r || r.error) callback(false, { status: 0, error: r ? r.error : 'failed' });
        else if (r.status !== 200) callback(false, { status: r.status, error: 'HTTP ' + r.status });
        else callback(true, { status: 200, bytes: r.saved || 0 });
    }), 'GET', url, requestHeaders(new Headers(), 'GET', null), null, 600000, path);
    if (sent === false) setTimeout(() => callback(false, { status: 0, error: 'not a data folder path: ' + path }), 0);
};

const MIME = { json: 'application/json', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', html: 'text/html', htm: 'text/html', txt: 'text/plain',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'video/mp4', webm: 'video/webm',
    otf: 'font/otf', ttf: 'font/ttf', woff: 'font/woff', woff2: 'font/woff2', xml: 'application/xml', wasm: 'application/wasm' };
J.mimeOf = function (url) {
    const m = /\.([a-z0-9]+)$/i.exec(String(url).split('#')[0].split('?')[0]);
    return (m && MIME[m[1].toLowerCase()]) || 'application/octet-stream';
};

// blob: URLs
const blobURLs = new Map();
let blobSeq = 1;

// load(url, callback(bytes Uint8Array | null, info {status, type, error})) for GET; request() for the rest
J.loadBytes = function (url, callback) {
    url = J.resolveURL(url) || String(url);
    if (url.startsWith('blob:')) {
        const b = blobURLs.get(url);
        setTimeout(() => b ? callback(b._bytes, { status: 200, type: b.type }) : callback(null, { status: 0, error: 'revoked blob URL' }), 0);
        return;
    }
    if (url.startsWith('data:')) {
        setTimeout(() => {
            const r = J.decodeDataURL(url);
            r ? callback(r.bytes, { status: 200, type: r.type }) : callback(null, { status: 0, error: 'bad data URL' });
        }, 0);
        return;
    }
    const path = J.urlToPath(url);
    if (path) {
        J.ensureLocal(url, path, (ok, info) => {
            if (!ok) { callback(null, { status: info.status, error: info.error }); return; }
            H5.readAsync(J.request(buffer => {
                if (buffer) callback(new Uint8Array(buffer), { status: 200, type: J.mimeOf(url) });
                else callback(null, { status: 404, error: 'no file ' + path });
            }), path);
        });
        return;
    }
    J.request2(url, { method: 'GET' }, callback);
};
J.loadText = function (url, callback) {
    J.loadBytes(url, (bytes, info) => callback(bytes ? J.utf8Decode(bytes) : null, info && info.error));
};
// other hosts: online requests (J.netRequest is the hook a network layer fills in)
J.request2 = function (url, init, callback) {
    let host = '';
    try { host = new URL(url).hostname; } catch (e) { /* not a URL */ }
    if (blocked.has(host)) { setTimeout(() => callback(null, { status: 0, error: 'blocked host ' + host }), 0); return; }
    if (J.netRequest) { J.netRequest(url, init, callback); return; }
    H5.log(1, 'net: ' + (init.method || 'GET') + ' ' + url + ' (offline: no network layer)');
    setTimeout(() => callback(null, { status: 0, error: 'offline' }), 0);
};
// percent-decoding as the URL standard does it: %XX is that byte, any other % stays (a data: URL of raw SVG
// with width='100%' in it is fine in a browser)
function percentDecode(s) {
    const b = J.utf8Encode(s);
    const out = new Uint8Array(b.length);
    const hex = c => c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;
    let n = 0;
    for (let i = 0; i < b.length; i++) {
        if (b[i] === 37 && i + 2 < b.length) {
            const h = hex(b[i + 1]), l = hex(b[i + 2]);
            if (h >= 0 && l >= 0) { out[n++] = h * 16 + l; i += 2; continue; }
        }
        out[n++] = b[i];
    }
    return out.subarray(0, n);
}
// the network layer (src/net.cpp): sent as a browser showing the page would send it
function requestHeaders(h, method, contentType)
{
    const list = [];
    h.forEach((v, k) => list.push([k, v]));
    if (!h.has('user-agent')) list.push(['User-Agent', G.navigator.userAgent]);
    if (!h.has('accept')) list.push(['Accept', '*/*']);
    if (!h.has('accept-language')) list.push(['Accept-Language', 'en-US,en;q=0.9']);
    let origin = '';
    try { origin = new G.URL(J.pageURL).origin; } catch (e) { /* no page URL */ }
    if (method !== 'GET' && method !== 'HEAD' && origin && !h.has('origin')) list.push(['Origin', origin]);
    if (J.pageURL && !h.has('referer')) list.push(['Referer', J.pageURL]);
    if (contentType && !h.has('content-type')) list.push(['Content-Type', contentType]);
    return list;
}
if (H5.netRequest) J.netRequest = function (url, init, callback) {
    const h = init.headers instanceof Headers ? init.headers : new Headers(init.headers || undefined);
    const method = String(init.method || 'GET').toUpperCase();
    const list = requestHeaders(h, method, init.body ? init.contentType : null);
    H5.netRequest(J.request(r => {
        if (!r || r.error) { callback(null, { status: 0, error: r ? r.error : 'failed' }); return; }
        callback(new Uint8Array(r.body), { status: r.status, statusText: r.statusText, headers: r.headers, url: r.url });
    }), method, url, list, init.body || null, init.timeout || 0);
};
J.decodeDataURL = function (url) {
    const m = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(url);
    if (!m) return null;
    const type = (m[1].split(';')[0] || 'text/plain').trim().toLowerCase();
    try {
        let bytes;
        if (m[2]) {
            const body = m[3].replace(/%([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
            bytes = J.base64ToBytes(body.replace(/[\t\n\f\r ]/g, ''));
        } else {
            bytes = percentDecode(m[3]);
        }
        return { type, bytes };
    } catch (e) { return null; }
};

// ---------------------------------------------------------------- Blob, File, FileReader
class Blob {
    constructor(parts = [], opts = {}) {
        const chunks = [];
        let size = 0;
        for (const p of parts) {
            let b;
            if (p instanceof Blob) b = p._bytes;
            else if (p instanceof ArrayBuffer) b = new Uint8Array(p);
            else if (ArrayBuffer.isView(p)) b = new Uint8Array(p.buffer, p.byteOffset, p.byteLength);
            else b = J.utf8Encode(String(p));
            chunks.push(b); size += b.length;
        }
        const all = new Uint8Array(size);
        let o = 0;
        for (const c of chunks) { all.set(c, o); o += c.length; }
        this._bytes = all;
        this._type = opts.type ? String(opts.type).toLowerCase() : '';
    }
    get size() { return this._bytes.length; }
    get type() { return this._type; }
    slice(start = 0, end = this._bytes.length, type = '') { const b = new Blob([], { type }); b._bytes = this._bytes.slice(start, end); return b; }
    arrayBuffer() { return Promise.resolve(this._bytes.slice().buffer); }
    bytes() { return Promise.resolve(this._bytes.slice()); }
    text() { return Promise.resolve(J.utf8Decode(this._bytes)); }
    stream() { throw new Error('Blob.stream is not supported'); }
}
J.blobFromBytes = function (bytes, type) { const b = new Blob([], { type }); b._bytes = bytes; return b; };
def(G, 'Blob', Blob);
def(G, 'File', class File extends Blob {
    constructor(parts, name, opts = {}) { super(parts, opts); this._name = String(name); this._modified = opts.lastModified || Date.now(); }
    get name() { return this._name; }
    get lastModified() { return this._modified; }
    get webkitRelativePath() { return ''; }
});
class FileReader extends J.EventTarget {
    constructor() { super(); this.readyState = 0; this.result = null; this.error = null; this.onload = this.onerror = this.onloadend = this.onloadstart = this.onprogress = this.onabort = null; }
    _read(blob, make) {
        this.readyState = 1;
        setTimeout(() => {
            if (this.readyState !== 1) return;
            this.result = make(blob._bytes);
            this.readyState = 2;
            J.dispatch(this, new G.ProgressEvent('load', { loaded: blob.size, total: blob.size, lengthComputable: true }));
            J.dispatch(this, new G.ProgressEvent('loadend', { loaded: blob.size, total: blob.size, lengthComputable: true }));
        }, 0);
    }
    readAsArrayBuffer(b) { this._read(b, x => x.slice().buffer); }
    readAsText(b) { this._read(b, x => J.utf8Decode(x)); }
    readAsDataURL(b) { this._read(b, x => 'data:' + (b.type || 'application/octet-stream') + ';base64,' + J.bytesToBase64(x)); }
    readAsBinaryString(b) { this._read(b, x => { let s = ''; for (let i = 0; i < x.length; i += 8192) s += String.fromCharCode.apply(null, x.subarray(i, i + 8192)); return s; }); }
    abort() { this.readyState = 2; J.dispatch(this, new G.ProgressEvent('abort')); }
}
FileReader.EMPTY = 0; FileReader.LOADING = 1; FileReader.DONE = 2;
def(G, 'FileReader', FileReader);
def(URL, 'createObjectURL', function (blob) {
    const url = 'blob:' + G.location.origin + '/' + (blobSeq++).toString(16).padStart(8, '0') + '-h5';
    blobURLs.set(url, blob);
    return url;
});
def(URL, 'revokeObjectURL', function (url) { blobURLs.delete(String(url)); });
J.blobOfURL = url => blobURLs.get(String(url)) || null;

// ---------------------------------------------------------------- Headers, Request, Response, fetch
class Headers {
    constructor(init) {
        this._m = new Map();
        if (!init) return;
        if (init instanceof Headers) init.forEach((v, k) => this.append(k, v));
        else if (Array.isArray(init)) for (const [k, v] of init) this.append(k, v);
        else for (const k of Object.keys(init)) this.append(k, init[k]);
    }
    append(k, v) { k = String(k).toLowerCase(); const cur = this._m.get(k); this._m.set(k, cur === undefined ? String(v) : cur + ', ' + v); }
    set(k, v) { this._m.set(String(k).toLowerCase(), String(v)); }
    get(k) { const v = this._m.get(String(k).toLowerCase()); return v === undefined ? null : v; }
    has(k) { return this._m.has(String(k).toLowerCase()); }
    delete(k) { this._m.delete(String(k).toLowerCase()); }
    forEach(cb, t) { for (const [k, v] of this._m) cb.call(t, v, k, this); }
    keys() { return this._m.keys(); }
    values() { return this._m.values(); }
    entries() { return this._m.entries(); }
    [Symbol.iterator]() { return this._m.entries(); }
}
def(G, 'Headers', Headers);

function bodyBytes(body) {
    if (body === undefined || body === null) return null;
    if (body instanceof Blob) return body._bytes;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    if (body instanceof G.URLSearchParams) return J.utf8Encode(body.toString());
    if (body instanceof FormData) return J.utf8Encode(body._encode());
    return J.utf8Encode(String(body));
}
J.bodyBytes = bodyBytes;
// the Content-Type a browser gives a body the page sent without one
function bodyType(body) {
    if (body === undefined || body === null || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return null;
    if (body instanceof Blob) return body.type || null;
    if (body instanceof G.URLSearchParams || body instanceof FormData) return 'application/x-www-form-urlencoded;charset=UTF-8';
    return 'text/plain;charset=UTF-8';
}

class Response {
    constructor(body, init = {}) {
        this._bytes = bodyBytes(body) || new Uint8Array(0);
        this._status = init.status === undefined ? 200 : init.status;
        this._statusText = init.statusText || '';
        this._headers = new Headers(init.headers);
        this._url = init.url || '';
        this._used = false;
        this._type = init.type || 'basic';
    }
    get status() { return this._status; }
    get statusText() { return this._statusText; }
    get ok() { return this._status >= 200 && this._status < 300; }
    get headers() { return this._headers; }
    get url() { return this._url; }
    get type() { return this._type; }
    get redirected() { return false; }
    get bodyUsed() { return this._used; }
    get body() { return null; }
    _take() { if (this._used) return Promise.reject(new TypeError('body stream already read')); this._used = true; return Promise.resolve(this._bytes); }
    arrayBuffer() { return this._take().then(b => b.slice().buffer); }
    bytes() { return this._take().then(b => b.slice()); }
    text() { return this._take().then(b => J.utf8Decode(b)); }
    json() { return this.text().then(t => JSON.parse(t)); }
    blob() { return this._take().then(b => J.blobFromBytes(b.slice(), this._headers.get('content-type') || '')); }
    formData() { return Promise.reject(new TypeError('formData is not supported')); }
    clone() { const r = new Response(this._bytes.slice(), { status: this._status, statusText: this._statusText, headers: this._headers, url: this._url }); return r; }
    static error() { return new Response(null, { status: 0, type: 'error' }); }
    static json(data, init = {}) { const h = new Headers(init.headers); h.set('content-type', 'application/json'); return new Response(JSON.stringify(data), Object.assign({}, init, { headers: h })); }
    static redirect(url, status = 302) { return new Response(null, { status, headers: { location: url } }); }
}
def(G, 'Response', Response);

class Request {
    constructor(input, init = {}) {
        if (input instanceof Request) { init = Object.assign({ method: input.method, headers: input.headers, body: input._body }, init); input = input.url; }
        this._url = J.resolveURL(String(input)) || String(input);
        this._method = String(init.method || 'GET').toUpperCase();
        this._headers = new Headers(init.headers);
        this._body = init.body === undefined ? null : init.body;
        this._signal = init.signal || null;
        this._credentials = init.credentials || 'same-origin';
        this._mode = init.mode || 'cors';
        this._cache = init.cache || 'default';
    }
    get url() { return this._url; }
    get method() { return this._method; }
    get headers() { return this._headers; }
    get signal() { return this._signal; }
    get credentials() { return this._credentials; }
    get mode() { return this._mode; }
    get cache() { return this._cache; }
    get bodyUsed() { return false; }
    clone() { return new Request(this); }
    arrayBuffer() { return Promise.resolve((bodyBytes(this._body) || new Uint8Array(0)).slice().buffer); }
    text() { return Promise.resolve(J.utf8Decode(bodyBytes(this._body) || new Uint8Array(0))); }
    json() { return this.text().then(t => JSON.parse(t)); }
}
def(G, 'Request', Request);

def(G, 'fetch', function fetch(input, init) {
    const req = new Request(input, init);
    return new Promise((resolve, reject) => {
        if (req._signal && req._signal.aborted) { reject(req._signal.reason || new G.DOMException('The user aborted a request.', 'AbortError')); return; }
        let aborted = false;
        if (req._signal) req._signal.addEventListener('abort', () => { aborted = true; reject(req._signal.reason || new G.DOMException('The user aborted a request.', 'AbortError')); });
        const done = (bytes, info) => {
            if (aborted) return;
            if (!bytes && (!info || !info.status)) { reject(new TypeError('Failed to fetch')); return; }
            const headers = new Headers(info && info.headers);
            if (info && info.type && !headers.has('content-type')) headers.set('content-type', info.type);
            resolve(new Response(bytes || new Uint8Array(0), { status: info.status || 200, statusText: info.statusText || '', headers, url: req.url }));
        };
        if (req.method === 'GET' || req.method === 'HEAD') J.loadBytes(req.url, done);
        else J.request2(req.url, { method: req.method, headers: req._headers, body: bodyBytes(req._body), contentType: bodyType(req._body) }, done);
    });
});

// ---------------------------------------------------------------- FormData
class FormData {
    constructor() { this._list = []; }
    append(k, v) { this._list.push([String(k), v instanceof Blob ? v : String(v)]); }
    set(k, v) { this.delete(k); this.append(k, v); }
    get(k) { const p = this._list.find(p => p[0] === k); return p ? p[1] : null; }
    getAll(k) { return this._list.filter(p => p[0] === k).map(p => p[1]); }
    has(k) { return this._list.some(p => p[0] === k); }
    delete(k) { this._list = this._list.filter(p => p[0] !== k); }
    entries() { return this._list[Symbol.iterator](); }
    [Symbol.iterator]() { return this.entries(); }
    forEach(cb, t) { for (const [k, v] of this._list) cb.call(t, v, k, this); }
    _encode() { return new G.URLSearchParams(this._list.filter(p => typeof p[1] === 'string')).toString(); }
}
def(G, 'FormData', FormData);

// ---------------------------------------------------------------- XMLHttpRequest
class XMLHttpRequestEventTarget extends J.EventTarget {}
class XMLHttpRequest extends XMLHttpRequestEventTarget {
    constructor() {
        super();
        this._readyState = 0;
        this._status = 0;
        this._statusText = '';
        this._response = null;
        this._bytes = null;
        this._headers = new Headers();
        this._respHeaders = new Headers();
        this.responseType = '';
        this.timeout = 0;
        this.withCredentials = false;
        this.upload = new XMLHttpRequestEventTarget();
        this._aborted = false;
        this._mime = null;
        for (const h of ['readystatechange', 'loadstart', 'progress', 'load', 'loadend', 'error', 'abort', 'timeout']) this['on' + h] = null;
    }
    get readyState() { return this._readyState; }
    get status() { return this._status; }
    get statusText() { return this._statusText; }
    get responseURL() { return this._url || ''; }
    get responseText() {
        if (this.responseType !== '' && this.responseType !== 'text') throw new G.DOMException("The value is only accessible if the object's 'responseType' is '' or 'text'.", 'InvalidStateError');
        return this._bytes ? J.utf8Decode(this._bytes) : '';
    }
    get responseXML() { return null; }
    get response() {
        if (this._readyState !== 4 || !this._bytes) return this.responseType === '' || this.responseType === 'text' ? (this._bytes ? J.utf8Decode(this._bytes) : '') : null;
        if (this._response !== null) return this._response;
        switch (this.responseType) {
        case 'arraybuffer': this._response = this._bytes.byteOffset === 0 && this._bytes.byteLength === this._bytes.buffer.byteLength ? this._bytes.buffer : this._bytes.slice().buffer; break;
        case 'blob': this._response = J.blobFromBytes(this._bytes, this._respHeaders.get('content-type') || ''); break;
        case 'json': try { this._response = JSON.parse(J.utf8Decode(this._bytes)); } catch (e) { this._response = null; } break;
        case 'document': this._response = null; break;
        default: this._response = J.utf8Decode(this._bytes);
        }
        return this._response;
    }
    open(method, url, async = true) {
        this._method = String(method).toUpperCase();
        this._url = J.resolveURL(String(url)) || String(url);
        this._async = async !== false;
        this._readyState = 1;
        this._status = 0;
        this._bytes = null;
        this._response = null;
        this._aborted = false;
        this._headers = new Headers();
        this._fireState();
    }
    setRequestHeader(k, v) { this._headers.append(k, v); }
    overrideMimeType(m) { this._mime = m; }
    getResponseHeader(k) { return this._readyState >= 2 ? this._respHeaders.get(k) : null; }
    getAllResponseHeaders() { if (this._readyState < 2) return ''; let s = ''; this._respHeaders.forEach((v, k) => { s += k + ': ' + v + '\r\n'; }); return s; }
    abort() {
        if (this._readyState === 0 || this._readyState === 4) return;
        this._aborted = true;
        this._readyState = 4;
        this._fireState();
        this._fire('abort');
        this._fire('loadend');
        this._readyState = 0;
    }
    _fireState() { J.dispatch(this, new G.Event('readystatechange')); }
    _fire(type, loaded = 0, total = 0) { J.dispatch(this, new G.ProgressEvent(type, { loaded, total, lengthComputable: total > 0 })); }
    send(body) {
        if (this._readyState !== 1) throw new G.DOMException("Failed to execute 'send' on 'XMLHttpRequest': The object's state must be OPENED.", 'InvalidStateError');
        const url = this._url;
        const finish = (bytes, info) => {
            if (this._aborted) return;
            if (!bytes && (!info || !info.status)) {
                this._readyState = 4;
                this._status = 0;
                this._fireState();
                this._fire('error');
                this._fire('loadend');
                return;
            }
            this._status = info.status || 200;
            this._statusText = info.statusText || (this._status === 200 ? 'OK' : '');
            this._respHeaders = new Headers(info.headers);
            if (info.type && !this._respHeaders.has('content-type')) this._respHeaders.set('content-type', info.type);
            this._bytes = bytes || new Uint8Array(0);
            this._readyState = 2; this._fireState();
            this._readyState = 3; this._fireState();
            this._fire('progress', this._bytes.length, this._bytes.length);
            this._readyState = 4; this._fireState();
            this._fire('load', this._bytes.length, this._bytes.length);
            this._fire('loadend', this._bytes.length, this._bytes.length);
        };
        if (!this._async) {
            // synchronous: local files only
            const path = J.urlToPath(url);
            const buf = path ? H5.readBytes(path) : null;
            if (buf) finish(new Uint8Array(buf), { status: 200, type: J.mimeOf(url) });
            else finish(null, { status: path ? 404 : 0 });
            return;
        }
        this._fire('loadstart');
        if (this._method === 'GET' || this._method === 'HEAD') J.loadBytes(url, finish);
        else J.request2(url, { method: this._method, headers: this._headers, body: bodyBytes(body), contentType: bodyType(body), withCredentials: this.withCredentials, timeout: this.timeout || 0 }, finish);
    }
}
for (const [k, v] of [['UNSENT', 0], ['OPENED', 1], ['HEADERS_RECEIVED', 2], ['LOADING', 3], ['DONE', 4]]) { XMLHttpRequest[k] = v; XMLHttpRequest.prototype[k] = v; }
def(G, 'XMLHttpRequestEventTarget', XMLHttpRequestEventTarget);
def(G, 'XMLHttpRequest', XMLHttpRequest);

// ---------------------------------------------------------------- WebSocket, EventSource: no network yet
class WebSocket extends J.EventTarget {
    constructor(url) {
        super();
        this.url = String(url); this.readyState = 0; this.protocol = ''; this.extensions = ''; this.bufferedAmount = 0; this.binaryType = 'blob';
        this.onopen = this.onclose = this.onerror = this.onmessage = null;
        H5.log(1, 'net: WebSocket ' + this.url + ' (offline)');
        setTimeout(() => { this.readyState = 3; J.dispatch(this, new G.Event('error')); J.dispatch(this, Object.assign(new G.Event('close'), { code: 1006, reason: '', wasClean: false })); }, 0);
    }
    send() {}
    close() { this.readyState = 3; }
}
Object.assign(WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
def(G, 'WebSocket', WebSocket);
def(G, 'EventSource', class EventSource extends J.EventTarget { constructor(url) { super(); this.url = url; this.readyState = 2; } close() {} });

// ---------------------------------------------------------------- storage (localStorage persists in the data folder)
class Storage {
    constructor(file) { this._map = new Map(); this._file = file; this._timer = 0; if (file) this._load(); }
    _load() {
        const text = H5.readText(this._file);
        if (text === null) return;
        try { const o = JSON.parse(text); for (const k of Object.keys(o)) this._map.set(k, String(o[k])); }
        catch (e) { H5.log(2, 'localStorage: ' + this._file + ' unreadable: ' + e.message); }
    }
    _save() {
        if (!this._file) return;
        if (this._timer) return;
        this._timer = setTimeout(() => this._flush(), 2000);
    }
    _flush() {
        if (this._timer) { clearTimeout(this._timer); this._timer = 0; }
        if (!this._file) return;
        const o = {};
        for (const [k, v] of this._map) o[k] = v;
        if (!H5.writeFile(this._file, JSON.stringify(o))) H5.log(3, 'localStorage: could not write ' + this._file);
    }
    get length() { return this._map.size; }
    key(i) { return Array.from(this._map.keys())[i] || null; }
    getItem(k) { const v = this._map.get(String(k)); return v === undefined ? null : v; }
    setItem(k, v) { this._map.set(String(k), String(v)); this._save(); }
    removeItem(k) { if (this._map.delete(String(k))) this._save(); }
    clear() { this._map.clear(); this._save(); }
}
// Storage objects answer property access too (localStorage.foo)
function storageProxy(s) {
    return new Proxy(s, {
        get(t, p) { if (typeof p === 'symbol' || p in t) { const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; } return t.getItem(p) === null ? undefined : t.getItem(p); },
        set(t, p, v) { if (typeof p === 'symbol' || p.startsWith('_')) t[p] = v; else t.setItem(p, v); return true; },
        deleteProperty(t, p) { t.removeItem(p); return true; },
        has(t, p) { return p in t || t._map.has(p); },
        ownKeys(t) { return Array.from(t._map.keys()); },
        getOwnPropertyDescriptor(t, p) { return t._map.has(p) ? { value: t._map.get(p), writable: true, enumerable: true, configurable: true } : undefined; },
    });
}
H5.mkdirs(H5.paths.data);
const local = new Storage(H5.paths.data + '/localStorage.json');
J.localStorage = local;
J.flushStorage = () => local._flush();
def(G, 'Storage', Storage);
def(G, 'localStorage', storageProxy(local));
def(G, 'sessionStorage', storageProxy(new Storage(null)));
def(G, 'indexedDB', undefined);
def(G, 'caches', undefined);

})(globalThis.__h5);

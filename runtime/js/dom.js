// h5 browser layer: the DOM. A tree of nodes with attributes, styles and events, and just enough layout
// (px boxes from inline styles, the window for the rest) for getBoundingClientRect and pointer mapping.
(function (H5) {
'use strict';
const G = globalThis;
const J = H5.js;
const def = J.def;

const screenW = H5.gl && H5.gl.available ? H5.gl.info().screenWidth : 1920;
const screenH = H5.gl && H5.gl.available ? H5.gl.info().screenHeight : 1080;
J.screen = { width: screenW, height: screenH };

// ---------------------------------------------------------------- styles
const PX_PROPS = new Set(['width', 'height', 'left', 'top', 'right', 'bottom', 'margin-left', 'margin-top', 'font-size']);
function camelToKebab(s) { return s.replace(/[A-Z]/g, c => '-' + c.toLowerCase()).replace(/^(webkit|moz|ms)-/, '-$1-'); }
function kebabToCamel(s) { return s.replace(/^-(webkit|moz|ms)-/, '$1-').replace(/-([a-z])/g, (m, c) => c.toUpperCase()); }
// a declaration's value without its "!important" (kept apart: nothing here cascades)
function cssValue(v) { return String(v).replace(/\s*!\s*important\s*$/i, '').trim(); }
const STYLE_METHODS = {
    setProperty(name, value, priority) { this._map.set(String(name).toLowerCase(), value === null || value === undefined ? '' : cssValue(value)); if (value === '' || value === null) this._map.delete(String(name).toLowerCase()); this._changed(); },
    getPropertyValue(name) { return this._map.get(String(name).toLowerCase()) || ''; },
    getPropertyPriority() { return ''; },
    removeProperty(name) { const k = String(name).toLowerCase(); const v = this._map.get(k) || ''; this._map.delete(k); this._changed(); return v; },
    item(i) { return Array.from(this._map.keys())[i] || ''; },
};
function makeStyle(owner) {
    const target = {
        _map: new Map(),
        _owner: owner,
        _changed() { if (owner && owner._styleChanged) owner._styleChanged(); },
    };
    return new Proxy(target, {
        get(t, prop) {
            if (typeof prop === 'symbol') return t[prop];
            if (prop in STYLE_METHODS) return STYLE_METHODS[prop].bind(t);
            if (prop === 'cssText') return Array.from(t._map).map(([k, v]) => k + ': ' + v + ';').join(' ');
            if (prop === 'length') return t._map.size;
            if (prop === '_map' || prop === '_changed' || prop === '_owner') return t[prop];
            if (prop === 'cssFloat') return t._map.get('float') || '';
            return t._map.get(camelToKebab(prop)) || '';
        },
        set(t, prop, value) {
            if (typeof prop === 'symbol') { t[prop] = value; return true; }
            if (prop === 'cssText') {
                t._map.clear();
                for (const decl of String(value).split(';')) {
                    const c = decl.indexOf(':');
                    if (c > 0) t._map.set(decl.slice(0, c).trim().toLowerCase(), cssValue(decl.slice(c + 1)));
                }
            } else {
                const k = camelToKebab(prop);
                let v = value === null || value === undefined ? '' : cssValue(value);
                if (typeof value === 'number' && PX_PROPS.has(k)) v = value + 'px';
                if (v === '') t._map.delete(k); else t._map.set(k, v);
            }
            t._changed();
            return true;
        },
        has(t, prop) { return true; },
        ownKeys(t) { return Array.from(t._map.keys()).map(kebabToCamel); },
        getOwnPropertyDescriptor(t, prop) { return { value: this.get(t, prop), writable: true, enumerable: true, configurable: true }; },
    });
}
J.makeStyle = makeStyle;
def(G, 'CSSStyleDeclaration', function CSSStyleDeclaration() {});
def(G, 'CSS', { supports: () => false, escape: s => String(s).replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c) });

// ---------------------------------------------------------------- class list, attributes
class DOMTokenList {
    constructor(el, attr) { this._el = el; this._attr = attr; }
    _get() { return (this._el.getAttribute(this._attr) || '').split(/\s+/).filter(Boolean); }
    _set(list) { this._el.setAttribute(this._attr, list.join(' ')); }
    get length() { return this._get().length; }
    get value() { return this._el.getAttribute(this._attr) || ''; }
    item(i) { return this._get()[i] || null; }
    contains(t) { return this._get().includes(t); }
    add(...ts) { const l = this._get(); for (const t of ts) if (!l.includes(t)) l.push(t); this._set(l); }
    remove(...ts) { this._set(this._get().filter(x => !ts.includes(x))); }
    toggle(t, force) { const has = this.contains(t); const want = force === undefined ? !has : !!force; if (want && !has) this.add(t); if (!want && has) this.remove(t); return want; }
    replace(a, b) { const l = this._get(); const i = l.indexOf(a); if (i < 0) return false; l[i] = b; this._set(l); return true; }
    supports() { return true; }
    forEach(cb, thisArg) { this._get().forEach(cb, thisArg); }
    [Symbol.iterator]() { return this._get()[Symbol.iterator](); }
    toString() { return this.value; }
}
def(G, 'DOMTokenList', DOMTokenList);

class DOMRect {
    constructor(x = 0, y = 0, width = 0, height = 0) { this.x = x; this.y = y; this.width = width; this.height = height; }
    get left() { return Math.min(this.x, this.x + this.width); }
    get top() { return Math.min(this.y, this.y + this.height); }
    get right() { return Math.max(this.x, this.x + this.width); }
    get bottom() { return Math.max(this.y, this.y + this.height); }
    toJSON() { return { x: this.x, y: this.y, width: this.width, height: this.height, left: this.left, top: this.top, right: this.right, bottom: this.bottom }; }
    static fromRect(r = {}) { return new DOMRect(r.x, r.y, r.width, r.height); }
}
def(G, 'DOMRect', DOMRect);
def(G, 'DOMRectReadOnly', DOMRect);

// ---------------------------------------------------------------- nodes
class NodeList {
    constructor(arr) { this._a = arr; }
    get length() { return this._a.length; }
    item(i) { return this._a[i] || null; }
    forEach(cb, t) { this._a.slice().forEach(cb, t); }
    entries() { return this._a.entries(); }
    keys() { return this._a.keys(); }
    values() { return this._a.values(); }
    [Symbol.iterator]() { return this._a[Symbol.iterator](); }
}
const nodeListProxy = {
    get(t, p) { if (typeof p === 'string' && /^\d+$/.test(p)) return t._a[+p]; return Reflect.get(t, p); },
};
function liveList(arr) { return new Proxy(new NodeList(arr), nodeListProxy); }
def(G, 'NodeList', NodeList);
def(G, 'HTMLCollection', NodeList);

class Node extends J.EventTarget {
    constructor() {
        super();
        this._parent = null;
        this._children = [];
        this._ownerDocument = J.document || null;
    }
    get parentNode() { return this._parent; }
    get parentElement() { return this._parent && this._parent.nodeType === 1 ? this._parent : null; }
    get childNodes() { return liveList(this._children); }
    get firstChild() { return this._children[0] || null; }
    get lastChild() { return this._children[this._children.length - 1] || null; }
    get previousSibling() { if (!this._parent) return null; const s = this._parent._children; return s[s.indexOf(this) - 1] || null; }
    get nextSibling() { if (!this._parent) return null; const s = this._parent._children; const i = s.indexOf(this); return i >= 0 ? s[i + 1] || null : null; }
    get ownerDocument() { return this.nodeType === 9 ? null : this._ownerDocument || J.document; }
    get isConnected() { let n = this; while (n._parent) n = n._parent; return n.nodeType === 9; }
    get textContent() { return this._children.map(c => c.textContent).join(''); }
    set textContent(v) { for (const c of this._children.slice()) this.removeChild(c); if (v !== null && v !== undefined && v !== '') this.appendChild(J.document.createTextNode(String(v))); }
    get nodeValue() { return null; }
    set nodeValue(v) {}
    get baseURI() { return J.pageURL; }
    hasChildNodes() { return this._children.length > 0; }
    getRootNode() { let n = this; while (n._parent) n = n._parent; return n; }
    contains(other) { while (other) { if (other === this) return true; other = other._parent; } return false; }
    compareDocumentPosition(other) { return this.contains(other) ? 20 : other && other.contains && other.contains(this) ? 10 : 1; }
    isSameNode(o) { return o === this; }
    isEqualNode(o) { return o === this; }
    appendChild(child) { return this.insertBefore(child, null); }
    insertBefore(child, ref) {
        if (!child || !(child instanceof Node)) throw new TypeError("Failed to execute 'insertBefore' on 'Node': parameter 1 is not of type 'Node'.");
        if (child.nodeType === 11) { for (const c of child._children.slice()) this.insertBefore(c, ref); return child; }
        if (child.contains(this)) throw new G.DOMException('The new child element contains the parent.', 'HierarchyRequestError');
        const wasConnected = child.isConnected;
        if (child._parent) child._parent._removeChildQuiet(child);
        const i = ref ? this._children.indexOf(ref) : -1;
        if (ref && i < 0) throw new G.DOMException('The node before which the new node is to be inserted is not a child of this node.', 'NotFoundError');
        if (i < 0) this._children.push(child); else this._children.splice(i, 0, child);
        child._parent = this;
        child._ownerDocument = this.nodeType === 9 ? this : this.ownerDocument;
        if (child.isConnected && !wasConnected) J.connected(child);
        J.layoutChanged();
        return child;
    }
    _removeChildQuiet(child) {
        const i = this._children.indexOf(child);
        if (i >= 0) this._children.splice(i, 1);
        child._parent = null;
    }
    removeChild(child) {
        if (!child || child._parent !== this) throw new G.DOMException('The node to be removed is not a child of this node.', 'NotFoundError');
        const wasConnected = child.isConnected;
        this._removeChildQuiet(child);
        if (wasConnected) J.disconnected(child);
        J.layoutChanged();
        return child;
    }
    replaceChild(newChild, oldChild) { this.insertBefore(newChild, oldChild); this.removeChild(oldChild); return oldChild; }
    cloneNode(deep) {
        const c = this._cloneShallow();
        if (deep) for (const k of this._children) c.appendChild(k.cloneNode(true));
        return c;
    }
    _cloneShallow() { return new this.constructor(); }
    normalize() {}
    lookupNamespaceURI() { return null; }
}
Object.assign(Node, { ELEMENT_NODE: 1, ATTRIBUTE_NODE: 2, TEXT_NODE: 3, CDATA_SECTION_NODE: 4, COMMENT_NODE: 8, DOCUMENT_NODE: 9, DOCUMENT_TYPE_NODE: 10, DOCUMENT_FRAGMENT_NODE: 11,
    DOCUMENT_POSITION_DISCONNECTED: 1, DOCUMENT_POSITION_PRECEDING: 2, DOCUMENT_POSITION_FOLLOWING: 4, DOCUMENT_POSITION_CONTAINS: 8, DOCUMENT_POSITION_CONTAINED_BY: 16 });
def(G, 'Node', Node);

class CharacterData extends Node {
    constructor(data) { super(); this._data = String(data === undefined ? '' : data); }
    get data() { return this._data; }
    set data(v) { this._data = String(v); J.layoutChanged(); }
    get length() { return this._data.length; }
    get nodeValue() { return this._data; }
    set nodeValue(v) { this._data = String(v); J.layoutChanged(); }
    get textContent() { return this._data; }
    set textContent(v) { this._data = String(v); J.layoutChanged(); }
    _cloneShallow() { return new this.constructor(this._data); }
    appendData(s) { this._data += s; }
    remove() { if (this._parent) this._parent.removeChild(this); }
}
class Text extends CharacterData {
    get nodeType() { return 3; }
    get nodeName() { return '#text'; }
    get wholeText() { return this._data; }
    splitText() { return this; }
}
class Comment extends CharacterData {
    get nodeType() { return 8; }
    get nodeName() { return '#comment'; }
}
def(G, 'CharacterData', CharacterData);
def(G, 'Text', Text);
def(G, 'Comment', Comment);

class DocumentFragment extends Node {
    get nodeType() { return 11; }
    get nodeName() { return '#document-fragment'; }
    get children() { return liveList(this._children.filter(c => c.nodeType === 1)); }
    querySelector(s) { return J.querySelectorAll(this, s, true)[0] || null; }
    querySelectorAll(s) { return liveList(J.querySelectorAll(this, s, false)); }
    getElementById(id) { return J.querySelectorAll(this, '#' + id, true)[0] || null; }
    append(...nodes) { for (const n of nodes) this.appendChild(typeof n === 'string' ? J.document.createTextNode(n) : n); }
}
def(G, 'DocumentFragment', DocumentFragment);

// ---------------------------------------------------------------- selectors (simple: tag, #id, .class, [attr], descendant/child)
function matchSimple(el, sel) {
    if (el.nodeType !== 1) return false;
    const re = /([#.]?[-\w]+|\*|\[[^\]]+\]|:[-\w]+(?:\([^)]*\))?)/g;
    let m;
    while ((m = re.exec(sel))) {
        const t = m[1];
        if (t === '*') continue;
        if (t[0] === '#') { if (el.id !== t.slice(1)) return false; }
        else if (t[0] === '.') { if (!el.classList.contains(t.slice(1))) return false; }
        else if (t[0] === '[') {
            const a = /^\[\s*([-\w:]+)\s*(?:([~|^$*]?=)\s*["']?([^"'\]]*)["']?)?\s*\]$/.exec(t);
            if (!a) return false;
            const v = el.getAttribute(a[1]);
            if (v === null) return false;
            if (a[2] === '=' && v !== a[3]) return false;
            if (a[2] === '^=' && !v.startsWith(a[3])) return false;
            if (a[2] === '$=' && !v.endsWith(a[3])) return false;
            if (a[2] === '*=' && !v.includes(a[3])) return false;
            if (a[2] === '~=' && !v.split(/\s+/).includes(a[3])) return false;
        } else if (t[0] === ':') {
            if (t === ':focus' && J.document.activeElement !== el) return false;
            if (t.startsWith(':not(')) { if (matchSimple(el, t.slice(5, -1))) return false; }
            if (t === ':first-child' && el._parent && el._parent._children.find(c => c.nodeType === 1) !== el) return false;
        } else if (el.localName !== t.toLowerCase()) return false;
    }
    return true;
}
function matches(el, selector) {
    for (const alt of String(selector).split(',')) {
        const parts = alt.trim().split(/\s*(>)\s*|\s+/).filter(p => p !== undefined && p !== '');
        if (!parts.length) continue;
        let ok = matchSimple(el, parts[parts.length - 1]);
        let cur = el;
        for (let i = parts.length - 2; ok && i >= 0; i--) {
            if (parts[i] === '>') { i--; cur = cur._parent; ok = cur && matchSimple(cur, parts[i]); }
            else { cur = cur._parent; while (cur && !matchSimple(cur, parts[i])) cur = cur._parent; ok = !!cur; }
        }
        if (ok) return true;
    }
    return false;
}
J.matches = matches;
J.querySelectorAll = function (root, selector, first) {
    const out = [];
    const walk = n => {
        for (const c of n._children) {
            if (c.nodeType === 1 && matches(c, selector)) { out.push(c); if (first) return true; }
            if (walk(c)) return true;
        }
        return false;
    };
    walk(root);
    return out;
};

// ---------------------------------------------------------------- elements
const HTML_NS = 'http://www.w3.org/1999/xhtml';
class Element extends Node {
    constructor(tag, ns) {
        super();
        this._tag = String(tag || 'div').toLowerCase();
        this._ns = ns || HTML_NS;
        this._attrs = new Map();
        this._style = null;
        this._classList = null;
        this._scrollTop = 0;
        this._scrollLeft = 0;
    }
    get nodeType() { return 1; }
    get nodeName() { return this._ns === HTML_NS ? this._tag.toUpperCase() : this._tag; }
    get tagName() { return this.nodeName; }
    get localName() { return this._tag; }
    get namespaceURI() { return this._ns; }
    get prefix() { return null; }
    get id() { return this.getAttribute('id') || ''; }
    set id(v) { this.setAttribute('id', v); }
    get className() { return this.getAttribute('class') || ''; }
    set className(v) { this.setAttribute('class', v); }
    get classList() { return this._classList || (this._classList = new DOMTokenList(this, 'class')); }
    get style() { return this._style || (this._style = makeStyle(this)); }
    set style(v) { this.style.cssText = v; }
    get dataset() {
        const el = this;
        return new Proxy({}, {
            get: (t, p) => typeof p === 'string' ? el.getAttribute('data-' + camelToKebab(p)) || undefined : undefined,
            set: (t, p, v) => { el.setAttribute('data-' + camelToKebab(p), v); return true; },
            deleteProperty: (t, p) => { el.removeAttribute('data-' + camelToKebab(p)); return true; },
            ownKeys: () => Array.from(el._attrs.keys()).filter(k => k.startsWith('data-')).map(k => kebabToCamel(k.slice(5))),
            getOwnPropertyDescriptor: (t, p) => ({ value: el.getAttribute('data-' + camelToKebab(p)), enumerable: true, configurable: true }),
        });
    }
    get attributes() {
        const list = Array.from(this._attrs, ([name, value]) => ({ name, value, localName: name, nodeName: name, specified: true }));
        list.getNamedItem = n => list.find(a => a.name === n) || null;
        return list;
    }
    getAttribute(n) { const v = this._attrs.get(String(n).toLowerCase()); return v === undefined ? null : v; }
    getAttributeNS(ns, n) { return this.getAttribute(n); }
    setAttribute(n, v) {
        n = String(n).toLowerCase();
        v = String(v);
        this._attrs.set(n, v);
        if (n === 'style') { this.style.cssText = v; }
        this._attributeChanged(n, v);
    }
    setAttributeNS(ns, n, v) { this.setAttribute(n, v); }
    removeAttribute(n) { n = String(n).toLowerCase(); this._attrs.delete(n); this._attributeChanged(n, null); }
    removeAttributeNS(ns, n) { this.removeAttribute(n); }
    hasAttribute(n) { return this._attrs.has(String(n).toLowerCase()); }
    hasAttributes() { return this._attrs.size > 0; }
    toggleAttribute(n, force) { const has = this.hasAttribute(n); const want = force === undefined ? !has : !!force; if (want) this.setAttribute(n, ''); else this.removeAttribute(n); return want; }
    getAttributeNames() { return Array.from(this._attrs.keys()); }
    getAttributeNode(n) { const v = this.getAttribute(n); return v === null ? null : { name: n, value: v }; }
    _attributeChanged(name, value) {}
    _styleChanged() { J.layoutChanged(); }
    _cloneShallow() {
        const c = J.document.createElementNS(this._ns, this._tag);
        for (const [k, v] of this._attrs) c.setAttribute(k, v);
        return c;
    }
    get children() { return liveList(this._children.filter(c => c.nodeType === 1)); }
    get childElementCount() { return this._children.filter(c => c.nodeType === 1).length; }
    get firstElementChild() { return this._children.find(c => c.nodeType === 1) || null; }
    get lastElementChild() { for (let i = this._children.length - 1; i >= 0; i--) if (this._children[i].nodeType === 1) return this._children[i]; return null; }
    get nextElementSibling() { let n = this.nextSibling; while (n && n.nodeType !== 1) n = n.nextSibling; return n; }
    get previousElementSibling() { let n = this.previousSibling; while (n && n.nodeType !== 1) n = n.previousSibling; return n; }
    append(...nodes) { for (const n of nodes) this.appendChild(typeof n === 'string' ? J.document.createTextNode(n) : n); }
    prepend(...nodes) { for (const n of nodes.reverse()) this.insertBefore(typeof n === 'string' ? J.document.createTextNode(n) : n, this.firstChild); }
    remove() { if (this._parent) this._parent.removeChild(this); }
    before(...nodes) { if (this._parent) for (const n of nodes) this._parent.insertBefore(typeof n === 'string' ? J.document.createTextNode(n) : n, this); }
    after(...nodes) { if (this._parent) { const next = this.nextSibling; for (const n of nodes) this._parent.insertBefore(typeof n === 'string' ? J.document.createTextNode(n) : n, next); } }
    replaceWith(...nodes) { if (this._parent) { this.before(...nodes); this.remove(); } }
    replaceChildren(...nodes) { for (const c of this._children.slice()) this.removeChild(c); this.append(...nodes); }
    querySelector(s) { return J.querySelectorAll(this, s, true)[0] || null; }
    querySelectorAll(s) { return liveList(J.querySelectorAll(this, s, false)); }
    getElementsByTagName(t) { return liveList(J.querySelectorAll(this, t === '*' ? '*' : t, false)); }
    getElementsByClassName(c) { return liveList(J.querySelectorAll(this, c.split(/\s+/).map(x => '.' + x).join(''), false)); }
    closest(s) { let n = this; while (n && n.nodeType === 1) { if (matches(n, s)) return n; n = n._parent; } return null; }
    matches(s) { return matches(this, s); }
    webkitMatchesSelector(s) { return matches(this, s); }
    get innerHTML() { return this._children.map(c => c.nodeType === 1 ? c.outerHTML : c.nodeType === 3 ? c._data.replace(/&/g, '&amp;').replace(/</g, '&lt;') : '').join(''); }
    set innerHTML(v) {
        for (const c of this._children.slice()) this.removeChild(c);
        v = String(v);
        if (!v) return;
        if (/</.test(v)) J.parseHTMLInto(this, v);
        else this.appendChild(J.document.createTextNode(v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')));
    }
    get outerHTML() {
        const attrs = Array.from(this._attrs, ([k, v]) => ' ' + k + '="' + String(v).replace(/"/g, '&quot;') + '"').join('');
        return '<' + this._tag + attrs + '>' + this.innerHTML + '</' + this._tag + '>';
    }
    insertAdjacentHTML(pos, html) {
        const frag = J.document.createDocumentFragment();
        J.parseHTMLInto(frag, String(html));
        this.insertAdjacentElement(pos, frag);
    }
    insertAdjacentElement(pos, el) {
        switch (String(pos).toLowerCase()) {
        case 'beforebegin': if (this._parent) this._parent.insertBefore(el, this); break;
        case 'afterbegin': this.insertBefore(el, this.firstChild); break;
        case 'beforeend': this.appendChild(el); break;
        case 'afterend': if (this._parent) this._parent.insertBefore(el, this.nextSibling); break;
        }
        return el;
    }
    insertAdjacentText(pos, text) { this.insertAdjacentElement(pos, J.document.createTextNode(text)); }
    // layout
    getBoundingClientRect() { const b = J.box(this); return new DOMRect(b.x, b.y, b.w, b.h); }
    getClientRects() { return [this.getBoundingClientRect()]; }
    get clientWidth() { return Math.round(J.box(this).w); }
    get clientHeight() { return Math.round(J.box(this).h); }
    get clientLeft() { return 0; }
    get clientTop() { return 0; }
    get scrollWidth() { return this.clientWidth; }
    get scrollHeight() { return this.clientHeight; }
    get scrollTop() { return this._scrollTop; }
    set scrollTop(v) { this._scrollTop = Number(v) || 0; }
    get scrollLeft() { return this._scrollLeft; }
    set scrollLeft(v) { this._scrollLeft = Number(v) || 0; }
    scrollIntoView() {}
    scrollTo() {}
    scrollBy() {}
    // pointer capture, fullscreen
    setPointerCapture(id) { J.pointerCapture = this; }
    releasePointerCapture(id) { if (J.pointerCapture === this) J.pointerCapture = null; }
    hasPointerCapture(id) { return J.pointerCapture === this; }
    requestFullscreen() { J.document._fullscreen = this; setTimeout(() => J.fireSimple(J.document, 'fullscreenchange', true), 0); return Promise.resolve(); }
    webkitRequestFullscreen() { return this.requestFullscreen(); }
    requestPointerLock() { return Promise.resolve(); }
    animate() { return { finished: Promise.resolve(), cancel() {}, play() {}, pause() {}, onfinish: null }; }
    getAnimations() { return []; }
    attachShadow() { const f = new DocumentFragment(); this._shadow = f; return f; }
    get shadowRoot() { return this._shadow || null; }
}
def(G, 'Element', Element);

class HTMLElement extends Element {
    get hidden() { return this.hasAttribute('hidden'); }
    set hidden(v) { this.toggleAttribute('hidden', !!v); }
    get title() { return this.getAttribute('title') || ''; }
    set title(v) { this.setAttribute('title', v); }
    get lang() { return this.getAttribute('lang') || ''; }
    set lang(v) { this.setAttribute('lang', v); }
    get dir() { return this.getAttribute('dir') || ''; }
    set dir(v) { this.setAttribute('dir', v); }
    get tabIndex() { const v = this.getAttribute('tabindex'); return v === null ? -1 : parseInt(v, 10); }
    set tabIndex(v) { this.setAttribute('tabindex', v); }
    get draggable() { return this.getAttribute('draggable') === 'true'; }
    set draggable(v) { this.setAttribute('draggable', v ? 'true' : 'false'); }
    get contentEditable() { return this.getAttribute('contenteditable') || 'inherit'; }
    set contentEditable(v) { this.setAttribute('contenteditable', v); }
    get isContentEditable() { return this.getAttribute('contenteditable') === 'true'; }
    get innerText() { return this.textContent; }
    set innerText(v) { this.textContent = v; }
    get outerText() { return this.textContent; }
    get offsetWidth() { return Math.round(J.box(this).w); }
    get offsetHeight() { return Math.round(J.box(this).h); }
    get offsetLeft() { return Math.round(J.box(this).x); }
    get offsetTop() { return Math.round(J.box(this).y); }
    get offsetParent() { return this._parent && this._parent.nodeType === 1 ? this._parent : null; }
    focus(opts) { J.focus(this); }
    blur() { if (J.document.activeElement === this) J.focus(null); }
    click() { J.dispatch(this, new G.MouseEvent('click', { bubbles: true, cancelable: true })); }
}
def(G, 'HTMLElement', HTMLElement);

// on<event> handler properties (null until set) for the events the page may use
const HANDLERS = ['abort', 'blur', 'canplay', 'canplaythrough', 'change', 'click', 'contextmenu', 'dblclick', 'durationchange', 'emptied', 'ended', 'error',
    'focus', 'input', 'keydown', 'keypress', 'keyup', 'load', 'loadeddata', 'loadedmetadata', 'loadstart', 'mousedown', 'mouseenter', 'mouseleave',
    'mousemove', 'mouseout', 'mouseover', 'mouseup', 'pause', 'play', 'playing', 'pointercancel', 'pointerdown', 'pointerenter', 'pointerleave',
    'pointermove', 'pointerout', 'pointerover', 'pointerup', 'progress', 'resize', 'scroll', 'seeked', 'seeking', 'select', 'stalled', 'submit',
    'suspend', 'timeupdate', 'volumechange', 'waiting', 'wheel', 'gotpointercapture', 'lostpointercapture', 'animationend', 'transitionend',
    'webglcontextlost', 'webglcontextrestored', 'webglcontextcreationerror'];
for (const h of HANDLERS) {
    for (const proto of [HTMLElement.prototype]) {
        Object.defineProperty(proto, 'on' + h, { get() { return this['_on' + h] || null; }, set(v) { this['_on' + h] = v; }, configurable: true });
    }
}

const tagClasses = new Map();
function defineTag(tags, cls, name) {
    def(G, name, cls);
    for (const t of tags) tagClasses.set(t, cls);
}
defineTag(['div'], class HTMLDivElement extends HTMLElement {}, 'HTMLDivElement');
defineTag(['span'], class HTMLSpanElement extends HTMLElement {}, 'HTMLSpanElement');
defineTag(['p'], class HTMLParagraphElement extends HTMLElement {}, 'HTMLParagraphElement');
defineTag(['br'], class HTMLBRElement extends HTMLElement {}, 'HTMLBRElement');
defineTag(['ul', 'ol', 'li'], class HTMLUListElement extends HTMLElement {}, 'HTMLUListElement');
defineTag(['a'], class HTMLAnchorElement extends HTMLElement {
    get href() { const h = this.getAttribute('href'); return h === null ? '' : J.resolveURL(h) || h; }
    set href(v) { this.setAttribute('href', v); }
    get target() { return this.getAttribute('target') || ''; }
    set target(v) { this.setAttribute('target', v); }
    get download() { return this.getAttribute('download') || ''; }
    set download(v) { this.setAttribute('download', v); }
    get pathname() { try { return new URL(this.href).pathname; } catch (e) { return ''; } }
    get hostname() { try { return new URL(this.href).hostname; } catch (e) { return ''; } }
    get protocol() { try { return new URL(this.href).protocol; } catch (e) { return ''; } }
    get host() { try { return new URL(this.href).host; } catch (e) { return ''; } }
    get search() { try { return new URL(this.href).search; } catch (e) { return ''; } }
    get hash() { try { return new URL(this.href).hash; } catch (e) { return ''; } }
    get port() { try { return new URL(this.href).port; } catch (e) { return ''; } }
    get origin() { try { return new URL(this.href).origin; } catch (e) { return ''; } }
    click() { const ok = J.dispatch(this, new G.MouseEvent('click', { bubbles: true, cancelable: true })); if (ok && this.href) G.open(this.href, this.target); }
}, 'HTMLAnchorElement');
defineTag(['button'], class HTMLButtonElement extends HTMLElement {
    get disabled() { return this.hasAttribute('disabled'); }
    set disabled(v) { this.toggleAttribute('disabled', !!v); }
    get type() { return this.getAttribute('type') || 'submit'; }
    set type(v) { this.setAttribute('type', v); }
    get value() { return this.getAttribute('value') || ''; }
    set value(v) { this.setAttribute('value', v); }
}, 'HTMLButtonElement');
defineTag(['form'], class HTMLFormElement extends HTMLElement { submit() {} reset() {} get elements() { return this.querySelectorAll('input,textarea,select,button'); } }, 'HTMLFormElement');
defineTag(['iframe'], class HTMLIFrameElement extends HTMLElement { get contentWindow() { return null; } get contentDocument() { return null; } get src() { return this.getAttribute('src') || ''; } set src(v) { this.setAttribute('src', v); } }, 'HTMLIFrameElement');
defineTag(['select'], class HTMLSelectElement extends HTMLElement { get value() { return this._value || ''; } set value(v) { this._value = String(v); } get options() { return this.querySelectorAll('option'); } }, 'HTMLSelectElement');
defineTag(['option'], class HTMLOptionElement extends HTMLElement { get value() { return this.getAttribute('value') || this.textContent; } set value(v) { this.setAttribute('value', v); } }, 'HTMLOptionElement');
defineTag(['label'], class HTMLLabelElement extends HTMLElement {}, 'HTMLLabelElement');
defineTag(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'], class HTMLHeadingElement extends HTMLElement {}, 'HTMLHeadingElement');
defineTag(['meta'], class HTMLMetaElement extends HTMLElement { get content() { return this.getAttribute('content') || ''; } set content(v) { this.setAttribute('content', v); } get name() { return this.getAttribute('name') || ''; } set name(v) { this.setAttribute('name', v); } }, 'HTMLMetaElement');
defineTag(['title'], class HTMLTitleElement extends HTMLElement { get text() { return this.textContent; } set text(v) { this.textContent = v; } }, 'HTMLTitleElement');
defineTag(['html'], class HTMLHtmlElement extends HTMLElement {}, 'HTMLHtmlElement');
defineTag(['head'], class HTMLHeadElement extends HTMLElement {}, 'HTMLHeadElement');
defineTag(['body'], class HTMLBodyElement extends HTMLElement {}, 'HTMLBodyElement');
defineTag(['pre'], class HTMLPreElement extends HTMLElement {}, 'HTMLPreElement');
defineTag(['img'], class HTMLUnknownImg extends HTMLElement {}, 'HTMLUnknownImg');   // (media.js puts HTMLImageElement here)
def(G, 'HTMLUnknownElement', class HTMLUnknownElement extends HTMLElement {});
def(G, 'SVGElement', class SVGElement extends Element {});
def(G, 'SVGSVGElement', class SVGSVGElement extends G.SVGElement { createSVGMatrix() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; } });
J.defineTag = defineTag;

// <input>, <textarea>: their value, and the system keyboard when focused (input.js)
class TextControl extends HTMLElement {
    constructor(tag) { super(tag); this._value = ''; this._selStart = 0; this._selEnd = 0; }
    get value() { return this._value; }
    set value(v) { this._value = v === null || v === undefined ? '' : String(v); this._selStart = this._selEnd = this._value.length; }
    get defaultValue() { return this.getAttribute('value') || ''; }
    set defaultValue(v) { this.setAttribute('value', v); }
    get placeholder() { return this.getAttribute('placeholder') || ''; }
    set placeholder(v) { this.setAttribute('placeholder', v); }
    get maxLength() { const v = this.getAttribute('maxlength'); return v === null ? -1 : parseInt(v, 10); }
    set maxLength(v) { this.setAttribute('maxlength', v); }
    get disabled() { return this.hasAttribute('disabled'); }
    set disabled(v) { this.toggleAttribute('disabled', !!v); }
    get readOnly() { return this.hasAttribute('readonly'); }
    set readOnly(v) { this.toggleAttribute('readonly', !!v); }
    get name() { return this.getAttribute('name') || ''; }
    set name(v) { this.setAttribute('name', v); }
    get selectionStart() { return this._selStart; }
    set selectionStart(v) { this._selStart = Math.max(0, Math.min(this._value.length, v | 0)); }
    get selectionEnd() { return this._selEnd; }
    set selectionEnd(v) { this._selEnd = Math.max(0, Math.min(this._value.length, v | 0)); }
    get selectionDirection() { return 'none'; }
    setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; }
    select() { this._selStart = 0; this._selEnd = this._value.length; }
    setRangeText(text, start = this._selStart, end = this._selEnd) { this._value = this._value.slice(0, start) + text + this._value.slice(end); this._selStart = this._selEnd = start + String(text).length; }
    checkValidity() { return true; }
    reportValidity() { return true; }
    setCustomValidity() {}
    get validity() { return { valid: true }; }
    get form() { return this.closest('form'); }
}
defineTag(['input'], class HTMLInputElement extends TextControl {
    get type() { return this.getAttribute('type') || 'text'; }
    set type(v) { this.setAttribute('type', v); }
    get checked() { return !!this._checked; }
    set checked(v) { this._checked = !!v; }
    get files() { return []; }
    get autocomplete() { return this.getAttribute('autocomplete') || ''; }
    set autocomplete(v) { this.setAttribute('autocomplete', v); }
}, 'HTMLInputElement');
defineTag(['textarea'], class HTMLTextAreaElement extends TextControl {
    get type() { return 'textarea'; }
    get rows() { return parseInt(this.getAttribute('rows') || '2', 10); }
    set rows(v) { this.setAttribute('rows', v); }
    get cols() { return parseInt(this.getAttribute('cols') || '20', 10); }
    set cols(v) { this.setAttribute('cols', v); }
    get textLength() { return this._value.length; }
}, 'HTMLTextAreaElement');
J.TextControl = TextControl;

// <script>: runs when it joins the document (src: fetched first)
defineTag(['script'], class HTMLScriptElement extends HTMLElement {
    get src() { const s = this.getAttribute('src'); return s ? J.resolveURL(s) || s : ''; }
    set src(v) { this.setAttribute('src', v); }
    get type() { return this.getAttribute('type') || ''; }
    set type(v) { this.setAttribute('type', v); }
    get async() { return this._async !== false; }
    set async(v) { this._async = !!v; }
    get defer() { return this.hasAttribute('defer'); }
    set defer(v) { this.toggleAttribute('defer', !!v); }
    get text() { return this.textContent; }
    set text(v) { this.textContent = v; }
    get crossOrigin() { return this.getAttribute('crossorigin'); }
    set crossOrigin(v) { this.setAttribute('crossorigin', v); }
    get charset() { return this.getAttribute('charset') || ''; }
    set charset(v) { this.setAttribute('charset', v); }
    get integrity() { return ''; }
    set integrity(v) {}
    get noModule() { return false; }
    set noModule(v) {}
    _connected() {
        if (this._started) return;
        this._started = true;
        const type = this.type;
        if (type && !/javascript|ecmascript|^module$/i.test(type)) return;
        if (this.hasAttribute('src')) {
            const url = this.src;
            J.loadText(url, (text, error) => {
                if (text === null) { H5.log(2, 'script ' + url + ': ' + (error || 'not loaded')); J.fire(this, new Event('error')); return; }
                J.runScript(text, url, this);
                J.fire(this, new Event('load'));
            });
        } else {
            const text = this.textContent;
            if (text.trim()) J.runScript(text, J.pageURL + '#inline', this);
        }
    }
}, 'HTMLScriptElement');
J.runScript = function (text, url, element) {
    const doc = J.document;
    const previous = doc._currentScript;
    doc._currentScript = element || null;
    try { H5.evaluate(text, url); }
    catch (e) { J.reportError(e, 'script ' + url); }
    finally { doc._currentScript = previous; }
};

// <style>: @font-face rules register fonts (media.js); the rest is ignored
defineTag(['style'], class HTMLStyleElement extends HTMLElement {
    get sheet() { return { cssRules: [], insertRule() { return 0; }, deleteRule() {} }; }
    get type() { return this.getAttribute('type') || 'text/css'; }
    set type(v) { this.setAttribute('type', v); }
    _connected() { if (J.applyCSS) J.applyCSS(this.textContent, J.pageURL); }
}, 'HTMLStyleElement');
// <link rel=stylesheet>: fetched for its @font-face rules
defineTag(['link'], class HTMLLinkElement extends HTMLElement {
    get href() { const h = this.getAttribute('href'); return h ? J.resolveURL(h) || h : ''; }
    set href(v) { this.setAttribute('href', v); }
    get rel() { return this.getAttribute('rel') || ''; }
    set rel(v) { this.setAttribute('rel', v); }
    get as() { return this.getAttribute('as') || ''; }
    set as(v) { this.setAttribute('as', v); }
    get type() { return this.getAttribute('type') || ''; }
    set type(v) { this.setAttribute('type', v); }
    get crossOrigin() { return this.getAttribute('crossorigin'); }
    set crossOrigin(v) { this.setAttribute('crossorigin', v); }
    get relList() { return new DOMTokenList(this, 'rel'); }
    get sheet() { return null; }
    _connected() {
        const url = this.href;
        if (!/stylesheet/i.test(this.rel) || !url) { setTimeout(() => J.fire(this, new Event('load')), 0); return; }
        J.loadText(url, text => {
            if (text === null) { J.fire(this, new Event('error')); return; }
            if (J.applyCSS) J.applyCSS(text, url, () => J.fire(this, new Event('load')));
            else J.fire(this, new Event('load'));
        });
    }
}, 'HTMLLinkElement');

// ---------------------------------------------------------------- a tiny HTML parser (innerHTML of simple markup)
J.parseHTMLInto = function (parent, html) {
    const doc = J.document;
    const stack = [parent];
    const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
    const VOID = new Set(['br', 'img', 'input', 'meta', 'link', 'hr', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']);
    const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    let m;
    while ((m = re.exec(html))) {
        const top = stack[stack.length - 1];
        if (m[4] !== undefined) { top.appendChild(doc.createTextNode(decode(m[4]))); continue; }
        if (!m[1]) continue;
        const tag = m[1].toLowerCase();
        if (m[0][1] === '/') { for (let i = stack.length - 1; i > 0; i--) if (stack[i].localName === tag) { stack.length = i; break; } continue; }
        const el = doc.createElement(tag);
        const attrRe = /([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
        let a;
        while ((a = attrRe.exec(m[2] || ''))) {
            let v = a[2] === undefined ? '' : a[2];
            if (v[0] === '"' || v[0] === "'") v = v.slice(1, -1);
            el.setAttribute(a[1], decode(v));
        }
        top.appendChild(el);
        if (!m[3] && !VOID.has(tag)) stack.push(el);
    }
};

// ---------------------------------------------------------------- layout: boxes from inline px styles
function px(v, base) {
    if (!v) return null;
    v = String(v).trim();
    if (v.endsWith('px')) return parseFloat(v);
    if (v.endsWith('%')) return base * parseFloat(v) / 100;
    if (v.endsWith('vw')) return J.screen.width * parseFloat(v) / 100;
    if (v.endsWith('vh')) return J.screen.height * parseFloat(v) / 100;
    if (/^-?[\d.]+$/.test(v)) return parseFloat(v);
    return null;
}
let layoutGeneration = 1;
J.layoutChanged = function () { layoutGeneration++; };

// text boxes: inline elements and absolutely placed ones without a width shrink to their text, measured with
// the canvas text natives (so a web font that has loaded measures differently from the fallback, as pages
// that wait for fonts by measuring a span expect)
const INLINE = new Set(['span', 'a', 'b', 'i', 'em', 'strong', 'label', 'small', 'sub', 'sup', 'font', 'code', 'tt', 'u', 's']);
let measureHandle = null;
function inheritedStyle(el, prop, fallback) {
    for (let n = el; n && n.nodeType === 1; n = n._parent) {
        const v = n._style ? n._style.getPropertyValue(prop) : '';
        if (v) return v;
    }
    return fallback;
}
J.textSize = function (el) {
    const text = el.textContent;
    const sizeValue = inheritedStyle(el, 'font-size', '16px');
    const size = parseFloat(sizeValue) * (/pt$/.test(sizeValue) ? 4 / 3 : /em$/.test(sizeValue) ? 16 : 1) || 16;
    if (!text) return { w: 0, h: Math.ceil(size * 1.15) };
    const family = inheritedStyle(el, 'font-family', 'sans-serif').split(',').map(f => f.trim().replace(/^["']|["']$/g, '')).filter(Boolean).join(',') || 'sans-serif';
    const weightValue = inheritedStyle(el, 'font-weight', '400');
    const weight = weightValue === 'bold' ? 700 : parseInt(weightValue, 10) || 400;
    const italic = /italic|oblique/.test(inheritedStyle(el, 'font-style', 'normal'));
    const C = H5.c2d;
    if (!measureHandle) measureHandle = C.create(1, 1);
    C.setFont(measureHandle, family, size, weight, italic);
    const m = C.measureText(measureHandle, text.replace(/\s+/g, ' '));
    return { w: Math.ceil(m[0]), h: Math.ceil(size * 1.15) };
};
J.box = function (el) {
    if (el._boxGen === layoutGeneration && el._box) return el._box;
    let box;
    if (!el._parent || el.localName === 'html' || el.localName === 'body' || el.nodeType === 9) {
        box = { x: 0, y: 0, w: J.screen.width, h: J.screen.height };
    } else {
        const p = el._parent.nodeType === 1 ? J.box(el._parent) : { x: 0, y: 0, w: J.screen.width, h: J.screen.height };
        const s = el._style ? el._style : null;
        const get = k => s ? s.getPropertyValue(k) : '';
        if (get('display') === 'none') box = { x: 0, y: 0, w: 0, h: 0 };
        else {
            let w = px(get('width'), p.w), h = px(get('height'), p.h);
            const pos = get('position');
            const shrinks = INLINE.has(el.localName) || pos === 'absolute' || pos === 'fixed' || get('display') === 'inline-block' || get('display') === 'inline';
            const intrinsic = el._intrinsicSize ? el._intrinsicSize() : (w === null || h === null) && shrinks ? J.textSize(el) : null;
            if (w === null) w = intrinsic ? intrinsic.w : p.w;
            if (h === null) h = intrinsic ? intrinsic.h : (el.localName === 'div' ? p.h : 0);
            let x = p.x, y = p.y;
            const left = px(get('left'), p.w), top = px(get('top'), p.h);
            const ml = px(get('margin-left'), p.w), mt = px(get('margin-top'), p.h);
            if (pos === 'fixed') { x = 0; y = 0; }
            if (left !== null) x += left; else if (px(get('right'), p.w) !== null) x += p.w - w - px(get('right'), p.w);
            if (top !== null) y += top; else if (px(get('bottom'), p.h) !== null) y += p.h - h - px(get('bottom'), p.h);
            if (ml !== null) x += ml;
            if (mt !== null) y += mt;
            const tf = get('transform');
            if (tf) { const t = /translate\(\s*(-?[\d.]+)(px|%)?\s*,\s*(-?[\d.]+)(px|%)?\s*\)/.exec(tf); if (t) { x += t[2] === '%' ? w * t[1] / 100 : +t[1]; y += t[4] === '%' ? h * t[3] / 100 : +t[3]; } }
            box = { x, y, w, h };
        }
    }
    el._box = box;
    el._boxGen = layoutGeneration;
    return box;
};

// ---------------------------------------------------------------- the document
class Document extends Node {
    constructor() {
        super();
        this._readyState = 'loading';
        this._title = '';
        this._cookies = new Map();
        this._active = null;
        this._fullscreen = null;
        this._currentScript = null;
    }
    get nodeType() { return 9; }
    get nodeName() { return '#document'; }
    get documentElement() { return this._children.find(c => c.nodeType === 1) || null; }
    get head() { const h = this.documentElement; return h ? h._children.find(c => c.localName === 'head') || null : null; }
    get body() { const h = this.documentElement; return h ? h._children.find(c => c.localName === 'body') || null : null; }
    get children() { return liveList(this._children.filter(c => c.nodeType === 1)); }
    get firstElementChild() { return this.documentElement; }
    get readyState() { return this._readyState; }
    get visibilityState() { return 'visible'; }
    get hidden() { return false; }
    get webkitHidden() { return false; }
    hasFocus() { return true; }
    get activeElement() { return this._active || this.body; }
    get title() { return this._title; }
    set title(v) { this._title = String(v); }
    get URL() { return J.pageURL; }
    get documentURI() { return J.pageURL; }
    get baseURI() { return J.pageURL; }
    get referrer() { return ''; }
    get domain() { return G.location.hostname; }
    get location() { return G.location; }
    get defaultView() { return G; }
    get characterSet() { return 'UTF-8'; }
    get charset() { return 'UTF-8'; }
    get inputEncoding() { return 'UTF-8'; }
    get contentType() { return 'text/html'; }
    get compatMode() { return 'CSS1Compat'; }
    get doctype() { return { name: 'html', nodeType: 10 }; }
    get currentScript() { return this._currentScript; }
    get scrollingElement() { return this.documentElement; }
    get styleSheets() { return []; }
    get forms() { return this.querySelectorAll('form'); }
    get images() { return this.querySelectorAll('img'); }
    get scripts() { return this.querySelectorAll('script'); }
    get links() { return this.querySelectorAll('a'); }
    get fullscreenElement() { return this._fullscreen; }
    get webkitFullscreenElement() { return this._fullscreen; }
    get webkitCurrentFullScreenElement() { return this._fullscreen; }
    get fullscreenEnabled() { return true; }
    get webkitFullscreenEnabled() { return true; }
    get fullscreen() { return !!this._fullscreen; }
    exitFullscreen() { this._fullscreen = null; setTimeout(() => J.fireSimple(this, 'fullscreenchange', true), 0); return Promise.resolve(); }
    webkitExitFullscreen() { return this.exitFullscreen(); }
    get pointerLockElement() { return null; }
    exitPointerLock() {}
    get cookie() { return Array.from(this._cookies, ([k, v]) => k + '=' + v).join('; '); }
    set cookie(v) {
        const first = String(v).split(';')[0];
        const eq = first.indexOf('=');
        if (eq <= 0) return;
        const k = first.slice(0, eq).trim(), val = first.slice(eq + 1).trim();
        if (/expires=Thu, 01 Jan 1970/i.test(v) || /max-age=0/i.test(v)) this._cookies.delete(k); else this._cookies.set(k, val);
    }
    get implementation() { return { createHTMLDocument: () => new Document(), hasFeature: () => true, createDocumentType: () => null }; }
    createElement(tag) {
        tag = String(tag).toLowerCase();
        const cls = tagClasses.get(tag);
        const el = cls ? new cls(tag) : new HTMLElement(tag);
        el._ownerDocument = this;
        return el;
    }
    createElementNS(ns, tag) {
        if (!ns || ns === HTML_NS) return this.createElement(tag);
        const el = ns === 'http://www.w3.org/2000/svg' ? (String(tag).toLowerCase() === 'svg' ? new G.SVGSVGElement(tag, ns) : new G.SVGElement(tag, ns)) : new Element(tag, ns);
        el._ownerDocument = this;
        return el;
    }
    createTextNode(t) { const n = new Text(t); n._ownerDocument = this; return n; }
    createComment(t) { const n = new Comment(t); n._ownerDocument = this; return n; }
    createDocumentFragment() { const f = new DocumentFragment(); f._ownerDocument = this; return f; }
    createEvent(kind) {
        const k = String(kind).toLowerCase();
        const cls = /mouse/.test(k) ? G.MouseEvent : /keyboard|key/.test(k) ? G.KeyboardEvent : /custom/.test(k) ? G.CustomEvent : /ui/.test(k) ? G.UIEvent : /touch/.test(k) ? J.TouchEvent : G.Event;
        return new cls('');
    }
    createRange() { return { setStart() {}, setEnd() {}, selectNodeContents() {}, collapse() {}, getBoundingClientRect: () => new DOMRect(), createContextualFragment: html => { const f = this.createDocumentFragment(); J.parseHTMLInto(f, html); return f; } }; }
    createTreeWalker(root) { const list = J.querySelectorAll(root, '*', false); let i = -1; return { nextNode: () => list[++i] || null, currentNode: root }; }
    getElementById(id) { return J.querySelectorAll(this, '#' + CSS.escape(String(id)), true)[0] || null; }
    getElementsByTagName(t) { return liveList(J.querySelectorAll(this, t, false)); }
    getElementsByClassName(c) { return liveList(J.querySelectorAll(this, String(c).split(/\s+/).map(x => '.' + x).join(''), false)); }
    getElementsByName(n) { return liveList(J.querySelectorAll(this, '[name="' + n + '"]', false)); }
    querySelector(s) { return J.querySelectorAll(this, s, true)[0] || null; }
    querySelectorAll(s) { return liveList(J.querySelectorAll(this, s, false)); }
    elementFromPoint(x, y) { return J.hitTest ? J.hitTest(x, y) : this.body; }
    elementsFromPoint(x, y) { const e = this.elementFromPoint(x, y); return e ? [e] : []; }
    caretRangeFromPoint() { return null; }
    execCommand() { return false; }
    queryCommandSupported() { return false; }
    getSelection() { return G.getSelection(); }
    open() { return this; }
    close() {}
    write(s) { H5.log(2, 'document.write ignored: ' + String(s).slice(0, 80)); }
    writeln(s) { this.write(s); }
    adoptNode(n) { return n; }
    importNode(n, deep) { return n.cloneNode(deep); }
}
for (const h of HANDLERS.concat(['readystatechange', 'visibilitychange', 'fullscreenchange', 'pointerlockchange', 'DOMContentLoaded'])) {
    Object.defineProperty(Document.prototype, 'on' + h, { get() { return this['_on' + h] || null; }, set(v) { this['_on' + h] = v; }, configurable: true });
}
def(G, 'Document', Document);
def(G, 'HTMLDocument', Document);

// connection to the document: scripts run, links load, canvases register (canvas2d/webgl.js)
J.connectedHooks = [];
J.connected = function (node) {
    const visit = n => {
        if (n._connected) { try { n._connected(); } catch (e) { J.reportError(e, 'connecting <' + n.localName + '>'); } }
        for (const h of J.connectedHooks) h(n);
        for (const c of n._children.slice()) visit(c);
    };
    visit(node);
};
J.disconnected = function (node) {
    const visit = n => {
        if (n._disconnected) n._disconnected();
        if (J.document && J.document._active === n) J.document._active = null;
        for (const c of n._children) visit(c);
    };
    visit(node);
};

const document = new Document();
J.document = document;
const html = document.createElement('html');
document.appendChild(html);
html.appendChild(document.createElement('head'));
html.appendChild(document.createElement('body'));
def(G, 'document', document);

// focus
J.focus = function (el) {
    const doc = J.document;
    const old = doc._active;
    if (old === el) return;
    doc._active = el;
    if (old) {
        J.fire(old, new G.FocusEvent('blur', { relatedTarget: el }));
        J.fire(old, new G.FocusEvent('focusout', { bubbles: true, relatedTarget: el }));
    }
    if (el) {
        J.fire(el, new G.FocusEvent('focus', { relatedTarget: old }));
        J.fire(el, new G.FocusEvent('focusin', { bubbles: true, relatedTarget: old }));
        if (el instanceof J.TextControl && J.openKeyboard) J.openKeyboard(el);
    }
};

// document loading: the app calls J.documentLoaded() once its scripts have run
J.documentLoaded = function () {
    document._readyState = 'interactive';
    J.fireSimple(document, 'readystatechange');
    J.fire(document, new Event('DOMContentLoaded', { bubbles: true }));
    setTimeout(() => {
        document._readyState = 'complete';
        J.fireSimple(document, 'readystatechange');
        J.fire(G, new Event('load'));
        J.fire(G, new G.PageTransitionEvent('pageshow', { persisted: false }));
    }, 0);
};
J.fireHashChange = function () { J.fire(G, new G.HashChangeEvent('hashchange', { newURL: J.pageURL })); };

// ---------------------------------------------------------------- the window's size, screen, media queries
J.getter(G, 'innerWidth', () => J.screen.width);
J.getter(G, 'innerHeight', () => J.screen.height);
J.getter(G, 'outerWidth', () => J.screen.width);
J.getter(G, 'outerHeight', () => J.screen.height);
const orientation = { type: 'landscape-primary', angle: 0, onchange: null, addEventListener() {}, removeEventListener() {}, lock: () => Promise.reject(new Error('not supported')), unlock() {} };
def(G, 'screen', { get width() { return J.screen.width; }, get height() { return J.screen.height; }, get availWidth() { return J.screen.width; }, get availHeight() { return J.screen.height; },
    availLeft: 0, availTop: 0, colorDepth: 24, pixelDepth: 24, orientation, isExtended: false, addEventListener() {}, removeEventListener() {} });
def(G, 'visualViewport', { get width() { return J.screen.width; }, get height() { return J.screen.height; }, offsetLeft: 0, offsetTop: 0, pageLeft: 0, pageTop: 0, scale: 1, addEventListener() {}, removeEventListener() {} });
def(G, 'matchMedia', q => {
    const query = String(q);
    const test = () => {
        let ok = true;
        query.replace(/\(\s*([-\w]+)\s*(?::\s*([^)]+))?\)/g, (m, f, v) => {
            const n = parseFloat(v);
            switch (f) {
            case 'min-width': ok = ok && J.screen.width >= n; break;
            case 'max-width': ok = ok && J.screen.width <= n; break;
            case 'min-height': ok = ok && J.screen.height >= n; break;
            case 'max-height': ok = ok && J.screen.height <= n; break;
            case 'orientation': ok = ok && /landscape/.test(v); break;
            case 'pointer': case 'any-pointer': ok = ok && /fine/.test(v); break;
            case 'hover': case 'any-hover': ok = ok && /hover/.test(v); break;
            case 'prefers-reduced-motion': ok = ok && /no-preference/.test(v); break;
            case 'prefers-color-scheme': ok = ok && /light/.test(v); break;
            case 'min-resolution': case '-webkit-min-device-pixel-ratio': ok = ok && 1 >= n; break;
            case 'max-resolution': case '-webkit-max-device-pixel-ratio': ok = ok && 1 <= n; break;
            case 'display-mode': ok = ok && /fullscreen/.test(v); break;
            }
            return m;
        });
        return ok;
    };
    return { media: query, get matches() { return test(); }, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };
});
def(G, 'getComputedStyle', (el, pseudo) => {
    const b = el && el.nodeType === 1 ? J.box(el) : { w: 0, h: 0 };
    const s = el && el._style;
    const base = { width: b.w + 'px', height: b.h + 'px', display: (s && s.display) || 'block', visibility: 'visible', position: (s && s.position) || 'static',
        fontSize: (s && s.fontSize) || '16px', fontFamily: (s && s.fontFamily) || 'sans-serif', opacity: (s && s.opacity) || '1', zIndex: (s && s.zIndex) || 'auto',
        paddingLeft: '0px', paddingRight: '0px', paddingTop: '0px', paddingBottom: '0px', borderLeftWidth: '0px', borderRightWidth: '0px',
        borderTopWidth: '0px', borderBottomWidth: '0px', marginLeft: '0px', marginTop: '0px', transform: 'none', overflow: 'visible', direction: 'ltr' };
    return new Proxy(base, {
        get(t, p) {
            if (p === 'getPropertyValue') return k => { const c = kebabToCamel(String(k)); return t[c] !== undefined ? t[c] : (s ? s.getPropertyValue(k) : ''); };
            if (typeof p === 'string' && t[p] === undefined && s) return s[p];
            return t[p];
        },
    });
});

// ---------------------------------------------------------------- observers (nothing is laid out: they never fire)
class StubObserver { constructor(cb) { this._cb = cb; } observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
def(G, 'MutationObserver', class MutationObserver extends StubObserver {});
def(G, 'WebKitMutationObserver', G.MutationObserver);
def(G, 'ResizeObserver', class ResizeObserver extends StubObserver {});
def(G, 'IntersectionObserver', class IntersectionObserver extends StubObserver {});
def(G, 'customElements', { define() {}, get() { return undefined; }, whenDefined: () => Promise.resolve(), upgrade() {} });

// ---------------------------------------------------------------- navigator
// a plain Chromium's; an app sets J.userAgent to its own shell's before the page's scripts run
J.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.78 Safari/537.36';
const chromeMajor = () => (/Chrome\/(\d+)/.exec(J.userAgent) || [0, '152'])[1];
const navigatorObject = {
    get userAgent() { return J.userAgent; },
    appName: 'Netscape', appCodeName: 'Mozilla', product: 'Gecko', productSub: '20030107',
    get appVersion() { return J.userAgent.replace(/^Mozilla\//, ''); },
    platform: 'Win32', vendor: 'Google Inc.', vendorSub: '',
    language: 'en-US', languages: ['en-US', 'en'],
    onLine: true, cookieEnabled: true, doNotTrack: null, webdriver: false, pdfViewerEnabled: false,
    hardwareConcurrency: 6, deviceMemory: 8, maxTouchPoints: 0,
    userActivation: { hasBeenActive: true, isActive: true },
    connection: { effectiveType: '4g', downlink: 10, rtt: 50, saveData: false, addEventListener() {}, removeEventListener() {} },
    plugins: [], mimeTypes: [],
    javaEnabled: () => false,
    sendBeacon: (url, data) => { H5.log(0, 'sendBeacon dropped: ' + url); return true; },
    vibrate: () => false,
    getBattery: () => Promise.resolve({ charging: true, level: 1, chargingTime: 0, dischargingTime: Infinity, addEventListener() {} }),
    clipboard: { writeText: t => { J.clipboard = String(t); return Promise.resolve(); }, readText: () => Promise.resolve(J.clipboard || ''), write: () => Promise.resolve(), read: () => Promise.resolve([]) },
    permissions: { query: () => Promise.resolve({ state: 'denied', onchange: null, addEventListener() {} }) },
    storage: { estimate: () => Promise.resolve({ quota: 1 << 30, usage: 0 }), persist: () => Promise.resolve(true), persisted: () => Promise.resolve(true) },
    mediaDevices: undefined,
    serviceWorker: undefined,
    getGamepads: () => [null, null, null, null],   // input.js
    requestMIDIAccess: undefined,
    userAgentData: { get brands() { return [{ brand: 'Chromium', version: chromeMajor() }]; }, mobile: false, platform: 'Windows', getHighEntropyValues: () => Promise.resolve({ platform: 'Windows', platformVersion: '10.0.0', architecture: 'x86', bitness: '64', model: '' }) },
};
def(G, 'navigator', navigatorObject);
def(G, 'clientInformation', navigatorObject);

})(globalThis.__h5);

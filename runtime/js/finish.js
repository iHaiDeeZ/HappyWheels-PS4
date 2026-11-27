// h5 browser layer: last step. Browsers' web API attributes and operations are enumerable (WebIDL), and
// pages find them with for...in; JavaScript classes define theirs non-enumerable. Redefine them.
(function (H5) {
'use strict';
const G = globalThis;
const J = H5.js;

function enumerableMembers(proto) {
    for (const key of Object.getOwnPropertyNames(proto)) {
        if (key === 'constructor' || key.startsWith('_')) continue;
        const d = Object.getOwnPropertyDescriptor(proto, key);
        if (d && !d.enumerable && d.configurable) { d.enumerable = true; Object.defineProperty(proto, key, d); }
    }
}
const done = new Set();
for (const cls of J.classes) {
    let p = cls.prototype;
    while (p && p !== Object.prototype && !done.has(p)) {
        done.add(p);
        enumerableMembers(p);
        p = Object.getPrototypeOf(p);
    }
}
// window's own attributes and operations (interfaces, i.e. capitalised constructors, stay non-enumerable)
for (const key of Object.getOwnPropertyNames(G)) {
    if (key.startsWith('__') || /^[A-Z]/.test(key)) continue;
    const d = Object.getOwnPropertyDescriptor(G, key);
    if (d && !d.enumerable && d.configurable && !['console', 'globalThis', 'undefined', 'NaN', 'Infinity', 'eval', 'isFinite', 'isNaN', 'parseFloat', 'parseInt',
        'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'escape', 'unescape'].includes(key)) {
        d.enumerable = true;
        Object.defineProperty(G, key, d);
    }
}
// the document and the other singletons' own members
for (const o of [J.document, G.navigator, G.screen, G.history, G.performance]) {
    if (!o) continue;
    for (const key of Object.getOwnPropertyNames(o)) {
        if (key.startsWith('_')) continue;
        const d = Object.getOwnPropertyDescriptor(o, key);
        if (d && !d.enumerable && d.configurable) { d.enumerable = true; Object.defineProperty(o, key, d); }
    }
}

})(globalThis.__h5);

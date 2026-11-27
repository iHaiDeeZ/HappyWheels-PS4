// h5 browser layer: events. EventTarget dispatches along the DOM path (capture, target, bubble); events the
// runtime makes (input, loading) are trusted, the page's own are not.
(function (H5) {
'use strict';
const G = globalThis;
const J = H5.js;
const def = J.def;

let trustedDepth = 0;
J.trusted = function (fn) { trustedDepth++; try { return fn(); } finally { trustedDepth--; } };

class Event {
    constructor(type, init = {}) {
        if (arguments.length === 0) throw new TypeError("Failed to construct 'Event': 1 argument required, but only 0 present.");
        this._type = String(type);
        this._bubbles = !!init.bubbles;
        this._cancelable = !!init.cancelable;
        this._composed = !!init.composed;
        this._defaultPrevented = false;
        this._stop = false;
        this._stopNow = false;
        this._target = null;
        this._current = null;
        this._phase = 0;
        this._trusted = trustedDepth > 0;
        this._time = H5.now();
        this._path = [];
        this._passive = false;
    }
    get type() { return this._type; }
    get bubbles() { return this._bubbles; }
    get cancelable() { return this._cancelable; }
    get composed() { return this._composed; }
    get defaultPrevented() { return this._defaultPrevented; }
    get target() { return this._target; }
    get srcElement() { return this._target; }
    get currentTarget() { return this._current; }
    get eventPhase() { return this._phase; }
    get isTrusted() { return this._trusted; }
    get timeStamp() { return this._time; }
    get returnValue() { return !this._defaultPrevented; }
    set returnValue(v) { if (!v) this.preventDefault(); }
    get cancelBubble() { return this._stop; }
    set cancelBubble(v) { if (v) this._stop = true; }
    preventDefault() { if (this._cancelable && !this._passive) this._defaultPrevented = true; }
    stopPropagation() { this._stop = true; }
    stopImmediatePropagation() { this._stop = true; this._stopNow = true; }
    composedPath() { return this._path.slice(); }
    initEvent(type, bubbles, cancelable) { this._type = String(type); this._bubbles = !!bubbles; this._cancelable = !!cancelable; }
}
Event.NONE = 0; Event.CAPTURING_PHASE = 1; Event.AT_TARGET = 2; Event.BUBBLING_PHASE = 3;
def(G, 'Event', Event);

function assignInit(ev, init, fields) {
    for (const [k, dflt] of fields) ev['_' + k] = init[k] !== undefined ? init[k] : dflt;
}
function getters(cls, names) {
    for (const n of names) Object.defineProperty(cls.prototype, n, { get() { return this['_' + n]; }, configurable: true, enumerable: true });
}

class CustomEvent extends Event {
    constructor(type, init = {}) { super(type, init); this._detail = init.detail === undefined ? null : init.detail; }
    get detail() { return this._detail; }
    initCustomEvent(type, bubbles, cancelable, detail) { this.initEvent(type, bubbles, cancelable); this._detail = detail; }
}
def(G, 'CustomEvent', CustomEvent);

class UIEvent extends Event {
    constructor(type, init = {}) { super(type, init); this._view = init.view || null; this._detail = init.detail || 0; }
    get view() { return this._view; }
    get detail() { return this._detail; }
    get which() { return 0; }
}
def(G, 'UIEvent', UIEvent);

const MODS = [['ctrlKey', false], ['shiftKey', false], ['altKey', false], ['metaKey', false]];
const MOUSE = [['screenX', 0], ['screenY', 0], ['clientX', 0], ['clientY', 0], ['movementX', 0], ['movementY', 0],
    ['button', 0], ['buttons', 0], ['relatedTarget', null]];
class MouseEvent extends UIEvent {
    constructor(type, init = {}) { super(type, init); assignInit(this, init, MOUSE.concat(MODS)); }
    get x() { return this._clientX; }
    get y() { return this._clientY; }
    get pageX() { return this._clientX; }
    get pageY() { return this._clientY; }
    get offsetX() { return this._clientX - (this._target && this._target.getBoundingClientRect ? this._target.getBoundingClientRect().left : 0); }
    get offsetY() { return this._clientY - (this._target && this._target.getBoundingClientRect ? this._target.getBoundingClientRect().top : 0); }
    get layerX() { return this.offsetX; }
    get layerY() { return this.offsetY; }
    get which() { return this._button + 1; }
    getModifierState(k) { return k === 'Control' ? this._ctrlKey : k === 'Shift' ? this._shiftKey : k === 'Alt' ? this._altKey : k === 'Meta' ? this._metaKey : false; }
    initMouseEvent(type, bubbles, cancelable, view, detail, sx, sy, cx, cy, ctrl, alt, shift, meta, button, related) {
        this.initEvent(type, bubbles, cancelable);
        Object.assign(this, { _view: view, _detail: detail, _screenX: sx, _screenY: sy, _clientX: cx, _clientY: cy, _ctrlKey: ctrl, _altKey: alt, _shiftKey: shift, _metaKey: meta, _button: button, _relatedTarget: related });
    }
}
getters(MouseEvent, MOUSE.concat(MODS).map(f => f[0]));
def(G, 'MouseEvent', MouseEvent);

const POINTER = [['pointerId', 1], ['width', 1], ['height', 1], ['pressure', 0], ['tangentialPressure', 0], ['tiltX', 0],
    ['tiltY', 0], ['twist', 0], ['pointerType', 'mouse'], ['isPrimary', true], ['altitudeAngle', Math.PI / 2], ['azimuthAngle', 0]];
class PointerEvent extends MouseEvent {
    constructor(type, init = {}) { super(type, init); assignInit(this, init, POINTER); }
    getCoalescedEvents() { return [this]; }
    getPredictedEvents() { return []; }
}
getters(PointerEvent, POINTER.map(f => f[0]));
def(G, 'PointerEvent', PointerEvent);

class WheelEvent extends MouseEvent {
    constructor(type, init = {}) { super(type, init); assignInit(this, init, [['deltaX', 0], ['deltaY', 0], ['deltaZ', 0], ['deltaMode', 0]]); }
}
getters(WheelEvent, ['deltaX', 'deltaY', 'deltaZ', 'deltaMode']);
WheelEvent.DOM_DELTA_PIXEL = 0; WheelEvent.DOM_DELTA_LINE = 1; WheelEvent.DOM_DELTA_PAGE = 2;
def(G, 'WheelEvent', WheelEvent);

const KEY = [['key', ''], ['code', ''], ['location', 0], ['repeat', false], ['isComposing', false], ['charCode', 0], ['keyCode', 0]];
class KeyboardEvent extends UIEvent {
    constructor(type, init = {}) { super(type, init); assignInit(this, init, KEY.concat(MODS)); }
    get which() { return this._keyCode || this._charCode; }
    getModifierState(k) { return k === 'Control' ? this._ctrlKey : k === 'Shift' ? this._shiftKey : k === 'Alt' ? this._altKey : k === 'Meta' ? this._metaKey : false; }
    initKeyboardEvent(type, bubbles, cancelable, view, key) { this.initEvent(type, bubbles, cancelable); this._key = key; }
}
getters(KeyboardEvent, KEY.concat(MODS).map(f => f[0]));
KeyboardEvent.DOM_KEY_LOCATION_STANDARD = 0; KeyboardEvent.DOM_KEY_LOCATION_LEFT = 1; KeyboardEvent.DOM_KEY_LOCATION_RIGHT = 2; KeyboardEvent.DOM_KEY_LOCATION_NUMPAD = 3;
def(G, 'KeyboardEvent', KeyboardEvent);

class FocusEvent extends UIEvent {
    constructor(type, init = {}) { super(type, init); this._relatedTarget = init.relatedTarget || null; }
    get relatedTarget() { return this._relatedTarget; }
}
def(G, 'FocusEvent', FocusEvent);

class InputEvent extends UIEvent {
    constructor(type, init = {}) { super(type, init); assignInit(this, init, [['data', null], ['inputType', ''], ['isComposing', false], ['dataTransfer', null]]); }
    getTargetRanges() { return []; }
}
getters(InputEvent, ['data', 'inputType', 'isComposing', 'dataTransfer']);
def(G, 'InputEvent', InputEvent);
def(G, 'CompositionEvent', class CompositionEvent extends UIEvent { constructor(t, i = {}) { super(t, i); this._data = i.data || ''; } get data() { return this._data; } });

class TouchEvent extends UIEvent {
    constructor(type, init = {}) { super(type, init); assignInit(this, init, [['touches', []], ['targetTouches', []], ['changedTouches', []]].concat(MODS)); }
}
getters(TouchEvent, ['touches', 'targetTouches', 'changedTouches'].concat(MODS.map(f => f[0])));
// (no TouchEvent on window: Pixi and the game take touch support from 'ontouchstart' in window)
J.TouchEvent = TouchEvent;

class ErrorEvent extends Event {
    constructor(type, init = {}) { super(type, init); assignInit(this, init, [['message', ''], ['filename', ''], ['lineno', 0], ['colno', 0], ['error', null]]); }
}
getters(ErrorEvent, ['message', 'filename', 'lineno', 'colno', 'error']);
def(G, 'ErrorEvent', ErrorEvent);

class ProgressEvent extends Event {
    constructor(type, init = {}) { super(type, init); assignInit(this, init, [['lengthComputable', false], ['loaded', 0], ['total', 0]]); }
}
getters(ProgressEvent, ['lengthComputable', 'loaded', 'total']);
def(G, 'ProgressEvent', ProgressEvent);

class MessageEvent extends Event {
    constructor(type, init = {}) { super(type, init); assignInit(this, init, [['data', null], ['origin', ''], ['lastEventId', ''], ['source', null], ['ports', []]]); }
}
getters(MessageEvent, ['data', 'origin', 'lastEventId', 'source', 'ports']);
def(G, 'MessageEvent', MessageEvent);

class PromiseRejectionEvent extends Event {
    constructor(type, init = {}) { super(type, init); this._promise = init.promise; this._reason = init.reason; }
    get promise() { return this._promise; }
    get reason() { return this._reason; }
}
def(G, 'PromiseRejectionEvent', PromiseRejectionEvent);

class GamepadEvent extends Event {
    constructor(type, init = {}) { super(type, init); this._gamepad = init.gamepad || null; }
    get gamepad() { return this._gamepad; }
}
def(G, 'GamepadEvent', GamepadEvent);
def(G, 'PageTransitionEvent', class PageTransitionEvent extends Event { constructor(t, i = {}) { super(t, i); this._persisted = !!i.persisted; } get persisted() { return this._persisted; } });
def(G, 'HashChangeEvent', class HashChangeEvent extends Event { constructor(t, i = {}) { super(t, i); this._old = i.oldURL || ''; this._new = i.newURL || ''; } get oldURL() { return this._old; } get newURL() { return this._new; } });
def(G, 'StorageEvent', class StorageEvent extends Event { constructor(t, i = {}) { super(t, i); Object.assign(this, { key: i.key || null, oldValue: i.oldValue || null, newValue: i.newValue || null, url: i.url || '', storageArea: i.storageArea || null }); } });
def(G, 'AnimationEvent', class AnimationEvent extends Event {});
def(G, 'TransitionEvent', class TransitionEvent extends Event {});
def(G, 'ClipboardEvent', class ClipboardEvent extends Event { get clipboardData() { return null; } });
def(G, 'DragEvent', class DragEvent extends MouseEvent { get dataTransfer() { return null; } });

class DOMException extends Error {
    constructor(message = '', name = 'Error') {
        super(message);
        this.name = name;
        const codes = { IndexSizeError: 1, HierarchyRequestError: 3, WrongDocumentError: 4, InvalidCharacterError: 5, NotFoundError: 8, NotSupportedError: 9, InvalidStateError: 11, SyntaxError: 12, InvalidAccessError: 15, SecurityError: 18, NetworkError: 19, AbortError: 20, TimeoutError: 23, DataCloneError: 25 };
        this.code = codes[name] || 0;
    }
}
def(G, 'DOMException', DOMException);

// ---------------------------------------------------------------- EventTarget
const LISTENERS = Symbol('listeners');
function listenersOf(t) {
    let m = t[LISTENERS];
    if (!m) { m = new Map(); Object.defineProperty(t, LISTENERS, { value: m, enumerable: false }); }
    return m;
}
class EventTarget {
    addEventListener(type, listener, options) {
        if (!listener) return;
        const capture = typeof options === 'boolean' ? options : !!(options && options.capture);
        const once = !!(options && typeof options === 'object' && options.once);
        const passive = !!(options && typeof options === 'object' && options.passive);
        const signal = options && typeof options === 'object' ? options.signal : undefined;
        if (signal && signal.aborted) return;
        const m = listenersOf(this);
        type = String(type);
        let list = m.get(type);
        if (!list) { list = []; m.set(type, list); }
        if (list.some(l => l.listener === listener && l.capture === capture)) return;
        const entry = { listener, capture, once, passive, removed: false };
        list.push(entry);
        if (signal) signal.addEventListener('abort', () => this.removeEventListener(type, listener, capture));
    }
    removeEventListener(type, listener, options) {
        const capture = typeof options === 'boolean' ? options : !!(options && options.capture);
        const m = this[LISTENERS];
        if (!m) return;
        const list = m.get(String(type));
        if (!list) return;
        const i = list.findIndex(l => l.listener === listener && l.capture === capture);
        if (i >= 0) { list[i].removed = true; list.splice(i, 1); }
    }
    dispatchEvent(event) {
        if (!(event instanceof Event)) throw new TypeError("Failed to execute 'dispatchEvent' on 'EventTarget': parameter 1 is not of type 'Event'.");
        return J.dispatch(this, event);
    }
}
def(G, 'EventTarget', EventTarget);
J.EventTarget = EventTarget;

function invoke(target, event, phase) {
    const m = target[LISTENERS];
    const handlerName = 'on' + event._type;
    const list = m && m.get(event._type);
    if (list && list.length) {
        for (const l of list.slice()) {
            if (l.removed) continue;
            if (phase === 1 && !l.capture) continue;
            if (phase === 3 && l.capture) continue;
            if (l.once) target.removeEventListener(event._type, l.listener, l.capture);
            event._passive = l.passive;
            try {
                if (typeof l.listener === 'function') l.listener.call(target, event);
                else if (l.listener && typeof l.listener.handleEvent === 'function') l.listener.handleEvent(event);
            } catch (e) { J.reportError(e, event._type + ' listener'); }
            event._passive = false;
            if (event._stopNow) return;
        }
    }
    // on<type> handler properties (window.onerror is called by the error path itself)
    if (phase !== 1 && !(target === G && event._type === 'error')) {
        const h = Object.prototype.hasOwnProperty.call(target, handlerName) || (target.constructor && handlerName in target) ? target[handlerName] : null;
        if (typeof h === 'function' && !(list && list.some(l => l.listener === h))) {
            try {
                const r = h.call(target, event);
                if (r === false && event._cancelable) event._defaultPrevented = true;
            } catch (e) { J.reportError(e, handlerName); }
        }
    }
}

// the path: target and its ancestors (nodes), the document, the window
J.eventPath = function (target) {
    const path = [target];
    if (target && target.nodeType !== undefined) {
        let n = target.parentNode;
        while (n) { path.push(n); n = n.parentNode; }
        if (path[path.length - 1] && path[path.length - 1].nodeType === 9 && target.isConnected !== false) path.push(G);
    }
    return path;
};
J.dispatch = function (target, event) {
    event._target = target;
    const path = J.eventPath(target);
    event._path = path;
    event._stop = event._stopNow = false;
    for (let i = path.length - 1; i > 0 && !event._stop; i--) {
        event._phase = 1; event._current = path[i]; invoke(path[i], event, 1);
    }
    if (!event._stop) { event._phase = 2; event._current = target; invoke(target, event, 2); }
    if (event._bubbles) for (let i = 1; i < path.length && !event._stop; i++) {
        event._phase = 3; event._current = path[i]; invoke(path[i], event, 3);
    }
    event._phase = 0; event._current = null;
    return !event._defaultPrevented;
};
// a trusted event fired by the runtime
J.fire = function (target, event) { event._trusted = true; return J.dispatch(target, event); };
J.fireSimple = function (target, type, bubbles) { return J.fire(target, new Event(type, { bubbles: !!bubbles })); };

// window is an EventTarget: its prototype chain gets EventTarget's methods
for (const k of ['addEventListener', 'removeEventListener', 'dispatchEvent'])
    def(G, k, EventTarget.prototype[k]);

// errors reaching the top: window.onerror, then an 'error' event
J.dispatchErrorEvent = function (error, message) {
    if (typeof G.onerror === 'function') {
        try { G.onerror(message, '', 0, 0, error); } catch (e) { H5.log(3, 'window.onerror threw: ' + e); }
    }
    J.fire(G, new ErrorEvent('error', { message, error, cancelable: true }));
};

// ---------------------------------------------------------------- AbortController
class AbortSignal extends EventTarget {
    constructor() { super(); this._aborted = false; this._reason = undefined; this.onabort = null; }
    get aborted() { return this._aborted; }
    get reason() { return this._reason; }
    throwIfAborted() { if (this._aborted) throw this._reason; }
    static abort(reason) { const c = new AbortController(); c.abort(reason); return c.signal; }
    static timeout(ms) { const c = new AbortController(); setTimeout(() => c.abort(new DOMException('signal timed out', 'TimeoutError')), ms); return c.signal; }
    static any(signals) { const c = new AbortController(); for (const s of signals) { if (s.aborted) { c.abort(s.reason); break; } s.addEventListener('abort', () => c.abort(s.reason)); } return c.signal; }
}
class AbortController {
    constructor() { this._signal = new AbortSignal(); }
    get signal() { return this._signal; }
    abort(reason) {
        const s = this._signal;
        if (s._aborted) return;
        s._aborted = true;
        s._reason = reason === undefined ? new DOMException('signal is aborted without reason', 'AbortError') : reason;
        J.dispatch(s, new Event('abort'));
    }
}
def(G, 'AbortSignal', AbortSignal);
def(G, 'AbortController', AbortController);

// ---------------------------------------------------------------- MessageChannel, postMessage
class MessagePort extends EventTarget {
    constructor() { super(); this._other = null; this._started = false; this._queue = []; this.onmessage = null; }
    postMessage(data) {
        const other = this._other;
        if (!other) return;
        const msg = structuredClone(data);
        setTimeout(() => J.dispatch(other, new MessageEvent('message', { data: msg })), 0);
    }
    start() { this._started = true; }
    close() { this._other = null; }
}
class MessageChannel {
    constructor() { this.port1 = new MessagePort(); this.port2 = new MessagePort(); this.port1._other = this.port2; this.port2._other = this.port1; }
}
def(G, 'MessagePort', MessagePort);
def(G, 'MessageChannel', MessageChannel);
def(G, 'BroadcastChannel', class BroadcastChannel extends EventTarget { constructor(name) { super(); this.name = name; } postMessage() {} close() {} });
def(G, 'postMessage', function (data, origin) {
    const msg = structuredClone(data);
    setTimeout(() => J.dispatch(G, new MessageEvent('message', { data: msg, origin: G.location.origin, source: G })), 0);
});

})(globalThis.__h5);

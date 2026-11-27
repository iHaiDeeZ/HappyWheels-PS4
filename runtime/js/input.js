// h5 browser layer: the controller as the Gamepad API (standard mapping, as OrbisWeb shows a DualShock 4),
// and the system keyboard for focused <input>/<textarea>.
(function (H5) {
'use strict';
const G = globalThis;
const J = H5.js;
const def = J.def;
const state = H5.padState;   // Float32Array [connected, timestamp, buttons x17, axes x4, touches, touch x, y, id]

// The runtime's own controls (js/overlay.js) share the controller with the page: they hide the buttons they
// are using from it (hideButtons / hideAxes: bit masks), press one for it (pressButtons), and learn which
// buttons and sticks the page listens to from what it reads (buttonRead / axisRead: the frame of the last read).
const P = J.pad = {
    frame: 0,
    hideButtons: 0,
    hideAxes: 0,
    pressButtons: 0,
    buttonRead: new Int32Array(17).fill(-1000000),
    axisRead: new Int32Array(4).fill(-1000000),
};

const PAD_ID = 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)';
class GamepadButton {
    constructor(i) { this._v = 0; this._i = i; }
    get pressed() { P.buttonRead[this._i] = P.frame; return this._v > 0.1; }
    get touched() { P.buttonRead[this._i] = P.frame; return this._v > 0; }
    get value() { P.buttonRead[this._i] = P.frame; return this._v; }
}
class Gamepad {
    constructor() {
        this._buttons = [];
        for (let i = 0; i < 17; i++) this._buttons.push(new GamepadButton(i));
        // the axes: an array whose elements note their reads
        this._values = new Float32Array(4);
        this._axes = [0, 0, 0, 0];
        for (let i = 0; i < 4; i++) {
            Object.defineProperty(this._axes, i, {
                enumerable: true,
                get: () => { P.axisRead[i] = P.frame; return this._values[i]; },
                set() { },
            });
        }
        this._time = 0;
        this._connected = false;
    }
    get id() { return PAD_ID; }
    get index() { return 0; }
    get connected() { return this._connected; }
    get timestamp() { return this._time; }
    get mapping() { return 'standard'; }
    get axes() { return this._axes; }
    get buttons() { return this._buttons; }
    get vibrationActuator() { return null; }
    get hapticActuators() { return []; }
    _refresh() {
        this._connected = state[0] > 0;
        this._time = state[1];
        const hide = P.hideButtons, press = P.pressButtons, hideAxes = P.hideAxes;
        for (let i = 0; i < 17; i++)
            this._buttons[i]._v = (press >> i) & 1 ? 1 : (hide >> i) & 1 ? 0 : state[2 + i];
        for (let i = 0; i < 4; i++) this._values[i] = (hideAxes >> i) & 1 ? 0 : state[19 + i];
    }
}
def(G, 'Gamepad', Gamepad);
def(G, 'GamepadButton', GamepadButton);
const pad = new Gamepad();
let announced = false;
const list = [null, null, null, null];
G.navigator.getGamepads = function getGamepads() {
    pad._refresh();
    list[0] = announced && pad._connected ? pad : null;
    return list;
};
// connect / disconnect events, once per change, before the page's frame
J.beforeFrame.push(() => {
    if (!J.pausePage) P.frame++;   // (a paused page reads nothing: what it listened to stays as it was)
    const connected = state[0] > 0;
    if (connected && !announced) {
        announced = true;
        pad._refresh();
        H5.log(1, 'input: controller connected');
        J.fire(G, new G.GamepadEvent('gamepadconnected', { gamepad: pad }));
    } else if (!connected && announced) {
        announced = false;
        pad._refresh();
        H5.log(1, 'input: controller disconnected');
        J.fire(G, new G.GamepadEvent('gamepaddisconnected', { gamepad: pad }));
    }
});

// ---------------------------------------------------------------- the system keyboard
let editing = null;
J.openKeyboard = function (el) {
    if (editing || el.disabled || el.readOnly) return;
    const multiline = el.localName === 'textarea';
    const title = el.placeholder || el.getAttribute('aria-label') || el.getAttribute('name') || '';
    if (!H5.imeOpen(title, el.value, el.maxLength > 0 ? el.maxLength : 0, multiline)) return;
    editing = el;
    H5.log(1, 'input: keyboard opened for <' + el.localName + (el.id ? '#' + el.id : '') + '>');
};
J.beforeFrame.push(() => {
    if (!editing) return;
    const r = H5.imePoll();
    if (r === 0 || r === null) { if (r === null) editing = null; return; }
    const el = editing;
    editing = null;
    if (r[0] === 1) {
        const before = el.value;
        el.value = r[1];
        if (el.value !== before) {
            J.fire(el, new G.InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: r[1] }));
            J.fire(el, new G.Event('change', { bubbles: true }));
        }
        // Enter, as a desktop user ends a field (the game's text fields commit on it)
        const key = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
        J.fire(el, new G.KeyboardEvent('keydown', key));
        J.fire(el, new G.KeyboardEvent('keyup', key));
    }
    H5.log(1, 'input: keyboard ' + (r[0] === 1 ? 'accepted' : 'cancelled'));
    if (J.document.activeElement === el) el.blur();
});

// a key from the runtime (USB keyboard, or the app's own mapping): keydown/keyup on the focused element
J.key = function (type, key, code, keyCode, mods = {}) {
    const target = J.document._active || J.document.body || J.document;
    return J.fire(target, new G.KeyboardEvent(type, Object.assign({ key, code, keyCode, which: keyCode, bubbles: true, cancelable: true }, mods)));
};

})(globalThis.__h5);

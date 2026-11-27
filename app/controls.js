// Happy Wheels, online edition: the controller. The site's build of the game has no controller code (the
// Steam build's is cut out of it), only the keyboard. While the player drives, the pad becomes the keys,
// laid out as the Steam build's own controller defaults are; everywhere else the runtime's D-pad selector and
// pointer do the menus (js/overlay.js).
//
// "Drives": the game's play session (its build keeps these field names: inputAllowed, paused, frames,
// m_world, _character) is running: its frame count moves, it is not paused (the game's menu, Tab, pauses
// it), input is allowed (a finished level turns it off), and it is no replay (those play themselves).
(function (H5) {
'use strict';
const J = H5.js;
const ui = J.ui;
const P = J.pad;
const raw = H5.padState;   // [connected, timestamp, buttons x17, axes x4, ...]

// ---------------------------------------------------------------- the session, caught as it starts
let session = null, lastFrames = -1, movedAt = 0;
Object.defineProperty(Object.prototype, 'inputAllowed', {
    configurable: true,
    get() { return undefined; },
    set(v) {
        Object.defineProperty(this, 'inputAllowed', { value: v, writable: true, enumerable: true, configurable: true });
        if (session !== this) {
            session = this;
            lastFrames = -1;
            H5.log(1, 'app: a ' + (isReplay(this) ? 'replay' : 'play') + ' session started');
        }
    },
});
const isReplay = s => 'replayProgressBar' in s || 'totalIterations' in s || 'mouseClickMap' in s;
function driving()
{
    const s = session;
    if (!s || s.inputAllowed !== true || s.paused !== false || isReplay(s)) return false;
    const now = H5.now();
    if (s.frames !== lastFrames) { lastFrames = s.frames; movedAt = now; }
    return now - movedAt < 300;
}
let playing = false;
ui.pageMode = () => playing ? 'play' : null;

// ---------------------------------------------------------------- the keys
const KEY = {
    up: ['ArrowUp', 'ArrowUp', 38], down: ['ArrowDown', 'ArrowDown', 40],
    left: ['ArrowLeft', 'ArrowLeft', 37], right: ['ArrowRight', 'ArrowRight', 39],
    space: [' ', 'Space', 32], shift: ['Shift', 'ShiftLeft', 16], ctrl: ['Control', 'ControlLeft', 17],
    z: ['z', 'KeyZ', 90], c: ['c', 'KeyC', 67], tab: ['Tab', 'Tab', 9],
};
const held = new Set();
function send(type, name)
{
    const [key, code, keyCode] = KEY[name];
    J.key(type, key, code, keyCode, { shiftKey: held.has('shift'), ctrlKey: held.has('ctrl'), location: name === 'shift' || name === 'ctrl' ? 1 : 0 });
}
function hold(name, on)
{
    if (on === held.has(name)) return;
    if (on) { held.add(name); send('keydown', name); }
    else { held.delete(name); send('keyup', name); }
}
// a press the game reacts to on its own (pause, camera): down now, up a moment later
const pulses = new Map();   // name -> when it goes up
function pulse(name, now)
{
    if (pulses.has(name)) return;
    if (H5.platform === 'host') H5.log(1, 'app: key ' + KEY[name][0] + (session ? ' (session paused=' + session.paused + ', frames ' + session.frames + ')' : ''));
    send('keydown', name);
    pulses.set(name, now + 90);
}

// the Steam build's controller defaults: R2 accelerate, L2 decelerate, D-pad / left stick lean, Cross the
// primary action, L1 / R1 the two secondary ones, Circle eject, the touch pad's tap the camera; Options its menu
const R2 = 7, L2 = 6, CROSS = 0, CIRCLE = 1, L1 = 4, R1 = 5, TOUCH = 8, OPTIONS = 9, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;
let before = 0, toldControls = false;
const CONTROLS = 'R2 go · L2 back · D-pad / stick lean · Cross action · L1 / R1 more actions · Circle eject · OPTIONS menu';

J.beforeFrame.push(now => {
    for (const [name, at] of pulses) if (now >= at) { pulses.delete(name); send('keyup', name); }
    playing = driving();
    let down = 0;
    if (raw[0] > 0) for (let i = 0; i < 17; i++) if (raw[2 + i] > 0.5) down |= 1 << i;
    const seen = (down & ~P.hideButtons) | P.pressButtons;   // (what the runtime leaves to the page)
    const newly = seen & ~before;
    before = seen;
    const b = i => (seen >> i) & 1;
    const menuOpen = ui.menuOpen();
    const drive = playing && !menuOpen;
    const lx = (P.hideAxes & 1) ? 0 : raw[19];
    hold('up', drive && !!(b(R2) || b(UP)));
    hold('down', drive && !!(b(L2) || b(DOWN)));
    hold('left', drive && !!(b(LEFT) || lx < -0.5));
    hold('right', drive && !!(b(RIGHT) || lx > 0.5));
    hold('space', drive && !!b(CROSS));
    hold('shift', drive && !!b(L1));
    hold('ctrl', drive && !!b(R1));
    hold('z', drive && !!b(CIRCLE));
    if (drive && (newly >> TOUCH) & 1) pulse('c', now);
    if (!menuOpen && (newly >> OPTIONS) & 1) pulse('tab', now);   // (the site's build: Tab opens its menu, Esc does nothing)
    if (drive && !toldControls) {
        toldControls = true;
        if (ui.toast) ui.toast(CONTROLS, 7000);
    }
});

ui.menuItems.push({ label: 'Show the controls', action: () => { ui.closeMenu(); if (ui.toast) ui.toast(CONTROLS, 7000); } });

})(globalThis.__h5);

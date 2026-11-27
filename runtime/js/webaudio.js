// h5 browser layer: Web Audio over __h5.audio (a native graph mixed on the sound thread).
(function (H5) {
'use strict';
const G = globalThis;
const J = H5.js;
const def = J.def;
const A = H5.audio;
if (!A) return;

const TYPE = { destination: 0, gain: 1, source: 2, stereo: 3, panner: 4, other: 5 };
const P = { gain: 0, pan: 1, rate: 2, detune: 3, x: 4, y: 5, z: 6 };
const sources = new Map();   // node id -> AudioBufferSourceNode (for 'ended')
H5.hooks.audioEnded = function (id) {
    const node = sources.get(id);
    if (!node) return;
    sources.delete(id);
    node._playing = false;
    J.fire(node, new G.Event('ended'));
};

class AudioParam {
    constructor(node, index, value, min = -3.4028234663852886e38, max = 3.4028234663852886e38) {
        this._node = node; this._i = index; this._value = value; this._default = value; this._min = min; this._max = max;
        A.param(node._id, index, 0, value, 0, 0);
    }
    get value() { return A.param(this._node._id, this._i, 6, 0, 0, 0); }
    set value(v) { v = Number(v); if (!isFinite(v)) return; this._value = v; A.param(this._node._id, this._i, 0, v, 0, 0); }
    get defaultValue() { return this._default; }
    get minValue() { return this._min; }
    get maxValue() { return this._max; }
    get automationRate() { return 'a-rate'; }
    setValueAtTime(v, t) { A.param(this._node._id, this._i, 1, +v, +t, 0); return this; }
    linearRampToValueAtTime(v, t) { A.param(this._node._id, this._i, 2, +v, +t, 0); return this; }
    exponentialRampToValueAtTime(v, t) { A.param(this._node._id, this._i, 3, Math.max(1e-6, +v), +t, 0); return this; }
    setTargetAtTime(v, t, c) { A.param(this._node._id, this._i, 4, +v, +t, +c); return this; }
    setValueCurveAtTime(curve, t, d) { if (curve && curve.length) { A.param(this._node._id, this._i, 1, curve[0], +t, 0); A.param(this._node._id, this._i, 2, curve[curve.length - 1], +t + +d, 0); } return this; }
    cancelScheduledValues(t) { A.param(this._node._id, this._i, 5, 0, +t, 0); return this; }
    cancelAndHoldAtTime(t) { return this.cancelScheduledValues(t); }
}
def(G, 'AudioParam', AudioParam);

class AudioNode extends J.EventTarget {
    constructor(ctx, type) {
        super();
        this._ctx = ctx;
        const made = A.node(type);
        this._id = made[0];
        this._handle = made[1];
        this._outs = new Set();
    }
    get context() { return this._ctx; }
    get numberOfInputs() { return 1; }
    get numberOfOutputs() { return 1; }
    get channelCount() { return 2; }
    set channelCount(v) {}
    get channelCountMode() { return 'max'; }
    set channelCountMode(v) {}
    get channelInterpretation() { return 'speakers'; }
    set channelInterpretation(v) {}
    connect(dest) {
        if (dest instanceof AudioParam) return dest;   // (modulating params: not supported)
        if (!(dest instanceof AudioNode)) throw new TypeError("Failed to execute 'connect' on 'AudioNode': the destination is not an AudioNode.");
        A.connect(this._id, dest._id);
        this._outs.add(dest);
        return dest;
    }
    disconnect(dest) {
        if (dest instanceof AudioNode) { A.disconnect(this._id, dest._id); this._outs.delete(dest); }
        else { A.disconnect(this._id, 0); this._outs.clear(); }
    }
}
def(G, 'AudioNode', AudioNode);

class AudioDestinationNode extends AudioNode {
    constructor(ctx) { super(ctx, TYPE.other); A.disconnect(this._id, 0); this._id = 1; }
    get maxChannelCount() { return 2; }
    get numberOfOutputs() { return 0; }
}
class GainNode extends AudioNode {
    constructor(ctx, opts = {}) { super(ctx, TYPE.gain); this._gain = new AudioParam(this, P.gain, opts.gain === undefined ? 1 : opts.gain); }
    get gain() { return this._gain; }
}
class StereoPannerNode extends AudioNode {
    constructor(ctx, opts = {}) { super(ctx, TYPE.stereo); this._pan = new AudioParam(this, P.pan, opts.pan || 0, -1, 1); }
    get pan() { return this._pan; }
}
class PannerNode extends AudioNode {
    constructor(ctx, opts = {}) {
        super(ctx, TYPE.panner);
        this._x = new AudioParam(this, P.x, opts.positionX || 0);
        this._y = new AudioParam(this, P.y, opts.positionY || 0);
        this._z = new AudioParam(this, P.z, opts.positionZ || 0);
        this.panningModel = opts.panningModel || 'equalpower'; this.distanceModel = opts.distanceModel || 'inverse';
        this.refDistance = 1; this.maxDistance = 10000; this.rolloffFactor = 1; this.coneInnerAngle = 360; this.coneOuterAngle = 360; this.coneOuterGain = 0;
        this.orientationX = new AudioParam(this, P.x, 1); this.orientationY = { value: 0 }; this.orientationZ = { value: 0 };
    }
    get positionX() { return this._x; }
    get positionY() { return this._y; }
    get positionZ() { return this._z; }
    setPosition(x, y, z) { this._x.value = x; this._y.value = y; this._z.value = z; }
    setOrientation() {}
    setVelocity() {}
}
class AudioBuffer {
    constructor(opts, handle) {
        if (handle) { this._h = handle; this._channels = opts.numberOfChannels; this._length = opts.length; this._rate = opts.sampleRate; }
        else {
            this._channels = Math.max(1, Math.min(2, opts.numberOfChannels || 1)); this._length = opts.length | 0; this._rate = opts.sampleRate || 48000;
            this._h = A.createBuffer(this._channels, this._length, this._rate);
        }
        this._data = [];
    }
    get sampleRate() { return this._rate; }
    get length() { return this._length; }
    get duration() { return this._length / this._rate; }
    get numberOfChannels() { return this._channels; }
    getChannelData(c) {
        if (!this._data[c]) this._data[c] = A.bufferChannel(this._h, c);
        // (writes to the array reach the sound when the buffer is next given to a source)
        return this._data[c];
    }
    copyFromChannel(dst, c, start = 0) { const d = this.getChannelData(c); dst.set(d.subarray(start, start + dst.length)); }
    copyToChannel(src, c, start = 0) { const d = this.getChannelData(c); d.set(src, start); }
    _sync() { for (let c = 0; c < this._data.length; c++) if (this._data[c]) A.bufferSetChannel(this._h, c, this._data[c]); }
}
def(G, 'AudioBuffer', AudioBuffer);
class AudioBufferSourceNode extends AudioNode {
    constructor(ctx, opts = {}) {
        super(ctx, TYPE.source);
        this._buffer = null; this._loop = false; this._loopStart = 0; this._loopEnd = 0; this._started = false; this._playing = false;
        this._rate = new AudioParam(this, P.rate, opts.playbackRate === undefined ? 1 : opts.playbackRate);
        this._detune = new AudioParam(this, P.detune, opts.detune || 0);
        this.onended = null;
        if (opts.buffer) this.buffer = opts.buffer;
        if (opts.loop) this.loop = true;
    }
    _set() { A.sourceSet(this._id, this._buffer ? this._buffer._h : null, this._loop, this._loopStart, this._loopEnd); }
    get buffer() { return this._buffer; }
    set buffer(b) { if (b) b._sync(); this._buffer = b || null; this._set(); }
    get loop() { return this._loop; }
    set loop(v) { this._loop = !!v; this._set(); }
    get loopStart() { return this._loopStart; }
    set loopStart(v) { this._loopStart = +v || 0; this._set(); }
    get loopEnd() { return this._loopEnd; }
    set loopEnd(v) { this._loopEnd = +v || 0; this._set(); }
    get playbackRate() { return this._rate; }
    get detune() { return this._detune; }
    start(when = 0, offset = 0, duration) {
        if (this._started) throw new G.DOMException("Failed to execute 'start' on 'AudioScheduledSourceNode': cannot call start more than once.", 'InvalidStateError');
        this._started = true; this._playing = true;
        sources.set(this._id, this);
        A.sourceStart(this._id, +when || 0, +offset || 0, duration === undefined ? -1 : +duration);
    }
    stop(when = 0) { if (this._started) A.sourceStop(this._id, +when || 0); }
    noteOn(w) { this.start(w); }
    noteGrainOn(w, o, d) { this.start(w, o, d); }
    noteOff(w) { this.stop(w); }
}
// nodes this runtime does not mix: they pass sound through
class PassThroughNode extends AudioNode { constructor(ctx) { super(ctx, TYPE.other); } }
class OscillatorNode extends PassThroughNode {
    constructor(ctx) { super(ctx); this.type = 'sine'; this.frequency = new AudioParam(this, P.rate, 440); this.detune = new AudioParam(this, P.detune, 0); this.onended = null; }
    start() {} stop() {} setPeriodicWave() {}
}
class BiquadFilterNode extends PassThroughNode {
    constructor(ctx) { super(ctx); this.type = 'lowpass'; this.frequency = { value: 350, setValueAtTime() {}, linearRampToValueAtTime() {} }; this.Q = { value: 1, setValueAtTime() {} }; this.gain = { value: 0, setValueAtTime() {} }; this.detune = { value: 0 }; }
    getFrequencyResponse() {}
}
class DynamicsCompressorNode extends PassThroughNode {
    constructor(ctx) { super(ctx); for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) this[k] = { value: 0, setValueAtTime() {} }; this.reduction = 0; }
}
class AnalyserNode extends PassThroughNode {
    constructor(ctx) { super(ctx); this.fftSize = 2048; this.minDecibels = -100; this.maxDecibels = -30; this.smoothingTimeConstant = 0.8; }
    get frequencyBinCount() { return this.fftSize / 2; }
    getFloatFrequencyData(a) { a.fill(-Infinity); } getByteFrequencyData(a) { a.fill(0); } getFloatTimeDomainData(a) { a.fill(0); } getByteTimeDomainData(a) { a.fill(128); }
}
for (const c of [AudioDestinationNode, GainNode, StereoPannerNode, PannerNode, AudioBufferSourceNode, OscillatorNode, BiquadFilterNode, DynamicsCompressorNode, AnalyserNode])
    def(G, c.name, c);
def(G, 'AudioScheduledSourceNode', AudioBufferSourceNode);

class AudioListener {
    constructor(ctx) { this.positionX = { value: 0 }; this.positionY = { value: 0 }; this.positionZ = { value: 0 }; this.forwardX = { value: 0 }; this.forwardY = { value: 0 }; this.forwardZ = { value: -1 }; this.upX = { value: 0 }; this.upY = { value: 1 }; this.upZ = { value: 0 }; }
    setPosition() {} setOrientation() {}
}

let theDestination = null;
class BaseAudioContext extends J.EventTarget {
    constructor() {
        super();
        this._state = 'running';
        this._rate = A.info().sampleRate;
        if (!theDestination) theDestination = new AudioDestinationNode(this);
        this._dest = theDestination;
        this._listener = new AudioListener(this);
        this.onstatechange = null;
    }
    get sampleRate() { return this._rate; }
    get currentTime() { return A.time(); }
    get destination() { return this._dest; }
    get listener() { return this._listener; }
    get state() { return this._state; }
    get baseLatency() { return 256 / this._rate; }
    get outputLatency() { return 0.02; }
    get audioWorklet() { return { addModule: () => Promise.reject(new Error('AudioWorklet is not supported')) }; }
    getOutputTimestamp() { return { contextTime: A.time(), performanceTime: H5.now() }; }
    _setState(s) { if (this._state !== s) { this._state = s; J.fire(this, new G.Event('statechange')); } }
    resume() { this._setState('running'); return Promise.resolve(); }
    suspend() { this._setState('suspended'); return Promise.resolve(); }
    close() { this._setState('closed'); return Promise.resolve(); }
    createGain() { return new GainNode(this); }
    createGainNode() { return new GainNode(this); }
    createBufferSource() { return new AudioBufferSourceNode(this); }
    createStereoPanner() { return new StereoPannerNode(this); }
    createPanner() { return new PannerNode(this); }
    createOscillator() { return new OscillatorNode(this); }
    createBiquadFilter() { return new BiquadFilterNode(this); }
    createDynamicsCompressor() { return new DynamicsCompressorNode(this); }
    createAnalyser() { return new AnalyserNode(this); }
    createDelay() { return new PassThroughNode(this); }
    createConvolver() { return new PassThroughNode(this); }
    createWaveShaper() { return new PassThroughNode(this); }
    createChannelSplitter() { return new PassThroughNode(this); }
    createChannelMerger() { return new PassThroughNode(this); }
    createMediaElementSource() { return new PassThroughNode(this); }
    createMediaStreamDestination() { return new PassThroughNode(this); }
    createScriptProcessor() { const n = new PassThroughNode(this); n.onaudioprocess = null; return n; }
    createConstantSource() { const n = new PassThroughNode(this); n.offset = { value: 1 }; n.start = () => {}; n.stop = () => {}; return n; }
    createPeriodicWave() { return {}; }
    createBuffer(channels, length, rate) { return new AudioBuffer({ numberOfChannels: channels, length, sampleRate: rate }); }
    decodeAudioData(data, success, failure) {
        return new Promise((ok, fail) => {
            if (!(data instanceof ArrayBuffer)) { const e = new TypeError("Failed to execute 'decodeAudioData': parameter 1 is not of type 'ArrayBuffer'."); if (failure) failure(e); fail(e); return; }
            A.decode(J.request((handle, channels, length, rate) => {
                if (!handle) {
                    const e = new G.DOMException('Unable to decode audio data', 'EncodingError');
                    if (failure) { try { failure(e); } catch (x) { J.reportError(x, 'decodeAudioData error callback'); } }
                    fail(e);
                    return;
                }
                const b = new AudioBuffer({ numberOfChannels: channels, length, sampleRate: rate }, handle);
                if (success) { try { success(b); } catch (x) { J.reportError(x, 'decodeAudioData callback'); } }
                ok(b);
            }), data);
        });
    }
}
class AudioContext extends BaseAudioContext {
    constructor(opts) { super(); }
    createMediaStreamSource() { return new PassThroughNode(this); }
}
def(G, 'BaseAudioContext', BaseAudioContext);
def(G, 'AudioContext', AudioContext);
def(G, 'webkitAudioContext', AudioContext);
def(G, 'OfflineAudioContext', class OfflineAudioContext extends BaseAudioContext {
    constructor(ch, len, rate) { super(); this._len = len; }
    startRendering() { return Promise.resolve(this.createBuffer(2, this._len || 1, this.sampleRate)); }
});

})(globalThis.__h5);

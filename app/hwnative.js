// Happy Wheels: window.hwNative, the bridge the Steam build's Electron preload gives the page
// (resources/app.asar electron/out/preload.js). No Steam here: its calls fail the way they do in Electron
// when Steam is not running ("Steam is not available"), and the game carries on without it.
(function (H5) {
'use strict';
const G = globalThis;
const J = H5.js;

const DOWNLOADS = H5.paths.data + '/downloads';
const ID = /^[1-9][0-9]{0,9}$/;
const noSteam = () => Promise.reject(new Error('Steam is not available'));

function readMeta(id) {
    const text = H5.readText(DOWNLOADS + '/' + id + '/meta.json');
    if (text === null) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
}

G.hwNative = {
    steam: { call: noSteam },
    // (the game's screen for Steam's rich presence: only logged)
    presence: { setState(s) { if (s && s.screen) H5.log(1, 'app: screen ' + s.screen); } },
    cursorPos: () => Promise.resolve(null),
    exit() { H5.log(1, 'app: the game asked to quit'); J.flushStorage(); H5.exit(0); },
    loaded() {
        H5.log(1, 'app: the game says it has loaded');
        if (J.ui && J.ui.toast) J.ui.toast('Hold the touch pad for the quick menu', 6000);
    },
    deepLink: { pending: () => Promise.resolve(null), onOpen() {} },
    overlay: { onActivated() {} },
    fullscreen: { set() {}, get: () => true, onChange() {} },
    auth: {
        // (online accounts need the network layer: offline, as Electron reports it without a connection)
        login: () => Promise.resolve({ outcome: 'error' }),
        getUser: () => Promise.resolve({ user: null, offline: true }),
        logout: () => Promise.resolve(),
        steamLogin: () => Promise.resolve({ outcome: 'unavailable' }),
        linkSteam: () => Promise.resolve('error'),
    },
    friends: {
        online: () => Promise.resolve([]),
        onChanged() {},
        findByTjfName: () => Promise.resolve(null),
        names: () => Promise.resolve([]),
        onNamesChanged() {},
    },
    // downloaded levels: <data>/downloads/<id>/{record.bin, meta.json}, as the Electron shell keeps them
    downloads: {
        list() {
            const names = H5.listDir(DOWNLOADS) || [];
            const out = [];
            for (const n of names) {
                if (!ID.test(n) || !H5.exists(DOWNLOADS + '/' + n + '/record.bin')) continue;
                const m = readMeta(n);
                if (m) out.push(m);
            }
            out.sort((a, b) => (b.downloadedAt - a.downloadedAt) || (b.id - a.id));
            return Promise.resolve(out);
        },
        save(id, meta, record) {
            id = String(id);
            if (!ID.test(id)) return Promise.reject(new Error('invalid level id'));
            if (!(record instanceof Uint8Array) || !record.byteLength) return Promise.reject(new Error('invalid record'));
            const m = meta && typeof meta === 'object' ? meta : {};
            const s = (v, n) => String(v === undefined || v === null ? '' : v).slice(0, n);
            const num = v => { const x = Number(v); return isFinite(x) ? x : 0; };
            const entry = { id: Number(id), name: s(m.name, 256), authorId: num(m.authorId), authorName: s(m.authorName, 256), weightedRating: num(m.weightedRating),
                votes: num(m.votes), plays: num(m.plays), created: num(m.created), comments: s(m.comments, 4096), character: num(m.character),
                downloadedAt: Date.now(), bytes: record.byteLength };
            const dir = DOWNLOADS + '/' + id;
            const ok = H5.mkdirs(dir) && H5.writeFile(dir + '/record.bin', record) && H5.writeFile(dir + '/meta.json', JSON.stringify(entry, null, 2) + '\n');
            return ok ? Promise.resolve() : Promise.reject(new Error('could not save the level'));
        },
        load(id) {
            id = String(id);
            if (!ID.test(id)) return Promise.reject(new Error('invalid level id'));
            const b = H5.readBytes(DOWNLOADS + '/' + id + '/record.bin');
            return b ? Promise.resolve(new Uint8Array(b)) : Promise.reject(new Error('no such level'));
        },
        delete(id) {
            id = String(id);
            if (!ID.test(id)) return Promise.reject(new Error('invalid level id'));
            H5.remove(DOWNLOADS + '/' + id);
            return Promise.resolve();
        },
    },
};

})(globalThis.__h5);

// Happy Wheels, online edition: the game as totaljerkface.com runs it in its own page
// (https://totaljerkface.com/happy-wheels-js/index.tjf, the <iframe> of /happy_wheels.tjf). That page reads
// version.json, which names the current scripts (js/dependencies.<hash>.js, js/index.<hash>.js); the game
// then loads its pictures and sounds from assets-<hash>/. Here each of those files is kept in <data>/web/
// (same paths) once it has been downloaded, so a later start fetches only version.json, takes a new version
// as soon as the site has one, and starts without the internet from what the console has.
(function (H5) {
'use strict';
const G = globalThis;
const J = H5.js;

const SITE = 'https://totaljerkface.com/';
const BASE = SITE + 'happy-wheels-js/';
const PAGE = BASE + 'index.tjf';
const CACHE = H5.paths.data + '/web/';
J.setPageURL(PAGE);
J.mount(BASE, CACHE, { download: true });

// what the site's page sets before the game's scripts run (the title screen's label is ours)
G.HW_SETTINGS = {
    siteURL: SITE, pathPrefix: '',
    titleLabel: 'PS4 Edition', titleLabelX: 645, titleLabelY: 250, titleLabelRotation: 0, titleLabelSize: 20, titleLabelColor: 0xfdfd65,
    resolutionZoomIncreaseRatio: 0.5, tesselation: 'tess2',
    replay_id: null, level_id: null,   // (the page copies its parent's ?replay_id= / ?level_id=: none here)
};

const HASH = /^[0-9a-f]{8,64}$/;
const valid = v => !!v && HASH.test(v.index) && HASH.test(v.dependencies);
const scripts = v => ['dependencies', 'index'].map(n => 'js/' + n + '.' + v[n] + '.js');
const say = (text, ms) => { if (J.ui && J.ui.toast) J.ui.toast(text, ms || 4000); };
const mb = n => (n / 1048576).toFixed(1) + ' MB';
function readJSON(path) { try { return JSON.parse(H5.readText(path)); } catch (e) { return null; } }

// the site's newest version.json, straight from the site (never the kept copy); null when it can't be had
function latest(callback)
{
    J.request2(BASE + 'version.json', { method: 'GET', timeout: 8000 }, (bytes, info) => {
        let v = null;
        if (bytes && info && info.status === 200) { try { v = JSON.parse(J.utf8Decode(bytes)); } catch (e) { v = null; } }
        if (!valid(v)) H5.log(2, 'app: no version.json from the site (' + (info && (info.error || info.status)) + ')');
        callback(valid(v) ? { index: v.index, dependencies: v.dependencies } : null);
    });
}

// files of older versions go once a newer one runs (their names change with their content): scripts at once,
// an asset folder when the game first asks for one of the new folder's files
function pruneScripts(v)
{
    const keep = new Set(scripts(v).map(p => p.slice(3)));
    for (const name of H5.listDir(CACHE + 'js') || []) {
        if (!keep.has(name)) { H5.log(1, 'app: removing old js/' + name); H5.remove(CACHE + 'js/' + name); }
    }
}
let assetsInUse = null;
const ensure = J.ensureLocal;
J.ensureLocal = function (url, path, callback) {
    if (!assetsInUse && path.startsWith(CACHE + 'assets-')) {
        assetsInUse = path.slice(CACHE.length).split('/')[0];
        for (const name of H5.listDir(CACHE) || []) {
            if (name.startsWith('assets-') && name !== assetsInUse) { H5.log(1, 'app: removing old ' + name); H5.remove(CACHE + name); }
        }
    }
    return ensure(url, path, callback);
};

// downloads in progress, on screen (the first start fetches the whole game: tens of MB)
let shownBytes = -1;
setInterval(() => {
    const d = J.downloadStats;
    if (d.pending > 0) {
        if (d.bytes !== shownBytes) { shownBytes = d.bytes; say('Downloading Happy Wheels from totaljerkface.com: ' + mb(d.bytes), 2000); }
    } else if (shownBytes >= 0 && d.files > 0) {
        say('Downloaded ' + d.files + ' files (' + mb(d.bytes) + '): next time it starts from the PS4', 4000);
        shownBytes = -1;
        J.downloadStats.files = 0;
    }
}, 500);

// the game's two scripts as the site's page adds them, one after the other
function run(v, fallback)
{
    const [deps, index] = scripts(v);
    const t0 = H5.now();
    const add = (src, next) => {
        const el = G.document.createElement('script');
        el.src = './' + src;
        el.addEventListener('load', next);
        el.addEventListener('error', () => {
            H5.log(3, 'app: ' + src + ' could not be loaded');
            if (fallback) { run(fallback, null); return; }
            say('Happy Wheels could not be downloaded. Check the internet connection and start it again.', 600000);
        });
        G.document.body.appendChild(el);
    };
    add(deps, () => add(index, () => {
        H5.log(1, 'app: the game\'s scripts (' + v.index.slice(0, 8) + ') ran ' + Math.round(H5.now() - t0) + ' ms after the start');
        H5.mkdirs(CACHE);
        H5.writeFile(CACHE + 'version.json', JSON.stringify(v));
        pruneScripts(v);
        setTimeout(() => say('Hold the touch pad for the quick menu', 6000), 4000);
    }));
}

G.HW_APP.start = function () {
    // (as on the site: the page has loaded before its scripts come)
    J.documentLoaded();
    const kept = readJSON(CACHE + 'version.json');
    latest(v => {
        if (v) {
            const isNew = !valid(kept) || kept.index !== v.index || kept.dependencies !== v.dependencies;
            H5.log(1, 'app: the site\'s game: index ' + v.index + (isNew ? (valid(kept) ? ' (new: was ' + kept.index + ')' : ' (first start)') : ' (as kept)'));
            // a new version that fails to come: the kept one still plays
            run(v, isNew && valid(kept) && scripts(kept).every(p => H5.exists(CACHE + p)) ? kept : null);
        } else if (valid(kept)) {
            H5.log(1, 'app: offline: the kept version (' + kept.index + ')');
            say('No connection to totaljerkface.com: playing the copy on this PS4', 6000);
            run(kept, null);
        } else {
            H5.log(3, 'app: offline, and nothing kept yet');
            say('Happy Wheels downloads the game the first time it starts: connect to the internet and start it again', 600000);
        }
    });
};

})(globalThis.__h5);

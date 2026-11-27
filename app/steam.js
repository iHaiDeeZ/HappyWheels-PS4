// Happy Wheels, Steam edition: the page the Steam build's Electron shell serves (resources/app.asar
// main.js), rebuilt here: https://totaljerkface.com/__hw_app__/index.html with webroot behind /__hw_app__/.
(function (H5) {
'use strict';
const G = globalThis;
const J = H5.js;

const PAGE = 'https://totaljerkface.com/__hw_app__/index.html';
const SITE = 'https://totaljerkface.com/';
// the Steam build's identity: Electron's user agent plus what its main.js appends (the site answers only
// requests that look like the game's). scripts/build-ps4.sh checks it against the user's copy.
const SHELL_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) happy-wheels/1.99.2 ' +
    'Chrome/152.0.7977.78 Electron/44.4.1 Safari/537.36 HappyWheels/1.99.2 (2.01; 3d349b46)';
J.userAgent = SHELL_UA;
J.setPageURL(PAGE);
J.mount('https://totaljerkface.com/__hw_app__/', H5.paths.game + '/');
G.HW_SETTINGS = { siteURL: SITE };

G.HW_APP.start = function () {
    // window.hwNative (the Electron preload's bridge): what this port has of it
    H5.loadScript(H5.paths.app + '/hwnative.js', 'h5://app/hwnative.js');
    // the page's scripts, in its order
    const t0 = H5.now();
    for (const src of ['./js/dependencies.js', './js/index.js']) {
        const url = J.resolveURL(src);
        const path = J.urlToPath(url);
        if (!H5.loadScript(path, url)) H5.log(3, 'app: ' + url + ' did not run');
    }
    H5.log(1, 'app: the game\'s scripts ran in ' + Math.round(H5.now() - t0) + ' ms');
    J.documentLoaded();
};

})(globalThis.__h5);

// Happy Wheels on h5. Two editions, by what the pkg carries:
//  - online (no game files in the pkg, the default): the game as totaljerkface.com's own page runs it
//    (/happy-wheels-js/), its files downloaded from the site and kept on the console, a new version taken
//    as soon as the site has it (app/online.js); the controller is ours (app/controls.js)
//  - Steam (webroot/ in the pkg, from the user's copy): the page the Steam build's Electron shell serves,
//    with the game's own controller support (app/steam.js)
(function (H5) {
'use strict';
const G = globalThis;
const J = H5.js;

const online = !H5.exists(H5.paths.game + '/js/index.js');
H5.log(1, 'app: ' + (online ? 'online edition (the site\'s game)' : 'Steam edition (the game files in the pkg)'));
// the game's error reporting (Sentry) is never contacted from this port
J.blockHosts(['sentry.totaljerkface.com', 'o0.ingest.sentry.io']);

// the edition says where the page is before anything is made (URLs resolve against it)
G.HW_APP = { online };
H5.loadScript(H5.paths.app + (online ? '/online.js' : '/steam.js'), online ? 'h5://app/online.js' : 'h5://app/steam.js');

const doc = G.document;
doc.title = 'Happy Wheels';
const meta = doc.createElement('meta');
meta.setAttribute('charset', 'UTF8');
doc.head.appendChild(meta);
const bg = online ? '#3d88c7' : '#000';
const style = doc.createElement('style');
style.textContent = 'body{overflow:hidden;background-color:' + bg + '}';
doc.head.appendChild(style);
doc.body.style.overflow = 'hidden';
doc.body.style.backgroundColor = bg;
const holder = doc.createElement('div');
holder.id = 'og-game-holder';
doc.body.appendChild(holder);

// the game's cursor and buttons for the runtime's pointer and D-pad selector (before Pixi starts)
H5.loadScript(H5.paths.app + '/gameui.js', 'h5://app/gameui.js');
if (online) H5.loadScript(H5.paths.app + '/controls.js', 'h5://app/controls.js');

// keep the saved options when the app closes
G.addEventListener('pagehide', () => J.flushStorage());

G.HW_APP.start();

})(globalThis.__h5);

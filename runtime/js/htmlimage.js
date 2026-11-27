// h5 browser layer: SVG images whose <foreignObject> holds HTML - a page's way to get styled text into an image
// (Chrome lays the HTML out and paints it; Skia's SVG has no HTML). The runtime lays out the part pages use for
// this: text in inline elements (b, strong, i, em, u, s, span, font, a, ...), <br>, block elements (div, p,
// h1-h6, center, ul/ol/li, hr) and the style that shapes text (font-*, line-height, color, text-decoration,
// text-align, white-space, padding, margin), then draws it with the 2D canvas into the image.
//   J.htmlInSVG(bytes, type) -> null (not such an SVG) | {handle, width, height}
(function (H5) {
'use strict';
const J = H5.js;

const BLOCK = new Set(['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'center', 'ul', 'ol', 'li', 'hr', 'pre',
    'blockquote', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'address', 'figure', 'dl', 'dt',
    'dd', 'body', 'html', 'table', 'tr', 'form', 'fieldset', 'details', 'summary']);
const SKIP = new Set(['script', 'style', 'head', 'title', 'template', 'img', 'svg', 'canvas', 'video', 'audio', 'iframe',
    'input', 'button', 'select', 'textarea', 'object']);
const HEADINGS = { h1: [2, 0.67], h2: [1.5, 0.83], h3: [1.17, 1], h4: [1, 1.33], h5: [0.83, 1.67], h6: [0.67, 2.33] };
const SIZE_KEYWORDS = { 'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48 };
const FONT_SIZES = [0, 10, 13, 16, 18, 24, 32, 48];   // <font size=1..7>

function declarations(text)
{
    const out = {};
    for (const part of String(text || '').split(';')) {
        const i = part.indexOf(':');
        if (i > 0) out[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).replace(/!\s*important/i, '').trim();
    }
    return out;
}
// a CSS length in px (null if it is none); em against `em`, % against `base`
function length(v, em, base)
{
    const m = /^(-?\d*\.?\d+)(px|pt|pc|em|rem|ex|ch|%|in|cm|mm)?$/i.exec(String(v).trim());
    if (!m) return null;
    const n = parseFloat(m[1]);
    switch ((m[2] || 'px').toLowerCase()) {
    case 'px': return n;
    case 'pt': return n * 4 / 3;
    case 'pc': return n * 16;
    case 'em': return n * em;
    case 'rem': return n * 16;
    case 'ex': case 'ch': return n * em / 2;
    case '%': return base === undefined ? null : n * base / 100;
    case 'in': return n * 96;
    case 'cm': return n * 96 / 2.54;
    case 'mm': return n * 96 / 25.4;
    }
    return null;
}
// top, right, bottom, left of a padding/margin shorthand
function sides(v, em, base)
{
    const parts = String(v).trim().split(/\s+/).map(p => p === 'auto' ? 0 : length(p, em, base) || 0);
    const [t, r = t, b = t, l = r] = parts;
    return [t, r, b, l];
}

// an element's style: the inherited part from its parent, the rest its own
function styleOf(el, parent, boxWidth)
{
    const tag = el.localName;
    const s = Object.assign({}, parent, { margin: [0, 0, 0, 0], padding: [0, 0, 0, 0], display: BLOCK.has(tag) ? 'block' : 'inline' });
    const em = parent.fontSize;
    // the browser's own style for the tag
    if (tag === 'b' || tag === 'strong' || tag === 'th' || tag === 'dt') s.weight = 700;
    else if (tag === 'i' || tag === 'em' || tag === 'cite' || tag === 'var' || tag === 'dfn' || tag === 'address') s.italic = true;
    else if (tag === 'u' || tag === 'ins') s.underline = true;
    else if (tag === 's' || tag === 'strike' || tag === 'del') s.strike = true;
    else if (tag === 'small') s.fontSize = em / 1.2;
    else if (tag === 'big') s.fontSize = em * 1.2;
    else if (tag === 'center') s.align = 'center';
    else if (tag === 'a' && el.getAttribute('href') !== null) { s.color = '#0000ee'; s.underline = true; }
    else if (tag === 'pre') s.whiteSpace = 'pre';
    else if (tag === 'p' || tag === 'blockquote' || tag === 'dl') s.margin = [em, 0, em, 0];
    else if (tag === 'ul' || tag === 'ol') { s.margin = [em, 0, em, 0]; s.padding = [0, 0, 0, 40]; }
    else if (HEADINGS[tag]) {
        s.weight = 700;
        s.fontSize = em * HEADINGS[tag][0];
        s.margin = [s.fontSize * HEADINGS[tag][1], 0, s.fontSize * HEADINGS[tag][1], 0];
    }
    if (tag === 'font') {
        if (el.getAttribute('color')) s.color = el.getAttribute('color');
        if (el.getAttribute('face')) s.family = el.getAttribute('face');
        const size = parseInt(el.getAttribute('size'), 10);
        if (size >= 1 && size <= 7) s.fontSize = FONT_SIZES[size];
    }
    if (el.getAttribute('align')) s.align = el.getAttribute('align').toLowerCase();
    // its style attribute
    const d = declarations(el.getAttribute('style'));
    if (d['font-size']) {
        const v = d['font-size'].toLowerCase();
        s.fontSize = SIZE_KEYWORDS[v] || (v === 'smaller' ? em / 1.2 : v === 'larger' ? em * 1.2 : length(v, em, em) || s.fontSize);
    }
    if (d.font) {   // the shorthand: [style] [weight] size[/line-height] family
        const m = /^((?:\s*(?:italic|oblique|normal|bold|bolder|lighter|\d00|small-caps)\s+)*)\s*([\d.]+\w*|[a-z-]+)(?:\/(\S+))?\s+(.+)$/i.exec(d.font);
        if (m) {
            if (/italic|oblique/i.test(m[1])) s.italic = true;
            if (/bold|[6-9]00/i.test(m[1])) s.weight = 700;
            s.fontSize = SIZE_KEYWORDS[m[2]] || length(m[2], em, em) || s.fontSize;
            if (m[3]) d['line-height'] = m[3];
            s.family = m[4];
        }
    }
    const fs = s.fontSize;
    if (d['font-family']) s.family = d['font-family'];
    if (d['font-weight']) {
        const v = d['font-weight'].toLowerCase();
        s.weight = v === 'bold' || v === 'bolder' ? 700 : v === 'normal' || v === 'lighter' ? 400 : parseInt(v, 10) || s.weight;
    }
    if (d['font-style']) s.italic = /italic|oblique/i.test(d['font-style']);
    if (d.color) s.color = d.color;
    if (d['line-height']) {
        const v = d['line-height'].toLowerCase();
        if (v === 'normal') s.lineHeight = null;
        else if (/^[\d.]+$/.test(v)) s.lineHeight = { factor: parseFloat(v) };
        else { const px = length(v, fs, fs); if (px !== null) s.lineHeight = { px }; }
    }
    const deco = d['text-decoration'] || d['text-decoration-line'];
    if (deco) {
        if (/none/i.test(deco)) { s.underline = false; s.strike = false; }
        if (/underline/i.test(deco)) s.underline = true;
        if (/line-through/i.test(deco)) s.strike = true;
    }
    if (d['text-align']) s.align = d['text-align'].toLowerCase();
    if (d['white-space']) s.whiteSpace = d['white-space'].toLowerCase();
    if (d.display) s.display = d.display.toLowerCase().startsWith('inline') ? 'inline' : d.display.toLowerCase() === 'none' ? 'none' : 'block';
    if (d.visibility === 'hidden') s.hidden = true;
    if (d.margin) s.margin = sides(d.margin, fs, boxWidth);
    if (d.padding) s.padding = sides(d.padding, fs, boxWidth);
    ['top', 'right', 'bottom', 'left'].forEach((side, i) => {
        if (d['margin-' + side]) s.margin[i] = length(d['margin-' + side], fs, boxWidth) || 0;
        if (d['padding-' + side]) s.padding[i] = length(d['padding-' + side], fs, boxWidth) || 0;
    });
    return s;
}

const fontOf = s => (s.italic ? 'italic ' : '') + (s.weight >= 600 ? 'bold ' : '') + s.fontSize + 'px ' + s.family;

// ---------------------------------------------------------------- one drawing
function draw(ctx, root, rootStyle, x0, y0, width)
{
    const measured = new Map();
    const measure = (s, text) => {
        const f = fontOf(s), key = f + '\u0000' + text;
        let w = measured.get(key);
        if (w === undefined) {
            ctx.font = f;
            w = ctx.measureText(text).width;
            measured.set(key, w);
        }
        return w;
    };
    const metricCache = new Map();
    // the part of a line box above and below the baseline for text of this style (CSS half-leading)
    const metrics = s => {
        const f = fontOf(s) + '/' + JSON.stringify(s.lineHeight);
        let m = metricCache.get(f);
        if (!m) {
            ctx.font = fontOf(s);
            const t = ctx.measureText('Hg');
            const a = t.fontBoundingBoxAscent || s.fontSize * 0.905, d = t.fontBoundingBoxDescent || s.fontSize * 0.212;
            const lh = s.lineHeight ? (s.lineHeight.px !== undefined ? s.lineHeight.px : s.lineHeight.factor * s.fontSize) : (a + d) * 1.03;
            const half = (lh - (a + d)) / 2;
            m = { above: a + half, below: d + half };
            metricCache.set(f, m);
        }
        return m;
    };
    let lines = 0;

    // inline content: words and spaces into line boxes, drawn as each line is done
    function inline(nodes, block, x, y, w)
    {
        const strut = metrics(block);
        let line = [], lineW = 0, lastSpace = true;
        const finish = () => {
            while (line.length && line[line.length - 1].space) lineW -= line.pop().w;   // spaces at the end hang
            let above = strut.above, below = strut.below;
            for (const seg of line) { const m = metrics(seg.s); above = Math.max(above, m.above); below = Math.max(below, m.below); }
            const free = w - lineW;
            let cx = x + (block.align === 'center' ? free / 2 : block.align === 'right' || block.align === 'end' ? free : 0);
            const baseline = y + above;
            for (const seg of line) {
                if (!seg.s.hidden) {
                    ctx.font = fontOf(seg.s);
                    ctx.fillStyle = seg.s.color;
                    if (!seg.space) ctx.fillText(seg.text, cx, baseline);
                    const thick = Math.max(1, seg.s.fontSize * 0.073);
                    if (seg.s.underline) ctx.fillRect(cx, baseline + seg.s.fontSize * 0.106, seg.w, thick);
                    if (seg.s.strike) ctx.fillRect(cx, baseline - seg.s.fontSize * 0.3, seg.w, thick);
                }
                cx += seg.w;
            }
            y += above + below;
            lines++;
            line = [];
            lineW = 0;
            lastSpace = true;
        };
        const add = (text, s, space) => {
            const wd = measure(s, text);
            const last = line[line.length - 1];
            if (last && last.s === s && !last.space && !space) { last.text += text; last.w += wd; }
            else line.push({ text, s, w: wd, space });
            lineW += wd;
        };
        const word = (text, s, nowrap) => {
            const wd = measure(s, text);
            if (!nowrap && line.length && lineW + wd > w + 0.01) finish();
            add(text, s, false);
            lastSpace = false;
        };
        const text = (str, s) => {
            const ws = s.whiteSpace || 'normal';
            const pre = ws === 'pre' || ws === 'pre-wrap' || ws === 'break-spaces';
            const keepNewlines = pre || ws === 'pre-line';
            const nowrap = ws === 'nowrap' || ws === 'pre';
            if (pre) str = str.replace(/\t/g, '        ');
            else if (keepNewlines) str = str.replace(/[\t\r\f ]+/g, ' ').replace(/ ?\n ?/g, '\n');
            else str = str.replace(/[\t\n\r\f ]+/g, ' ');
            for (const tok of str.match(/\n| +|[^ \n]+/g) || []) {
                if (tok === '\n') { finish(); continue; }
                if (tok[0] === ' ') {
                    if (pre) { add(tok, s, true); continue; }
                    if (lastSpace || !line.length) continue;   // collapsed, or at a line's start
                    add(' ', s, true);
                    lastSpace = true;
                    continue;
                }
                word(tok, s, nowrap);
            }
        };
        const walk = (node, s) => {
            if (node.nodeType === 3) { text(node.data, s); return; }
            if (node.nodeType !== 1 || SKIP.has(node.localName)) return;
            const cs = styleOf(node, s, w);
            if (cs.display === 'none') return;
            if (node.localName === 'br') { finish(); return; }
            for (const c of node.childNodes) walk(c, cs);
        };
        for (const n of nodes) walk(n, block);
        if (line.length) finish();
        return y;
    }

    // a block container's children: runs of inline content and blocks, top to bottom; returns the bottom
    function blocks(el, s, x, y, w)
    {
        let run = [], carry = 0;   // inline nodes waiting; the last block's bottom margin
        const flush = () => {
            if (!run.length) return;
            const before = lines;
            const ny = inline(run, s, x, y + carry, w);
            if (lines > before) { y = ny; carry = 0; }
            run = [];
        };
        let index = 0;
        for (const c of el.childNodes) {
            if (c.nodeType === 1 && !SKIP.has(c.localName)) {
                const cs = styleOf(c, s, w);
                if (cs.display === 'none') continue;
                if (cs.display === 'block') {
                    flush();
                    const [mt, mr, mb, ml] = cs.margin, [pt, pr, pb, pl] = cs.padding;
                    y += Math.max(carry, mt);
                    const bx = x + ml + pl, bw = Math.max(0, w - ml - mr - pl - pr);
                    if (c.localName === 'hr') {
                        ctx.fillStyle = '#c0c0c0';
                        ctx.fillRect(x + ml, y + 1, Math.max(0, w - ml - mr), 1);
                        y += 2 + pt + pb;
                    } else {
                        if (c.localName === 'li') {   // the marker, left of the content
                            const m = metrics(cs);
                            ctx.font = fontOf(cs);
                            ctx.fillStyle = cs.color;
                            const marker = el.localName === 'ol' ? (index + 1) + '. ' : '• ';
                            ctx.fillText(marker, bx - measure(cs, marker), y + pt + m.above);
                            index++;
                        }
                        y = blocks(c, cs, bx, y + pt, bw) + pb;
                    }
                    carry = mb;
                    continue;
                }
            }
            run.push(c);
        }
        flush();
        return y + carry;
    }

    blocks(root, rootStyle, x0, y0, width);
    return lines;
}

// ---------------------------------------------------------------- the image
function size(v, base)
{
    if (v === null || v === undefined || v === '') return null;
    return length(v, 16, base);
}
function find(el, tag)
{
    for (const c of el.childNodes) {
        if (c.nodeType !== 1) continue;
        if (c.localName === tag) return c;
        const f = find(c, tag);
        if (f) return f;
    }
    return null;
}

J.htmlInSVG = function (bytes, type) {
    if (!/svg/i.test(type || '') && !(bytes.length && bytes[0] === 0x3c)) return null;
    const text = J.utf8Decode(bytes);
    if (!/<foreignObject[\s>]/i.test(text)) return null;
    const t0 = H5.now();
    const holder = J.document.createElement('div');
    holder.innerHTML = text;
    const svg = find(holder, 'svg');
    const fo = svg && find(svg, 'foreignobject');
    if (!fo) return null;
    const vb = (svg.getAttribute('viewBox') || svg.getAttribute('viewbox') || '').trim().split(/[\s,]+/).map(Number);
    const hasViewBox = vb.length === 4 && vb[2] > 0 && vb[3] > 0;
    const w = Math.round(size(svg.getAttribute('width'), 0) || (hasViewBox ? vb[2] : 300));
    const h = Math.round(size(svg.getAttribute('height'), 0) || (hasViewBox ? vb[3] : 150));
    if (!(w > 0 && h > 0) || w * h > 4096 * 4096) return null;
    // user space: the viewBox scaled into the image
    const uw = hasViewBox ? vb[2] : w, uh = hasViewBox ? vb[3] : h;
    const fx = size(fo.getAttribute('x'), uw) || 0, fy = size(fo.getAttribute('y'), uh) || 0;
    const fw = size(fo.getAttribute('width'), uw) ?? uw, fh = size(fo.getAttribute('height'), uh) ?? uh;
    const canvas = J.document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (hasViewBox) {
        ctx.scale(w / vb[2], h / vb[3]);
        ctx.translate(-vb[0], -vb[1]);
    }
    ctx.beginPath();
    ctx.rect(fx, fy, fw, fh);
    ctx.clip();
    // the foreignObject is a block box of its own size; HTML's defaults inside it
    const initial = { fontSize: 16, family: 'serif', weight: 400, italic: false, underline: false, strike: false,
        color: '#000000', lineHeight: null, align: 'left', whiteSpace: 'normal', hidden: false };
    const lines = draw(ctx, fo, initial, fx, fy, fw);
    const handle = H5.imageCreate(w, h, ctx.getImageData(0, 0, w, h).data);
    H5.log(1, 'image: an SVG with HTML in it, ' + w + 'x' + h + ', ' + lines + ' lines (' + Math.round(H5.now() - t0) + ' ms)');
    return { handle, width: w, height: h };
};

})(globalThis.__h5);

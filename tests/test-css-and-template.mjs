// Checks the things a browser would only tell you by silently drawing nothing:
// that every mask data URI is well-formed SVG, that the -webkit- twin matches the
// standard property exactly, that mask-size agrees with the tile the SVG declares,
// and that the template's block helpers balance.
import fs from 'node:fs';

let failures = 0;
const fail = message => { failures++; console.log(`  FAIL  ${message}`); };
const ok = message => console.log(`  ok    ${message}`);

const css = fs.readFileSync('styles/tool-mapping.css', 'utf8');

// Each floor rule, with its declarations.
const rules = [...css.matchAll(/\.cartographer-mapping-floor\.is-floor-([a-z-]+)\s*\{([^}]*)\}/g)]
    .map(match => ({ type: match[1], text: match[2] }));

console.log(`floor rules found: ${rules.map(rule => rule.type).join(', ')}`);
const expected = ['shade-light', 'shade-medium', 'shade-dark', 'dirt', 'grass', 'rock',
    'cobblestone', 'brick', 'wood', 'tile'];
for (const type of expected) {
    if (!rules.some(rule => rule.type === type)) fail(`no rule for ${type}`);
}
if (rules.length === expected.length) ok(`all ${expected.length} surfaces have a rule, and no extras`);

console.log('\nmask data URIs');
for (const rule of rules) {
    if (rule.type.startsWith('shade-')) {
        if (/mask-image/.test(rule.text)) fail(`${rule.type} should carry no mask at all`);
        else if (!/background-color:\s*var\(--cartographer-map-floor-tint-/.test(rule.text)) {
            fail(`${rule.type} has no tint colour`);
        } else ok(`${rule.type} is a flat wash, no mask`);
        continue;
    }

    const standard = rule.text.match(/(?<!-)\bmask-image:\s*([\s\S]*?);/);
    const webkit = rule.text.match(/-webkit-mask-image:\s*([\s\S]*?);/);
    if (!standard || !webkit) { fail(`${rule.type} is missing a mask-image pair`); continue; }
    if (standard[1].trim() !== webkit[1].trim()) {
        fail(`${rule.type}: -webkit-mask-image differs from mask-image`);
        continue;
    }

    const url = standard[1].match(/url\("data:image\/svg\+xml,([^"]+)"\)/);
    if (!url) {
        // tile is gradients, not an SVG.
        if (/repeating-linear-gradient/.test(standard[1])) ok(`${rule.type}: gradient mask, pair matches`);
        else fail(`${rule.type}: mask is neither an SVG data URI nor a gradient`);
        continue;
    }

    let svg;
    try { svg = decodeURIComponent(url[1]); } catch { fail(`${rule.type}: data URI is not valid percent-encoding`); continue; }
    if (!svg.startsWith('<svg ') || !svg.endsWith('</svg>')) { fail(`${rule.type}: not a whole SVG document`); continue; }
    if (!/xmlns='http:\/\/www\.w3\.org\/2000\/svg'/.test(svg)) { fail(`${rule.type}: missing xmlns, will not load`); continue; }

    // Every element either self-closes or is one of the paired tags we use.
    const tags = [...svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*)>/g)];
    const stack = [];
    for (const [, closing, name, attributes] of tags) {
        if (closing) {
            if (stack.pop() !== name) { fail(`${rule.type}: <${name}> closes out of order`); break; }
        } else if (!attributes.trim().endsWith('/')) stack.push(name);
    }
    if (stack.length) fail(`${rule.type}: unclosed <${stack.join('><')}>`);

    // The tile the SVG declares must be the tile mask-size repeats at, or the
    // pattern is silently scaled and the seams stop meeting.
    const width = svg.match(/width='([\d.]+)'/)?.[1];
    const height = svg.match(/height='([\d.]+)'/)?.[1];
    const size = rule.text.match(/(?<!-)\bmask-size:\s*([\d.]+)px\s+([\d.]+)px/);
    if (!size) fail(`${rule.type}: no mask-size`);
    else if (size[1] !== width || size[2] !== height) {
        fail(`${rule.type}: mask-size ${size[1]}x${size[2]} but the SVG is ${width}x${height}`);
    } else if (!stack.length) ok(`${rule.type}: valid SVG, pair matches, tile ${width}x${height}`);
}

console.log('\ntint variables defined in every theme');
const themes = [...css.matchAll(/cartographer-mapping-window(\.blacksmith-window-tool-theme-([a-z]+))?\s*\{([\s\S]*?)\n\}/g)];
for (const [, , name, block] of themes) {
    const missing = ['light', 'medium', 'dark']
        .filter(step => !block.includes(`--cartographer-map-floor-tint-${step}:`));
    if (missing.length) fail(`theme ${name ?? 'default'} is missing tint-${missing.join(', tint-')}`);
    else ok(`theme ${name ?? 'default'} defines all three tints`);
}

console.log('\ntemplate block helpers balance');
const hbs = fs.readFileSync('templates/window-mapping.hbs', 'utf8');
const opens = (hbs.match(/\{\{#(if|each|unless)/g) ?? []).length;
const closes = (hbs.match(/\{\{\/(if|each|unless)/g) ?? []).length;
if (opens !== closes) fail(`${opens} block opens vs ${closes} closes`);
else ok(`${opens} block helpers, all closed`);
if (!/clipPathUnits="objectBoundingBox"/.test(hbs)) fail('clipPath is missing objectBoundingBox units');
else ok('clipPath uses objectBoundingBox, so it needs no cell size');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);

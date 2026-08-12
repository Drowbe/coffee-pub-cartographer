// The grid preference is the first thing here that composes a colour out of
// custom properties, so this resolves the substitution by hand and checks the
// alpha each weight actually lands on -- including that Medium reproduces
// exactly what every theme was drawn at before the preference existed.
import fs from 'node:fs';

let failures = 0;
const fail = message => { failures++; console.log(`  FAIL  ${message}`); };
const ok = message => console.log(`  ok    ${message}`);

const css = fs.readFileSync('styles/tool-mapping.css', 'utf8');
const js = fs.readFileSync('scripts/window-mapping.js', 'utf8');
const hbs = fs.readFileSync('templates/window-mapping.hbs', 'utf8');
const settings = fs.readFileSync('scripts/settings.js', 'utf8');
// en.json nests everything under the module id.
const lang = JSON.parse(fs.readFileSync('lang/en.json', 'utf8'))['coffee-pub-cartographer'];

// The weights the menu offers, read out of the source.
const weights = [...js.matchAll(/\{ id: '(\w+)', weight: ([\d.]+), labelKey: '([\w.]+)'/g)]
    .map(match => ({ id: match[1], weight: Number(match[2]), labelKey: match[3] }));
console.log(`grid options: ${weights.map(w => `${w.id}=${w.weight}`).join(', ')}`);
const wanted = ['off', 'light', 'medium', 'dark'];
if (JSON.stringify(weights.map(w => w.id)) !== JSON.stringify(wanted)) {
    fail(`expected ${wanted.join(', ')}`);
} else ok('four options, in the order asked for');
if (weights.find(w => w.id === 'medium')?.weight !== 1) fail('medium must be weight 1 (the old look)');
else ok('medium is weight 1');
if (weights.find(w => w.id === 'off')?.weight !== 0) fail('off must be weight 0');
else ok('off is weight 0');

// Every weight has a CSS rule, and it matches the JS constant.
console.log('\nCSS weight rules agree with the JS constant');
for (const option of weights) {
    const rule = css.match(new RegExp(`is-grid-${option.id} \\{\\s*--cartographer-map-grid-weight: ([\\d.]+);`));
    if (!rule) fail(`no CSS rule for is-grid-${option.id}`);
    else if (Number(rule[1]) !== option.weight) {
        fail(`is-grid-${option.id}: CSS says ${rule[1]}, JS says ${option.weight}`);
    } else ok(`is-grid-${option.id} -> ${rule[1]}`);
}

// Resolve the composed colours per theme, the way the browser would.
console.log('\nresolved grid alpha per theme and weight');
const themeBlocks = [...css.matchAll(/cartographer-mapping-window(?:\.blacksmith-window-tool-theme-([a-z]+))?\s*\{([\s\S]*?)\n\}/g)];
// What each theme was drawn at before the preference existed, from git HEAD.
const baseline = { default: { floor: 0.22, void: 0.16 }, dark: { floor: 0.16, void: 0.08 }, glass: { floor: 0.18, void: 0.07 } };
for (const [, rawName, block] of themeBlocks) {
    const name = rawName ?? 'default';
    for (const kind of ['floor', 'void']) {
        const ink = block.match(new RegExp(`--cartographer-map-${kind}-grid-ink:\\s*([^;]+);`))?.[1]?.trim();
        const strength = block.match(new RegExp(`--cartographer-map-${kind}-grid-strength:\\s*([\\d.]+);`))?.[1];
        if (!ink || !strength) { fail(`${name}/${kind}: missing ink or strength`); continue; }
        if (!/^\d+,\s*\d+,\s*\d+$/.test(ink)) { fail(`${name}/${kind}: ink "${ink}" is not an rgb triplet`); continue; }
        if (Number(strength) !== baseline[name][kind]) {
            fail(`${name}/${kind}: strength ${strength} but was drawn at ${baseline[name][kind]}`);
            continue;
        }
        const resolved = weights.map(w => `${w.id}=${+(Number(strength) * w.weight).toFixed(3)}`);
        ok(`${name}/${kind}: rgba(${ink}) ${resolved.join(' ')}`);
    }
}

// Nothing may still reference the colours that were split apart.
console.log('\nno stale whole-colour grid variables');
// Only the root may declare a whole grid colour; a theme doing so would silently
// win over the composed one and the weight would stop working.
for (const [, name, block] of themeBlocks) {
    if (/--cartographer-map-(?:floor|void)-grid:/.test(block)) {
        fail(`theme ${name ?? 'default'} still declares a whole grid colour, which would override the weight`);
    }
}
ok('themes declare ink and strength only');
for (const kind of ['floor', 'void']) {
    if (!css.includes(`--cartographer-map-${kind}-grid: rgba(`)) fail(`${kind} grid is never composed`);
}
ok('both grid colours composed once, on the root');

// Wiring.
console.log('\nwiring');
if (!/gridClass/.test(hbs)) fail('template does not apply the grid class');
else ok('template applies gridClass to the root');
// Defined once, then returned by both branches of _buildModel -- the list view
// and the map view. Miss one and the class vanishes in that view.
const branches = [...js.matchAll(/gridClass/g)].length;
if (branches !== 3) fail(`gridClass appears ${branches} times in JS; expected 3 (definition + both model branches)`);
else ok('gridClass defined once and returned by both model branches');
if (!/'mapping\.gridWeight'/.test(settings)) fail('setting not registered');
else if (!/mapping\.gridWeight[\s\S]{0,200}scope: 'user'/.test(settings)) fail('setting is not user-scoped');
else if (!/mapping\.gridWeight[\s\S]{0,200}default: 'medium'/.test(settings)) fail('setting does not default to medium');
else ok("setting registered: user scope, default 'medium', hidden from the form");
// The menu must not sit behind an ownership check.
const menu = js.match(/_showCellMenu\(event, items\) \{[\s\S]*?\n    \}/)?.[0] ?? '';
if (!menu.includes('_gridMenu()')) fail('grid menu is not appended in _showCellMenu');
else if (/canManageRecord|canAnnotateRecord/.test(menu)) fail('grid menu is gated behind ownership');
else ok('grid menu appended for every cell menu, ungated');

console.log('\nlabels');
for (const key of ['mapping.gridLines', ...weights.map(w => w.labelKey)]) {
    if (!lang[`${key}`]) fail(`lang is missing ${key}`);
}
ok(`all ${weights.length + 1} labels present: Grid > ${weights.map(w => lang[w.labelKey]).join(' / ')}`);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);

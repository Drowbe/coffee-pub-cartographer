// The list borrows the shape of the other tool windows but takes its colour from
// the tool window API's own variables.
//
// Blacksmith's blacksmith-list-* / blacksmith-window-section components were
// tried here and are the wrong family: they belong to its dark windows and
// hard-code a near-white row title, which on this window's paper surface is
// unreadable. So this checks two things — that those components are not applied
// or overridden, and that nothing in the list invents a colour the theme should
// have supplied.
import fs from 'node:fs';

const hbs = fs.readFileSync('templates/window-mapping.hbs', 'utf8');
const css = fs.readFileSync('styles/tool-mapping.css', 'utf8');
let bad = 0;
const fail = (m) => { bad++; console.log('  FAIL  ' + m); };
const ok = (m) => console.log('  ok    ' + m);

console.log('the dark window family is neither applied nor overridden');
for (const cls of ['blacksmith-list-row', 'blacksmith-list-empty', 'blacksmith-window-section',
    'blacksmith-window-btn-secondary', 'blacksmith-window-btn-critical']) {
    // The explanatory comment names them deliberately; the markup must not.
    const applied = hbs.split('\n').some(line => line.includes('class=') && line.includes(cls));
    if (applied) fail(`${cls} is applied in the markup, and it hard-codes dark colours`);
    if (css.includes('.' + cls)) fail(`${cls} is being restyled here, which is fighting it`);
}
ok('none applied, none restyled');

console.log('\nthe list takes its colour from the tool theme');
const block = css.slice(css.indexOf('RECORDED MAPS LIST'));
const literals = [...block.matchAll(/:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g)].map(m => m[1]);
// One deliberate exception: the danger tint a delete button takes on hover,
// which the tool palette has no variable for.
const allowed = new Set(['#a63232']);
const stray = literals.filter(value => !allowed.has(value.toLowerCase()));
if (stray.length) fail(`${stray.length} hard-coded colour(s): ${stray.join(', ')}`);
else ok(`no invented colours (${literals.length} literal, allow-listed)`);

const vars = [...new Set([...block.matchAll(/var\((--blacksmith-tool-[a-z-]+)/g)].map(m => m[1]))];
if (vars.length < 8) fail(`only ${vars.length} tool variables used; expected the palette`);
else ok(`${vars.length} tool-theme variables used: ${vars.length} of the published set`);

console.log('\nthe superseded classes are gone from template and stylesheet');
for (const dead of ['cartographer-mapping-list-item', 'cartographer-mapping-list-copy',
    'cartographer-mapping-list-icon', 'cartographer-mapping-item-actions',
    'cartographer-mapping-list-group', 'cartographer-mapping-group-name',
    'cartographer-mapping-list-header']) {
    if (hbs.includes(dead)) fail(`${dead} still in the template`);
    if (css.includes(dead)) fail(`${dead} still styled`);
}
ok('none remain');

console.log('\nevery class the list styles is actually applied');
const ours = [...new Set([...block.matchAll(/\.(cartographer-mapping-[a-z-]+)/g)].map(m => m[1]))];
for (const cls of ours) if (!hbs.includes(cls)) fail(`${cls} is styled but never applied`);
ok(`${ours.length} classes, all used`);

// The direction that actually bites. Deleting a superseded rule is easy to do
// one class too far: the markup keeps the class, nothing errors, and the layout
// quietly loses whatever that rule carried. That is how the sections lost the
// gap between them -- and, less visibly, how the list lost its scrolling.
console.log('\nand every class the markup applies has a rule');
const applied = [...new Set(
    [...hbs.matchAll(/class="([^"{}]*)"/g)].flatMap(m => m[1].split(/\s+/))
)].filter(cls => cls.startsWith('cartographer-'));
const unstyled = applied.filter(cls => !css.includes('.' + cls));
if (unstyled.length) fail(`no rule for: ${unstyled.join(', ')}`);
else ok(`${applied.length} applied classes, none unstyled`);

console.log('\nthe list can still scroll inside the window');
const container = css.slice(css.indexOf('.cartographer-mapping-list {'));
const decls = container.slice(0, container.indexOf('}'));
for (const need of ['overflow-y', 'min-height', 'gap']) {
    if (!decls.includes(need)) fail(`the list container has no ${need}`);
}
ok('it scrolls, it can shrink, and it spaces its sections');

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);

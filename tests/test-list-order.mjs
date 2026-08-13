// What order a group's maps come in, and which view controls are offered.
import fs from 'node:fs';

const src = fs.readFileSync('scripts/window-mapping.js', 'utf8');
let bad = 0;
const check = (label, actual, expected) => {
    if (JSON.stringify(actual) === JSON.stringify(expected)) { console.log('  ok    ' + label); return; }
    bad++; console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

// The ordering, from the shipped constant and the shipped comparator.
const order = eval(`(${src.match(/const MAP_KIND_ORDER = ([^;]+);/)[1]})`);
const sortMaps = (maps) => [...maps].sort((left, right) => order[left.kind] - order[right.kind]);

console.log('the shared maps lead, in the order asked for');
check('official, then party, then the rest', order, { official: 0, party: 1, player: 2 });
{
    const group = [
        { kind: 'player', name: 'Bruenor' },
        { kind: 'party', name: 'Party' },
        { kind: 'player', name: 'Favia' },
        { kind: 'official', name: 'Artifact' }
    ];
    check('sorted', sortMaps(group).map(m => m.name), ['Artifact', 'Party', 'Bruenor', 'Favia']);
}
{
    // Sorting must be stable, or personal maps would shuffle on every render.
    const group = [
        { kind: 'player', name: 'first' },
        { kind: 'player', name: 'second' },
        { kind: 'player', name: 'third' }
    ];
    check('personal maps keep the recency order they arrived in',
        sortMaps(group).map(m => m.name), ['first', 'second', 'third']);
}
{
    check('a group with neither shared map is untouched',
        sortMaps([{ kind: 'player', name: 'a' }, { kind: 'player', name: 'b' }]).map(m => m.name), ['a', 'b']);
    check('a group of only the artifact', sortMaps([{ kind: 'official', name: 'x' }]).map(m => m.name), ['x']);
}

console.log('\nfitting the map is always offered');
const controls = src.slice(src.indexOf('_buildViewControls(model) {'), src.indexOf('    _chromeButton({ action'));
// Fit must not sit on either side of a conditional.
const fitLine = controls.slice(controls.indexOf("action: 'fit-map'"));
if (/\?|\.\.\.\(/.test(controls.slice(controls.indexOf('const buttons'), controls.indexOf("action: 'fit-map'")))) {
    bad++; console.log('  FAIL  fit-map is behind a condition');
} else console.log('  ok    fit-map is unconditional');
if (!controls.includes("...(model.showParty ? [this._chromeButton({")) {
    bad++; console.log('  FAIL  centring is not the conditional one');
} else console.log('  ok    centring on the party is the one that comes and goes');
if (!/zoom-out[\s\S]*fit-map[\s\S]*center-view[\s\S]*zoom-in/.test(controls)) {
    bad++; console.log('  FAIL  the zoom controls no longer bracket the view controls');
} else console.log('  ok    zoom out, fit, centre, zoom in');

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);

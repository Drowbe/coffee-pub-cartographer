// A map is called after its scene and nothing else.
//
// Who mapped it is already said by the row it sits in and the heading above it.
// Titles generated under the old scheme are rewritten on the way in, but a name
// somebody chose must survive that — a rename that quietly undid itself would be
// worse than the sloppy titles this replaced.
import fs from 'node:fs';

const src = fs.readFileSync('scripts/manager-mapping.js', 'utf8');
const start = src.indexOf('function mapDisplayName');
const mapDisplayName = eval(`(${src.slice(start, src.indexOf('\n}\n', start) + 2)})`);

let bad = 0;
const check = (label, actual, expected) => {
    if (actual === expected) { console.log('  ok    ' + label); return; }
    bad++; console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};

const SCENE = 'Sunless Citadel';

console.log('old auto-generated titles are cleaned up');
check('a character map loses the character',
    mapDisplayName({ name: `Bruenor — ${SCENE}` }, SCENE, ['Bruenor', 'Map']), SCENE);
check('the nameless fallback goes too',
    mapDisplayName({ name: `Map — ${SCENE}` }, SCENE, ['', 'Map']), SCENE);
check('the party map loses the party',
    mapDisplayName({ name: `The Crimson Hand — ${SCENE}` }, SCENE, ['The Crimson Hand']), SCENE);
check('an artifact loses its label',
    mapDisplayName({ name: `Official Map — ${SCENE}` }, SCENE, ['Official Map']), SCENE);

console.log('\na name somebody chose is never touched');
check('a plain rename survives',
    mapDisplayName({ name: "Bruenor's Survey" }, SCENE, ['Bruenor', 'Map']), "Bruenor's Survey");
check('even one that mentions the scene',
    mapDisplayName({ name: `Notes on ${SCENE}` }, SCENE, ['Bruenor']), `Notes on ${SCENE}`);
check('even one shaped like the old pattern but not from us',
    mapDisplayName({ name: `Gandalf — ${SCENE}` }, SCENE, ['Bruenor', 'Map']), `Gandalf — ${SCENE}`);
check('a name that is only the owner is left alone',
    mapDisplayName({ name: 'Bruenor' }, SCENE, ['Bruenor']), 'Bruenor');
check('the scene alone is already right',
    mapDisplayName({ name: SCENE }, SCENE, ['Bruenor']), SCENE);

console.log('\nnothing stored falls back to the scene');
check('empty', mapDisplayName({ name: '' }, SCENE, ['Bruenor']), SCENE);
check('whitespace only', mapDisplayName({ name: '   ' }, SCENE, ['Bruenor']), SCENE);
check('absent', mapDisplayName({}, SCENE, ['Bruenor']), SCENE);
check('no record at all', mapDisplayName(null, SCENE, ['Bruenor']), SCENE);

console.log('\nno owner names to match against');
check('the stored name stands', mapDisplayName({ name: `Bruenor — ${SCENE}` }, SCENE, []), `Bruenor — ${SCENE}`);
check('and null owners are skipped rather than matched',
    mapDisplayName({ name: `null — ${SCENE}` }, SCENE, [null, undefined, '']), `null — ${SCENE}`);

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);

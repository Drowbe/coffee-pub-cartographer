// Opening the mapper twice at once must produce one window, not two.
//
// Two applications sharing an id are not two windows: Foundry's _insertElement
// replaces whatever it finds under that id, so the second takes the first's
// place in the document and the first is left holding a detached element while
// still believing it is rendered. Anything that measures it then reads
// offsetWidth off a null parent, a frame later, with none of this in the stack.
import fs from 'node:fs';

const src = fs.readFileSync('scripts/manager-mapping.js', 'utf8');
const pick = (name) => {
    const start = src.indexOf(`    ${name}(`);
    if (start < 0) throw new Error(`missing ${name}`);
    return src.slice(start, src.indexOf('\n    }\n', start) + 6);
};
const Mgr = eval(`(class M {\n${pick('async openWindow')}\n})`);

let bad = 0;
const check = (label, actual, expected) => {
    if (actual === expected) { console.log('  ok    ' + label); return; }
    bad++; console.log(`  FAIL  ${label}: expected ${expected}, got ${actual}`);
};

function manager({ delay = 5 } = {}) {
    const m = new Mgr();
    m._windowOpening = null;
    m.built = 0;
    m._openWindow = async () => {
        m.built++;
        // The gap that matters: a real open awaits a dynamic import and a
        // render before anything records that a window exists.
        await new Promise(resolve => setTimeout(resolve, delay));
        return { id: 'the-window', built: m.built };
    };
    return m;
}

console.log('concurrent opens share one window');
{
    const m = manager();
    const results = await Promise.all([m.openWindow(), m.openWindow(), m.openWindow()]);
    check('only one window was built', m.built, 1);
    check('and every caller got it', new Set(results).size, 1);
    check('the same object, not a copy', results[0] === results[2], true);
}

console.log('\nthe guard clears, so the window can be reopened later');
{
    const m = manager();
    await m.openWindow();
    check('nothing left in flight', m._windowOpening, null);
    await m.openWindow();
    check('a later open builds again', m.built, 2);
}

console.log('\na failed open does not wedge the guard shut');
{
    const m = manager();
    m._openWindow = async () => { throw new Error('render blew up'); };
    await m.openWindow().then(() => { bad++; console.log('  FAIL  the failure was swallowed'); },
        () => console.log('  ok    the failure reaches the caller'));
    check('and the guard released', m._windowOpening, null);
    m._openWindow = async () => 'recovered';
    check('so opening can be retried', await m.openWindow(), 'recovered');
}

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);

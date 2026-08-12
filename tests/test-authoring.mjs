// Blank ground is offered to exactly one kind of map: the artifact, which is
// drawn rather than walked or donated to. Everything else that is empty is
// waiting for something and should say so instead of handing over a pencil.
import fs from 'node:fs';
const js = fs.readFileSync('scripts/window-mapping.js', 'utf8');
const start = js.indexOf('    _canAuthorBlank()');
const body = js.slice(start, js.indexOf('\n    }\n', start) + 6);
const Win = eval(`(class W {\n${body}\n})`);
let bad = 0;
const check = (l, a, e) => { if (a === e) console.log('  ok    ' + l); else { bad++; console.log(`  FAIL  ${l}: expected ${e} got ${a}`); } };
const win = (kind, canManage) => Object.assign(new Win(), {
    manager: { state: { kind }, canManageRecord: () => canManage }
});
check('a player map keeps its "start recording" message', win('player', true)._canAuthorBlank(), false);
check('an official map the GM owns offers blank ground', win('official', true)._canAuthorBlank(), true);
check('an official map a player cannot author does not', win('official', false)._canAuthorBlank(), false);
// The party map is filled by donation and by members recording into it, so
// an empty one is waiting for something rather than asking to be drawn.
check('the party map does not -- it is waiting to be given to', win('party', true)._canAuthorBlank(), false);
check('a record with no kind reads as player', win(undefined, true)._canAuthorBlank(), false);
console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);

// The authoring loop for a map nobody walks: does an empty one give the person
// holding the pencil something to draw on?
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
check('the party map offers it to a member', win('party', true)._canAuthorBlank(), true);
check('a record with no kind reads as player', win(undefined, true)._canAuthorBlank(), false);
console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);

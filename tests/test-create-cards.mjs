// One map each: a character gets one per scene, the party one, a scene one
// artifact. The create cards have to agree with that or they offer nothing.
import fs from 'node:fs';
const src = fs.readFileSync('scripts/manager-mapping.js', 'utf8');
const helpers = src.slice(src.indexOf('const MAP_KINDS'), src.indexOf('/** Compact "column,row"'));
const pick = (n) => { const s = src.indexOf(`    ${n}(`); return src.slice(s, src.indexOf('\n    }\n', s) + 6); };
const methods = ['hasMapOfKind', 'hasMapForSelectedToken', '_recordId'].map(pick).join('\n');
let scene = { id: 's1' };
globalThis.canvas = { get scene() { return scene; } };
const { Mgr } = eval(`(() => { ${helpers}\nreturn { Mgr: class M {\n${methods}\n} }; })()`);

let bad = 0;
const check = (l, a, e) => { if (a === e) console.log('  ok    ' + l); else { bad++; console.log(`  FAIL  ${l}: expected ${e} got ${a}`); } };
const mgr = (entries, token) => Object.assign(new Mgr(), {
    _index: new Map(entries.map((e, i) => [String(i), e])),
    _getSingleControlledToken: () => token,
    getRecord: (id) => entries.find(e => `${e.actorId}::${e.sceneId}` === id) ?? null
});

console.log('the artifact card');
check('shown when the scene has none', mgr([], null).hasMapOfKind('official'), false);
check('hidden once one exists', mgr([{ kind: 'official', sceneId: 's1' }], null).hasMapOfKind('official'), true);
check('another scene does not count', mgr([{ kind: 'official', sceneId: 's2' }], null).hasMapOfKind('official'), false);

console.log('\nthe party card');
check('hidden once the party map exists', mgr([{ kind: 'party', sceneId: 's1' }], null).hasMapOfKind('party'), true);
check('an artifact is not a party map', mgr([{ kind: 'official', sceneId: 's1' }], null).hasMapOfKind('party'), false);

console.log("\nthe character card asks about the token in hand, not the reader");
const bruenor = { actor: { id: 'a-bruenor' } };
const mine = { kind: 'player', actorId: 'a-bruenor', sceneId: 's1' };
const theirs = { kind: 'player', actorId: 'a-other', sceneId: 's1' };
check('hidden when this token already has one', mgr([mine], bruenor).hasMapForSelectedToken(), true);
check("shown when only somebody else's exists -- the GM case", mgr([theirs], bruenor).hasMapForSelectedToken(), false);
check('shown with no token selected, so it can say which to pick', mgr([mine], null).hasMapForSelectedToken(), false);
check('a map of another scene does not hide it', mgr([{ ...mine, sceneId: 's2' }], bruenor).hasMapForSelectedToken(), false);

console.log('\nno scene at all');
scene = null;
check('nothing is claimed to exist', mgr([{ kind: 'official', sceneId: 's1' }], bruenor).hasMapOfKind('official'), false);
check('and no card is suppressed', mgr([mine], bruenor).hasMapForSelectedToken(), false);

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);

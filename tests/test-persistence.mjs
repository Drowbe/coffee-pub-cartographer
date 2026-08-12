// Where each kind of map is written, and that it is written at all.
//
// The party map and every official map were once created, cached, rendered --
// and never saved, because the write path asked for an Actor id and they have
// none. Nothing failed; the record simply stopped existing at the next reload.
// A write that silently does nothing is the failure this suite exists to catch.
import fs from 'node:fs';

const src = fs.readFileSync('scripts/manager-mapping.js', 'utf8');
const helpers = src.slice(src.indexOf('const MAP_KINDS'), src.indexOf('/** Compact "column,row"'));
const pick = (name) => {
    const start = src.indexOf(`    ${name}(`);
    if (start < 0) throw new Error(`missing ${name}`);
    return src.slice(start, src.indexOf('\n    }\n', start) + 6);
};
const methods = ['async _persistMapRecord', '_sceneMaps'].map(pick).join('\n');

const MODULE = { ID: 'coffee-pub-cartographer', NAME: 'Cartographer' };
const FLAG_KEY = 'mapping';
const STATE_VERSION = 4;
const broadcasts = [];
const socketManager = { broadcast: async (...args) => { broadcasts.push(args); } };
globalThis.foundry = { utils: { deepClone: (v) => structuredClone(v) } };

let writes = [];
let stored = null;
const scene = {
    id: 's1',
    getFlag: () => stored,
    update: async (data) => { writes.push(data); }
};
globalThis.game = { scenes: { get: (id) => (id === 's1' ? scene : null) }, user: { isGM: true, id: 'u-gm' } };

const { Mgr } = eval(`(() => { ${helpers}\nreturn { Mgr: class M {\n${methods}\n} }; })()`);

let bad = 0;
const check = (label, actual, expected) => {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { console.log('  ok    ' + label); return; }
    bad++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`);
};

function manager() {
    const m = new Mgr();
    m._saveQueue = Promise.resolve();
    m._index = new Map();
    m.records = new Map();
    m.containers = [];
    m._writeSceneContainer = async (_scene, container) => { m.containers.push(container); };
    return m;
}
const record = (over) => ({ sceneId: 's1', explored: [], symbols: [], ...over });
const pathOf = (write) => Object.keys(write ?? {})[0] ?? null;

console.log('into an existing container, each kind lands under its own key');
stored = { version: STATE_VERSION, maps: {} };
for (const [label, rec, key] of [
    ['a player map', record({ kind: 'player', actorId: 'a-bruenor' }), 'a-bruenor'],
    ['the party map', record({ kind: 'party', actorId: null }), 'party'],
    ['an official map', record({ kind: 'official', officialId: 'o7', actorId: null }), 'official:o7']
]) {
    writes = [];
    const m = manager();
    await m._persistMapRecord(rec);
    check(`${label} is written`, writes.length, 1);
    check(`  ...under ${key}`, pathOf(writes[0]), `flags.coffee-pub-cartographer.mapping.maps.${key}`);
}

console.log('\nreplacing an existing entry forces the whole value');
stored = { version: STATE_VERSION, maps: { party: { kind: 'party' } } };
{
    writes = [];
    const m = manager();
    await m._persistMapRecord(record({ kind: 'party', actorId: null }));
    check('"==" prefix so a merge cannot resurrect what was removed',
        pathOf(writes[0]), 'flags.coffee-pub-cartographer.mapping.maps.==party');
}

console.log('\nwith no container yet, a whole one is laid down');
stored = null;
{
    const m = manager();
    await m._persistMapRecord(record({ kind: 'official', officialId: 'o7', actorId: null }));
    check('a container was written', m.containers.length, 1);
    check('holding the artifact under its key', Object.keys(m.containers[0].maps), ['official:o7']);
}

console.log('\na record naming no owner is not written anywhere');
stored = { version: STATE_VERSION, maps: {} };
{
    writes = [];
    const m = manager();
    await m._persistMapRecord(record({ kind: 'player', actorId: null }));
    check('nothing written', writes.length, 0);
    await m._persistMapRecord(record({ kind: 'official', officialId: null, actorId: null }));
    check('an artifact with no id of its own is not written either', writes.length, 0);
}

console.log('\nrebuilding the container keeps every kind');
{
    const m = manager();
    const entries = [
        { id: 'a-bruenor::s1', sceneId: 's1', kind: 'player', actorId: 'a-bruenor', raw: { n: 1 } },
        { id: 'party::s1', sceneId: 's1', kind: 'party', actorId: null, raw: { n: 2 } },
        { id: 'official:o7::s1', sceneId: 's1', kind: 'official', officialId: 'o7', actorId: null, raw: { n: 3 } },
        { id: 'a-other::s2', sceneId: 's2', kind: 'player', actorId: 'a-other', raw: { n: 4 } }
    ];
    for (const entry of entries) m._index.set(entry.id, entry);
    const maps = m._sceneMaps('s1');
    check('this scene only, keyed by owner', Object.keys(maps).sort(), ['a-bruenor', 'official:o7', 'party']);
}

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);

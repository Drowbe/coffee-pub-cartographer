// Exercises the real _processMutationRequest -- the GM-side write path every
// change to a map goes through. Sliced out of manager-mapping.js and run against
// stubs, so this is the shipped handler and not a description of it.
//
// Written because a symbol placement was saved from the wrong array and nothing
// noticed: every suite up to now covered pure geometry and stylesheet structure,
// and none of them touched the code that actually writes a record.
import fs from 'node:fs';

const src = fs.readFileSync('scripts/manager-mapping.js', 'utf8');
const helpers = src.slice(src.indexOf('const MAP_KINDS'), src.indexOf('/** Compact "column,row"'));
const slice = (name, start = src.indexOf(`    ${name}(`)) => {
    if (start < 0) throw new Error(`missing ${name}`);
    return src.slice(start, src.indexOf('\n    }\n', start) + 6);
};
const methods = [
    'async _processMutationRequest', '_normalizeSymbols', 'exploredSet', '_canManageActor',
    'canViewRecord', 'canManageRecord', 'canDeleteRecord', 'canAnnotateRecord', 'canRemoveEntry',
    '_isPartyMember', '_partyActorIds'
].map(name => slice(name)).join('\n');

// Imports the handler reaches for, stubbed rather than loaded: const.js and
// utils-toast.js both touch Foundry at module scope.
// The real merge, loaded rather than stubbed, so the handler is exercised
// against the function it actually calls. Resolved from the working directory
// so this file can live outside the project.
const { mergeMapInto } = await import(
    `file:///${process.cwd().replace(/\\/g, '/')}/scripts/utils-mapping.js`
);
const MODULE = { ID: 'coffee-pub-cartographer', NAME: 'Cartographer' };
const notified = [];
const notify = (message, options) => notified.push({ message, options });
const ANNOTATION_ACTIONS = ['place-symbol', 'remove-symbol'];
const MAPPING_SYMBOL_TYPES = new Set(['note', 'trap', 'stairs-up']);
const MAPPING_SYMBOL_TEXT_LIMIT = 1000;
const MAPPING_FLOOR_TYPE_IDS = new Set(['default', 'wood']);
let ids = 0;
globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3, NONE: 0 } };
globalThis.foundry = { utils: { randomID: () => `id-${++ids}`, deepClone: (v) => structuredClone(v) } };

const alice = { id: 'u-alice', isGM: false, active: true };
const bob = { id: 'u-bob', isGM: false, active: true };
const gm = { id: 'u-gm', isGM: true, active: true };
const users = { 'u-alice': alice, 'u-bob': bob, 'u-gm': gm };
const actorFor = (id, owners) => ({ id, testUserPermission: (u, l) => l === 3 && owners.includes(u.id) });
const actors = [actorFor('a-alice', ['u-alice']), actorFor('a-bob', ['u-bob'])];
actors.get = (id) => actors.find(a => a.id === id);

let acting = gm;
globalThis.game = {
    get user() { return acting; },
    users: Object.assign({ get: (id) => users[id] }, { activeGM: { isSelf: true } }),
    actors,
    modules: { get: () => ({ api: { campaign: { getParty: () => ({ members: [{ id: 'a-alice' }] }) } } }) },
    i18n: { localize: (k) => k, format: (k) => k }
};

const Manager = eval(`(() => { ${helpers}\nreturn class M {\n${methods}\n}; })()`);

function makeManager(record) {
    const m = new Manager();
    m._exploredSets = new WeakMap();
    m.saved = null;
    m._current = record;
    Object.defineProperty(m, 'currentRecord', { get() { return this._current; } });
    m.currentMapId = record.id;
    m.getRecord = (id) => (id === record.id ? m._current : null);
    m._cacheRecord = (next) => { m._current = next; m.saved = next; return next; };
    m.renderWindow = async () => {};
    m._persistMapRecord = async () => {};
    m.atlasFor = () => ({ features: {}, barriers: new Set(), split: new Set() });
    m._normalizeFloors = (f) => ({ ...(f ?? {}) });
    m._normalizeSides = (s) => ({ ...(s ?? {}) });
    return m;
}

let bad = 0;
const check = (label, actual, expected) => {
    if (JSON.stringify(actual) === JSON.stringify(expected)) { console.log('  ok    ' + label); return; }
    bad++; console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
};
const baseRecord = (over = {}) => ({
    id: 'a-alice::s1', kind: 'player', actorId: 'a-alice', sceneId: 's1',
    explored: ['1,1', '2,2'], symbols: [], floors: {}, sides: {}, hidden: [], ...over
});
const at = (record, c, r) => (record?.symbols ?? []).filter(s => s.column === c && s.row === r);

console.log('placing a symbol actually saves it');
{
    const m = makeManager(baseRecord());
    await m._processMutationRequest(
        { action: 'place-symbol', mapId: 'a-alice::s1', type: 'note', column: 1, row: 1, text: 'rusted portcullis', userId: 'u-gm' },
        { allowLocalGM: true }
    );
    check('the record was written', Boolean(m.saved), true);
    check('one symbol on the square', at(m.saved, 1, 1).length, 1);
    check('it is the symbol that was placed', at(m.saved, 1, 1)[0]?.type, 'note');
    check('its text survived', at(m.saved, 1, 1)[0]?.text, 'rusted portcullis');
}

console.log('\nplacing a second symbol keeps the first');
{
    const m = makeManager(baseRecord());
    for (const [type, column, row] of [['note', 1, 1], ['trap', 2, 2]]) {
        await m._processMutationRequest(
            { action: 'place-symbol', mapId: 'a-alice::s1', type, column, row, userId: 'u-gm' },
            { allowLocalGM: true }
        );
    }
    check('both are on the map', m.saved.symbols.length, 2);
    check('each on its own square', [at(m.saved, 1, 1)[0].type, at(m.saved, 2, 2)[0].type], ['note', 'trap']);
}

console.log('\nplacing onto an occupied square replaces, and does not duplicate');
{
    const m = makeManager(baseRecord());
    for (const type of ['note', 'trap']) {
        await m._processMutationRequest(
            { action: 'place-symbol', mapId: 'a-alice::s1', type, column: 1, row: 1, userId: 'u-gm' },
            { allowLocalGM: true }
        );
    }
    check('still one symbol there', at(m.saved, 1, 1).length, 1);
    check('the newer one', at(m.saved, 1, 1)[0].type, 'trap');
}

console.log('\nremoving a symbol');
{
    const m = makeManager(baseRecord());
    await m._processMutationRequest({ action: 'place-symbol', mapId: 'a-alice::s1', type: 'note', column: 1, row: 1, userId: 'u-gm' }, { allowLocalGM: true });
    await m._processMutationRequest({ action: 'remove-symbol', mapId: 'a-alice::s1', column: 1, row: 1, userId: 'u-gm' }, { allowLocalGM: true });
    check('the square is clear', at(m.saved, 1, 1).length, 0);
}

console.log('\nan unexplored square refuses a symbol');
{
    const m = makeManager(baseRecord());
    await m._processMutationRequest({ action: 'place-symbol', mapId: 'a-alice::s1', type: 'note', column: 9, row: 9, userId: 'u-gm' }, { allowLocalGM: true });
    check('nothing written', m.saved, null);
}

console.log('\nofficial map: a player may add, but not overwrite or remove what is there');
{
    const official = baseRecord({
        id: 'official:x1::s1', kind: 'official', officialId: 'x1', actorId: null,
        symbols: [{ id: 's-orig', type: 'trap', column: 1, row: 1, text: '', createdAt: 1, createdBy: 'u-gm' }]
    });
    const m = makeManager(official);
    acting = gm;   // the handler runs GM-side; `user` is who asked for it
    await m._processMutationRequest({ action: 'place-symbol', mapId: official.id, type: 'note', column: 1, row: 1, userId: 'u-alice' }, { allowLocalGM: true });
    check('a player cannot overwrite the author\'s symbol', m.saved, null);
    check('it is still the original', at(m._current, 1, 1)[0].id, 's-orig');

    await m._processMutationRequest({ action: 'remove-symbol', mapId: official.id, column: 1, row: 1, userId: 'u-alice' }, { allowLocalGM: true });
    check('nor remove it', at(m._current, 1, 1).length, 1);

    await m._processMutationRequest({ action: 'place-symbol', mapId: official.id, type: 'note', column: 2, row: 2, userId: 'u-alice' }, { allowLocalGM: true });
    check('but may annotate a free square', at(m._current, 2, 2).length, 1);
    check('and it is recorded as theirs', at(m._current, 2, 2)[0].createdBy, 'u-alice');

    await m._processMutationRequest({ action: 'remove-symbol', mapId: official.id, column: 2, row: 2, userId: 'u-alice' }, { allowLocalGM: true });
    check('and may take their own back', at(m._current, 2, 2).length, 0);

    await m._processMutationRequest({ action: 'remove-symbol', mapId: official.id, column: 1, row: 1, userId: 'u-gm' }, { allowLocalGM: true });
    check('the GM may remove anything', at(m._current, 1, 1).length, 0);
}

console.log('\nofficial map: a player cannot author it');
{
    const official = baseRecord({ id: 'official:x1::s1', kind: 'official', officialId: 'x1', actorId: null });
    const m = makeManager(official);
    await m._processMutationRequest({ action: 'rename', mapId: official.id, name: 'Mine Now', userId: 'u-alice' }, { allowLocalGM: true });
    check('rename refused', m.saved, null);
    await m._processMutationRequest({ action: 'rename', mapId: official.id, name: 'The Duke\'s Survey', userId: 'u-gm' }, { allowLocalGM: true });
    check('GM rename allowed', m.saved?.name, 'The Duke\'s Survey');
}

console.log('\nparty map: any member edits, only the GM empties');
{
    const party = baseRecord({ id: 'party::s1', kind: 'party', actorId: null, floors: { '1,1': 'wood' } });
    const m = makeManager(party);
    await m._processMutationRequest({ action: 'rename', mapId: 'party::s1', name: 'Our Map', userId: 'u-alice' }, { allowLocalGM: true });
    check('a member may rename', m.saved?.name, 'Our Map');

    const m2 = makeManager(party);
    await m2._processMutationRequest({ action: 'reset', mapId: 'party::s1', userId: 'u-alice' }, { allowLocalGM: true });
    check('a member may not empty it', m2.saved, null);
    await m2._processMutationRequest({ action: 'reset', mapId: 'party::s1', userId: 'u-gm' }, { allowLocalGM: true });
    check('the GM may', m2.saved?.explored, []);
}

console.log('\nanother player cannot edit a player map');
{
    const m = makeManager(baseRecord());
    await m._processMutationRequest({ action: 'rename', mapId: 'a-alice::s1', name: 'Bob Was Here', userId: 'u-bob' }, { allowLocalGM: true });
    check('rename refused', m.saved, null);
}

console.log('\ncreating an ownerless map');
{
    const m = makeManager(baseRecord());
    m._newOwnerlessRecord = (kind, scene, { name } = {}) => ({
        id: kind === 'party' ? `party::${scene.id}` : `official:o1::${scene.id}`,
        kind, officialId: kind === 'official' ? 'o1' : null, actorId: null,
        sceneId: scene.id, name: name || `${kind} map`, explored: [], symbols: [], floors: {}, sides: {}, hidden: []
    });
    m._deletedMapIds = new Set();
    game.scenes = { get: (id) => (id === 's1' ? { id: 's1', name: 'Citadel' } : null) };

    await m._processMutationRequest({ action: 'create-owned', kind: 'official', sceneId: 's1', name: 'Duke Survey', userId: 'u-alice' }, { allowLocalGM: true });
    check('a player cannot author an official map', m.saved, null);

    await m._processMutationRequest({ action: 'create-owned', kind: 'official', sceneId: 's1', name: 'Duke Survey', userId: 'u-gm' }, { allowLocalGM: true });
    check('the GM can', m.saved?.kind, 'official');
    check('with the name they gave', m.saved?.name, 'Duke Survey');
    check('and no Actor', m.saved?.actorId, null);

    const m2 = makeManager(baseRecord());
    m2._newOwnerlessRecord = m._newOwnerlessRecord;
    m2._deletedMapIds = new Set();
    await m2._processMutationRequest({ action: 'create-owned', kind: 'party', sceneId: 's1', userId: 'u-alice' }, { allowLocalGM: true });
    check('a party member can start the party map', m2.saved?.kind, 'party');

    // Only ever one to a scene: asking again must not lay a second one down.
    const m3 = makeManager(baseRecord());
    m3._newOwnerlessRecord = m._newOwnerlessRecord;
    m3._deletedMapIds = new Set();
    m3.getRecord = (id) => (id === 'party::s1' ? { id, kind: 'party' } : m3._current);
    await m3._processMutationRequest({ action: 'create-owned', kind: 'party', sceneId: 's1', userId: 'u-alice' }, { allowLocalGM: true });
    check('a second party map is refused', m3.saved, null);

    const m4 = makeManager(baseRecord());
    m4._newOwnerlessRecord = m._newOwnerlessRecord;
    m4._deletedMapIds = new Set();
    await m4._processMutationRequest({ action: 'create-owned', kind: 'player', sceneId: 's1', userId: 'u-gm' }, { allowLocalGM: true });
    check('create-owned refuses to make a player map', m4.saved, null);
}

console.log('\nsharing a player map');
{
    const m = makeManager(baseRecord());
    await m._processMutationRequest({ action: 'set-shared', mapId: 'a-alice::s1', shared: true, userId: 'u-alice' }, { allowLocalGM: true });
    check('the owner may share', m.saved?.shared, true);

    const m2 = makeManager(baseRecord({ shared: true }));
    await m2._processMutationRequest({ action: 'set-shared', mapId: 'a-alice::s1', shared: false, userId: 'u-bob' }, { allowLocalGM: true });
    check('another player may not unshare it', m2.saved, null);

    const m3 = makeManager(baseRecord({ id: 'party::s1', kind: 'party', actorId: null }));
    await m3._processMutationRequest({ action: 'set-shared', mapId: 'party::s1', shared: false, userId: 'u-gm' }, { allowLocalGM: true });
    check('a party map cannot be hidden at all', m3.saved, null);
}

console.log('\ndonating, through the real handler');
{
    const partyMap = baseRecord({
        id: 'party::s1', kind: 'party', actorId: null, explored: ['1,1'], contributors: []
    });
    const donation = baseRecord({ id: 'a-alice::s1', explored: ['1,1', '2,2'] });
    const m = makeManager(partyMap);
    m.getRecord = (id) => (id === 'party::s1' ? m._current : (id === 'a-alice::s1' ? donation : null));

    await m._processMutationRequest({ action: 'donate', mapId: 'party::s1', fromMapId: 'a-alice::s1', userId: 'u-bob' }, { allowLocalGM: true });
    check("a player cannot donate someone else's map", m.saved, null);

    await m._processMutationRequest({ action: 'donate', mapId: 'party::s1', fromMapId: 'a-alice::s1', userId: 'u-alice' }, { allowLocalGM: true });
    check('the owner can', m.saved?.explored?.length, 2);
    check('and is recorded as a contributor', m.saved?.contributors, ['a-alice']);

    // A map of somewhere else has nothing to say about this place.
    const elsewhere = baseRecord({ id: 'a-alice::s2', sceneId: 's2', explored: ['9,9'] });
    const m2 = makeManager(partyMap);
    m2.getRecord = (id) => (id === 'party::s1' ? m2._current : (id === 'a-alice::s2' ? elsewhere : null));
    await m2._processMutationRequest({ action: 'donate', mapId: 'party::s1', fromMapId: 'a-alice::s2', userId: 'u-alice' }, { allowLocalGM: true });
    check('a map of another scene is refused', m2.saved, null);

    // Donating into anything but the party map is meaningless.
    const m3 = makeManager(baseRecord());
    m3.getRecord = (id) => (id === 'a-alice::s1' ? m3._current : null);
    await m3._processMutationRequest({ action: 'donate', mapId: 'a-alice::s1', fromMapId: 'a-alice::s1', userId: 'u-alice' }, { allowLocalGM: true });
    check('cannot donate into a player map', m3.saved, null);
}

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);

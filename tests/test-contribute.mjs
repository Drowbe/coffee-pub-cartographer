// Giving to the party as you walk.
//
// The character always gets a map of what they record. Contributing adds a
// second map to the walk; it never diverts the walk into it. So this checks the
// character's record is left alone as much as it checks the party's grows.
import fs from 'node:fs';
import { mergeMapInto } from '../scripts/utils-mapping.js';

const src = fs.readFileSync('scripts/manager-mapping.js', 'utf8');
const helpers = src.slice(src.indexOf('const MAP_KINDS'), src.indexOf('/** Compact "column,row"'));
const pick = (name) => {
    const start = src.indexOf(`    ${name}(`);
    if (start < 0) throw new Error(`missing ${name}`);
    return src.slice(start, src.indexOf('\n    }\n', start) + 6);
};
const methods = ['async _contributeReveal', 'partyMapId', '_recordId'].map(pick).join('\n');
globalThis.canvas = { scene: { id: 's1' } };
const { Mgr } = eval(`(() => { ${helpers}\nreturn { Mgr: class M {\n${methods}\n} }; })()`);

let bad = 0;
const check = (label, actual, expected) => {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { console.log('  ok    ' + label); return; }
    bad++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`);
};

function harness(party) {
    const m = new Mgr();
    m.saved = [];
    m.currentMapId = null;
    m._party = party;
    m.getRecord = (id) => (id === party?.id ? m._party : null);
    m._cacheRecord = (record) => { m._party = record; m.saved.push(record); return record; };
    m.renderWindow = async () => {};
    m._persistMapRecord = async () => {};
    return m;
}
const partyMap = (over = {}) => ({
    id: 'party::s1', kind: 'party', sceneId: 's1', explored: ['1,1'], sides: {}, floors: {},
    secrets: [], hidden: [], symbols: [], contributors: [], ...over
});
const walk = (over = {}) => ({
    id: 'a-bruenor::s1', kind: 'player', actorId: 'a-bruenor', sceneId: 's1',
    explored: ['1,1', '2,1', '3,1'], sides: { '3,1': [50, 50] }, floors: {}, secrets: [],
    hidden: [], symbols: [], lastPosition: { column: 3, row: 1 }, ...over
});

console.log('what the character walks reaches the party map');
{
    const m = harness(partyMap());
    await m._contributeReveal(walk(), 'u-bruenor');
    check('the squares arrive', m._party.explored.sort(), ['1,1', '2,1', '3,1']);
    check('the walker is credited', m._party.contributors, ['a-bruenor']);
    check('the marker follows them', m._party.lastPosition, { column: 3, row: 1 });
}

console.log('\nthe character keeps their own map regardless');
{
    // The character's record was already written, separately, before this ran.
    // Contributing must not reach back into it.
    const mine = walk();
    const before = JSON.stringify(mine);
    const m = harness(partyMap());
    await m._contributeReveal(mine, 'u-bruenor');
    check('their record is untouched', JSON.stringify(mine), before);
}

console.log('\nit is the same merge the donate button makes');
{
    const target = partyMap({ floors: { '1,1': 'wood' }, sides: { '1,1': [50, 50] } });
    const m = harness(target);
    await m._contributeReveal(walk({ floors: { '1,1': 'grass' }, sides: { '1,1': [90, 10] } }), 'u-bruenor');
    check("the party's surface is not restyled", m._party.floors['1,1'], 'wood');
    check('nor its recorded side moved', m._party.sides['1,1'], [50, 50]);
}
{
    // Nothing the walker struck off their own map is struck off the party's.
    const m = harness(partyMap({ explored: ['9,9'] }));
    await m._contributeReveal(walk({ hidden: ['9,9'] }), 'u-bruenor');
    check("a square the party has survives the walker's strike-off", m._party.explored.includes('9,9'), true);
}

console.log('\nwith no party map there is nothing to give to');
{
    const m = harness(null);
    await m._contributeReveal(walk(), 'u-bruenor');
    check('nothing written, and no error', m.saved.length, 0);
}
{
    // Guards the id colliding with a record that is not the party map.
    const m = harness(partyMap({ kind: 'player' }));
    await m._contributeReveal(walk(), 'u-bruenor');
    check('a record that is not the party map is refused', m.saved.length, 0);
}

console.log('\ncontributing twice adds nothing the second time');
{
    const m = harness(partyMap());
    await m._contributeReveal(walk(), 'u-bruenor');
    const after = JSON.stringify(m._party.explored.sort());
    await m._contributeReveal(walk(), 'u-bruenor');
    check('the squares are the same', JSON.stringify(m._party.explored.sort()), after);
    check('and the walker is credited once', m._party.contributors, ['a-bruenor']);
}

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);

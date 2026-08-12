// The donation merge, from the real utils-mapping.js. Every rule here exists
// because the two maps are different people's knowledge of one place: only one
// of them is being offered, and neither may overrule the other.
import { mergeMapInto } from '../scripts/utils-mapping.js';

let bad = 0;
const check = (label, actual, expected) => {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { console.log('  ok    ' + label); return; }
    bad++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`);
};
const sorted = (list) => [...list].sort();

const party = (over = {}) => ({
    explored: ['1,1', '2,1'], sides: { '1,1': [50, 50] }, floors: { '1,1': 'wood' },
    secrets: ['sd-1'], hidden: [], symbols: [], ...over
});
const donor = (over = {}) => ({
    explored: ['2,1', '3,1'], sides: { '3,1': [10, 50] }, floors: { '3,1': 'brick' },
    secrets: ['sd-2'], hidden: [], symbols: [], ...over
});

console.log('the party map grows by what was donated');
{
    const merged = mergeMapInto(party(), donor());
    check('squares are unioned', sorted(merged.explored), ['1,1', '2,1', '3,1']);
    check('secrets are unioned', sorted(merged.secrets), ['sd-1', 'sd-2']);
    check('a surface fills where the party had none', merged.floors['3,1'], 'brick');
    check('and does not overwrite where it had one', merged.floors['1,1'], 'wood');
    check('a side is taken where the party had none', merged.sides['3,1'], [10, 50]);
}

console.log('\nwhatever the party settled first stands');
{
    const merged = mergeMapInto(
        party({ sides: { '2,1': [50, 50] } }),
        donor({ sides: { '2,1': [90, 10] } })
    );
    check('the donor does not move a recorded side', merged.sides['2,1'], [50, 50]);
    const surfaced = mergeMapInto(party({ floors: { '2,1': 'wood' } }), donor({ floors: { '2,1': 'grass' } }));
    check('nor restyle a surfaced room', surfaced.floors['2,1'], 'wood');
}

console.log("\na donor's struck-off square is not struck off for the party");
{
    // Bruenor struck 4,1 off his own map. Someone else walked it and gave it to
    // the party. His correction is about his map, not about their knowledge.
    const merged = mergeMapInto(
        party({ explored: ['1,1', '4,1'] }),
        donor({ explored: ['2,1'], hidden: ['4,1'] })
    );
    check('the square the party had survives', merged.explored.includes('4,1'), true);
    check("and the donor's strike-off is not adopted", merged.hidden, []);
}

console.log("\nbut the party's own struck-off squares still stand");
{
    const merged = mergeMapInto(
        party({ explored: ['1,1'], hidden: ['9,9'] }),
        donor({ explored: ['9,9'] })
    );
    check('a square the party struck off stays off', merged.explored.includes('9,9'), false);
    check('and stays struck off', merged.hidden, ['9,9']);
}

console.log('\nsymbols land only where the party has left the square free');
{
    const partyNote = { id: 'p1', type: 'note', column: 1, row: 1, text: 'ours', createdBy: 'u-a' };
    const donorNote = { id: 'd1', type: 'note', column: 1, row: 1, text: 'theirs', createdBy: 'u-b' };
    const donorTrap = { id: 'd2', type: 'trap', column: 3, row: 1, text: '', createdBy: 'u-b' };
    const merged = mergeMapInto(
        party({ symbols: [partyNote] }),
        donor({ symbols: [donorNote, donorTrap] })
    );
    check('the occupied square keeps what the party had', merged.symbols.filter(s => s.column === 1)[0].id, 'p1');
    check('no duplicate on that square', merged.symbols.filter(s => s.column === 1 && s.row === 1).length, 1);
    check('a free square takes the donated symbol', merged.symbols.some(s => s.id === 'd2'), true);
    check('and the donor keeps the credit', merged.symbols.find(s => s.id === 'd2').createdBy, 'u-b');
}
{
    // A symbol on a square that ends up unexplored has nothing to sit on.
    const merged = mergeMapInto(
        party({ explored: ['1,1'], hidden: ['5,5'] }),
        donor({ explored: ['5,5'], symbols: [{ id: 'd3', type: 'note', column: 5, row: 5, createdBy: 'u-b' }] })
    );
    check('no symbol on a struck-off square', merged.symbols.length, 0);
}

console.log('\ndonating twice changes nothing the second time');
{
    const first = mergeMapInto(party(), donor());
    const second = mergeMapInto({ ...party(), ...first }, donor());
    check('squares identical', sorted(second.explored), sorted(first.explored));
    check('floors identical', second.floors, first.floors);
    check('sides identical', second.sides, first.sides);
    check('symbols identical', second.symbols.length, first.symbols.length);
}

console.log('\nnothing is ever taken away');
{
    const before = party({
        explored: ['1,1', '2,1', '7,7'], floors: { '1,1': 'wood', '7,7': 'tile' },
        secrets: ['sd-1'], symbols: [{ id: 'p1', type: 'note', column: 1, row: 1 }]
    });
    const merged = mergeMapInto(before, donor({ explored: [], floors: {}, secrets: [], symbols: [] }));
    check('every square kept', sorted(merged.explored), sorted(before.explored));
    check('every surface kept', merged.floors, before.floors);
    check('every secret kept', merged.secrets, before.secrets);
    check('every symbol kept', merged.symbols.length, before.symbols.length);
}

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);

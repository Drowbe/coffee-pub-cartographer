// The real utils-mapping.js, imported directly -- it has no imports of its own
// and touches Foundry globals only inside the vision helpers, which are not used
// here. So these are the shipped functions, not stand-ins.
import { propagateFloors, contiguousFloorRegion, sameFloorRegion } from '../scripts/utils-mapping.js';

let failures = 0;
const check = (label, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

// ---------------------------------------------------------------------------
console.log('propagateFloors: a doorway blocks even on a square a curve cuts');
console.log('(the leak: skipping the whole boundary test for cut squares)');

// A is surfaced. B has just been revealed, is cut by a curve, and a door was
// recorded between the two. B must NOT take A's surface.
{
    const atlas = {
        features: { '1,0': ['door:west'] },
        barriers: new Set(['e:0,0']),
        split: new Set(['1,0'])
    };
    const explored = new Set(['0,0', '1,0']);
    const sides = { '1,0': [10, 50] }; // B's floor faces west, toward A
    const next = propagateFloors(explored, atlas, { '0,0': 'wood' }, ['1,0'], sides);
    check('cut square behind a door stays bare', next['1,0'], undefined);
    check('the surfaced square is untouched', next['0,0'], 'wood');
}

// The same, with a secret door the party has walked -- still a boundary.
{
    const atlas = {
        features: { '0,0': ['secret-door:east'] },
        barriers: new Set(['e:0,0']),
        split: new Set(['1,0'])
    };
    const next = propagateFloors(
        new Set(['0,0', '1,0']), atlas, { '0,0': 'wood' }, ['1,0'], { '1,0': [10, 50] }
    );
    check('a door recorded on the far square blocks too', next['1,0'], undefined);
}

console.log('\npropagateFloors: no regression -- a curve alone must still not block');
// The whole reason the test was skipped: the curve cutting a square IS the wall
// it lies against, so it cannot be treated as being in the way.
{
    const atlas = { features: {}, barriers: new Set(['e:0,0']), split: new Set(['1,0']) };
    const next = propagateFloors(
        new Set(['0,0', '1,0']), atlas, { '0,0': 'wood' }, ['1,0'], { '1,0': [10, 50] }
    );
    check('cut square against a curve still adopts', next['1,0'], 'wood');
}
{
    // A square that is not cut is still stopped by a curve.
    const atlas = { features: {}, barriers: new Set(['e:0,0']), split: new Set() };
    const next = propagateFloors(new Set(['0,0', '1,0']), atlas, { '0,0': 'wood' }, ['1,0'], {});
    check('whole square behind a curve stays bare', next['1,0'], undefined);
}
{
    // floorFaces still governs which room a cut square belongs to.
    const atlas = { features: {}, barriers: new Set(['e:0,0']), split: new Set(['1,0']) };
    const next = propagateFloors(
        new Set(['0,0', '1,0']), atlas, { '0,0': 'wood' }, ['1,0'], { '1,0': [90, 50] }
    );
    check('cut square facing away does not adopt', next['1,0'], undefined);
}
{
    // Open ground still spreads, which is the feature all this protects.
    const atlas = { features: {}, barriers: new Set(), split: new Set() };
    const next = propagateFloors(
        new Set(['0,0', '1,0', '2,0']), atlas, { '0,0': 'wood' }, ['1,0', '2,0'], {}
    );
    check('a run of open squares inherits along its length', [next['1,0'], next['2,0']], ['wood', 'wood']);
}

// ---------------------------------------------------------------------------
console.log('\nsameFloorRegion: clearing reaches squares a changed wall stranded');
{
    // Four squares of wood in a row. A wall now stands between 1,0 and 2,0 --
    // edited into the scene after the surface was laid.
    const floors = { '0,0': 'wood', '1,0': 'wood', '2,0': 'wood', '3,0': 'wood' };
    const explored = new Set(Object.keys(floors));
    const atlas = { features: { '1,0': ['wall:east'] }, barriers: new Set(), split: new Set() };

    const bounded = contiguousFloorRegion(explored, atlas, { column: 0, row: 0 }, {});
    check('the wall really does split the area', bounded.sort(), ['0,0', '1,0']);

    const clearing = sameFloorRegion(explored, floors, { column: 0, row: 0 });
    check('clearing still reaches all four', clearing.sort(), ['0,0', '1,0', '2,0', '3,0']);
}
{
    // A different material is where clearing stops.
    const floors = { '0,0': 'wood', '1,0': 'wood', '2,0': 'brick', '3,0': 'wood' };
    const region = sameFloorRegion(new Set(Object.keys(floors)), floors, { column: 0, row: 0 });
    check('stops at a different material', region.sort(), ['0,0', '1,0']);
}
{
    // Unexplored ground stops it, so clearing cannot reach off the map.
    const floors = { '0,0': 'wood', '1,0': 'wood', '2,0': 'wood' };
    const region = sameFloorRegion(new Set(['0,0', '1,0']), floors, { column: 0, row: 0 });
    check('stops at the edge of the explored map', region.sort(), ['0,0', '1,0']);
}
{
    // Bare paper: nothing to take away, and not an error.
    check('clearing bare paper is a no-op', sameFloorRegion(new Set(['0,0']), {}, { column: 0, row: 0 }), []);
    check('clearing an unexplored square is a no-op',
        sameFloorRegion(new Set(), { '0,0': 'wood' }, { column: 0, row: 0 }), []);
}
{
    // Diagonals are not adjacency, here as everywhere else on this map.
    const floors = { '0,0': 'wood', '1,1': 'wood' };
    const region = sameFloorRegion(new Set(Object.keys(floors)), floors, { column: 0, row: 0 });
    check('a diagonal neighbour is not reached', region, ['0,0']);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);

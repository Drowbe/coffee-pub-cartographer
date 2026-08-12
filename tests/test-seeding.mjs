// Seeding an official map from a scene's walls.
//
// The whole thing rests on one idea: flood inward from the edge of the scene,
// and whatever the open ground cannot reach is inside. These build small
// lattices by hand and check what comes back is the room and not the world.
import { sceneInteriorRegion } from '../scripts/utils-mapping.js';

let bad = 0;
const check = (label, actual, expected) => {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    if (a === e) { console.log('  ok    ' + label); return; }
    bad++; console.log(`  FAIL  ${label}\n        expected ${e}\n        got      ${a}`);
};

// An atlas whose only walls sit on the lattice, given as "feature:direction"
// codes per square -- the shape normalizeFeatures produces.
const atlasOf = (features = {}, barriers = []) => ({
    features, barriers: new Set(barriers), split: new Set(), lines: []
});

// Walls a room needs on all four sides, stated once from the inside.
function roomWalls(x0, y0, x1, y1) {
    const features = {};
    const add = (key, code) => { (features[key] ??= []).push(code); };
    for (let column = x0; column <= x1; column++) {
        add(`${column},${y0}`, 'wall:north');
        add(`${column},${y1}`, 'wall:south');
    }
    for (let row = y0; row <= y1; row++) {
        add(`${x0},${row}`, 'wall:west');
        add(`${x1},${row}`, 'wall:east');
    }
    return features;
}

console.log('a single walled room in the middle of a scene');
{
    // A 6x6 scene with a room occupying columns 2-3, rows 2-3.
    const { explored } = sceneInteriorRegion(atlasOf(roomWalls(2, 2, 3, 3)), 6, 6);
    check('exactly the room is inside', explored.sort(), ['2,2', '2,3', '3,2', '3,3']);
}

console.log('\nthe open ground around it is not mapped');
{
    const { explored } = sceneInteriorRegion(atlasOf(roomWalls(2, 2, 3, 3)), 6, 6);
    check('a corner of the scene is left out', explored.includes('0,0'), false);
    check('and so is the square just outside the wall', explored.includes('1,2'), false);
    check('nothing outside crept in', explored.length, 4);
}

console.log('\na door seals the flood as a wall does');
{
    // Same room, but its west wall is a door rather than stone. The dungeon is
    // still inside: a door is shut until somebody opens it.
    const features = roomWalls(2, 2, 3, 3);
    features['2,2'] = features['2,2'].map(code => (code === 'wall:west' ? 'door:west' : code));
    const { explored } = sceneInteriorRegion(atlasOf(features), 6, 6);
    check('the room is still inside', explored.sort(), ['2,2', '2,3', '3,2', '3,3']);
}

console.log('\na room with a gap in its wall is open ground, and honestly so');
{
    // The wall simply is not there. Nothing seals the room, so nothing about it
    // is inside -- which is the correct answer, not a failure: an unenclosed
    // scene has no interior to map.
    const features = roomWalls(2, 2, 3, 3);
    features['2,2'] = features['2,2'].filter(code => code !== 'wall:west');
    features['2,3'] = features['2,3'].filter(code => code !== 'wall:west');
    const { explored } = sceneInteriorRegion(atlasOf(features), 6, 6);
    check('nothing is mapped', explored, []);
}

console.log('\ntwo rooms joined by a corridor');
{
    // Rooms at 1-2 and 5-6 on row 2, with a corridor along row 2 between them.
    const features = {};
    const add = (key, code) => { (features[key] ??= []).push(code); };
    for (let column = 1; column <= 6; column++) {
        add(`${column},2`, 'wall:north');
        add(`${column},2`, 'wall:south');
    }
    add('1,2', 'wall:west');
    add('6,2', 'wall:east');
    const { explored } = sceneInteriorRegion(atlasOf(features), 8, 5);
    check('the whole run is inside', explored.sort(), ['1,2', '2,2', '3,2', '4,2', '5,2', '6,2']);
}

console.log('\nthe sides recorded are the ones the renderer expects');
{
    const { explored, sides } = sceneInteriorRegion(atlasOf(roomWalls(2, 2, 3, 3)), 6, 6);
    check('every mapped square has a side', explored.every(key => Array.isArray(sides[key])), true);
    check('a square whose middle is floor says so', sides['2,2'], [50, 50]);
}

console.log('\na scene with no walls at all');
{
    const { explored } = sceneInteriorRegion(atlasOf({}), 6, 6);
    check('has no interior', explored, []);
}

console.log('\ndegenerate scenes do not throw');
{
    check('no columns', sceneInteriorRegion(atlasOf({}), 0, 5).explored, []);
    check('no rows', sceneInteriorRegion(atlasOf({}), 5, 0).explored, []);
    check('no atlas', sceneInteriorRegion(null, 4, 4).explored, []);
}

console.log('\na scene of any size finishes quickly');
{
    const started = Date.now();
    const { explored } = sceneInteriorRegion(atlasOf(roomWalls(20, 20, 60, 40)), 120, 90);
    const took = Date.now() - started;
    check('the big room is mapped', explored.length, 41 * 21);
    if (took > 500) { bad++; console.log(`  FAIL  took ${took}ms for 120x90`); }
    else console.log(`  ok    120x90 scene in ${took}ms`);
}

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);

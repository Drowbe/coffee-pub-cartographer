// Exercises the real _buildFloorLayers from window-mapping.js, lifted out of the
// class so it can run without Foundry. Not a copy: the source text is sliced
// straight out of the file, so a change there changes what this tests.
import fs from 'node:fs';

const src = fs.readFileSync('scripts/window-mapping.js', 'utf8');
const start = src.indexOf('    _buildFloorLayers(');
const end = src.indexOf('    /** A clip polygon as CSS', start);
if (start < 0 || end < 0) throw new Error('could not locate _buildFloorLayers');
const body = src.slice(start, end);

const MODULE = { ID: 'coffee-pub-cartographer' };
const MAPPING_FLOOR_TYPES = [
    { type: 'default' }, { type: 'shade-light' }, { type: 'shade-medium' },
    { type: 'shade-dark' }, { type: 'brick' }, { type: 'cobblestone' },
    { type: 'dirt' }, { type: 'grass' }, { type: 'rock' }, { type: 'tile' }, { type: 'wood' }
];
const Harness = eval(`(class Harness { ${body} })`);

let failures = 0;
const check = (label, actual, expected) => {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

// A 10x10 grid at origin 0,0. Wood: a 3-run in row 2, a single in row 3, and a
// wall-cut square at 5,5 keeping its top half. Brick: one square, elsewhere.
const floors = {
    '2,2': 'wood', '3,2': 'wood', '4,2': 'wood',
    '2,3': 'wood',
    '5,5': 'wood',
    '7,7': 'brick'
};
const explored = new Set([...Object.keys(floors), '9,9']);
const clips = new Map([['5,5', [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }
]]]);

const harness = new Harness();
harness.manager = { state: { floors } };
const layers = harness._buildFloorLayers(
    explored, { originColumn: 0, originRow: 0, columnCount: 10, rowCount: 10 }, clips
);

console.log('layer count and order (catalogue order, brick before wood)');
check('types', layers.map(layer => layer.type), ['brick', 'wood']);
check('one layer per surface, not per square', layers.length, 2);

console.log('run merging');
const wood = layers.find(layer => layer.type === 'wood');
check('4 wood squares -> 2 rects', wood.rects.length, 2);
check('row 2 run of three', wood.rects[0], { x: 0.2, y: 0.2, width: 0.3, height: 0.1 });
check('row 3 single', wood.rects[1], { x: 0.2, y: 0.3, width: 0.1, height: 0.1 });

console.log('wall-cut square becomes a polygon, not a rect');
check('polygon count', wood.polygons.length, 1);
check('cut square in grid fractions', wood.polygons[0], '0.5,0.5 0.6,0.5 0.6,0.55 0.5,0.55');
check('cut square is not also a rect', wood.rects.some(r => r.x === 0.5 && r.y === 0.5), false);

console.log('phasing and ids');
check('clip id', wood.clipId, 'coffee-pub-cartographer-floor-wood');
check('pattern phased by grid origin', [wood.patternX, wood.patternY], [0, 0]);

console.log('a non-zero origin offsets everything');
const shifted = new Harness();
shifted.manager = { state: { floors: { '12,8': 'tile' } } };
const shiftedLayers = shifted._buildFloorLayers(
    new Set(['12,8']), { originColumn: 10, originRow: 5, columnCount: 8, rowCount: 4 }, new Map()
);
check('rect relative to origin', shiftedLayers[0].rects[0], { x: 0.25, y: 0.75, width: 0.125, height: 0.25 });
check('phase carries the origin', [shiftedLayers[0].patternX, shiftedLayers[0].patternY], [10, 5]);

console.log('a run must not jump a gap');
const gapped = new Harness();
gapped.manager = { state: { floors: { '1,1': 'rock', '2,1': 'rock', '4,1': 'rock' } } };
const gappedLayers = gapped._buildFloorLayers(
    new Set(['1,1', '2,1', '4,1']), { originColumn: 0, originRow: 0, columnCount: 10, rowCount: 10 }, new Map()
);
check('gap splits the run', gappedLayers[0].rects.map(r => [r.x, r.width]), [[0.1, 0.2], [0.4, 0.1]]);

console.log('a surface on an unexplored square is not drawn');
const stale = new Harness();
stale.manager = { state: { floors: { '1,1': 'grass', '50,50': 'grass' } } };
const staleLayers = stale._buildFloorLayers(
    new Set(['1,1']), { originColumn: 0, originRow: 0, columnCount: 10, rowCount: 10 }, new Map()
);
check('only the explored square', staleLayers[0].rects.length, 1);

console.log('no surfaces at all means no layers');
const bare = new Harness();
bare.manager = { state: { floors: {} } };
check('empty', bare._buildFloorLayers(new Set(['1,1']), { originColumn: 0, originRow: 0, columnCount: 4, rowCount: 4 }, new Map()), []);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);

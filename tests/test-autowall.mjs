// Drives the real utils-autowall.js on pictures painted in code: a wall the
// colour of stone on a floor the colour of wood, with grain over both. What it
// settles is the geometry -- where the centreline lands, that a junction stays a
// junction, that a wall stops where its material does, that a flood which leaks
// says so. It says nothing about how a real painted map behaves; that is tried
// on the map.
import { mapWall, mapOpening, floodMask, simplify, snapSegments, labBuffer, mergeStraight, findOpening, cleanupEnds, splitSegmentAt } from '../scripts/utils-autowall.js';

let failures = 0;
const check = (label, ok, detail = '') => {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};

// Deterministic grain, so a run is the same run every time.
let seed = 7;
const grain = amount => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return ((seed / 0x7fffffff) - 0.5) * amount; };

const STONE = [150, 140, 120];
const WOOD = [110, 80, 50];

/** A picture with rectangles of stone on wood. Each rect is [x0, y0, x1, y1]. */
function paint(width, height, rects, { floor = WOOD, stone = STONE, noise = 6 } = {}) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const on = rects.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);
            const base = on ? stone : floor;
            const i = (y * width + x) * 4;
            const n = grain(noise);
            data[i] = base[0] + n; data[i + 1] = base[1] + n; data[i + 2] = base[2] + n; data[i + 3] = 255;
        }
    }
    return { data, width, height };
}

const near = (point, x, y, within = 4) => Math.hypot(point[0] - x, point[1] - y) <= within;
const endpoints = segments => {
    const counts = new Map();
    for (const [a, b] of segments) {
        for (const p of [a, b]) {
            const key = `${Math.round(p[0])},${Math.round(p[1])}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
    }
    return counts;
};
const covers = (segments, x, y, within = 4) => segments.some(([a, b]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / lengthSq)) : 0;
    return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy)) <= within;
});

// ------------------------------------------------------------------
console.log('a straight wall, 10px thick, with grain');
{
    const picture = paint(200, 100, [[20, 40, 180, 50]]);
    const result = mapWall(picture, 100, 45, { tolerance: 20, stepTolerance: 6, lightnessWeight: 0.5 });
    check('it is not capped', !result.capped);
    check('the mask is the wall and only the wall', result.count > 1500 && result.count <= 1600, `count ${result.count}`);
    check('one segment', result.segments.length === 1, `got ${result.segments.length}`);
    const [a, b] = result.segments[0] ?? [[0, 0], [0, 0]];
    const [left, right] = a[0] < b[0] ? [a, b] : [b, a];
    check('it runs down the middle of the wall', Math.abs(left[1] - 44.5) <= 1.5 && Math.abs(right[1] - 44.5) <= 1.5, `y ${left[1]}, ${right[1]}`);
    check('it spans the wall to within its half-thickness', left[0] <= 26 && right[0] >= 174, `x ${left[0]} to ${right[0]}`);
}

// ------------------------------------------------------------------
console.log('\na T: two walls meeting');
{
    const picture = paint(200, 160, [[20, 40, 180, 50], [95, 50, 105, 130]]);
    const result = mapWall(picture, 40, 45, { tolerance: 20, stepTolerance: 6, lightnessWeight: 0.5 });
    check('the stem is mapped from a click on the bar', covers(result.segments, 100, 110), 'nothing near the foot of the stem');
    check('and the bar', covers(result.segments, 40, 44.5) && covers(result.segments, 160, 44.5));
    const counts = endpoints(result.segments);
    const junctions = [...counts.values()].filter(c => c >= 3).length;
    check('the three arms meet at one place', junctions === 1, `points with 3+ segments: ${junctions}`);
}

// ------------------------------------------------------------------
console.log('\na wall stops where its material does');
{
    // Stone, then a stretch of a different material (a gate), then stone again.
    const GATE = [70, 90, 140];
    const picture = paint(300, 80, [[20, 35, 120, 45], [180, 35, 280, 45]]);
    for (let y = 35; y < 45; y++) {
        for (let x = 120; x < 180; x++) {
            const i = (y * 300 + x) * 4;
            picture.data[i] = GATE[0]; picture.data[i + 1] = GATE[1]; picture.data[i + 2] = GATE[2];
        }
    }
    const result = mapWall(picture, 60, 40, { tolerance: 20, stepTolerance: 6, lightnessWeight: 0.5 });
    check('the near side is mapped', covers(result.segments, 60, 39.5));
    check('the far side is not', !covers(result.segments, 230, 39.5, 8), 'the mapping crossed the gate');
}

// ------------------------------------------------------------------
console.log('\na flood that leaks says so instead of tracing the map');
{
    // A wall and a floor that are the same colour: nothing separates them.
    const picture = paint(120, 120, [[20, 50, 100, 60]], { floor: STONE });
    const result = mapWall(picture, 60, 55, { tolerance: 20, stepTolerance: 6, lightnessWeight: 0.5, maxPixels: 3000 });
    check('capped is set', result.capped);
    const reach = floodMask(picture, 60, 55, { tolerance: 20, stepTolerance: 6, maxRadius: 10 });
    check('maxRadius holds it within the radius', reach.capped && reach.count < 450, `count ${reach.count}`);
}

// ------------------------------------------------------------------
console.log('\na flood into a room is refused, a wall is not');
{
    // A wall joined to a room of the same stone: the flood fills both.
    const picture = paint(160, 140, [[20, 20, 140, 30], [20, 30, 140, 130]], { noise: 3 });
    const room = mapWall(picture, 60, 25, { tolerance: 20, stepTolerance: 6, lightnessWeight: 0.5, maxThickness: 24 });
    check('it says the mask is too thick', room.tooThick === true);
    check('and draws nothing', room.segments.length === 0);
    const wall = paint(160, 60, [[10, 25, 150, 35]]);
    const ok = mapWall(wall, 80, 30, { tolerance: 20, stepTolerance: 6, lightnessWeight: 0.5, maxThickness: 24 });
    check('a wall within the limit is mapped', !ok.tooThick && ok.segments.length === 1);
}

// ------------------------------------------------------------------
console.log('\nmore than one click maps a wall that changes material');
{
    const GATE = [70, 90, 140];
    const picture = paint(300, 80, [[20, 35, 120, 45], [180, 35, 280, 45]]);
    for (let y = 35; y < 45; y++) {
        for (let x = 120; x < 180; x++) {
            const i = (y * 300 + x) * 4;
            picture.data[i] = GATE[0]; picture.data[i + 1] = GATE[1]; picture.data[i + 2] = GATE[2];
        }
    }
    const result = mapWall(picture, 60, 40, { tolerance: 20, stepTolerance: 6, lightnessWeight: 0.5, extraSeeds: [[150, 40], [230, 40]] });
    check('one centreline runs through all three parts', covers(result.segments, 40, 39.5) && covers(result.segments, 150, 39.5) && covers(result.segments, 260, 39.5));
    check('and it is one segment', result.segments.length === 1, `got ${result.segments.length}`);
    check('bounds are the box around the wall, inside the image',
        result.bounds.x >= 0 && result.bounds.y >= 0 && result.bounds.x + result.bounds.width <= 300 && result.bounds.height < 40,
        JSON.stringify(result.bounds));
}

// ------------------------------------------------------------------
console.log('\na chipped wall is a plain line, not a string of points');
{
    // 14px thick, with both edges ragged by a few pixels along the whole run,
    // and a lump of stone on one side -- the shape a painted wall has.
    const width = 400;
    const height = 80;
    const picture = paint(width, height, [], { noise: 4 });
    for (let x = 20; x < 380; x++) {
        const top = 33 + Math.round(grain(5));
        const bottom = 47 + Math.round(grain(5));
        const lump = x >= 200 && x < 215 ? 7 : 0;
        for (let y = top - lump; y < bottom; y++) {
            const i = (y * width + x) * 4;
            picture.data[i] = STONE[0]; picture.data[i + 1] = STONE[1]; picture.data[i + 2] = STONE[2];
        }
    }
    const rough = { tolerance: 20, stepTolerance: 6, lightnessWeight: 0.5, epsilon: 1.5 };
    const plain = mapWall(picture, 100, 40, { ...rough, pruneLength: 30 });
    check('it is not capped or refused', !plain.capped && !plain.tooThick);
    check('one segment, however ragged, once stubs are pruned', plain.segments.length === 1, `got ${plain.segments.length}`);
    const [a, b] = plain.segments[0] ?? [[0, 0], [0, 0]];
    check('and it runs the length of the wall, to within a thickness of each end, down its middle',
        Math.min(a[0], b[0]) <= 40 && Math.max(a[0], b[0]) >= 360 && Math.abs(a[1] - 40) <= 2 && Math.abs(b[1] - 40) <= 2, JSON.stringify(plain.segments));
    const stubby = mapWall(picture, 100, 40, rough);
    check('a short stub off the wall is kept when pruning is not asked for', stubby.segments.length === 2, `got ${stubby.segments.length}`);
}

// ------------------------------------------------------------------
console.log('\na door: the line down its length');
{
    const DOOR = [120, 70, 40];
    const paintDoor = (picture, cx, cy, length, thick, degrees) => {
        const a = degrees * Math.PI / 180;
        const ux = Math.cos(a), uy = Math.sin(a);
        for (let y = 0; y < picture.height; y++) {
            for (let x = 0; x < picture.width; x++) {
                const along = (x - cx) * ux + (y - cy) * uy;
                const across = -(x - cx) * uy + (y - cy) * ux;
                if (Math.abs(along) <= length / 2 && Math.abs(across) <= thick / 2) {
                    const i = (y * picture.width + x) * 4;
                    picture.data[i] = DOOR[0]; picture.data[i + 1] = DOOR[1]; picture.data[i + 2] = DOOR[2];
                }
            }
        }
    };
    const opts = { tolerance: 20, stepTolerance: 6, lightnessWeight: 0.5 };

    // A door in a gap of the wall, level.
    const level = paint(200, 80, [[10, 35, 70, 45], [130, 35, 190, 45]]);
    paintDoor(level, 100, 40, 60, 10, 0);
    const flat = mapOpening(level, 100, 40, opts);
    check('it runs the length of the door', Math.abs(flat.length - 61) <= 3, `length ${flat.length}`);
    const [a, b] = flat.segment[0][0] < flat.segment[1][0] ? flat.segment : [flat.segment[1], flat.segment[0]];
    check('from one end to the other', near(a, 70, 40, 2.5) && near(b, 130, 40, 2.5), JSON.stringify(flat.segment));
    check('and is as thick as the door', Math.abs(flat.thickness - 10) <= 2, `thickness ${flat.thickness}`);

    // The same at a slant: the axis follows the door, not the picture.
    const slant = paint(200, 200, []);
    paintDoor(slant, 100, 100, 80, 10, 30);
    const tilted = mapOpening(slant, 100, 100, opts);
    const dx = tilted.segment[1][0] - tilted.segment[0][0];
    const dy = tilted.segment[1][1] - tilted.segment[0][1];
    const degrees = Math.abs(Math.atan2(dy, dx) * 180 / Math.PI);
    check('a slanted door is found at its own angle', Math.abs(degrees - 30) <= 2 || Math.abs(degrees - 150) <= 2, `angle ${degrees}`);
    check('and at its own length', Math.abs(tilted.length - 81) <= 4, `length ${tilted.length}`);

    // Nothing there.
    const none = mapOpening(level, -5, -5, opts);
    check('a click outside the picture finds nothing', none.segment === null && none.count === 0);
}

// ------------------------------------------------------------------
console.log('\na door is the gap between two wall ends that face each other');
{
    const grid = 100;
    // A wall with a gap at x 300..400, and the wall that carries on.
    const walls = [[0, 100, 300, 100], [400, 100, 700, 100]];
    const gap = findOpening(walls, [350, 108], { grid });
    check('the click between them finds the gap', JSON.stringify(gap) === JSON.stringify([[300, 100], [400, 100]]), JSON.stringify(gap));
    check('a click far from the gap finds nothing', findOpening(walls, [350, 400], { grid }) === null);
    check('a click on the wall, not the gap, finds nothing', findOpening(walls, [150, 100], { grid }) === null);

    // The wall's own two ends are never a pair, however the click lies.
    check('one wall alone has no gap', findOpening([[0, 100, 300, 100]], [150, 100], { grid }) === null);

    // Walls that run along the gap rather than away from it do not face.
    check('ends of walls that run along the line do not face', findOpening([[300, 100, 300, 400], [400, 100, 400, 400]], [350, 100], { grid }) !== null,
        'perpendicular walls either side of a gap do face (a doorway in a corridor)');

    // The gap that is too wide to be a door is not one.
    check('too wide to be a door', findOpening([[0, 100, 100, 100], [700, 100, 800, 100]], [400, 100], { grid }) === null);

    // Free ends beat a nearer pair with a wall meeting at one end.
    const crowded = [[0, 100, 300, 100], [400, 100, 700, 100], [400, 100, 400, 300]];
    const chosen = findOpening(crowded, [350, 100], { grid });
    check('with a wall also meeting there, a gap is still found', chosen !== null);

    // A gap that has a door in it is not a gap any more.
    const filled = findOpening([[0, 100, 300, 100], [400, 100, 700, 100], [300, 100, 400, 100]], [350, 100], { grid });
    check('a gap with a door already in it is not offered again', filled === null, JSON.stringify(filled));

    // A slanted gap.
    const slant = findOpening([[0, 0, 100, 100], [200, 200, 300, 300]], [150, 150], { grid });
    check('a gap on a diagonal', JSON.stringify(slant) === JSON.stringify([[100, 100], [200, 200]]), JSON.stringify(slant));
}

// ------------------------------------------------------------------
console.log('\njoining wall ends');
{
    const close = cleanupEnds([
        { id: 'a', c: [0, 0, 100, 0] },
        { id: 'b', c: [103, 2, 103, 100] }
    ], 10);
    check('ends within the distance are brought to one point', close.updates.length === 2 && close.joined === 2, JSON.stringify(close));
    const [a, b] = close.updates;
    check('which both walls share', a.c[2] === b.c[0] && a.c[3] === b.c[1], JSON.stringify(close.updates));

    const apart = cleanupEnds([{ id: 'a', c: [0, 0, 100, 0] }, { id: 'b', c: [150, 0, 250, 0] }], 10);
    check('ends further apart are left alone', apart.updates.length === 0 && apart.joined === 0);

    const tiny = cleanupEnds([{ id: 'a', c: [0, 0, 4, 0] }, { id: 'b', c: [50, 50, 90, 50] }], 10);
    check('a wall that would shrink to a point is not touched', tiny.skipped === 1 && tiny.updates.every(u => u.id !== 'a'), JSON.stringify(tiny));

    // Ends at 100, 108 and 116: the first and last are 16 apart, but each is near the one between.
    const chain = cleanupEnds([{ id: 'a', c: [0, 0, 100, 0] }, { id: 'b', c: [108, 0, 108, 50] }, { id: 'c', c: [116, 0, 116, 50] }], 10);
    const byId = Object.fromEntries(chain.updates.map(u => [u.id, u.c]));
    check('a chain of near ends is one group', byId.a?.[2] === 108 && byId.c?.[0] === 108 && byId.a?.[3] === 0 && byId.c?.[1] === 0, JSON.stringify(chain.updates));

    const again = cleanupEnds(close.updates.map(u => ({ id: u.id, c: u.c })), 10);
    check('doing it twice changes nothing more', again.updates.length === 0);
}

// ------------------------------------------------------------------
console.log('\nputting a point in a wall');
{
    const segments = [[[0, 0], [100, 0]], [[100, 0], [100, 100]]];
    const split = splitSegmentAt(segments, [40, 3], 8);
    check('the wall nearest the click is cut in two there', split && split.segments.length === 3, JSON.stringify(split));
    check('at the foot of the click on the wall', JSON.stringify(split.at) === JSON.stringify([40, 0]), JSON.stringify(split?.at));
    check('the pieces meet at the new point', JSON.stringify(split.segments[0][1]) === JSON.stringify(split.segments[1][0]));
    check('the other walls are as they were', JSON.stringify(split.segments[2]) === JSON.stringify(segments[1]));
    check('a click out of reach does nothing', splitSegmentAt(segments, [40, 60], 8) === null);
    check('a click at an end does nothing, a point is already there', splitSegmentAt(segments, [1, 1], 8) === null);
}

// ------------------------------------------------------------------
console.log('\nlight across a wall is not an edge, a hard edge is');
{
    // A wall that darkens steadily along its length, as a shadow falls across.
    const picture = paint(200, 60, [[10, 25, 190, 35]], { noise: 0 });
    for (let y = 25; y < 35; y++) {
        for (let x = 10; x < 190; x++) {
            const shade = 1 - (x - 10) / 180 * 0.25;
            const i = (y * 200 + x) * 4;
            picture.data[i] = STONE[0] * shade; picture.data[i + 1] = STONE[1] * shade; picture.data[i + 2] = STONE[2] * shade;
        }
    }
    const result = mapWall(picture, 20, 30, { tolerance: 25, stepTolerance: 3, lightnessWeight: 0.5 });
    check('the gradient is followed to the far end', covers(result.segments, 180, 29.5, 6), 'stopped partway along');
}

// ------------------------------------------------------------------
console.log('\nsimplify and snap');
{
    const wobble = Array.from({ length: 50 }, (_, i) => [i * 2, (i % 2) * 1.5]);
    check('a wobble within epsilon collapses to one segment', simplify(wobble, 3).length === 2);
    const corner = [[0, 0], [50, 0], [50, 50]];
    check('a real corner survives', simplify(corner, 3).length === 3);

    const snapped = snapSegments([[[1, 1], [99, 3]]], { grid: 100, snapDistance: 10 });
    check('ends within snapDistance go to the grid', near(snapped[0][0], 0, 0, 0.5) && near(snapped[0][1], 100, 0, 3.5), JSON.stringify(snapped));

    const shared = snapSegments([[[0, 0], [101, 2]], [[101, 2], [99, 100]]], { grid: 100, snapDistance: 10 });
    check('segments that met still meet', shared[0][1][0] === shared[1][0][0] && shared[0][1][1] === shared[1][0][1]);

    const line = mergeStraight([[[0, 0], [50, 1]], [[50, 1], [100, 0]]]);
    check('two segments meeting on a straight line are one', line.length === 1 && line[0][0][0] === 0 && line[0][1][0] === 100, JSON.stringify(line));
    const bend = mergeStraight([[[0, 0], [50, 0]], [[50, 0], [100, 50]]]);
    check('a real corner keeps its point', bend.length === 2);
    const tee = mergeStraight([[[0, 0], [50, 0]], [[50, 0], [100, 0]], [[50, 0], [50, 40]]]);
    check('a third wall arriving keeps the point', tee.length === 3);

    const slight = snapSegments([[[0, 0], [100, 4]]], { angleSnap: 5 });
    check('a few degrees off horizontal is made horizontal',
        Math.abs(slight[0][0][1] - slight[0][1][1]) < 1e-6, JSON.stringify(slight));
    const diagonal = snapSegments([[[0, 0], [100, 60]]], { angleSnap: 5 });
    check('a real angle is left alone', Math.abs(diagonal[0][1][1] - diagonal[0][0][1] - 60) < 1e-6);
}

// ------------------------------------------------------------------
console.log('\nedges of the image');
{
    const picture = paint(100, 40, [[0, 15, 100, 25]]);
    const result = mapWall(picture, 50, 20, { tolerance: 20, stepTolerance: 6, lightnessWeight: 0.5 });
    check('a wall that runs off both sides is mapped to the edge', covers(result.segments, 2, 19.5, 5) && covers(result.segments, 97, 19.5, 5));
    const outside = floodMask(picture, -5, 400, { lab: labBuffer(picture) });
    check('a click outside the image maps nothing', outside.count === 0);
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);

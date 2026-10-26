// Drives the real utils-autowall.js on pictures painted in code: a wall the
// colour of stone on a floor the colour of wood, with grain over both. What it
// settles is the geometry -- where the centreline lands, that a junction stays a
// junction, that a wall stops where its material does, that a flood which leaks
// says so. It says nothing about how a real painted map behaves; that is tried
// on the map.
import { mapWall, mapOpening, floodMask, simplify, snapSegments, labBuffer, mergeStraight, findOpening, cleanupEnds, splitSegmentAt, mergeStraightAt, mergeWalls, openingOnWall, splitWallAt, countNearEnds, planJoinedMove, snapNewWall, sketchToSegments } from '../scripts/utils-autowall.js';

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
console.log('\njoined walls that run straight become one wall');
{
    const pair = [[[0, 0], [100, 0]], [[100, 0], [200, 2]]];
    const one = mergeStraightAt(pair, [100, 0]);
    check('two segments meeting on a straight line are made one', one && one.length === 1 && one[0][0][0] === 0 && one[0][1][0] === 200, JSON.stringify(one));
    check('a corner is not merged', mergeStraightAt([[[0, 0], [100, 0]], [[100, 0], [100, 100]]], [100, 0]) === null);
    check('a third wall there makes a junction, which stays',
        mergeStraightAt([[[0, 0], [100, 0]], [[100, 0], [200, 0]], [[100, 0], [100, 80]]], [100, 0]) === null);
    check('a point put in a wall elsewhere is left alone',
        mergeStraightAt([[[0, 0], [50, 0]], [[50, 0], [100, 0]], [[100, 0], [150, 0]]], [100, 0]).length === 2);

    const plain = 'normal';
    const run = mergeWalls([
        { id: 'a', c: [0, 0, 100, 0], key: plain },
        { id: 'b', c: [100, 0, 200, 1], key: plain },
        { id: 'c', c: [200, 1, 300, 0], key: plain }
    ]);
    check('a run of three plain walls is one', run.walls.length === 1 && run.merged === 2 && run.removed.length === 2, JSON.stringify(run));
    check('from one end to the other', run.walls[0].c[0] === 0 && run.walls[0].c[2] === 300, JSON.stringify(run.walls));

    const door = mergeWalls([
        { id: 'a', c: [0, 0, 100, 0], key: plain },
        { id: 'd', c: [100, 0, 160, 0], key: null },
        { id: 'b', c: [160, 0, 300, 0], key: plain }
    ]);
    check('a door in a wall keeps the wall in two and is itself kept', door.walls.length === 3 && door.merged === 0, JSON.stringify(door));

    const unlike = mergeWalls([{ id: 'a', c: [0, 0, 100, 0], key: 'normal' }, { id: 'b', c: [100, 0, 200, 0], key: 'invisible' }]);
    check('walls that differ are not merged', unlike.walls.length === 2);

    const corner = mergeWalls([{ id: 'a', c: [0, 0, 100, 0], key: plain }, { id: 'b', c: [100, 0, 100, 100], key: plain }]);
    check('a corner is not merged', corner.walls.length === 2);

    const tee = mergeWalls([
        { id: 'a', c: [0, 0, 100, 0], key: plain }, { id: 'b', c: [100, 0, 200, 0], key: plain }, { id: 'c', c: [100, 0, 100, 90], key: plain }
    ]);
    check('a wall meeting the line there stops the merge', tee.walls.length === 3);

    const doorBeside = mergeWalls([
        { id: 'a', c: [0, 0, 100, 0], key: plain }, { id: 'b', c: [100, 0, 200, 0], key: plain }, { id: 'd', c: [100, 0, 100, 60], key: null }
    ]);
    check('a door meeting there counts as a wall meeting', doorBeside.walls.length === 3);
}

// ------------------------------------------------------------------
console.log('\na door on a wall that runs straight through it');
{
    const grid = 100;
    const walls = [[0, 100, 1000, 100]];
    const onWall = openingOnWall(walls, [400, 104], null, { grid });
    check('a click on a wall puts a door there, a square wide', onWall && onWall.wall === 0
        && JSON.stringify(onWall.segment) === JSON.stringify([[350, 100], [450, 100]]), JSON.stringify(onWall));

    const sized = openingOnWall(walls, [400, 104], [[330, 101], [470, 99]], { grid });
    check('the length the picture found is used when it runs along the wall', JSON.stringify(sized.segment) === JSON.stringify([[330, 100], [470, 100]]), JSON.stringify(sized));

    const across = openingOnWall(walls, [400, 104], [[400, 40], [400, 160]], { grid });
    check('a picture that runs across the wall is ignored', JSON.stringify(across.segment) === JSON.stringify([[350, 100], [450, 100]]), JSON.stringify(across));

    check('a click off the wall finds nothing', openingOnWall(walls, [400, 300], null, { grid }) === null);
    check('a click at the end of a wall is a gap, not a cut', openingOnWall(walls, [1005, 100], null, { grid }) === null);
    check('a click near an end is too near to cut', openingOnWall(walls, [10, 100], null, { grid }) === null);

    const near = openingOnWall([[0, 0, 1000, 0], [0, 40, 1000, 40]], [500, 30], null, { grid });
    check('the nearer of two walls', near.wall === 1, JSON.stringify(near));

    const cut = splitWallAt([0, 100, 1000, 100], [[350, 100], [450, 100]]);
    check('cut from the middle, a wall is two', cut && cut.pieces.length === 2
        && JSON.stringify(cut.pieces[0]) === JSON.stringify([0, 100, 350, 100]) && JSON.stringify(cut.pieces[1]) === JSON.stringify([450, 100, 1000, 100]), JSON.stringify(cut));
    const fromEnd = splitWallAt([0, 100, 1000, 100], [[0, 100], [120, 100]]);
    check('cut from an end, a wall is shortened', fromEnd && fromEnd.pieces.length === 1 && JSON.stringify(fromEnd.pieces[0]) === JSON.stringify([120, 100, 1000, 100]), JSON.stringify(fromEnd));
    const backwards = splitWallAt([0, 100, 1000, 100], [[450, 100], [350, 100]]);
    check('whichever way the opening is drawn', backwards && backwards.pieces.length === 2 && backwards.pieces[0][2] === 350);
    check('an opening that is the whole wall leaves nothing to cut', splitWallAt([0, 100, 200, 100], [[0, 100], [200, 100]]) === null);
    check('an opening off the wall is not a cut', splitWallAt([0, 100, 1000, 100], [[350, 140], [450, 140]]) === null);
    check('an opening that runs past the end is not a cut', splitWallAt([0, 100, 1000, 100], [[950, 100], [1100, 100]]) === null);
    const slanted = splitWallAt([0, 0, 1000, 1000], [[300, 300], [500, 500]]);
    check('on a slanted wall', slanted && slanted.pieces.length === 2 && slanted.pieces[0][2] === 300 && slanted.pieces[1][0] === 500, JSON.stringify(slanted));
}

// ------------------------------------------------------------------
console.log('\na curved wall is not made straight');
{
    // A ring of walls, the way a hand-drawn curve is: many short walls, each turning a few degrees.
    const ring = (steps, radius) => Array.from({ length: steps }, (_, i) => {
        const a = (i / steps) * 2 * Math.PI;
        const b = ((i + 1) / steps) * 2 * Math.PI;
        return { id: `r${i}`, c: [Math.round(5000 + radius * Math.cos(a)), Math.round(5000 + radius * Math.sin(a)), Math.round(5000 + radius * Math.cos(b)), Math.round(5000 + radius * Math.sin(b))], key: 'normal' };
    });
    // Five degrees at a joint is within the angle for straight, and the old merge ate it joint by joint.
    const coarse = mergeWalls(ring(72, 1000), 8, 3);
    check('a ring turning five degrees a wall keeps its walls', coarse.walls.length >= 70, `${coarse.walls.length} of 72`);
    const same = mergeWalls(ring(72, 1000), 8);
    check('and with no check on the curve a third of the ring was all that was left', same.walls.length < 40, `${same.walls.length} of 72`);

    // Finer than that, merging is allowed so long as the curve stays within the tolerance of itself.
    const fine = mergeWalls(ring(360, 1000), 8, 3);
    check('a very fine ring may be simplified, but is still a ring', fine.walls.length > 40 && fine.walls.length < 360, `${fine.walls.length} of 360`);
    const pointsOnCircle = fine.walls.every(w => Math.abs(Math.hypot(w.c[0] - 5000, w.c[1] - 5000) - 1000) < 2 && Math.abs(Math.hypot(w.c[2] - 5000, w.c[3] - 5000) - 1000) < 2);
    check('every end of it is still on the circle', pointsOnCircle);

    // A straight run with a little jitter is still one wall.
    const jitter = mergeWalls([
        { id: 'a', c: [0, 0, 100, 1], key: 'normal' }, { id: 'b', c: [100, 1, 200, -1], key: 'normal' }, { id: 'c', c: [200, -1, 300, 0], key: 'normal' }
    ], 8, 3);
    check('a straight run with jitter is still made one', jitter.walls.length === 1 && jitter.merged === 2, JSON.stringify(jitter));

    // In the tracer's own output too.
    const bent = mergeStraight([[[0, 0], [100, 0]], [[100, 0], [200, 9]]], 12, 3);
    check('a bend the tracer found is kept when it is more than the tolerance', bent.length === 2, JSON.stringify(bent));
    check('and merged when it is within it', mergeStraight([[[0, 0], [100, 0]], [[100, 0], [200, 4]]], 12, 3).length === 1);
}

// ------------------------------------------------------------------
console.log('\nwall ends that nearly meet');
{
    const walls = [{ c: [0, 0, 100, 0] }, { c: [128, 0, 300, 0] }, { c: [100, 60, 400, 400] }];
    check('ends beyond the join distance but within a square are counted', countNearEnds(walls, 25, 100) === 3, `${countNearEnds(walls, 25, 100)}`);
    check('and none once the join distance reaches them', countNearEnds(walls, 70, 100) === 0);
    check('ends of the same wall are not pairs', countNearEnds([{ c: [0, 0, 40, 0] }], 10, 100) === 0);
}

// ------------------------------------------------------------------
console.log('\nmoving a joint moves the walls on each side of it');
{
    const chain = [{ id: 'a', c: [0, 0, 100, 0] }, { id: 'b', c: [100, 0, 200, 0] }];
    const plan = planJoinedMove(chain, 'a', [0, 0, 100, 0], [0, 0, 100, 50]);
    check('the end moved is the wall the GM moved', JSON.stringify(plan.c) === JSON.stringify([0, 0, 100, 50]), JSON.stringify(plan));
    check('and the wall that met it there follows', plan.updates.length === 1 && plan.updates[0]._id === 'b' && JSON.stringify(plan.updates[0].c) === JSON.stringify([100, 50, 200, 0]), JSON.stringify(plan.updates));

    const fromStart = planJoinedMove(chain, 'b', [100, 0, 200, 0], [100, -40, 200, 0]);
    check('whichever wall of the two is the one moved', fromStart.updates.length === 1 && JSON.stringify(fromStart.updates[0].c) === JSON.stringify([0, 0, 100, -40]), JSON.stringify(fromStart));

    const star = [{ id: 'a', c: [0, 0, 100, 0] }, { id: 'b', c: [100, 0, 200, 0] }, { id: 'c', c: [100, 0, 100, 150] }];
    const three = planJoinedMove(star, 'a', [0, 0, 100, 0], [0, 0, 120, 30]);
    check('every wall at the joint follows, not only two', three.updates.length === 2 && three.updates.every(u => u.c.includes(120) && u.c.includes(30)), JSON.stringify(three.updates));

    check('a wall moved by both ends is carried, and nothing follows', planJoinedMove(chain, 'a', [0, 0, 100, 0], [10, 10, 110, 10]) === null);
    check('a wall not moved is not a move', planJoinedMove(chain, 'a', [0, 0, 100, 0], [0, 0, 100, 0]) === null);
    check('a wall with no neighbour at that end moves alone', planJoinedMove([{ id: 'a', c: [0, 0, 100, 0] }], 'a', [0, 0, 100, 0], [0, 0, 100, 40]).updates.length === 0);

    // The picture in the request: two walls end to end, then joined.
    const apart = [{ id: 'a', c: [0, 0, 100, 0] }, { id: 'b', c: [130, 0, 300, 0] }];
    const snap = planJoinedMove(apart, 'a', [0, 0, 100, 0], [0, 0, 112, 0], { reach: 40 });
    check('an end let go near another end joins it', snap.snapped && JSON.stringify(snap.c) === JSON.stringify([0, 0, 130, 0]), JSON.stringify(snap));
    check('and what is joined is left where it was', snap.updates.length === 0);
    const far = planJoinedMove(apart, 'a', [0, 0, 100, 0], [0, 0, 104, 0], { reach: 10 });
    check('an end let go further off than the reach is left where it was let go', !far.snapped && far.c[2] === 104, JSON.stringify(far));
    const held = planJoinedMove(apart, 'a', [0, 0, 100, 0], [0, 0, 112, 0], { reach: 0 });
    check('with no reach (Shift held) it is not joined', !held.snapped && held.c[2] === 112);

    // Joined, then moved: both follow.
    const joined = [{ id: 'a', c: [0, 0, 130, 0] }, { id: 'b', c: [130, 0, 300, 0] }];
    const lift = planJoinedMove(joined, 'b', [130, 0, 300, 0], [130, -90, 300, 0]);
    check('once joined, moving the middle moves both sides of it', JSON.stringify(lift.c) === JSON.stringify([130, -90, 300, 0]) && JSON.stringify(lift.updates[0].c) === JSON.stringify([0, 0, 130, -90]), JSON.stringify(lift));

    // A joint dropped on a third wall's end joins that too, and takes the walls with it.
    const three_ = [{ id: 'a', c: [0, 0, 100, 0] }, { id: 'b', c: [100, 0, 200, 0] }, { id: 'c', c: [140, 60, 300, 300] }];
    const onto = planJoinedMove(three_, 'a', [0, 0, 100, 0], [0, 0, 130, 50], { reach: 25 });
    check('a joint let go near another wall end is that end, with its walls', onto.snapped && JSON.stringify(onto.c) === JSON.stringify([0, 0, 140, 60]) && JSON.stringify(onto.updates[0].c) === JSON.stringify([140, 60, 200, 0]), JSON.stringify(onto));

    // It cannot be folded back on itself.
    const fold = planJoinedMove([{ id: 'a', c: [0, 0, 100, 0] }, { id: 'z', c: [0, 0, 0, 80] }], 'a', [0, 0, 100, 0], [0, 0, 6, 0], { reach: 40 });
    check('an end is not joined to the far end of its own wall, which would fold it flat', !fold.snapped, JSON.stringify(fold));

    // A wall carried onto its own far end is gone.
    const gone = planJoinedMove([{ id: 'a', c: [0, 0, 100, 0] }, { id: 'b', c: [100, 0, 150, 0] }], 'a', [0, 0, 100, 0], [0, 0, 150, 0]);
    check('a wall that is carried onto its own other end is removed', JSON.stringify(gone.deletes) === JSON.stringify(['b']) && gone.updates.length === 0, JSON.stringify(gone));
}

// ------------------------------------------------------------------
console.log('\ndrawing a wall next to others');
{
    const walls = [{ id: 'a', c: [0, 0, 100, 0] }];
    check('a new wall started near the end of another starts at that end', JSON.stringify(snapNewWall(walls, [112, 8, 300, 200], 30)) === JSON.stringify([100, 0, 300, 200]));
    check('and one that ends near it ends there', JSON.stringify(snapNewWall(walls, [300, 200, 96, -6], 30)) === JSON.stringify([300, 200, 100, 0]));
    check('both ends can join', JSON.stringify(snapNewWall([{ id: 'a', c: [0, 0, 100, 0] }, { id: 'b', c: [300, 0, 400, 0] }], [104, 3, 296, -2], 30)) === JSON.stringify([100, 0, 300, 0]));
    check('further off than the reach, it is left where it is', JSON.stringify(snapNewWall(walls, [160, 0, 300, 200], 30)) === JSON.stringify([160, 0, 300, 200]));
    check('with no reach, nothing joins', JSON.stringify(snapNewWall(walls, [102, 0, 300, 200], 0)) === JSON.stringify([102, 0, 300, 200]));
    check('a short wall is not folded flat onto one end', snapNewWall(walls, [96, 4, 104, 4], 30).join() !== '100,0,100,0');
}

// ------------------------------------------------------------------
console.log('\na line drawn freehand becomes walls');
{
    let seed = 5;
    const jitter = amount => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return ((seed / 0x7fffffff) - 0.5) * amount; };
    const straight = Array.from({ length: 60 }, (_, i) => [i * 10, 100 + jitter(4)]);
    const one = sketchToSegments(straight, { epsilon: 6 });
    check('a shaky straight line is one wall', one.length === 1 && Math.abs(one[0][0][0]) <= 1 && Math.abs(one[0][1][0] - 590) <= 1, JSON.stringify(one));

    const elbow = [...Array.from({ length: 30 }, (_, i) => [i * 10, 0 + jitter(3)]), ...Array.from({ length: 30 }, (_, i) => [290 + jitter(3), i * 10])];
    const two = sketchToSegments(elbow, { epsilon: 6 });
    check('a line with a corner is two walls, meeting at the corner', two.length === 2 && Math.abs(two[0][1][0] - 290) <= 8 && Math.abs(two[0][1][1]) <= 8, JSON.stringify(two));
    check('and the walls follow one another', JSON.stringify(two[0][1]) === JSON.stringify(two[1][0]));

    const circle = Array.from({ length: 80 }, (_, i) => [Math.round(500 + 300 * Math.cos(i / 80 * 2 * Math.PI + 0.1)), Math.round(500 + 300 * Math.sin(i / 80 * 2 * Math.PI + 0.1))]);
    const open = sketchToSegments([...circle, [circle[0][0] + 12, circle[0][1] + 9]], { epsilon: 12 });
    const ring = sketchToSegments([...circle, [circle[0][0] + 12, circle[0][1] + 9]], { epsilon: 12, closeDistance: 40 });
    check('a loop that ends beside where it began is closed when asked', JSON.stringify(ring[0][0]) === JSON.stringify(ring[ring.length - 1][1]), JSON.stringify([ring[0][0], ring[ring.length - 1][1]]));
    check('and left open when not', JSON.stringify(open[0][0]) !== JSON.stringify(open[open.length - 1][1]));
    check('a curve is several walls, not one, with every point of it still near the line', ring.length >= 6 && ring.length <= 40, `${ring.length}`);

    check('a point, or nothing, is not a wall', sketchToSegments([[5, 5]]).length === 0 && sketchToSegments([]).length === 0);
    check('a line that goes nowhere is not a wall', sketchToSegments([[5, 5], [5, 5], [5, 5]]).length === 0);
    check('the walls are in whole pixels', sketchToSegments([[0.4, 0.4], [100.6, 0.4]]).flat(2).every(Number.isInteger));
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

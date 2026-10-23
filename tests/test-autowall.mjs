// Drives the real utils-autowall.js on pictures painted in code: a wall the
// colour of stone on a floor the colour of wood, with grain over both. What it
// settles is the geometry -- where the centreline lands, that a junction stays a
// junction, that a wall stops where its material does, that a flood which leaks
// says so. It says nothing about how a real painted map behaves; that is tried
// on the map.
import { mapWall, floodMask, simplify, snapSegments, labBuffer } from '../scripts/utils-autowall.js';

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

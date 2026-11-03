// A route drawn as a curve: it goes through every waypoint (a road crosses its
// points), keeps its ends, never strays far from the straight legs it joins, and
// each stretch of it knows which leg's terrain it takes.
import { curveThrough } from '../scripts/utils-routes.js';

let failures = 0;
const fail = message => { failures++; console.log(`  FAIL  ${message}`); };
const ok = message => console.log(`  ok    ${message}`);
const near = (a, b, tolerance = 1e-6) => Math.abs(a - b) < tolerance;
const has = (points, [x, y]) => points.some(p => near(p[0], x) && near(p[1], y));

// A zigzag with a sharp turn, like a road down a valley and back up.
const waypoints = [[0, 0], [200, 60], [260, 400], [300, 80], [520, 20]];
const curve = curveThrough(waypoints);

if (waypoints.every(point => has(curve.points, point))) ok('the line crosses every waypoint');
else fail('the line misses a waypoint');

const first = curve.points[0];
const last = curve.points.at(-1);
if (near(first[0], 0) && near(first[1], 0) && near(last[0], 520) && near(last[1], 20)) ok('both ends are where they were');
else fail(`ends moved: ${JSON.stringify([first, last])}`);

// Distance from a point to the nearest straight leg: a spline wanders, but not far.
const toLegs = ([x, y]) => Math.min(...waypoints.slice(1).map(([bx, by], i) => {
    const [ax, ay] = waypoints[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}));
const strayed = Math.max(...curve.points.map(toLegs));
if (strayed < 80) ok(`it stays close to the legs (at most ${Math.round(strayed)} px away)`);
else fail(`it strayed ${Math.round(strayed)} px from the legs`);

if (curve.points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) ok('every point is a number');
else fail('a point is not finite');

// Legs: pieces between waypoint 1 and 2 are leg 1, and the order never goes back.
const index = point => curve.points.findIndex(p => near(p[0], point[0]) && near(p[1], point[1]));
const [a, b] = [index(waypoints[1]), index(waypoints[2])];
const between = curve.legs.slice(a, b);
if (between.length > 0 && between.every(leg => leg === 1)) ok('each stretch is on the leg it came from');
else fail(`legs between the waypoints: ${JSON.stringify(between)}`);
if (curve.legs.every((leg, i) => i === 0 || leg >= curve.legs[i - 1])) ok('legs run in order');
else fail('legs went backwards');
if (curve.legs.length === curve.points.length) ok('one leg per point');
else fail('legs and points differ in length');

// A straight run stays straight.
const straight = curveThrough([[0, 0], [100, 0], [250, 0]]);
if (straight.points.every(([, y]) => near(y, 0, 1e-6))) ok('a straight run stays straight');
else fail('a straight run bent');

// A single leg is a straight line between its two ends.
const single = curveThrough([[0, 0], [100, 100]]);
const offLine = Math.max(...single.points.map(([x, y]) => Math.abs(x - y)));
if (offLine < 1e-6 && has(single.points, [100, 100])) ok('a single leg is straight');
else fail('a single leg bent');

if (curveThrough([]).points.length === 0 && curveThrough(null).points.length === 0) ok('nothing in, nothing out');
else fail('empty input produced points');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);

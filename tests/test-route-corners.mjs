// Rounding a route's corners for drawing: the ends stay put, a corner becomes a
// curve that starts and ends inside its legs, a short leg is never overrun, and
// each stretch of the curve knows which leg's terrain it takes.
import { roundCorners } from '../scripts/utils-routes.js';

let failures = 0;
const fail = message => { failures++; console.log(`  FAIL  ${message}`); };
const ok = message => console.log(`  ok    ${message}`);
const near = (a, b) => Math.abs(a - b) < 1e-6;

// An L: 200 right, then 200 down.
const bend = roundCorners([[0, 0], [200, 0], [200, 200]], 50);
const first = bend.points[0];
const last = bend.points.at(-1);
if (first[0] === 0 && first[1] === 0 && last[0] === 200 && last[1] === 200) ok('both ends stay where they were');
else fail(`ends moved: ${JSON.stringify([first, last])}`);

if (bend.points.every(([x, y]) => x <= 200 + 1e-6 && y >= -1e-6)) ok('the curve stays inside the corner');
else fail('a point went outside the corner');

const corner = bend.points.some(([x, y]) => near(x, 200) && near(y, 0));
if (!corner) ok('the sharp point itself is gone');
else fail('the waypoint is still a point on the line');

const start = bend.points.find(([x]) => near(x, 150));
const end = bend.points.find(([x, y]) => near(x, 200) && near(y, 50));
if (start && end) ok('the curve starts 50 before the waypoint and ends 50 after it');
else fail('the curve does not start and end the radius from the waypoint');

if (bend.legs.length === bend.points.length && bend.legs[0] === 0 && bend.legs.at(-2) === 1) ok('each stretch is on the leg it came from');
else fail(`legs: ${JSON.stringify(bend.legs)}`);

// A short leg limits the curve to half of it, so the next corner is not reached.
const tight = roundCorners([[0, 0], [100, 0], [100, 20], [200, 20]], 50);
// The 20-long leg is shared: each corner may take half of it, and no more.
const onLeg = tight.points.filter(([x, y]) => near(x, 100) && y > 1e-6 && y < 20 - 1e-6);
if (onLeg.length === 2 && onLeg.every(([, y]) => near(y, 10))) ok('a short leg is shared, each corner taking half');
else fail(`the short leg was overrun: ${JSON.stringify(onLeg)}`);

// No corner, no change.
const straight = roundCorners([[0, 0], [100, 0], [200, 0]], 50);
if (straight.points.length === 3) ok('a straight run is left alone');
else fail(`straight run became ${straight.points.length} points`);
const two = roundCorners([[0, 0], [100, 100]], 50);
if (two.points.length === 2 && two.legs.length === 2) ok('a single leg is left alone');
else fail('a single leg changed');
if (roundCorners([], 50).points.length === 0 && roundCorners(null, 50).points.length === 0) ok('nothing in, nothing out');
else fail('empty input produced points');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);

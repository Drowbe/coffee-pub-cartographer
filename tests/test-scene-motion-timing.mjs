// The shared clock and the group rules behind scene motion: parallax layers,
// spinning and scrolling tiles, and collections. Both files are imported as
// they ship -- neither touches Foundry at module scope.
//
// The clock is what every client computes positions from, so a mistake here
// is a jump or a drift on every screen at once: these check that position is
// continuous through an ease, that its rate is the eased speed, and that a
// change made partway through an ease carries on without a jump.
import {
    easeProgress, motionSpeed, motionTravel, rebaseMotion, angleVector, wrap
} from '../scripts/utils-motion.js';
import {
    NONE_GROUP, normalizeActive, shownByGroups, toggledActive, sameActive
} from '../scripts/utils-groups.js';
import {
    pixelsToDistance, formatDistance, formatSpan, toSceneUnits, unitChoices, gridStep,
    REAL_WORLD_PACES, rulesPaces, paceToSceneUnits, paceUnit, sceneUnitsToPace,
    paceInputToSceneUnits, unitsPerHourToPixels, pixelsToUnitsPerHour
} from '../scripts/utils-travel.js';
import {
    convertDistance, legPixels, routePixels, gridDistance, pointAlong, cleanPoints,
    distancePixels, nearestWaypoint, nearestOnRoute, legTerrains, travelHours, insertWaypoint,
    removeWaypoint, snapTo, chainRoutes, pathLegs, totalEffort, distanceForEffort, effortForDistance,
    legIndexAt, travelEffort, defaultPathTravel, travelPlan, timelineEffort, timelineWith,
    TIME_RATES, timeRateIndex
} from '../scripts/utils-routes.js';

let bad = 0;
const fail = (m) => { bad++; console.log('  FAIL  ' + m); };
const ok = (m) => console.log('  ok    ' + m);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

console.log('the eased travel is continuous and its rate is the eased speed');
{
    const motion = { playing: true, masterSpeed: 3, easeSeconds: 2, anchorAt: 0, rampFrom: 0 };
    let worst = 0;
    for (let t = 1; t < 5000; t += 10) {
        const rate = (motionTravel(motion, t + 0.01) - motionTravel(motion, t - 0.01)) / 0.00002;
        worst = Math.max(worst, Math.abs(rate - motionSpeed(motion, t)));
    }
    if (worst > 1e-4) fail(`travel rate strays from the eased speed by ${worst}`);
    else ok(`rate matches speed within ${worst.toExponential(1)}`);
    if (!near(motionTravel(motion, 2000 - 1e-6), motionTravel(motion, 2000 + 1e-6), 1e-5)) fail('travel jumps at the end of the ease');
    else ok('no jump where the ease ends');
}

console.log('\na change partway through an ease carries on from where it is');
{
    const before = { playing: true, masterSpeed: 3, easeSeconds: 2, anchorAt: 0, rampFrom: 0 };
    const at = 1000;
    const after = { ...rebaseMotion(before, at), masterSpeed: -2 };
    if (!near(after.rampFrom, motionSpeed(before, at))) fail('rebased speed is not the speed in effect');
    else ok(`speed carries over: ${after.rampFrom.toFixed(3)}`);
    if (!near(motionTravel(after, at), 0)) fail('a rebased motion does not start from zero travel');
    else ok('travel restarts at zero from the new anchor');
}

console.log('\nstopping eases to zero and holds');
{
    const stopped = { playing: false, masterSpeed: 3, easeSeconds: 2, anchorAt: 0, rampFrom: 3 };
    if (motionSpeed(stopped, 2500) !== 0) fail('a stopped motion is still moving after its ease');
    else ok('speed is zero once eased out');
    if (!near(motionTravel(stopped, 9000), motionTravel(stopped, 3000))) fail('a stopped motion still travels');
    else ok('no travel once stopped');
}

console.log('\nsmall helpers');
{
    if (easeProgress(-1) !== 0 || easeProgress(2) !== 1 || !near(easeProgress(0.5), 0.5)) fail('easeProgress is not clamped smoothstep');
    else ok('easeProgress clamps and is symmetric');
    const v = angleVector(90);
    if (!near(v.x, 0) || !near(v.y, 1)) fail('angle 90 is not straight down');
    else ok('90 degrees is down, as the canvas has it');
    if (wrap(-1, 10) !== 9 || wrap(25, 10) !== 5 || wrap(3, 0) !== 0) fail('wrap does not fold into [0, size)');
    else ok('wrap folds negatives and handles a zero size');
}

console.log('\ngroups add together');
{
    const groups = [
        { id: 'base', items: ['sky', 'hills'], off: [] },
        { id: 'snow', items: ['snow', 'hills'], off: ['hills'] },
        { id: 'night', items: ['dark'], off: [] }
    ];
    const shown = active => ['sky', 'hills', 'snow', 'dark']
        .filter(id => shownByGroups(id, groups, active, g => g.items, g => g.off)).join(',');
    const cases = [
        [null, 'sky,hills,snow,dark', 'All shows everything'],
        [[], '', 'None shows nothing'],
        [['base'], 'sky,hills', 'one group shows its members'],
        [['snow'], 'snow', 'an item off in its only group is hidden'],
        [['base', 'snow'], 'sky,hills,snow', 'an item off in one group still shows if another group on shows it'],
        [['base', 'snow', 'night'], 'sky,hills,snow,dark', 'three groups add together']
    ];
    for (const [active, want, what] of cases) {
        const got = shown(active);
        if (got !== want) fail(`${what}: got "${got}", want "${want}"`);
        else ok(what);
    }
}

console.log('\nturning groups on and off');
{
    if (JSON.stringify(toggledActive(null, 'a')) !== '["a"]') fail('turning a group on from All does not show just it');
    else ok('from All, turning one on shows just that group');
    if (JSON.stringify(toggledActive(['a', 'b'], 'a')) !== '["b"]') fail('turning a group off does not remove it');
    else ok('turning one off removes it');
    if (JSON.stringify(toggledActive(['a'], 'a')) !== '[]') fail('turning the last group off is not None');
    else ok('turning the last one off leaves None');
}

console.log('\nreading what is on from a save');
{
    const groups = [{ id: 'a' }, { id: 'b' }];
    const cases = [
        [normalizeActive(undefined, 'a', groups), '["a"]', 'an older single-group save becomes that group on'],
        [normalizeActive(undefined, NONE_GROUP, groups), '[]', 'an older None stays None'],
        [normalizeActive(undefined, null, groups), 'null', 'an older All stays All'],
        [normalizeActive(['gone'], undefined, groups), 'null', 'every group on deleted falls back to All'],
        [normalizeActive([], undefined, groups), '[]', 'None is kept as None'],
        [normalizeActive(['a', 'a', 'gone'], undefined, groups), '["a"]', 'duplicates and unknown ids are dropped']
    ];
    for (const [got, want, what] of cases) {
        if (JSON.stringify(got) !== want) fail(`${what}: got ${JSON.stringify(got)}`);
        else ok(what);
    }
    if (!sameActive(['a', 'b'], ['b', 'a']) || sameActive(null, []) || !sameActive(null, null)) fail('sameActive is order-sensitive or confuses All with None');
    else ok('sameActive ignores order and tells All from None');
}

console.log('\ntravel distances');
{
    const grid = { size: 140, distance: 5, units: 'ft' };
    if (pixelsToDistance(140, grid) !== 5 || pixelsToDistance(70, grid) !== 2.5) fail('pixels do not convert on the grid');
    else ok('one grid square of pixels is one square of distance');
    if (pixelsToDistance(140, { size: 0 }) !== 0) fail('a scene with no grid does not read as zero');
    else ok('no grid, no distance');
    const cases = [
        [formatDistance(4000, 'ft'), '4,000 ft', 'under a mile stays in feet'],
        [formatDistance(5280 * 2.5, 'ft'), '2.5 mi', 'a mile or more reads in miles'],
        [formatDistance(1500, 'm'), '1.5 km', 'metres roll over into kilometres'],
        [formatDistance(12, 'hexes'), '12 hexes', 'an unknown unit is shown as it is']
    ];
    for (const [got, want, what] of cases) {
        if (got !== want) fail(`${what}: got "${got}"`);
        else ok(what);
    }
    if (toSceneUnits(40, 'mi', 'ft') !== 211200 || toSceneUnits(300, 'ft', 'ft') !== 300) fail('a destination is not converted to scene units');
    else ok('a destination in miles is stored in the scene\'s feet');
    const spans = [[formatSpan(90), '01 m'], [formatSpan(5 * 3600 + 20 * 60), '5 h 20 m'], [formatSpan(2 * 86400 + 4 * 3600 + 59), '2 d 04 h'], [formatSpan(3600), '1 h 00 m'], [formatSpan(5 * 3600 + 7 * 60), '5 h 07 m']];
    if (spans.some(([got, want]) => got !== want)) fail(`spans read wrongly: ${spans.map(([g]) => g).join(' | ')}`);
    else ok('an ETA reads as its two largest units');
    if (JSON.stringify(unitChoices('m')) !== '["m","km"]' || JSON.stringify(unitChoices('hexes')) !== '["hexes"]') fail('unit choices are wrong');
    else ok('units offered are the scene\'s and its longer one');
}

console.log('\npaces');
{
    const close = (a, b) => Math.abs(a - b) < 1e-9;
    const grid = { size: 140, distance: 5, units: 'ft' };
    // 3 mph is 15,840 ft an hour, 4.4 ft a second, 123.2 px a second on this grid.
    const px = unitsPerHourToPixels(paceToSceneUnits(3, 'ft'), grid);
    if (!close(px, 123.2)) fail(`3 mph on a 140 px, 5 ft grid is ${px} px/s, not 123.2`);
    else ok('3 mph on a 140 px, 5 ft grid is 123.2 px/s');
    if (!close(pixelsToUnitsPerHour(px, grid), 15840)) fail('a speed does not convert back to its pace');
    else ok('and 123.2 px/s reads back as 3 mph');
    const metric = paceInputToSceneUnits(5, 'm');
    if (paceUnit('m') !== 'km/h' || !close(metric, 5000) || !close(sceneUnitsToPace(metric, 'm'), 5)) fail('a metric scene does not take its pace in km/h');
    else ok('a metric scene takes and shows its pace in km/h');
    if (paceUnit('ft') !== 'mph' || !close(sceneUnitsToPace(5280 * 4, 'yd'), 12)) fail('imperial paces are wrong');
    else ok('an imperial scene shows its pace in mph');
    if (paceToSceneUnits(3, 'hexes') !== null || paceInputToSceneUnits(3, 'squares') !== null) fail('a grid in hexes has a pace');
    else ok('a grid in hexes or squares has no pace');
    const config = { DND5E: { travelPace: {
        slow: { label: 'DND5E.TravelPaceSlow', standard: 18, multiplier: 2 / 3 },
        normal: { label: 'DND5E.TravelPaceNormal', standard: 24, multiplier: 1 },
        fast: { label: 'DND5E.TravelPaceFast', standard: 30, multiplier: 4 / 3 }
    } } };
    const rules = rulesPaces('dnd5e', config);
    const mph = rules?.slice(0, 3).map(p => Math.round(p.mph * 1e9) / 1e9).join(',');
    if (mph !== '2,3,4' || rules[0].id !== 'dnd5e.slow' || rules[0].label !== 'DND5E.TravelPaceSlow') fail(`D&D 5e paces read as ${mph}`);
    else ok('D&D 5e\'s paces are 2, 3 and 4 mph, as its rules give them');
    const byId = id => rules?.find(p => p.id === `dnd5e.${id}`);
    if (byId('ridingHorse')?.mph !== 6 || byId('ridingHorse')?.group !== 'mount' || byId('galley')?.group !== 'water' || byId('airship')?.mph !== 8) fail('D&D 5e mounts and vehicles are missing or wrong');
    else ok('D&D 5e also lists the SRD mounts (a riding horse at 6 mph) and vehicles');
    if (rulesPaces('pf2e', config) !== null || rulesPaces('dnd5e', {}) !== null) fail('a system without paces has some');
    else ok('a system without paces falls back to real-world ones');
    if (REAL_WORLD_PACES.some(p => !(p.mph > 0)) || new Set(REAL_WORLD_PACES.map(p => p.id)).size !== REAL_WORLD_PACES.length) fail('real-world paces are malformed');
    else ok(`${REAL_WORLD_PACES.length} real-world paces, each with a speed`);
}

console.log('\nroutes');
{
    const close = (a, b) => Math.abs(a - b) < 1e-9;
    // A 3-4-5 triangle's two legs, on a 100 px, 5 mi grid.
    const points = [[0, 0], [300, 0], [300, 400]];
    if (JSON.stringify(legPixels(points)) !== '[300,400]' || routePixels(points) !== 700) fail('leg lengths are wrong');
    else ok('a route is the sum of its legs');
    if (!close(routePixels([[0, 0], [300, 400]]), 500)) fail('a diagonal is not its true length');
    else ok('a diagonal leg is as long as it looks');
    if (gridDistance(700, { size: 100, distance: 5 }) !== 35 || gridDistance(700, { size: 0 }) !== 0) fail('pixels do not convert on the grid');
    else ok('700 px on a 100 px, 5 mi grid is 35 mi');
    const mid = pointAlong(points, 350);
    if (!close(mid.x, 300) || !close(mid.y, 50) || !close(mid.angle, Math.PI / 2)) fail(`350 px along lands at ${mid.x}, ${mid.y}`);
    else ok('a distance along the route lands on the right leg, heading its way');
    const end = pointAlong(points, 10000);
    const start = pointAlong(points, -5);
    if (end.x !== 300 || end.y !== 400 || start.x !== 0 || start.y !== 0) fail('positions past the ends are not clamped');
    else ok('past either end, the position stays at that end');
    if (JSON.stringify(cleanPoints([[0.4, 0.2], [100.2, 0], [101, 1], [101, 1]])) !== '[[0,0],[100,0]]') fail('a double-click leaves duplicate points');
    else ok('points a double-click lands on twice are dropped');
    if (!close(convertDistance(1, 'mi', 'ft'), 5280) || !close(convertDistance(1, 'km', 'm'), 1000) || !close(convertDistance(1609.344, 'm', 'mi'), 1)) fail('distances do not convert between units');
    else ok('a route in miles converts to an odometer in feet or metres');
    if (convertDistance(3, 'hexes', 'ft') !== null || convertDistance(3, 'days', 'days') !== 3) fail('incomparable units convert');
    else ok('units that cannot be compared do not convert; the same unit always does');
    if (distancePixels(35, { size: 100, distance: 5 }) !== 700) fail('distance does not convert back to pixels');
    else ok('35 mi on a 100 px, 5 mi grid is 700 px');
    const wp = nearestWaypoint(points, [290, 390]);
    if (wp.index !== 2 || !close(wp.distance, Math.hypot(10, 10))) fail('the nearest waypoint is wrong');
    else ok('the waypoint nearest a click is found');
    const on = nearestOnRoute(points, [310, 200]);
    if (on.index !== 1 || !close(on.point[0], 300) || !close(on.point[1], 200) || !close(on.distance, 10)) fail(`a double-click lands at ${on.point}`);
    else ok('a double-click by the line finds the leg and the point on it');
}

console.log('\nterrain');
{
    const pts = [[0, 0], [100, 0], [200, 0], [300, 0]];
    if (legTerrains(pts, ['road', 'lava']).join() !== 'road,open,open') fail('missing or unknown terrain is not filled with open ground');
    else ok('each leg has a terrain; missing or unknown ones are open ground');
    // 10 mi of road and 10 mi of forest at 2 mi an hour: 5 h and 10 h.
    if (travelHours([10, 10], ['road', 'forest'], 2) !== 15) fail('difficult terrain does not halve the pace');
    else ok('a leg through forest takes twice as long');
    if (travelHours([10], ['road'], 0) !== null) fail('no pace still gives a time');
    else ok('no pace, no time');
    const added = insertWaypoint(pts, ['road', 'forest', 'hills'], 1, [150, 0]);
    if (added.points.length !== 5 || added.terrain.join() !== 'road,forest,forest,hills') fail(`adding a waypoint gives ${added.terrain}`);
    else ok('a waypoint added to a leg splits it, both halves keeping its terrain');
    const middle = removeWaypoint(pts, ['road', 'forest', 'hills'], 2);
    const first = removeWaypoint(pts, ['road', 'forest', 'hills'], 0);
    const last = removeWaypoint(pts, ['road', 'forest', 'hills'], 3);
    if (middle.terrain.join() !== 'road,forest' || first.terrain.join() !== 'forest,hills' || last.terrain.join() !== 'road,forest'
        || middle.points.length !== 3) fail(`removing waypoints gives ${middle.terrain} / ${first.terrain} / ${last.terrain}`);
    else ok('removing a waypoint joins its two legs, keeping the terrain of the first, or drops an end leg');
}

console.log('\nsnapping and journeys');
{
    const ends = [[100, 100], [500, 500]];
    if (JSON.stringify(snapTo([108, 95], ends, 12)) !== '[100,100]' || snapTo([130, 100], ends, 12) !== null) fail('snapping is wrong');
    else ok('a point near another route\'s end snaps onto it, and only when near');
    // Keep to Phlan, then Phlan to Melvaunt drawn the other way, then a road that does not quite meet.
    const a = { id: 'a', points: [[0, 0], [100, 0]], terrain: ['road'] };
    const b = { id: 'b', points: [[100, 100], [100, 0]], terrain: ['forest'] };
    const c = { id: 'c', points: [[100, 150], [200, 150]], terrain: ['hills'] };
    const chain = chainRoutes([a, b, c], 2);
    if (JSON.stringify(chain.points) !== '[[0,0],[100,0],[100,100],[100,150],[200,150]]') fail(`the journey runs ${JSON.stringify(chain.points)}`);
    else ok('each route runs whichever way joins the one before');
    if (!chain.parts[1].reversed || chain.parts[0].reversed || chain.parts[2].reversed) fail('the directions are wrong');
    else ok('a route drawn the other way round is reversed');
    if (chain.gaps.length !== 1 || chain.gaps[0].after !== 1 || chain.gaps[0].distance !== 50) fail(`gaps: ${JSON.stringify(chain.gaps)}`);
    else ok('where two routes do not meet, the gap is found and crossed');
    if (chain.terrain.join() !== 'road,forest,open,hills') fail(`journey terrain is ${chain.terrain}`);
    else ok('each route keeps its terrain in the journey; a gap is open ground');
    const flipped = chainRoutes([{ points: [[100, 0], [0, 0]] }, b], 2);
    if (!flipped.parts[0].reversed || JSON.stringify(flipped.points) !== '[[0,0],[100,0],[100,100]]') fail('the first route is not turned to meet the second');
    else ok('the first route runs whichever way meets the second');
}

console.log('\neffort along a path');
{
    const close = (a, b) => Math.abs(a - b) < 1e-9;
    // 10 mi of road, then 10 of forest, on a 100 px, 5 mi grid.
    const legs = pathLegs([[0, 0], [200, 0], [400, 0]], ['road', 'forest'], { size: 100, distance: 5 });
    if (JSON.stringify(legs) !== '[{"distance":10,"factor":1},{"distance":10,"factor":0.5}]') fail(`legs read as ${JSON.stringify(legs)}`);
    else ok('a path\'s legs carry their length and how fast their terrain allows');
    if (totalEffort(legs) !== 30) fail('the forest does not cost double');
    else ok('20 mi with 10 of it forest is 30 mi of effort');
    const cases = [[5, 5], [10, 10], [20, 15], [30, 20], [99, 20], [-4, 0]];
    const wrong = cases.filter(([effort, distance]) => !close(distanceForEffort(legs, effort), distance));
    if (wrong.length) fail(`effort to distance is wrong at ${wrong.map(c => c[0]).join(', ')}`);
    else ok('effort turns into distance, at half rate in the forest, clamped to the ends');
    if (!close(effortForDistance(legs, 15), 20) || !close(effortForDistance(legs, 5), 5)) fail('distance to effort is wrong');
    else ok('and back again');
    if (legIndexAt(legs, 9.99) !== 0 || legIndexAt(legs, 10) !== 1 || legIndexAt(legs, 50) !== 1) fail('the leg at a distance is wrong');
    else ok('the leg at a distance is found, the last one past the end');
    const travel = { ...defaultPathTravel(), effort: 2, pace: 3600, motion: { ...defaultPathTravel().motion, playing: true, anchorAt: 1000 } };
    if (!close(travelEffort(travel, 11000), 12)) fail(`effort after 10 s at 1 unit/s is ${travelEffort(travel, 11000)}`);
    else ok('effort grows at the pace from where it was anchored');
    travel.motion.clockFactor = 60;
    if (!close(travelEffort(travel, 11000), 602)) fail('the world clock does not speed up effort');
    else ok('following the clock at x60, a real second is a minute of travel');
}

console.log('\nthe world-time timeline');
{
    const close = (a, b) => Math.abs(a - b) < 1e-9;
    // Set out at 1000 at 1 unit a second; stop at 4600 (3600 units); set out again at 8200 at 2 a second.
    let line = timelineWith([], { w: 1000, effort: 0, rate: 1 });
    line = timelineWith(line, { w: 4600, effort: 3600, rate: 0 });
    line = timelineWith(line, { w: 8200, effort: 3600, rate: 2 });
    const at = w => timelineEffort(line, w);
    if (!close(at(500), 0) || !close(at(2800), 1800) || !close(at(6000), 3600) || !close(at(9200), 5600)) fail(`timeline reads ${[500, 2800, 6000, 9200].map(at).join(', ')}`);
    else ok('where the party is goes with the world time: before setting out, travelling, stopped, and on again');
    const rewritten = timelineWith(line, { w: 2800, effort: 1800, rate: 0 });
    if (rewritten.length !== 2 || !close(timelineEffort(rewritten, 9200), 1800)) fail('a change after scrubbing back does not replace what followed');
    else ok('changing course after scrubbing back replaces what came after');
    const travel = { ...defaultPathTravel(), followClock: true, timeline: line, effort: 99 };
    if (!close(travelEffort(travel, 0, 2800), 1800)) fail('a path following the clock does not read its timeline');
    else ok('a path following the clock reads its place from the timeline, not real time');
    let long = [];
    for (let i = 0; i < 600; i++) long = timelineWith(long, { w: i, effort: i, rate: 0 });
    if (long.length !== 500 || long[0].w !== 100) fail('the timeline grows without limit');
    else ok('the timeline keeps its last 500 changes');
}

console.log('\ntime rates');
{
    const at = rate => TIME_RATES[timeRateIndex(rate)];
    const cases = [[1, 1], [60, 60], [-10, 10], [3600, 3600], [2, 1], [45, 60], [-700, 600], [0, 1]];
    const wrong = cases.filter(([rate, want]) => at(rate) !== want);
    if (wrong.length) fail(`time rates snap wrongly: ${wrong.map(c => `${c[0]} -> ${at(c[0])}`).join(', ')}`);
    else ok('a time rate finds its nearest step; one from before, run backwards, runs onward at its size');
    if (TIME_RATES.includes(0)) fail('the time rates include standing still');
    else ok('every step moves: stopping is Stop\'s job');
}

console.log('\nplanning travel days');
{
    const plan = (hours, perDay) => { const p = travelPlan(hours, perDay); return `${p.days}+${Math.round(p.rest * 10) / 10}`; };
    const cases = [[30, 8, '3+6'], [24, 8, '3+0'], [5, 8, '0+5'], [23.99999999, 8, '3+0'], [30, 6, '5+0'], [30, 0, '3+6']];
    const wrong = cases.filter(([hours, perDay, want]) => plan(hours, perDay) !== want);
    if (wrong.length) fail(`travel days are wrong for ${wrong.map(c => `${c[0]} h at ${c[1]}`).join(', ')}`);
    else ok('hours of travel split into days of the planned length, with the rest left over');
}

console.log('\nhex grids');
{
    const close = (a, b) => Math.abs(a - b) < 1e-9;
    // A pointy-top hex grid whose neighbours are 120 px apart, centre to centre,
    // in a size that is not that number -- so reading size would be wrong.
    const step = 120;
    const hex = {
        isHexagonal: true, size: 138.56, distance: 6, units: 'mi',
        getCenterPoint: ({ i, j }) => ({ x: j * step + (i % 2 ? step / 2 : 0), y: i * step * Math.sqrt(3) / 2 }),
        getAdjacentOffsets: ({ i, j }) => [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]]
            .map(([di, dj]) => ({ i: i + di, j: j + dj - (i % 2 ? 0 : (di ? 1 : 0)) }))
    };
    if (!close(gridStep(hex), step)) fail(`a hex step read as ${gridStep(hex)} px, not ${step}`);
    else ok('a hex grid\'s step is the distance between neighbouring centres');
    if (!close(gridDistance(600, hex), 30) || !close(pixelsToDistance(600, hex), 30)) fail('distance on a hex grid is wrong');
    else ok('five hexes\' width on a 6-mile hex grid is 30 miles');
    if (gridStep({ size: 140 }) !== 140) fail('a square grid\'s step is not its size');
    else ok('a square grid\'s step is its size');
}

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);

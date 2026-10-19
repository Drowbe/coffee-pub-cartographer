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
    pixelsToDistance, formatDistance, toSceneUnits, unitChoices
} from '../scripts/utils-travel.js';

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
    if (pixelsToDistance(140, grid) !== 5 || pixelsToDistance(140, grid, 60) !== 300) fail('pixels do not convert on the grid, or ignore the scale');
    else ok('one grid square of pixels is one square of distance, times the scale');
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
    if (JSON.stringify(unitChoices('m')) !== '["m","km"]' || JSON.stringify(unitChoices('hexes')) !== '["hexes"]') fail('unit choices are wrong');
    else ok('units offered are the scene\'s and its longer one');
}

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);

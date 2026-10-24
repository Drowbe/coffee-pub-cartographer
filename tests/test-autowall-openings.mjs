// Doors and windows: where an opening is fitted to the walls, and what is written
// for it. Slices the real methods out of manager-autowall.js and runs them with a
// stand-in for the canvas, so a change to them changes what this tests.
//
// It cannot say that Foundry accepts the data; the constants below are Foundry 14's
// own (common/constants.mjs), so it says that what is written is what the wall tool
// would write for the same preset.
import fs from 'node:fs';

const src = fs.readFileSync('scripts/manager-autowall.js', 'utf8');
const slice = (from, to) => {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a);
    if (a < 0 || b < 0) throw new Error(`could not locate ${from.trim().slice(0, 40)}`);
    return src.slice(a, b);
};
const fitting = slice('    /** The wall end nearest a point', '    /**\n     * The picture as the tool read it');
const writing = slice('    /** The wall data for one segment', '    async accept()');

const MODULE = { ID: 'coffee-pub-cartographer' };
const FLAG = 'autoWall';
const ATTACH_SQUARES = Number(src.match(/const ATTACH_SQUARES = ([\d.]+)/)[1]);
const CONST = {
    EDGE_SENSE_TYPES: { NONE: 0, LIMITED: 10, NORMAL: 20, PROXIMITY: 30, DISTANCE: 40 },
    WALL_DOOR_TYPES: { NONE: 0, DOOR: 1, SECRET: 2 },
    WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1, LOCKED: 2 }
};
let canvas = { scene: { grid: { size: 100 }, levels: { size: 1 } }, dimensions: { distance: 5 }, level: { id: 'lvl' } };

const Harness = eval(`(class Harness {
    constructor(ends) { this.ends = ends; }
    _wallEnds() { return this.ends; }
${fitting}
${writing}
})`);

let failures = 0;
const check = (label, ok, detail = '') => {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('an opening is fitted to the wall ends beside it');
{
    const walls = new Harness([[100, 100], [20, 100], [300, 100], [380, 100]]);
    const both = walls._attach([[108, 98], [292, 103]]);
    check('each end goes to the wall end beside it', same(both, [[100, 100], [300, 100]]), JSON.stringify(both));

    const lone = new Harness([[100, 100]])._attach([[108, 98], [292.4, 103.6]]);
    check('with one wall end near, the other end stays where the art ends, rounded', same(lone, [[100, 100], [292, 104]]), JSON.stringify(lone));

    const far = new Harness([[100, 100], [300, 100]])._attach([[260, 260], [440, 260]]);
    check('wall ends further than the reach are not taken', same(far, [[260, 260], [440, 260]]), JSON.stringify(far));
    check('the reach is a little over a grid square', ATTACH_SQUARES > 1 && ATTACH_SQUARES < 2, `${ATTACH_SQUARES}`);

    const crowd = new Harness([[100, 100]])._attach([[110, 100], [150, 100]]);
    check('two ends cannot both take one wall end: the nearer keeps it',
        same(crowd, [[100, 100], [150, 100]]), JSON.stringify(crowd));

    const none = new Harness([])._attach([[10.4, 20.6], [80.5, 20.6]]);
    check('with no walls at all it is the art, rounded', same(none, [[10, 21], [81, 21]]), JSON.stringify(none));

    const ends = new Harness([[100, 100], [300, 100]]);
    check('it counts the ends that sit on a wall end',
        ends._attachedEnds([[100, 100], [300, 100]]) === 2
        && ends._attachedEnds([[100, 100], [200, 100]]) === 1
        && ends._attachedEnds([[150, 150], [200, 100]]) === 0);
}

console.log('\nwhat is written for each');
{
    const harness = new Harness([]);
    const options = { doorState: 'closed', doorSound: '', doorAnimation: '', windowDistance: 2, windowAttenuation: true };
    const make = (mode, over = {}) => harness._wallData({ mode, options: { ...options, ...over } }, [0, 0, 100, 0], 42);

    const wall = make('wall');
    check('a wall is just its line, and the tag', same(Object.keys(wall).sort(), ['c', 'flags']), JSON.stringify(wall));
    check('the tag says which run and which kind', same(wall.flags[MODULE.ID][FLAG], { run: 42, kind: 'wall' }));

    const door = make('door');
    check('a door blocks everything and is a door', door.door === 1 && door.move === 20 && door.light === 20 && door.sight === 20 && door.sound === 20, JSON.stringify(door));
    check('it starts closed', door.ds === 0);
    check('with no sound or animation chosen it names neither', !('doorSound' in door) && !('animation' in door));
    check('open and locked are the states they say', make('door', { doorState: 'open' }).ds === 1 && make('door', { doorState: 'locked' }).ds === 2);
    check('a chosen sound is named', make('door', { doorSound: 'wood' }).doorSound === 'wood');
    check('a chosen animation is its type', same(make('door', { doorAnimation: 'slide' }).animation, { type: 'slide' }));

    const window = make('window');
    check('a window passes light and sight at close range: proximity', window.light === 30 && window.sight === 30, JSON.stringify(window));
    check('but stops movement and sound', window.move === 20 && window.sound === 20);
    check('two squares of five feet is ten', window.threshold.light === 10 && window.threshold.sight === 10, JSON.stringify(window.threshold));
    check('and it fades with distance', window.threshold.attenuation === true && make('window', { windowAttenuation: false }).threshold.attenuation === false);
    check('the see-through distance follows the scene scale',
        (() => { canvas = { ...canvas, dimensions: { distance: 10 } }; const t = make('window', { windowDistance: 3 }).threshold.light; canvas = { ...canvas, dimensions: { distance: 5 } }; return t === 30; })());
    check('a window is not a door', !('door' in window));

    check('a one-level scene leaves levels alone', !('levels' in door));
    canvas = { ...canvas, scene: { ...canvas.scene, levels: { size: 3 } } };
    check('on several levels a wall belongs to the one being looked at', same(make('wall').levels, ['lvl']));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);

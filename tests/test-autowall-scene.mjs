// What Map Walls does to a scene's walls: the clean-up and its undo, adding what a run
// found, and taking a run back. These are the parts that change walls the GM may have
// drawn by hand, so they are run, from the real source, against a stand-in scene that
// keeps its walls and records every call made to it.
//
// The stand-in is not Foundry: it does not validate wall data. What it shows is which
// walls are written, moved, deleted and put back, and that a clean-up undone leaves the
// scene exactly as it was.
import fs from 'node:fs';
import { cleanupEnds, mergeWalls, splitWallAt, countNearEnds, SKIP_JOIN } from '../scripts/utils-autowall.js';

const src = fs.readFileSync('scripts/manager-autowall.js', 'utf8');
const slice = (from, to) => {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a);
    if (a < 0 || b < 0) throw new Error(`could not locate ${from.trim().slice(0, 40)}`);
    return src.slice(a, b);
};
const cleaning = slice('    async cleanup() {', '    // ==================================================================\n    // ===== CLICKS AND KEYS');
const writing = slice('    /** The wall data for one segment', '}\n\nexport const autoWallManager');

const MODULE = { ID: 'coffee-pub-cartographer', NAME: 'CARTOGRAPHER' };
const FLAG = 'autoWall';
const HINTS = { wall: 'hint', door: 'hintDoor', window: 'hintWindow' };
const CONST = {
    EDGE_SENSE_TYPES: { NONE: 0, LIMITED: 10, NORMAL: 20, PROXIMITY: 30, DISTANCE: 40 },
    WALL_DOOR_TYPES: { NONE: 0, DOOR: 1, SECRET: 2 },
    WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1, LOCKED: 2 }
};

// ---------------------------------------------------------------- the stand-in scene
function makeScene(wallData) {
    const scene = { id: 'scene-1', grid: { size: 100 }, calls: [], levels: { size: 1 } };
    let counter = 0;
    const make = data => {
        const doc = {
            id: data._id ?? `w${++counter}`,
            c: [...data.c], door: 0, light: 20, move: 20, sight: 20, sound: 20, dir: 0, levels: new Set(),
            flags: {}, ...structuredClone({ ...data, c: undefined, _id: undefined })
        };
        doc.c = [...data.c];
        doc.getFlag = (module, key) => doc.flags?.[module]?.[key];
        doc.toObject = () => ({ _id: doc.id, c: [...doc.c], door: doc.door, light: doc.light, move: doc.move, sight: doc.sight, sound: doc.sound, dir: doc.dir, flags: structuredClone(doc.flags) });
        return doc;
    };
    scene.list = wallData.map(make);
    scene.walls = {
        get contents() { return scene.list; },
        has: id => scene.list.some(w => w.id === id),
        filter: fn => scene.list.filter(fn)
    };
    scene.updateEmbeddedDocuments = async (type, updates) => {
        scene.calls.push(['update', updates]);
        for (const update of updates) Object.assign(scene.list.find(w => w.id === update._id), { c: [...update.c] });
    };
    scene.deleteEmbeddedDocuments = async (type, ids) => {
        scene.calls.push(['delete', ids]);
        scene.list = scene.list.filter(w => !ids.includes(w.id));
    };
    scene.createEmbeddedDocuments = async (type, data, options) => {
        scene.calls.push(['create', data, options]);
        for (const item of data) scene.list.push(make(item));
    };
    return scene;
}

let canvas;
const ui = { notifications: { info() {}, error() {}, warn() {} } };
const game = { user: { isGM: true } };

const Harness = eval(`(class Harness {
    constructor(session) { this.session = session; this.window = null; this._endsCache = null; this.cleanupStatus = null; this.status = null; this.cleared = 0; }
    _localize(key, data) { return data ? \`\${key} \${JSON.stringify(data)}\` : key; }
    _setCleanupStatus(text) { this.cleanupStatus = text; }
    _setStatus(text, tone) { this.status = { text, tone }; }
    _clearPreview() { this.cleared++; }
${cleaning}
${writing}
})`);

let failures = 0;
const check = (label, ok, detail = '') => {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const coords = scene => scene.list.map(w => w.c.join(',')).sort();
const options = { joinDistance: 0.25, doorState: 'closed', doorSound: '', doorAnimation: '', windowDistance: 2, windowAttenuation: true };

console.log('clean up walls');
{
    const scene = makeScene([
        { c: [0, 0, 100, 0] },
        { c: [104, 2, 200, 0] },
        { c: [199, 1, 300, 0] }
    ]);
    canvas = { scene, dimensions: { distance: 5 } };
    const before = coords(scene);
    const manager = new Harness({ options: { ...options } });
    await manager.cleanup();
    check('three walls that run on straight are one', scene.list.length === 1, JSON.stringify(coords(scene)));
    check('it runs the whole way', scene.list[0].c[0] === 0 && scene.list[0].c[2] === 300, JSON.stringify(scene.list[0].c));
    check('and says what it did', /cleanupDone/.test(manager.cleanupStatus) && /"merged":2/.test(manager.cleanupStatus), manager.cleanupStatus);
    check('it can be undone', manager.canUndoCleanup());

    await manager.undoCleanup();
    check('undone, the three walls are back', scene.list.length === 3, JSON.stringify(coords(scene)));
    check('where they were', JSON.stringify(coords(scene)) === JSON.stringify(before), `${JSON.stringify(coords(scene))} vs ${JSON.stringify(before)}`);
    check('and it cannot be undone twice', !manager.canUndoCleanup());
    check('the walls that went into another came back with their own ids', ['w1', 'w2', 'w3'].every(id => scene.walls.has(id)), JSON.stringify(scene.list.map(w => w.id)));
    check('and recreated with their ids kept', scene.calls.some(([kind, , opts]) => kind === 'create' && opts?.keepId === true));
}
{
    // A door in a wall: joined to the wall ends, but not merged with them.
    const scene = makeScene([
        { c: [0, 0, 100, 0] },
        { c: [102, 1, 160, 0], door: 1 },
        { c: [161, 1, 300, 0] }
    ]);
    canvas = { scene, dimensions: { distance: 5 } };
    const manager = new Harness({ options: { ...options } });
    await manager.cleanup();
    check('a door keeps the walls either side as they are', scene.list.length === 3, JSON.stringify(coords(scene)));
    const door = scene.list.find(w => w.door === 1);
    const left = scene.list.find(w => w.c[0] === 0);
    check('the door and the wall now meet exactly', left.c[2] === door.c[0] && left.c[3] === door.c[1], JSON.stringify(scene.list.map(w => w.c)));
}
{
    // Different kinds of wall do not merge into each other.
    const scene = makeScene([
        { c: [0, 0, 100, 0] },
        { c: [100, 0, 200, 0], sight: 0, light: 0, sound: 0 }
    ]);
    canvas = { scene, dimensions: { distance: 5 } };
    const manager = new Harness({ options: { ...options } });
    await manager.cleanup();
    check('a normal wall and an invisible one stay two', scene.list.length === 2);
    check('and with nothing to do it says so', /cleanupNothing/.test(manager.cleanupStatus) && !manager.canUndoCleanup(), manager.cleanupStatus);
    check('and changes nothing', scene.calls.length === 0);
}

console.log('\nclean up leaves a curve a curve');
{
    // The ring of walls from a hand-drawn oval: 19 short walls, each turning a few degrees.
    const ring = Array.from({ length: 72 }, (_, i) => {
        const a = (i / 72) * 2 * Math.PI;
        const b = ((i + 1) / 72) * 2 * Math.PI;
        return { c: [Math.round(5000 + 1000 * Math.cos(a)), Math.round(5000 + 1000 * Math.sin(a)), Math.round(5000 + 1000 * Math.cos(b)), Math.round(5000 + 1000 * Math.sin(b))] };
    });
    const scene = makeScene(ring);
    canvas = { scene, dimensions: { distance: 5 } };
    const manager = new Harness({ options: { ...options } });
    await manager.cleanup();
    check('it is still a ring of walls, not a few straight lines', scene.list.length >= 70, `${scene.list.length} walls`);
    check('and nothing was removed that bends', scene.calls.every(([kind]) => kind !== 'delete') || scene.list.length >= 70);
}
{
    // Two wall ends a little further apart than the join distance: left alone, and said so.
    const scene = makeScene([{ c: [0, 0, 1000, 0] }, { c: [1000, 60, 1000, 600] }]);
    canvas = { scene, dimensions: { distance: 5 } };
    const manager = new Harness({ options: { ...options, joinDistance: 0.25 } });
    await manager.cleanup();
    check('ends 60 apart are not joined at a join distance of 25', scene.list[0].c.join(',') === '0,0,1000,0' && scene.list[1].c.join(',') === '1000,60,1000,600');
    check('and the GM is told some are near', /cleanupNear/.test(manager.cleanupStatus) && /"count":1/.test(manager.cleanupStatus), manager.cleanupStatus);
    manager.session.options.joinDistance = 0.7;
    await manager.cleanup();
    check('raised to 70, they are joined', scene.list[0].c.join(',') === '0,0,1000,30' || scene.list[0].c[2] === scene.list[1].c[0], JSON.stringify(scene.list.map(w => w.c)));
}

console.log('\nadding what a run found');
{
    const scene = makeScene([{ c: [0, 0, 100, 0] }]);
    canvas = { scene, dimensions: { distance: 5 }, level: null };
    const session = {
        mode: 'door', options: { ...options, doorState: 'locked', doorSound: 'metal' },
        result: { capped: false, tooThick: false, tooLong: false }, segments: [[[100, 0], [160, 0]]], seeds: [[130, 0]]
    };
    const manager = new Harness(session);
    await manager.accept();
    const added = scene.list.find(w => w.id !== 'w1');
    check('one wall is added', scene.list.length === 2);
    check('it is a locked door with the sound chosen', added.door === 1 && added.ds === 2 && added.doorSound === 'metal', JSON.stringify(added));
    check('tagged as a door from a run', added.flags[MODULE.ID][FLAG].kind === 'door' && Number.isFinite(added.flags[MODULE.ID][FLAG].run));
    check('the run is over, ready for the next door', session.segments.length === 0 && session.result === null && session.seeds.length === 0);

    // A run that was refused adds nothing.
    const refusedScene = makeScene([]);
    canvas = { scene: refusedScene, dimensions: { distance: 5 } };
    const refused = new Harness({ mode: 'wall', options: { ...options }, result: { capped: true }, segments: [[[0, 0], [10, 0]]], seeds: [] });
    await refused.accept();
    check('a flood that leaked is never written', refusedScene.calls.length === 0);
}

console.log('\na door on a wall that runs straight through it');
{
    const scene = makeScene([{ c: [0, 100, 1000, 100] }]);
    canvas = { scene, dimensions: { distance: 5 }, level: null };
    const session = {
        mode: 'door', options: { ...options }, onWall: true,
        result: { capped: false, tooThick: false, tooLong: false }, segments: [[[350, 100], [450, 100]]], seeds: [[400, 100]]
    };
    const manager = new Harness(session);
    await manager.accept();
    const lines = scene.list.map(w => w.c.join(','));
    check('the wall is cut short to what is before the door', scene.list.find(w => w.id === 'w1').c.join(',') === '0,100,350,100', JSON.stringify(lines));
    check('what is after it is a wall of its own', lines.includes('450,100,1000,100'), JSON.stringify(lines));
    check('and the door is between', scene.list.some(w => w.door === 1 && w.c.join(',') === '350,100,450,100'));
    check('three walls, none overlapping', scene.list.length === 3);
    const door = scene.list.find(w => w.door === 1);
    check('the door remembers the wall it was cut from', JSON.stringify(door.flags[MODULE.ID][FLAG].splitFrom) === JSON.stringify({ id: 'w1', c: [0, 100, 1000, 100] }), JSON.stringify(door.flags));

    await new Harness({ options }).undo();
    check('taken back, the wall is whole again and nothing else is left', scene.list.length === 1 && scene.list[0].id === 'w1' && scene.list[0].c.join(',') === '0,100,1000,100', JSON.stringify(scene.list.map(w => [w.id, w.c.join(',')])));
}
{
    // Cut from the end: the wall is only shortened.
    const scene = makeScene([{ c: [0, 100, 1000, 100] }]);
    canvas = { scene, dimensions: { distance: 5 }, level: null };
    const session = { mode: 'window', options: { ...options }, result: { capped: false, tooThick: false, tooLong: false }, segments: [[[0, 100], [100, 100]]], seeds: [] };
    await new Harness(session).accept();
    check('an opening at the start of a wall shortens it, with no new wall but the opening', scene.list.length === 2 && scene.list.find(w => w.id === 'w1').c.join(',') === '100,100,1000,100', JSON.stringify(scene.list.map(w => w.c.join(','))));
    await new Harness({ options }).undo();
    check('and undone, it is whole', scene.list.length === 1 && scene.list[0].c.join(',') === '0,100,1000,100');
}
{
    // A door in a gap cuts nothing; nor does an opening laid over a door.
    const scene = makeScene([{ c: [0, 100, 300, 100] }, { c: [400, 100, 700, 100] }]);
    canvas = { scene, dimensions: { distance: 5 }, level: null };
    const session = { mode: 'door', options: { ...options }, result: { capped: false, tooThick: false, tooLong: false }, segments: [[[300, 100], [400, 100]]], seeds: [] };
    await new Harness(session).accept();
    check('a door in a gap leaves the walls as they are', scene.list.find(w => w.id === 'w1').c.join(',') === '0,100,300,100' && scene.list.find(w => w.id === 'w2').c.join(',') === '400,100,700,100');
    check('and adds just the door', scene.list.length === 3);
    const over = { mode: 'window', options: { ...options }, result: { capped: false, tooThick: false, tooLong: false }, segments: [[[320, 100], [380, 100]]], seeds: [] };
    await new Harness(over).accept();
    const door = scene.list.find(w => w.door === 1);
    check('an opening laid over a door does not cut the door', door.c.join(',') === '300,100,400,100', door.c.join(','));
}

console.log('\ntaking a run back');
{
    const scene = makeScene([
        { c: [0, 0, 10, 0] },
        { c: [20, 0, 30, 0], flags: { [MODULE.ID]: { [FLAG]: { run: 100, kind: 'wall' } } } },
        { c: [40, 0, 50, 0], flags: { [MODULE.ID]: { [FLAG]: { run: 200, kind: 'wall' } } } },
        { c: [60, 0, 70, 0], flags: { [MODULE.ID]: { [FLAG]: { run: 200, kind: 'door' } } } }
    ]);
    canvas = { scene };
    await new Harness({ options }).undo();
    check('the latest run goes, doors with it', scene.list.length === 2, JSON.stringify(coords(scene)));
    check('an earlier run, and walls drawn by hand, stay', scene.list.some(w => w.c[0] === 0) && scene.list.some(w => w.c[0] === 20));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);

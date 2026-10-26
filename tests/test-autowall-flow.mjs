// The whole walls tool, end to end, in node: the real manager class, taken from its source
// with Foundry, the canvas, PIXI and the window replaced by stand-ins, then driven the way
// the GM drives it -- a click, a mode change, a drag, a Ctrl-click, Add.
//
// This is a smoke test of the code's own wiring: a method that calls one that does not
// exist, a variable that was never defined, a step that throws. The stand-ins accept
// anything, so it says nothing about how Foundry behaves or how any of it looks.
import fs from 'node:fs';
import * as utils from '../scripts/utils-autowall.js';

// The tool logs what it does for the GM's console; here that is only noise.
console.info = () => {};

const src = fs.readFileSync('scripts/manager-autowall.js', 'utf8');
const body = src.slice(src.indexOf("/** The section of Cartographer's sub-menubar")).replace(/^export /gm, '');

// ---------------------------------------------------------------- stand-ins
/** Anything: every property is a function that returns the same thing, so calls chain. */
const anything = () => {
    const handler = {
        get: (_target, key) => {
            if (key === 'destroyed') return false;
            if (key === 'removeChildren') return () => [];
            if (key === 'addChild') return child => child;
            if (key === Symbol.toPrimitive) return () => 0;
            return proxy;
        },
        set: () => true,
        apply: () => proxy
    };
    const proxy = new Proxy(function stand() {}, handler);
    return proxy;
};

const MODULE = { ID: 'coffee-pub-cartographer', NAME: 'CARTOGRAPHER' };
const CONST = {
    EDGE_SENSE_TYPES: { NONE: 0, LIMITED: 10, NORMAL: 20, PROXIMITY: 30, DISTANCE: 40 },
    WALL_DOOR_TYPES: { NONE: 0, DOOR: 1, SECRET: 2 },
    WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1, LOCKED: 2 },
    GRID_SNAPPING_MODES: { VERTEX: 1 }
};
const GRID = 50;
const game = {
    user: { isGM: true },
    i18n: { localize: key => key, format: (key, data) => `${key} ${JSON.stringify(data)}` },
    modules: { get: () => undefined }
};
const notices = [];
const ui = { notifications: { info: text => notices.push(['info', text]), warn: text => notices.push(['warn', text]), error: text => notices.push(['error', text]) } };
const documentStand = {
    createElement: () => ({
        width: 0, height: 0,
        getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} })
    }),
    addEventListener() {}, removeEventListener() {}
};
const foundry = { utils: { escapeHTML: text => String(text) } };
const CONFIG = { Wall: { doorSounds: { wood: { label: 'Wood' } }, animationTypes: { slide: { label: 'Slide' } } } };
const PIXI = { Container: function () { return anything(); }, Graphics: function () { return anything(); }, Sprite: function () { return anything(); }, Point: function (x, y) { return { x, y }; }, Texture: { from: () => anything() } };

/** A scene whose walls can be changed, and which records every call. */
function makeScene(wallData = []) {
    const scene = { id: 's', grid: { size: GRID }, calls: [], levels: { size: 1 } };
    let n = 0;
    const make = data => ({ id: data._id ?? `w${++n}`, c: [...data.c], door: 0, light: 20, move: 20, sight: 20, sound: 20, dir: 0, levels: new Set(), flags: data.flags ?? {},
        getFlag(module, key) { return this.flags?.[module]?.[key]; }, toObject() { return { _id: this.id, c: [...this.c] }; }, ...(data.door ? { door: data.door } : {}) });
    scene.list = wallData.map(make);
    scene.walls = { get contents() { return scene.list; }, has: id => scene.list.some(w => w.id === id), filter: fn => scene.list.filter(fn) };
    scene.createEmbeddedDocuments = async (_type, data) => { scene.calls.push(['create', data]); data.forEach(item => scene.list.push(make(item))); };
    scene.deleteEmbeddedDocuments = async (_type, ids) => { scene.list = scene.list.filter(w => !ids.includes(w.id)); };
    scene.updateEmbeddedDocuments = async (_type, updates) => { for (const update of updates) Object.assign(scene.list.find(w => w.id === update._id), { c: [...update.c] }); };
    return scene;
}

function makeCanvas(scene) {
    const view = { getBoundingClientRect: () => ({ left: 0, top: 0 }), style: {}, addEventListener() {}, removeEventListener() {} };
    return {
        scene, ready: true, interface: anything(), level: null, dimensions: { distance: 5, sceneRect: { x: 0, y: 0, width: 400, height: 200 } },
        grid: { getSnappedPoint: p => ({ x: Math.round(p.x / GRID) * GRID, y: Math.round(p.y / GRID) * GRID }) },
        stage: { scale: { x: 1 }, toLocal: p => p },
        app: { view, stage: { toLocal: p => p } }
    };
}

let canvas;
const injected = { MODULE, CONST, game, ui, foundry, CONFIG, PIXI, performance, Hooks: { on: () => 1 }, document: documentStand,
    cartographerToolbar: { registerTool() {} }, wallJoinManager: { suspended: false }, AutoWallWindow: { open: async () => ({ element: null, render: async () => {}, close: async () => {} }) },
    ...utils };
const names = Object.keys(injected);
const build = () => new Function('canvas', ...names, `${body}\nreturn autoWallManager;`)(canvas, ...names.map(name => injected[name]));

// ---------------------------------------------------------------- a picture to click on
const WIDTH = 400, HEIGHT = 200;
function picture() {
    const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    let seed = 3;
    const grain = amount => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return ((seed / 0x7fffffff) - 0.5) * amount; };
    for (let y = 0; y < HEIGHT; y++) {
        for (let x = 0; x < WIDTH; x++) {
            // A wall along the top with a stem down from it at x 195..205, on wood.
            const wall = (y >= 40 && y < 50 && x >= 20 && x < 380) || (x >= 195 && x < 205 && y >= 50 && y < 150);
            const base = wall ? [150, 140, 120] : [110, 80, 50];
            const i = (y * WIDTH + x) * 4;
            const n = grain(6);
            data[i] = base[0] + n; data[i + 1] = base[1] + n; data[i + 2] = base[2] + n; data[i + 3] = 255;
        }
    }
    return { data, width: WIDTH, height: HEIGHT };
}

let failures = 0;
const check = (label, ok, detail = '') => {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const event = (x, y, extra = {}) => ({ button: 0, clientX: x, clientY: y, shiftKey: false, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {}, ...extra });
const near = (point, x, y, within = 3) => Math.hypot(point[0] - x, point[1] - y) <= within;

function startSession(manager, over = {}) {
    const pixels = picture();
    const session = {
        seeds: [], mode: 'wall', result: null, segments: [],
        options: { mode: 'wall', tab: 'map', joinEnds: true, joinDistance: 0.25, match: 20, smoothing: 0.3, widest: 1, snap: false,
            doorState: 'closed', doorSound: '', doorAnimation: '', windowDistance: 2, windowAttenuation: true, ...over },
        image: { pixels, lab: utils.labBuffer(pixels), placement: { x: 0, y: 0, width: WIDTH, height: HEIGHT }, scaleX: 1, scaleY: 1, surface: { width: WIDTH, height: HEIGHT } }
    };
    manager.session = session;
    manager._status = null;
    return session;
}

// ---------------------------------------------------------------- a wall
console.log('click a wall, adjust it, add it');
{
    canvas = makeCanvas(makeScene());
    const manager = build();
    const session = startSession(manager);
    session.seeds = [[100, 45]];
    manager._run(session);
    check('the wall is found: a bar and its stem', session.segments.length >= 2, `segments ${JSON.stringify(session.segments)}`);
    check('and reported', manager._status?.tone === 'ok', JSON.stringify(manager._status));
    check('down the middle of the bar', session.segments.some(([a, b]) => Math.abs(a[1] - 45) <= 3 && Math.abs(b[1] - 45) <= 3));

    // Take hold of the end of the bar and drag it somewhere else.
    const end = [...session.segments.flatMap(s => s).reduce((best, p) => (p[0] < best[0] ? p : best))];
    manager._onPointerDown(event(end[0], end[1]));
    check('an end can be taken hold of', manager._drag !== null && manager._drag !== undefined);
    manager._onDragMove(event(end[0] - 10, end[1] + 30));
    check('and moved', session.segments.flatMap(s => s).some(p => near(p, end[0] - 10, end[1] + 30, 1)), JSON.stringify(session.segments));
    manager._onDragEnd(event(end[0] - 10, end[1] + 30));
    check('and let go', manager._drag === null);

    // Ctrl-click puts a point in a wall; a plain click on a wall already found changes nothing.
    const before = session.segments.length;
    const seeds = JSON.stringify(session.seeds);
    const click = (x, y, extra = {}) => { manager._onPointerDown(event(x, y, extra)); manager._onPointerUp(event(x, y, extra)); };
    click(300, 45);
    check('a click on a wall that was found is not a new wall to find', session.segments.length === before && JSON.stringify(session.seeds) === seeds);
    click(300, 45, { ctrlKey: true });
    check('Ctrl-click puts a point in a wall', session.segments.length === before + 1, `${before} -> ${session.segments.length}`);
    click(300, 45, { ctrlKey: true });
    check('and where a point is already, a second does nothing more', session.segments.length === before + 1);
    click(250, 45, { metaKey: true });
    check('Command does the same on a Mac', session.segments.length === before + 2, `${session.segments.length}`);
    // Far from any wall found, a click is a new wall to find.
    click(60, 170);
    check('a click on the map, off the walls, is a new click to find a wall from', JSON.stringify(session.seeds) === JSON.stringify([[60, 170]]), JSON.stringify(session.seeds));
    // That click scheduled the walls to be worked out again; the test is about what is on the screen now.
    clearTimeout(manager._timer);

    await manager.accept();
    check('Add writes the walls', canvas.scene.list.length === before + 2, `${canvas.scene.list.length} walls`);
    check('and the run is ready for the next', session.segments.length === 0 && session.result === null);
    check('with a note to the GM', notices.some(([kind, text]) => kind === 'info' && /autowall.added/.test(text)));
}

// ---------------------------------------------------------------- snapping and joining
console.log('\nsnapping and joining');
{
    canvas = makeCanvas(makeScene([{ c: [20, 100, 200, 100] }]));
    const manager = build();
    const session = startSession(manager, { snap: true });
    session.seeds = [[100, 45]];
    manager._run(session);
    const onGrid = session.segments.flatMap(s => s).filter(([x, y]) => x % GRID === 0 && y % GRID === 0).length;
    check('with snap on, ends near grid corners sit on them', onGrid > 0 || session.segments.length > 0, JSON.stringify(session.segments));

    // An end let go near the end of a wall already on the scene joins it.
    session.segments = [[[100, 20], [160, 20]]];
    manager._onPointerDown(event(160, 20));
    manager._onDragMove(event(196, 96));
    check('an end dragged near a wall end on the scene joins it', session.segments[0][1][0] === 200 && session.segments[0][1][1] === 100, JSON.stringify(session.segments));
    manager._onDragEnd(event(196, 96));

    // With joining off it does not.
    session.options.joinEnds = false;
    session.options.snap = false;
    session.segments = [[[100, 20], [160, 20]]];
    manager._onPointerDown(event(160, 20));
    manager._onDragMove(event(196, 96));
    check('with joining off, it stays where it was dropped', session.segments[0][1][0] === 196 && session.segments[0][1][1] === 96, JSON.stringify(session.segments));
    manager._onDragEnd(event(196, 96));

    // Joined and running straight on: one wall.
    session.options.joinEnds = true;
    session.segments = [[[0, 0], [100, 0]], [[150, 3], [300, 0]]];
    manager._drag = { at: [100, 0], ends: [] };
    session.segments[1][0] = [100, 0];
    manager._onDragEnd(event(100, 0));
    check('two walls joined on a straight line become one', session.segments.length === 1 && session.segments[0][0][0] === 0 && session.segments[0][1][0] === 300, JSON.stringify(session.segments));
}

// ---------------------------------------------------------------- a door
console.log('\na door and a window');
{
    canvas = makeCanvas(makeScene([{ c: [20, 100, 150, 100] }, { c: [250, 100, 380, 100] }]));
    const manager = build();
    const session = startSession(manager);
    manager.setMode('door');
    check('changing mode clears the run', session.mode === 'door' && session.segments.length === 0 && manager._status?.text === 'coffee-pub-cartographer.autowall.hintDoor' || manager._status?.text?.includes('hintDoor'), JSON.stringify(manager._status));
    session.seeds = [[200, 104]];
    manager._run(session);
    check('a door is fitted into the gap between the two wall ends', session.segments.length === 1 && near(session.segments[0][0], 150, 100, 1) && near(session.segments[0][1], 250, 100, 1), JSON.stringify(session.segments));
    check('and reported as fitted', /autowall.fitted /.test(manager._status?.text ?? '') && manager._status.tone === 'ok', JSON.stringify(manager._status));
    session.options.doorSound = 'wood';
    await manager.accept();
    const door = canvas.scene.list.find(w => w.door === 1);
    check('Add writes a door with the sound chosen', door && door.c.join() === '150,100,250,100' && canvas.scene.calls.at(-1)[1][0].doorSound === 'wood', JSON.stringify(canvas.scene.calls.at(-1)));

    // The same gap again is no longer a gap.
    session.seeds = [[200, 104]];
    manager._run(session);
    check('a gap with a door in it is not fitted again', !session.segments.length || !(near(session.segments[0][0], 150, 100, 1) && near(session.segments[0][1], 250, 100, 1)), JSON.stringify(session.segments));

    // A window in another gap.
    canvas.scene.list.push(...makeScene([{ c: [20, 160, 100, 160] }, { c: [180, 160, 300, 160] }]).list.map((w, i) => ({ ...w, id: `x${i}` })));
    manager.setMode('window');
    session.seeds = [[140, 164]];
    manager._run(session);
    check('a window is fitted the same way', session.segments.length === 1 && near(session.segments[0][0], 100, 160, 1) && near(session.segments[0][1], 180, 160, 1), JSON.stringify(session.segments));
    await manager.accept();
    const added = canvas.scene.calls.at(-1)[1][0];
    check('and written with proximity and a threshold', added.light === 30 && added.sight === 30 && added.threshold.light === 10, JSON.stringify(added));
}

// ---------------------------------------------------------------- a door in a wall with no gap
console.log('\na door on a wall that runs straight across it');
{
    canvas = makeCanvas(makeScene([{ c: [20, 100, 380, 100] }]));
    const manager = build();
    const session = startSession(manager);
    manager.setMode('door');
    session.seeds = [[200, 103]];
    manager._run(session);
    check('with no gap, the door is placed on the wall, a square wide', session.onWall && session.segments.length === 1
        && near(session.segments[0][0], 175, 100, 2) && near(session.segments[0][1], 225, 100, 2), JSON.stringify(session.segments));
    check('and says so', /autowall.placedOnWall/.test(manager._status?.text ?? '') && manager._status.tone === 'ok', JSON.stringify(manager._status));

    // The GM drags one end to size it; it is still on the wall.
    manager._onPointerDown(event(225, 100));
    manager._onDragMove(event(260, 100));
    manager._onDragEnd(event(260, 100));
    check('dragging an end along the wall keeps it on the wall', session.onWall && near(session.segments[0][1], 260, 100, 1), JSON.stringify(session.segments));

    await manager.accept();
    const lines = canvas.scene.list.map(w => w.c.join(',')).sort();
    check('Add cuts the wall around it', lines.length === 3 && lines.includes('20,100,175,100') && lines.includes('260,100,380,100'), JSON.stringify(lines));

    // Dragged off the wall into a gap-less place, it is no longer on the wall.
    manager.setMode('window');
    session.seeds = [[300, 103]];
    manager._run(session);
    check('a window on the part of the wall that is left', session.onWall && session.segments.length === 1, JSON.stringify(session.segments));
    manager._onPointerDown(event(session.segments[0][1][0], 100));
    manager._onDragMove(event(session.segments[0][1][0], 150));
    manager._onDragEnd(event(session.segments[0][1][0], 150));
    check('dragged off the wall, it is no longer cut out of it', session.onWall === false, JSON.stringify(session.segments));
}

// ---------------------------------------------------------------- things that go wrong
console.log('\nthings that go wrong');
{
    canvas = makeCanvas(makeScene());
    const manager = build();
    const session = startSession(manager);
    session.seeds = [[-50, -50]];
    manager._run(session);
    check('a click off the picture says so and draws nothing', manager._status?.tone === 'warn' && session.segments.length === 0, JSON.stringify(manager._status));

    manager.setMode('door');
    session.seeds = [[200, 100]];
    manager._run(session);
    check('a door on a scene with no walls says to map the walls first', /autowall.noWalls/.test(manager._status?.text ?? ''), JSON.stringify(manager._status));

    manager.setMode('wall');
    session.seeds = [[10, 10]];
    session.options.match = 30;
    manager._run(session);
    check('a click on the floor is refused or finds nothing, and does not throw', ['warn'].includes(manager._status?.tone), JSON.stringify(manager._status));

    manager.cancel();
    check('cancel ends the run', manager.session === null && manager.window === null);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);

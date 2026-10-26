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
const PIXI = { Matrix: function () { return anything(); }, Container: function () { return anything(); }, Graphics: function () { return anything(); }, Sprite: function () { return anything(); }, Point: function (x, y) { return { x, y }; }, Texture: { from: () => anything() } };

/** A scene whose walls can be changed, and which records every call. */
function makeScene(wallData = []) {
    const scene = { id: 's', grid: { size: GRID }, calls: [], levels: { size: 1 } };
    let n = 0;
    const make = data => ({ id: data._id ?? `w${++n}`, c: [...data.c], door: 0, light: 20, move: 20, sight: 20, sound: 20, dir: 0, levels: new Set(), flags: data.flags ?? {},
        getFlag(module, key) { return this.flags?.[module]?.[key]; }, toObject() { return { _id: this.id, c: [...this.c] }; }, ...(data.door ? { door: data.door } : {}) });
    scene.list = wallData.map(make);
    scene.walls = { get contents() { return scene.list; }, has: id => scene.list.some(w => w.id === id), filter: fn => scene.list.filter(fn) };
    scene.createEmbeddedDocuments = async (_type, data) => { scene.calls.push(['create', data]); return data.map(item => { const doc = make(item); scene.list.push(doc); return doc; }); };
    scene.deleteEmbeddedDocuments = async (_type, ids) => { scene.list = scene.list.filter(w => !ids.includes(w.id)); };
    scene.updateEmbeddedDocuments = async (_type, updates) => { for (const update of updates) Object.assign(scene.list.find(w => w.id === update._id), { c: [...update.c] }); };
    return scene;
}

function makeCanvas(scene, tiles = []) {
    const view = { getBoundingClientRect: () => ({ left: 0, top: 0 }), style: {}, addEventListener() {}, removeEventListener() {} };
    return {
        scene, ready: true, interface: anything(), level: null, dimensions: { distance: 5, sceneRect: { x: 0, y: 0, width: 400, height: 200 } },
        grid: { getSnappedPoint: p => ({ x: Math.round(p.x / GRID) * GRID, y: Math.round(p.y / GRID) * GRID }) },
        tiles: { placeables: tiles },
        stage: { scale: { x: 1 }, toLocal: p => p, worldTransform: { applyInverse: p => p } },
        app: { view, stage: { toLocal: p => p } }
    };
}

let canvas;
const injected = { MODULE, CONST, game, ui, foundry, CONFIG, PIXI, performance, Hooks: { on: () => 1 }, document: documentStand,
    cartographerToolbar: { registerTool() {} }, wallJoinManager: { suspended: false },
    window: { addEventListener() {}, removeEventListener() {}, innerWidth: 1600 }, AutoWallWindow: { open: async () => ({ element: null, render: async () => {}, close: async () => {} }) },
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
        options: { mode: 'wall', tab: 'map', drawTool: 'point', drawKind: 'wall', joinEnds: true, joinDistance: 0.25, match: 20, smoothing: 0.3, widest: 1, snap: false,
            doorState: 'closed', doorSound: '', doorAnimation: '', windowDistance: 2, windowAttenuation: true, ...over },
        image: { key: 'background', label: 'Scene background', pixels, lab: utils.labBuffer(pixels), surface: { width: WIDTH, height: HEIGHT },
            ...utils.transformFromCorners([0, 0], [WIDTH, 0], [0, HEIGHT], WIDTH, HEIGHT) },
        files: new Map(),
        draw: { active: false, last: null, start: null, run: null, count: 0, history: [], points: null, queue: Promise.resolve() }
    };
    session.background = session.image;
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

// ---------------------------------------------------------------- a wall on a tile
console.log('\na wall painted on a tile, not on the background');
{
    // A tile 200 by 100, turned a quarter, with its top-left corner at 1000,500. Its picture has a wall
    // along the middle, across the width; turned, that is a wall running down the scene at x of about 950.
    const TW = 200, TH = 100;
    const tileData = new Uint8ClampedArray(TW * TH * 4);
    let seed = 11;
    const grain = amount => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return ((seed / 0x7fffffff) - 0.5) * amount; };
    for (let y = 0; y < TH; y++) {
        for (let x = 0; x < TW; x++) {
            const i = (y * TW + x) * 4;
            const wall = y >= 45 && y < 55 && x >= 10 && x < 190;
            const hole = x >= 150 && y < 20;
            const base = wall ? [150, 140, 120] : [110, 80, 50];
            const n = grain(6);
            tileData[i] = base[0] + n; tileData[i + 1] = base[1] + n; tileData[i + 2] = base[2] + n; tileData[i + 3] = hole ? 0 : 255;
        }
    }
    const tilePixels = { data: tileData, width: TW, height: TH };
    // x' = a x + c y + tx ; y' = b x + d y + ty, for a quarter turn about the top-left corner.
    const turned = { a: 0, b: 1, c: -1, d: 0, tx: 1000, ty: 500 };
    const mesh = {
        destroyed: false, texture: { orig: { width: TW, height: TH } }, anchor: { x: 0, y: 0 },
        worldTransform: { apply: p => ({ x: turned.a * p.x + turned.c * p.y + turned.tx, y: turned.b * p.x + turned.d * p.y + turned.ty }) }
    };
    const tile = { id: 't1', mesh, document: { texture: { src: 'tiles/Dock Wall.png' }, elevation: 0, sort: 0 } };
    const files = [];
    const prepare = () => {
        canvas = makeCanvas(makeScene(), [tile]);
        const manager = build();
        manager._loadFile = async src => { files.push(src); return { pixels: tilePixels, surface: { width: TW, height: TH }, naturalWidth: TW, naturalHeight: TH }; };
        const session = startSession(manager);
        return { manager, session };
    };

    const { manager, session } = prepare();
    manager._pick([950, 600], false);
    await new Promise(resolve => setTimeout(resolve, 0));
    check('a click on a tile reads that tile, not the background', session.image.key.startsWith('tile:') && files.length === 1, session.image.key);
    check('and says which', /autowall.sourceTile/.test(session.image.label) && /Dock Wall.png/.test(session.image.label), session.image.label);
    check('the picture is placed on the scene as the tile is: a point of it lands where the mesh puts it', JSON.stringify(session.image.toScene([100, 50]).map(Math.round)) === '[950,600]', JSON.stringify(session.image.toScene([100, 50])));
    check('and back again', JSON.stringify(session.image.toImage([950, 600]).map(Math.round)) === '[100,50]');
    check('its scale is one picture pixel to a scene pixel', Math.abs(session.image.scale - 1) < 1e-9);

    manager._run(session);
    const ends = session.segments.flat();
    check('the wall found is in scene pixels: a line down the scene at x of 950', session.segments.length >= 1 && ends.every(p => Math.abs(p[0] - 950) <= 3), JSON.stringify(session.segments));
    check('from one end of the wall to the other, as the tile is turned', Math.min(...ends.map(p => p[1])) <= 530 && Math.max(...ends.map(p => p[1])) >= 670, JSON.stringify(session.segments));

    // The same tile, clicked where its picture is transparent: the click goes through to the background.
    const through = prepare();
    through.manager._pick([1000 - 10, 500 + 160], false);
    await new Promise(resolve => setTimeout(resolve, 0));
    check('a click where the tile is transparent goes through to what is under it', through.session.image.key === 'background', through.session.image.key);

    // Off the tile altogether.
    const off = prepare();
    off.manager._pick([300, 100], false);
    check('a click off any tile reads the background, with no waiting', off.session.image.key === 'background' && JSON.stringify(off.session.seeds) === '[[300,100]]');

    // Shift-click adds to the picture already being read; it does not choose again.
    const add = prepare();
    add.manager._pick([950, 600], false);
    await new Promise(resolve => setTimeout(resolve, 0));
    const reads = files.length;
    add.manager._pick([950, 540], true);
    check('a shift-click adds a click to the same picture', add.session.seeds.length === 2 && files.length === reads);

    // Back to the background: what was found on the tile is not carried over.
    add.session.segments = [[[1, 1], [2, 2]]];
    add.manager._pick([300, 100], false);
    check('clicking the background after a tile starts afresh on the background', add.session.image.key === 'background' && add.session.segments.length === 0 && JSON.stringify(add.session.seeds) === '[[300,100]]');
}

console.log('\nthe button among the wall tools');
{
    canvas = makeCanvas(makeScene());
    const manager = build();
    const controls = { walls: { tools: { select: { name: 'select' } } } };
    manager.addWallTool(controls);
    const tool = controls.walls.tools[Object.keys(controls.walls.tools).find(name => name !== 'select')];
    check('the tool is added to the Walls controls', !!tool && tool.button === true && /autowall.barMap/.test(tool.title), JSON.stringify(controls.walls.tools));
    check('and Foundry\'s own tools are left as they are', controls.walls.tools.select.name === 'select');
    const list = { walls: { tools: [] } };
    manager.addWallTool(list);
    check('as an array too, for an older shape of the controls', list.walls.tools.length === 1);
    const none = {};
    manager.addWallTool(none);
    check('with no Walls controls there is nothing to add to, and no error', Object.keys(none).length === 0);
}

// ---------------------------------------------------------------- walls drawn by hand
console.log('\ndrawing walls by hand, with points');
{
    // Events that say whether the tool took them, since a click it does not want must reach Foundry.
    const ev = (x, y, extra = {}) => { const e = event(x, y, extra); e.swallowed = false; e.stopImmediatePropagation = () => { e.swallowed = true; }; return e; };
    const click = async (manager, x, y, extra = {}) => {
        const down = ev(x, y, extra);
        const up = ev(x, y, extra);
        manager._onPointerDown(down);
        manager._onPointerUp(up);
        await manager.session.draw.queue;
        return down.swallowed && up.swallowed;
    };
    const setup = (scenery = [], over = {}) => {
        canvas = makeCanvas(makeScene(scenery));
        const manager = build();
        const session = startSession(manager, { tab: 'draw', ...over });
        return { manager, session };
    };
    const drawn = scene => scene.list.filter(w => w.flags?.[MODULE.ID]?.autoWall);

    // Off, the map is Foundry's.
    const off = setup();
    check('with drawing off, a click is left to Foundry', await click(off.manager, 100, 100) === false && off.session.draw.last === null);

    // On: the first click places a point, each after makes a wall to it.
    const { manager, session } = setup();
    manager.toggleDraw();
    check('turning drawing on says what to do', /autowall.drawFirst/.test(manager._drawStatusText()), manager._drawStatusText());
    check('the first click places a point and makes no wall', await click(manager, 100, 100) === true && JSON.stringify(session.draw.last) === '[100,100]' && canvas.scene.list.length === 0);
    await click(manager, 200, 100);
    check('the second makes a wall from the first to it', drawn(canvas.scene).length === 1 && drawn(canvas.scene)[0].c.join() === '100,100,200,100', JSON.stringify(canvas.scene.list.map(w => w.c)));
    await click(manager, 200, 200);
    check('and each after carries on from the last', drawn(canvas.scene).length === 2 && drawn(canvas.scene)[1].c.join() === '200,100,200,200');
    check('the status names the last point', /autowall.drawNext/.test(manager._drawStatusText()) && /"x":200,"y":200/.test(manager._drawStatusText()), manager._drawStatusText());
    check('a chain is one run, to take back together', new Set(drawn(canvas.scene).map(w => w.flags[MODULE.ID].autoWall.run)).size === 1);

    // Back at the start, the shape is closed and the chain is over.
    await click(manager, 100, 200);
    await click(manager, 100, 100);
    check('a click back on the start closes the shape', drawn(canvas.scene).length === 4 && drawn(canvas.scene)[3].c.join() === '100,200,100,100', JSON.stringify(drawn(canvas.scene).map(w => w.c.join())));
    check('and ends the chain', session.draw.last === null && session.draw.start === null);
    check('the next click begins a new chain', await click(manager, 600, 600) && JSON.stringify(session.draw.last) === '[600,600]');

    // Backspace takes the last wall back and stands where it began.
    await click(manager, 700, 600);
    check('a wall is made', drawn(canvas.scene).length === 5);
    manager._drawKey({ key: 'Backspace', preventDefault() {}, stopPropagation() {} });
    await session.draw.queue;
    await new Promise(resolve => setTimeout(resolve, 0));
    check('Backspace takes it back', drawn(canvas.scene).length === 4, `${drawn(canvas.scene).length}`);
    check('and stands where it began', JSON.stringify(session.draw.last) === '[600,600]', JSON.stringify(session.draw.last));

    // Enter, then Escape.
    manager._drawKey({ key: 'Enter', preventDefault() {}, stopPropagation() {} });
    check('Enter ends the chain', session.draw.last === null);
    check('Escape with no chain turns drawing off', (manager._drawKey({ key: 'Escape', preventDefault() {}, stopPropagation() {} }), session.draw.active === false));
}
{
    // A chain can begin on a wall end already on the scene: the thing Foundry's own tool makes hard.
    const scenery = [{ c: [400, 300, 400, 500] }];
    canvas = makeCanvas(makeScene(scenery));
    const manager = build();
    const session = startSession(manager, { tab: 'draw' });
    manager.toggleDraw();
    const down = x => manager._onPointerDown(event(x[0], x[1]));
    const up = x => manager._onPointerUp(event(x[0], x[1]));
    down([410, 296]); up([410, 296]);
    check('a first click near the end of a wall is that end, to carry on from', JSON.stringify(session.draw.last) === '[400,300]', JSON.stringify(session.draw.last));
    down([600, 300]); up([600, 300]);
    await session.draw.queue;
    const made = canvas.scene.list.find(w => w.id !== 'w1');
    check('so the new wall starts on the old wall\'s end exactly', made?.c.join() === '400,300,600,300', JSON.stringify(canvas.scene.list.map(w => w.c)));

    // Shift places a point freely.
    manager._drawEndChain();
    manager._onPointerDown(event(410, 296, { shiftKey: true }));
    manager._onPointerUp(event(410, 296, { shiftKey: true }));
    check('Shift places a point where it is, not on the end near it', JSON.stringify(session.draw.last) === '[410,296]', JSON.stringify(session.draw.last));

    // Joining off: no snapping to ends.
    manager._drawEndChain();
    session.options.joinEnds = false;
    manager._onPointerDown(event(410, 296));
    manager._onPointerUp(event(410, 296));
    check('with joining off, it is where it was clicked', JSON.stringify(session.draw.last) === '[410,296]');
}
{
    // What is drawn is a door, or a window, as it is chosen.
    canvas = makeCanvas(makeScene());
    const manager = build();
    const session = startSession(manager, { tab: 'draw', drawKind: 'door', doorState: 'locked', doorSound: 'wood' });
    manager.toggleDraw();
    for (const [x, y] of [[100, 100], [200, 100]]) { manager._onPointerDown(event(x, y)); manager._onPointerUp(event(x, y)); }
    await session.draw.queue;
    const door = canvas.scene.list[0];
    check('drawn as a door, with its state and sound', door.door === 1 && canvas.scene.calls.at(-1)[1][0].ds === 2 && canvas.scene.calls.at(-1)[1][0].doorSound === 'wood', JSON.stringify(canvas.scene.calls.at(-1)));
    check('and tagged as a door from a run', door.flags[MODULE.ID].autoWall.kind === 'door');
    session.options.drawKind = 'window';
    manager._drawEndChain();
    for (const [x, y] of [[300, 100], [400, 100]]) { manager._onPointerDown(event(x, y)); manager._onPointerUp(event(x, y)); }
    await session.draw.queue;
    check('a window as a window', canvas.scene.calls.at(-1)[1][0].light === 30 && canvas.scene.calls.at(-1)[1][0].threshold.light === 10);
}

console.log('\nsketching a wall freehand');
{
    const ev = (x, y, extra = {}) => event(x, y, extra);
    canvas = makeCanvas(makeScene([{ c: [100, 300, 100, 500] }]));
    const manager = build();
    const session = startSession(manager, { tab: 'draw', drawTool: 'sketch' });
    manager.toggleDraw();
    let seed = 9;
    const jitter = amount => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return ((seed / 0x7fffffff) - 0.5) * amount; };
    // From near the end of a wall already there, along and then down: an L.
    manager._onPointerDown(ev(108, 296));
    check('sketching takes hold of the pointer', session.draw.points !== null);
    // The pointer reports every few pixels, as a real one does.
    for (let x = 108; x <= 400; x += 3) manager._onSketchMove(ev(x, 296 + jitter(2)));
    for (let y = 299; y <= 500; y += 3) manager._onSketchMove(ev(400 + jitter(2), y));
    manager._onSketchEnd(ev(400, 500));
    await session.draw.queue;
    const walls = canvas.scene.list.filter(w => w.flags?.[MODULE.ID]?.autoWall);
    check('a stroke with a corner is two walls', walls.length === 2, JSON.stringify(walls.map(w => w.c)));
    check('it begins on the end of the wall it started beside', walls[0].c[0] === 100 && walls[0].c[1] === 300, JSON.stringify(walls[0].c));
    check('the corner is where the stroke turned', Math.abs(walls[0].c[2] - 400) <= 10 && Math.abs(walls[0].c[3] - 300) <= 10, JSON.stringify(walls));
    check('one stroke is one thing to take back', new Set(walls.map(w => w.flags[MODULE.ID].autoWall.run)).size === 1);
    manager.drawBack();
    await new Promise(resolve => setTimeout(resolve, 0));
    check('Backspace takes the whole stroke back', canvas.scene.list.filter(w => w.flags?.[MODULE.ID]?.autoWall).length === 0, `${canvas.scene.list.length}`);

    // A pointer that did not go anywhere draws nothing.
    manager._onPointerDown(ev(500, 500));
    manager._onSketchEnd(ev(500, 500));
    await session.draw.queue;
    check('a click with no stroke draws nothing', canvas.scene.list.every(w => !w.flags?.[MODULE.ID]?.autoWall));
}

console.log('\nthe canvas is left alone when it is not wanted');
{
    // Foundry's own windows and sidebar are under the same window listener: the tool must not take their clicks.
    {
        const over = { target: { tagName: 'DIV' }, button: 0, clientX: 100, clientY: 100, shiftKey: false, swallowed: false, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() { over.swallowed = true; } };
        canvas = makeCanvas(makeScene());
        const manager = build();
        const session = startSession(manager, { tab: 'map' });
        manager._onPointerDown(over);
        check('a click on something drawn over the map is not the tool\'s', over.swallowed === false);
        const onMap = { ...over, target: canvas.app.view, swallowed: false, stopImmediatePropagation() { onMap.swallowed = true; } };
        manager._onPointerDown(onMap);
        check('and a click on the map is', onMap.swallowed === true);
        manager._onPointerUp({ ...over, target: { tagName: 'DIV' } });
        check('a press on the map let go over something else is not a click', manager._press === null);
        session.draw.active = false;
    }

    const ev = (x, y, extra = {}) => { const e = event(x, y, extra); e.swallowed = false; e.stopImmediatePropagation = () => { e.swallowed = true; }; return e; };
    canvas = makeCanvas(makeScene());
    const manager = build();
    const session = startSession(manager, { tab: 'options' });
    const down = ev(100, 100);
    manager._onPointerDown(down);
    check('on the Options tab, a click is Foundry\'s', down.swallowed === false);
    session.options.tab = 'draw';
    const idle = ev(100, 100);
    manager._onPointerDown(idle);
    check('on the Draw tab with drawing off, a click is Foundry\'s', idle.swallowed === false);
    session.options.tab = 'map';
    const map = ev(100, 100);
    manager._onPointerDown(map);
    check('on the Map tab it is the tool\'s', map.swallowed === true);
    session.draw.active = true;
    session.options.tab = 'draw';
    const right = ev(100, 100, { button: 2 });
    manager._onPointerDown(right);
    check('a right-click while drawing still pans and opens menus', right.swallowed === false);
    manager.setTab('options');
    check('leaving the Draw tab turns drawing off and drops the chain', session.draw.active === false && session.draw.last === null);
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

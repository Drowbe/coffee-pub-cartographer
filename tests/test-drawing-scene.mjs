// What the drawing tool writes to a scene, and takes back, run from the real methods in
// manager-drawing.js against a stand-in scene: a wall stroke is walls and a line, a kept stamp is
// Drawings, a temporary stamp is a canvas graphic that is broadcast with the seed it was made
// with, undo takes back whatever came last, a player cannot make walls, and a stamp that arrives
// from another client is drawn the same.
//
// It does not run Foundry: that Foundry accepts the data is for the map to show.
import fs from 'node:fs';
import {
    stampById, isStamp, isProceduralStamp, buildStamp, stampPalette, drawStamp, stampDrawingData, parseColor
} from '../scripts/utils-stamps.js';
import { wallStrokeSegments, segmentsPath, strokeDrawingData, distanceToPolyline, drawingHit, keptGroup, wallKindById, wallKindData, discDrawingData } from '../scripts/utils-drawing.js';
import { terrainById, terrainPalette, smoothPath, buildTerrain, MAX_TEXTURE } from '../scripts/utils-terrain.js';

const src = fs.readFileSync('scripts/manager-drawing.js', 'utf8');
const slice = (from, to) => {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a);
    if (a < 0 || b < 0) throw new Error(`could not locate ${from.trim().slice(0, 40)}`);
    return src.slice(a, b);
};
const methods = slice('    // ===== STAMPS ====', '    // ===== THE TOOLS WINDOW');
const toolButton = slice('    addDrawingTool(controls) {', '    /** Open the drawing tools window, or bring');
const undo = slice('    undoLastDrawing() {', '    /**\n     * Clean up drawings from a specific player');
const MAX_SCATTER = Number(src.match(/const MAX_SCATTER = (\d+)/)[1]);
const KEPT_SPECKS = Number(src.match(/const KEPT_SPECKS = (\d+)/)[1]);
const WALL_CASING = src.match(/const WALL_CASING = '([^']+)'/)[1];
const pointer = slice('    /** The button went down on the map', '    /** Stop drawing from the window. */');
const wallOptions = slice('    setWallOption(name, value) {', '    setLineStyle(style) {');
const strokeMode = slice('    _strokeMode() {', '    /**\n     * Set the stamp style');

const MODULE = { ID: 'coffee-pub-cartographer', NAME: 'Cartographer' };
const notices = [];
const notify = (title, options) => notices.push({ title, ...options });
const CONST = {
    DRAWING_FILL_TYPES: { NONE: 0, SOLID: 1 },
    GRID_SNAPPING_MODES: { VERTEX: 1 },
    EDGE_SENSE_TYPES: { NONE: 0, LIMITED: 10, NORMAL: 20, PROXIMITY: 30, DISTANCE: 40 },
    WALL_DOOR_TYPES: { NONE: 0, DOOR: 1, SECRET: 2 },
    WALL_DOOR_STATES: { CLOSED: 0, OPEN: 1, LOCKED: 2 }
};
const foundry = { utils: { randomID: (() => { let n = 0; return () => `id${++n}`; })() }, get applications() { return foundryApplications; } };
let isGM = true;
let canCreate = true;
let savedMode = 'box';
let confirmAnswer = true;
const game = {
    get user() { return { id: 'u1', name: 'Una', isGM, can: () => canCreate }; },
    settings: { get: () => savedMode, set() {} }
};
const foundryApplications = { api: { DialogV2: { confirm: async () => confirmAnswer } } };

class Collection {
    constructor() { this.map = new Map(); }
    has(id) { return this.map.has(id); }
    get size() { return this.map.size; }
    get contents() { return [...this.map.values()]; }
    [Symbol.iterator]() { return this.contents[Symbol.iterator](); }
}
const makeScene = () => {
    let counter = 0;
    const scene = {
        walls: new Collection(),
        drawings: new Collection(),
        levels: { size: 1 },
        creates: [],
        failNext: null,
        async createEmbeddedDocuments(type, data, options = {}) {
            if (scene.failNext === type) { scene.failNext = null; throw new Error('refused'); }
            scene.creates.push([type, data]);
            const collection = type === 'Wall' ? scene.walls : scene.drawings;
            return data.map(d => {
                const id = options.keepId && d._id ? d._id : `${type}${++counter}`;
                const doc = { ...d, id, isOwner: true, toObject() { return { ...d, _id: id }; } };
                collection.map.set(id, doc);
                return doc;
            });
        },
        updates: [],
        async update(changes) { scene.updates.push(changes); },
        async deleteEmbeddedDocuments(type, ids) {
            const collection = type === 'Wall' ? scene.walls : scene.drawings;
            for (const id of ids) collection.map.delete(id);
        }
    };
    return scene;
};
let scene = makeScene();
const canvas = {
    get scene() { return scene; },
    grid: { size: 100, getSnappedPoint: ({ x, y }) => ({ x: Math.round(x / 50) * 50, y: Math.round(y / 50) * 50 }) },
    walls: null,
    level: null,
    dimensions: { distance: 5 }
};
globalThis.PIXI = { Graphics: class { constructor() { this.calls = []; this.destroyed = false; return new Proxy(this, { get: (t, n) => (n === 'parent' ? undefined : n === 'destroy' ? () => { t.destroyed = true; } : n in t ? t[n] : (...a) => t.calls.push([n, ...a])) }); } } };

class DrawingTool {
    static strSmallSymbolSize = 40;
    static strMediumSymbolSize = 80;
    static strLargeSymbolSize = 140;
}
const Harness = eval(`(() => {
return class Harness {
${strokeMode}
${methods}
${wallOptions}
${pointer}
${toolButton}
${undo}
};
})()`);

const added = [];
const make = () => {
    const tool = new Harness();
    Object.assign(tool, {
        state: {
            drawingMode: 'wall', stampStyle: 'tree', symbolSize: 'medium', timedEraseEnabled: false,
            brushSettings: { size: 6, color: 'rgba(186, 60, 49, 0.7)', type: 'pen' },
            stamp: { natural: true, keep: false, rotate: true, jitter: true, spacing: 1, terrain: 'dirt', pathWidth: 1 },
            wallShape: 'line', wallSnap: true, wallKind: 'wall', wallDoor: 'closed'
        },
        services: { canvasLayer: { added: [], addChild(g) { this.added.push(g); } } },
        _pixiDrawings: [], _kept: [], _roll: null, _lastDrawing: null,
        _erased: new Set(), _eraseBatch: { Wall: [], Drawing: [] }, _eraseQueue: Promise.resolve(), _erasing: false,
        notifyChange() { this.changes = (this.changes ?? 0) + 1; },
        extractAlphaFromRgba: color => Number((color.match(/,\s*([\d.]+)\)$/) ?? [])[1] ?? 1),
        getExpirationTime: () => null,
        scheduleCleanup() { this.scheduled = true; },
        broadcastDrawingCreation(data) { added.push(data); },
        removePreviewSymbol() {},
        _fadeOutAndRemove(graphics) { graphics.parent?.removeChild(graphics); },
        broadcastDrawingDeletion(clear, user, id) { (this.broadcastDeleted ??= []).push(id); },
        deleteDrawingById(id) { this.deleted = [...(this.deleted ?? []), id]; this._pixiDrawings = this._pixiDrawings.filter(d => d.id !== id); },
        getWorldCoordinates: event => ({ x: event.x, y: event.y })
    });
    return tool;
};

let failures = 0;
const check = (label, ok, detail = '') => {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};

console.log('the mode a stroke is');
{
    const tool = make();
    check('wall in line shape strokes as a line', tool._strokeMode() === 'line');
    tool.state.wallShape = 'sketch';
    check('wall in sketch shape strokes as a sketch', tool._strokeMode() === 'sketch');
    tool.state.drawingMode = 'box';
    check('any other mode is itself', tool._strokeMode() === 'box');
}

console.log('\na wall stroke');
{
    scene = makeScene();
    const tool = make();
    await tool.createWallStroke([[12, 8], [388, 14]]);
    const walls = scene.creates.filter(([type]) => type === 'Wall');
    const lines = scene.creates.filter(([type]) => type === 'Drawing');
    check('one wall is written, with its line, the dark line under it, and a disc at each end of both', walls.length === 1 && walls[0][1].length === 1 && lines.length === 1 && lines[0][1].length === 6);
    check('the wall is where the snap put it', walls[0][1][0].c.join() === '0,0,400,0');
    check('the wall and the line carry the same group flag', walls[0][1][0].flags[MODULE.ID].drawnWall.id === lines[0][1][3].flags[MODULE.ID].drawnWall.id);
    check('the line is the colour of the kind, at the brush\'s width', lines[0][1][3].strokeColor === wallKindById('wall').color && lines[0][1][3].strokeWidth === 6 && lines[0][1][3].strokeAlpha === 1);
    check('a plain wall is written as Foundry\'s defaults: no sense fields at all', !('door' in walls[0][1][0]) && !('light' in walls[0][1][0]) && !('threshold' in walls[0][1][0]));
    check('the line is open: no fill', [lines[0][1][0], lines[0][1][3]].every(d => d.fillType === 0));
    check('the line runs along the wall', [lines[0][1][0], lines[0][1][3]].every(d => d.shape.points.join() === '0,0,400,0' && d.x === 0 && d.y === 0));
    check('under the line is a darker, wider one, so the wall shows on any map', lines[0][1][0].strokeColor === WALL_CASING && lines[0][1][0].strokeWidth === 10 && lines[0][1][0].sort < lines[0][1][3].sort);
    const discs = lines[0][1].filter(d => d.fillType === 1);
    check('the ends are round: a dark disc and a coloured one at each end', discs.length === 4 && discs.filter(d => d.fillColor === WALL_CASING).length === 2 && discs.filter(d => d.fillColor === wallKindById('wall').color).length === 2);
    check('the discs are as wide as the lines they cap', discs.filter(d => d.fillColor === WALL_CASING).every(d => d.shape.width >= 10 && d.shape.width <= 11) && discs.filter(d => d.fillColor !== WALL_CASING).every(d => d.shape.width >= 6 && d.shape.width <= 7));
    check('the discs sit on the ends of the wall', [0, 400].every(x => discs.some(d => Math.abs(d.x + d.shape.width / 2 - x) <= 1)));
    check('dark below, colour above: every dark thing sorts under every coloured one', Math.max(...lines[0][1].filter(d => d.sort === 0).map(d => d.sort)) < Math.min(...lines[0][1].filter(d => d.sort === 1).map(d => d.sort)) && lines[0][1].filter(d => d.sort === 0).length === 3);
    check('both carry the same group flag, so the eraser takes both', lines[0][1].every(d => d.flags[MODULE.ID].drawnWall.id === lines[0][1][0].flags[MODULE.ID].drawnWall.id));
    check('it is one thing to take back, with both kinds in it', tool._kept.length === 1 && tool._kept[0].wallIds.length === 1 && tool._kept[0].drawingIds.length === 6);
    check('the window is told', tool.changes >= 1);
}
{
    scene = makeScene();
    const tool = make();
    tool.state.wallSnap = false;
    await tool.createWallStroke([[12, 8], [388, 14]]);
    check('with snap off the wall is where it was drawn', scene.creates[0][1][0].c.join() === '12,8,388,14');
}
{
    scene = makeScene();
    const tool = make();
    tool.state.wallShape = 'sketch';
    const points = [];
    for (let i = 0; i <= 40; i++) points.push([i * 10, 2 * Math.sin(i)]);
    for (let i = 1; i <= 40; i++) points.push([400, i * 10 + 2 * Math.sin(i)]);
    await tool.createWallStroke(points);
    const walls = scene.creates.find(([type]) => type === 'Wall')[1];
    check('a freehand stroke along two sides makes a few walls', walls.length >= 2 && walls.length <= 4, `got ${walls.length}`);
    check('every wall is four numbers', walls.every(w => w.c.length === 4 && w.c.every(Number.isFinite)));
    check('one line is drawn over all of them', scene.creates.filter(([type]) => type === 'Drawing').length === 1);
    const drawn = scene.creates.find(([type]) => type === 'Drawing')[1];
    const corners = walls.length + 1;
    check('a corner where two walls meet has a disc, so it is a joint and not two slabs', drawn.filter(d => d.fillType === 1).length === corners * 2);
    check('and a run of walls is still one line over one dark line', drawn.filter(d => d.fillType === 0).length === 2);
    check('the walls are one group', new Set(walls.map(w => w.flags[MODULE.ID].drawnWall.id)).size === 1);
}
{
    scene = makeScene();
    const tool = make();
    await tool.createWallStroke([[10, 10], [20, 20]]);
    check('a stroke too short to be a wall writes nothing', scene.creates.length === 0 && tool._kept.length === 0);
}
{
    scene = makeScene();
    scene.levels = { size: 2 };
    canvas.level = { id: 'L2' };
    const tool = make();
    await tool.createWallStroke([[0, 0], [300, 0]]);
    check('on a scene with levels a wall belongs to the level looked at', scene.creates[0][1][0].levels.join() === 'L2');
    canvas.level = null;
}
{
    scene = makeScene();
    isGM = false;
    notices.length = 0;
    const tool = make();
    await tool.createWallStroke([[0, 0], [300, 0]]);
    check('a player makes no wall, and is told why', scene.creates.length === 0 && notices.some(n => /Only the GM/.test(n.title)));
    isGM = true;
}
{
    scene = makeScene();
    scene.failNext = 'Drawing';
    notices.length = 0;
    const tool = make();
    await tool.createWallStroke([[0, 0], [300, 0]]);
    check('if the line is refused the user is told, and nothing is recorded to undo', notices.some(n => /Could not draw/.test(n.title)) && tool._kept.length === 0);
}

console.log('\nkinds of wall');
{
    const written = async (kind, setup = () => {}) => {
        scene = makeScene();
        const tool = make();
        tool.state.wallKind = kind;
        setup(tool);
        await tool.createWallStroke([[0, 0], [400, 0]]);
        return { tool, wall: scene.creates.find(([type]) => type === 'Wall')[1][0], line: scene.creates.find(([type]) => type === 'Drawing')[1][3], casing: scene.creates.find(([type]) => type === 'Drawing')[1][0] };
    };
    const sense = CONST.EDGE_SENSE_TYPES;
    {
        const { wall } = await written('invisible');
        check('an invisible wall stops movement and nothing else', wall.move === sense.NORMAL && wall.sight === sense.NONE && wall.light === sense.NONE && wall.sound === sense.NONE);
    }
    {
        const { wall } = await written('terrain');
        check('a terrain wall cuts sight, light and sound short, and stops movement', wall.sight === sense.LIMITED && wall.light === sense.LIMITED && wall.sound === sense.LIMITED && wall.move === sense.NORMAL);
    }
    {
        const { wall } = await written('ethereal');
        check('an ethereal wall stops sight, light and sound, and not movement', wall.move === sense.NONE && wall.sight === sense.NORMAL && wall.light === sense.NORMAL);
    }
    {
        const { wall } = await written('door');
        check('a door is a door, closed', wall.door === CONST.WALL_DOOR_TYPES.DOOR && wall.ds === CONST.WALL_DOOR_STATES.CLOSED && wall.move === sense.NORMAL);
    }
    {
        const { wall } = await written('door', t => { t.state.wallDoor = 'open'; });
        check('an open door is drawn open', wall.ds === CONST.WALL_DOOR_STATES.OPEN);
    }
    {
        const { wall } = await written('door', t => { t.state.wallDoor = 'locked'; });
        check('a locked door is drawn locked', wall.ds === CONST.WALL_DOOR_STATES.LOCKED);
    }
    {
        const { wall } = await written('secret', t => { t.state.wallDoor = 'locked'; });
        check('a secret door is a secret door, in the state chosen', wall.door === CONST.WALL_DOOR_TYPES.SECRET && wall.ds === CONST.WALL_DOOR_STATES.LOCKED);
    }
    {
        const { wall } = await written('window');
        check('a window lets light and sight through close up, fading over two squares', wall.light === sense.PROXIMITY && wall.sight === sense.PROXIMITY && wall.threshold.light === 10 && wall.threshold.sight === 10 && wall.threshold.attenuation === true);
        check('and still stops movement and sound', wall.move === sense.NORMAL && wall.sound === sense.NORMAL);
    }
    for (const kind of ['wall', 'invisible', 'terrain', 'ethereal', 'door', 'secret', 'window']) {
        const { wall, line } = await written(kind);
        check(`${kind}: the wall and its line carry the kind, and the line is its colour`, wall.flags[MODULE.ID].drawnWall.kind === kind && line.strokeColor === wallKindById(kind).color);
    }
    {
        const { wall } = await written('nonsense');
        check('an unknown kind is a plain wall', !('door' in wall) && !('light' in wall) && wall.flags[MODULE.ID].drawnWall.kind === 'wall');
    }
    {
        const { tool } = await written('door');
        const entry = tool._kept.at(-1);
        await tool._undoKept();
        check('undoing a door takes the door and its line', scene.walls.size === 0 && scene.drawings.size === 0 && entry.kind === 'wall');
    }
    {
        scene = makeScene();
        const tool = make();
        const saved = [];
        game.settings.set = (...args) => saved.push(args);
        tool.state.drawingMode = 'sketch';
        tool.setWallOption('kind', 'door');
        tool.setWallOption('door', 'locked');
        tool.setWallOption('kind', 'nonsense');
        tool.setWallOption('door', 'ajar');
        check('the kind and the door state are chosen, and nonsense is refused', tool.state.wallKind === 'door' && tool.state.wallDoor === 'locked');
        check('and remembered with the shape and snap', JSON.stringify(saved.at(-1)[2]) === JSON.stringify({ shape: 'line', snap: true, kind: 'door', door: 'locked' }));
        game.settings.set = () => {};
        tool.state.drawingMode = 'sketch';
        isGM = false;
        tool.setDrawingMode = mode => { tool.mode = mode; };
        tool.chooseWall('door');
        check('a player cannot pick a kind of wall', tool.mode === undefined);
        isGM = true;
    }
}

console.log('\nundo');
{
    scene = makeScene();
    const tool = make();
    await tool.createWallStroke([[0, 0], [300, 0]]);
    await tool.createWallStroke([[0, 100], [300, 100]]);
    check('two strokes, two things to take back', tool._kept.length === 2 && scene.walls.size === 2 && scene.drawings.size === 12);
    await tool._undoKept();
    check('undo takes back the last wall and its line, and no more', scene.walls.size === 1 && scene.drawings.size === 6 && tool._kept.length === 1);
    const remaining = [...scene.walls.map.values()][0];
    check('and it is the first that is left', remaining.c.join() === '0,0,300,0');
    await tool._undoKept();
    check('undo again leaves the scene as it was', scene.walls.size === 0 && scene.drawings.size === 0);
    await tool._undoKept();
    check('undo with nothing to take back does nothing', scene.walls.size === 0 && !tool.canUndo());
}
{
    scene = makeScene();
    const tool = make();
    await tool.createWallStroke([[0, 0], [300, 0]]);
    scene.walls.map.clear();
    await tool._undoKept();
    check('if the wall was already deleted by hand, its line still goes and nothing throws', scene.drawings.size === 0);
}
{
    scene = makeScene();
    const tool = make();
    tool._lastDrawing = { id: 'tmp', createdAt: Date.now() - 5000 };
    await tool.createWallStroke([[0, 0], [300, 0]]);
    check('a wall drawn after a temporary drawing is undone first', tool._keptIsNewest());
    tool._kept = [];
    check('with nothing kept, the temporary drawing is', !tool._keptIsNewest());
    tool._lastDrawing = null;
    check('and with neither there is nothing to undo', !tool._keptIsNewest() && !tool.canUndo());
    tool._lastDrawing = { id: 'tmp', createdAt: Date.now() };
    await tool.createWallStroke([[0, 0], [300, 0]]);
    tool._lastDrawing = { id: 'later', createdAt: Date.now() + 10000 };
    check('a temporary drawing made after the wall is undone first', !tool._keptIsNewest());
}

console.log('\na stamp, temporary');
{
    scene = makeScene();
    added.length = 0;
    const tool = make();
    tool.state.drawingMode = 'stamp';
    tool._placeStamp('tree', 640, 480);
    const record = tool._pixiDrawings[0];
    check('it is a graphic on the canvas layer and a record', tool.services.canvasLayer.added.length === 1 && tool._pixiDrawings.length === 1 && record.stampKind === 'tree');
    check('it is the one to undo, and cleanup is scheduled', tool._lastDrawing === record && tool.scheduled === true);
    check('it is broadcast with everything needed to draw it elsewhere', added.length === 1 && ['stampKind', 'seed', 'rotation', 'mirror', 'size', 'x', 'y', 'drawingId', 'userId'].every(k => added[0][k] !== undefined));
    check('the size is a tree at medium: 80 by the stamp scale, give or take the variation', added[0].size > 80 * 1.5 * 0.84 && added[0].size < 80 * 1.5 * 1.16);
    check('natural colours: no tint is sent', added[0].tint === null);
    check('nothing is written to the scene', scene.creates.length === 0);
    check('a legacy marker is not placed this way', (() => { const t = make(); t._placeStamp('plus', 0, 0); return t._pixiDrawings.length === 0; })());
    check('an unknown stamp is not placed', (() => { const t = make(); t._placeStamp('nonsense', 0, 0); return t._pixiDrawings.length === 0; })());
    const remote = make();
    remote.createRemoteStamp(added[0]);
    check('another client draws the same stamp from what was sent', remote._pixiDrawings.length === 1 && remote._pixiDrawings[0].id === added[0].drawingId && remote._pixiDrawings[0].userId === 'u1');
    const mine = tool.services.canvasLayer.added[0].calls;
    const theirs = remote.services.canvasLayer.added[0].calls;
    check('and it is drawn identically, shape for shape', JSON.stringify(mine) === JSON.stringify(theirs));
    const tinted = make();
    tinted.state.stamp.natural = false;
    added.length = 0;
    tinted._placeStamp('tree', 0, 0);
    check('with natural colours off the brush colour is the tint', added[0].tint === 'rgba(186, 60, 49, 0.7)');
    const small = make();
    small.state.symbolSize = 'small';
    small.state.stamp.jitter = false;
    added.length = 0;
    small._placeStamp('rock', 0, 0);
    check('without variation the size is exact: small, by the rock\'s scale', added[0].size === 40 * stampById('rock').scale);
    const flat = make();
    flat.state.stamp.rotate = false;
    added.length = 0;
    flat._placeStamp('tree', 0, 0);
    check('with turning off a stamp is not turned or flipped', added[0].rotation === 0 && added[0].mirror === false);
}
{
    const tool = make();
    const first = tool._peekRoll();
    check('the roll is kept until it is used, so the preview is what is placed', tool._peekRoll() === first);
    check('and using it rolls the next', tool._takeRoll() === first && tool._peekRoll() !== first);
}

console.log('\na stamp, kept on the scene');
{
    scene = makeScene();
    const tool = make();
    tool.state.stamp.keep = true;
    tool._placeStamp('shrub', 640, 480);
    await new Promise(resolve => setTimeout(resolve, 10));
    const drawings = scene.creates.filter(([type]) => type === 'Drawing');
    check('it is written as Drawings, in one batch', drawings.length === 1 && drawings[0][1].length > 3);
    check('and not as a temporary graphic', tool._pixiDrawings.length === 0 && tool.services.canvasLayer.added.length === 0);
    check('every Drawing carries the stamp flag with one group', new Set(drawings[0][1].map(d => d.flags[MODULE.ID].stamp.id)).size === 1 && drawings[0][1][0].flags[MODULE.ID].stamp.kind === 'shrub');
    check('it is one thing to take back', tool._kept.length === 1 && tool._kept[0].kind === 'stamp' && tool._kept[0].drawingIds.length === drawings[0][1].length);
    await tool._undoKept();
    check('and undo removes every piece of it', scene.drawings.size === 0);
}
{
    scene = makeScene();
    canCreate = false;
    isGM = false;
    const tool = make();
    tool.state.stamp.keep = true;
    tool._placeStamp('shrub', 0, 0);
    await new Promise(resolve => setTimeout(resolve, 10));
    check('a user who may not create drawings gets a temporary stamp instead', scene.creates.length === 0 && tool._pixiDrawings.length === 1);
    canCreate = true;
    isGM = true;
}
{
    scene = makeScene();
    scene.failNext = 'Drawing';
    notices.length = 0;
    const tool = make();
    tool.state.stamp.keep = true;
    tool._placeStamp('shrub', 0, 0);
    await new Promise(resolve => setTimeout(resolve, 10));
    check('if the scene refuses, the user is told and nothing is left to undo', notices.some(n => /Could not keep/.test(n.title)) && tool._kept.length === 0);
}

console.log('\na path');
{
    scene = makeScene();
    added.length = 0;
    const tool = make();
    tool.state.drawingMode = 'terrain';
    const stroke = [];
    for (let i = 0; i <= 30; i++) stroke.push([100 + i * 20, 300 + 40 * Math.sin(i / 4)]);
    tool.createTerrainPath(stroke);
    check('a path is a graphic on the canvas layer and a record', tool.services.canvasLayer.added.length === 1 && tool._pixiDrawings.length === 1 && tool._pixiDrawings[0].terrainKind === 'dirt');
    check('it is the one to undo', tool._lastDrawing === tool._pixiDrawings[0]);
    check('it is broadcast with its line and seed, not the hand-drawn points', added.length === 1 && Array.isArray(added[0].path) && added[0].seed > 0 && added[0].width === 100 && added[0].terrainKind === 'dirt');
    check('the line sent is whole and even', added[0].path.length % 2 === 0 && added[0].path.every(Number.isFinite));
    check('nothing is written to the scene', scene.creates.length === 0);
    const remote = make();
    remote.createRemoteTerrain(added[0]);
    check('another client draws the same path from it', remote._pixiDrawings.length === 1 && JSON.stringify(remote.services.canvasLayer.added[0].calls) === JSON.stringify(tool.services.canvasLayer.added[0].calls));
    check('a width of two squares is two grid sizes', (() => { const t = make(); t.state.stamp.pathWidth = 2; return t._pathWidthPixels() === 200; })());
    check('a hairline width has a floor', (() => { const t = make(); t.state.stamp.pathWidth = 0.01; return t._pathWidthPixels() >= 12; })());
    check('an unknown kind falls back to dirt', (() => { const t = make(); t.state.stamp.terrain = 'lava'; return t._terrainKind() === 'dirt'; })());
    const tiny = make();
    tiny.createTerrainPath([[5, 5], [5, 5]]);
    check('a click with no drag lays nothing', tiny._pixiDrawings.length === 0);
    const kept = make();
    kept.state.stamp.keep = true;
    kept.state.stamp.terrain = 'gravel';
    kept.createTerrainPath(stroke);
    await new Promise(resolve => setTimeout(resolve, 10));
    const drawings = scene.creates.filter(([type]) => type === 'Drawing');
    check('kept, it is written as Drawings in one batch, and not as a graphic', drawings.length === 1 && kept._pixiDrawings.length === 0 && drawings[0][1].length > 3);
    check('kept, it is flagged as terrain with one group', new Set(drawings[0][1].map(d => d.flags[MODULE.ID].terrain.id)).size === 1 && drawings[0][1][0].flags[MODULE.ID].terrain.kind === 'gravel');
    check('kept, the texture is held to what a scene should carry', drawings[0][1].length <= 3 + MAX_TEXTURE.scene);
    check('kept, the ribbon is stroked at the width of the path', drawings[0][1][1].strokeWidth === 100);
    check('kept, it is one thing to take back', kept._kept.length === 1 && kept._kept[0].kind === 'path');
    await kept._undoKept();
    check('and undo removes every piece of it', scene.drawings.size === 0);
}

console.log('\nscattering');
{
    added.length = 0;
    const tool = make();
    tool.state.drawingMode = 'stamp';
    tool.state.stamp.jitter = false;
    tool._beginScatter({ x: 100, y: 100 });
    check('dragging after a nature stamp scatters more', tool._scatter && tool._scatter.x === 100);
    tool._scatterTo({ x: 105, y: 100 });
    check('a short move places nothing', tool._pixiDrawings.length === 0);
    const step = 80 * stampById('tree').scale * 0.6;
    tool._scatterTo({ x: 100 + step * 1.5, y: 100 });
    check('a move of enough places another', tool._pixiDrawings.length === 1);
    tool._scatterTo({ x: 100 + step * 3.5, y: 100 });
    check('and again further on, one for each step along the way', tool._pixiDrawings.length === 3);
    const wide = make();
    wide.state.stamp.spacing = 3;
    wide._beginScatter({ x: 0, y: 0 });
    wide._scatterTo({ x: step * 1.5, y: 0 });
    check('wider spacing means fewer', wide._pixiDrawings.length === 0);
    const marker = make();
    marker.state.stampStyle = 'plus';
    marker._beginScatter({ x: 0, y: 0 });
    check('a marker does not scatter', marker._scatter === null);
}

console.log('\ndrawing from the window: press, drag, release');
{
    const calls = [];
    const recorder = () => {
        const tool = make();
        tool.state.active = true;
        tool.state.isDrawing = false;
        for (const name of ['startDrawing', 'startLineDrawing', 'startBoxDrawing', 'startEllipseDrawing', 'updateDrawing', 'updateLinePreview', 'updateBoxPreview', 'updateEllipsePreview', 'finishDrawing', 'finishLineDrawing', 'finishBoxDrawing', 'finishEllipseDrawing', 'cancelDrawing', 'stampSymbol', '_eraseAtEvent', '_previewEraser', '_commitErase']) {
            tool[name] = () => { calls.push(name); if (name.startsWith('start') && name !== 'stampSymbol') tool.state.isDrawing = true; if (name.startsWith('finish') || name === 'cancelDrawing') tool.state.isDrawing = false; };
        }
        tool.canUserDraw = () => true;
        tool.updatePreviewSymbol = () => calls.push('preview');
        return tool;
    };
    const event = (extra = {}) => ({ button: 0, buttons: 1, clientX: 100, clientY: 100, x: 100, y: 100, pointerId: 1, ctrlKey: false, altKey: false, metaKey: false, prevented: 0, preventDefault() { this.prevented++; }, stopPropagation() {}, stopImmediatePropagation() {}, ...extra });
    canvas.app = { view: { setPointerCapture() {}, releasePointerCapture() {} } };

    const modes = [['sketch', 'startDrawing', 'updateDrawing', 'finishDrawing'], ['line', 'startLineDrawing', 'updateLinePreview', 'finishLineDrawing'], ['box', 'startBoxDrawing', 'updateBoxPreview', 'finishBoxDrawing'], ['ellipse', 'startEllipseDrawing', 'updateEllipsePreview', 'finishEllipseDrawing']];
    for (const [mode, start, update, finish] of modes) {
        calls.length = 0;
        const tool = recorder();
        tool.state.drawingMode = mode;
        tool._windowPointerMove(event({ buttons: 0 }));
        check(`${mode}: moving the pointer with no button down starts nothing`, calls.length === 0 && !tool.state.isDrawing);
        tool._windowPointerDown(event());
        check(`${mode}: pressing starts the stroke`, calls.join() === start && tool.state.isDrawing);
        tool._windowPointerMove(event({ clientX: 160 }));
        check(`${mode}: dragging updates it`, calls.includes(update));
        tool._windowPointerUp(event({ clientX: 220 }));
        check(`${mode}: letting go finishes it`, calls.at(-1) === finish && !tool.state.isDrawing);
    }
    {
        calls.length = 0;
        const tool = recorder();
        tool.state.drawingMode = 'box';
        tool._windowPointerDown(event());
        tool._windowPointerUp(event({ clientX: 101 }));
        check('a click with no drag draws nothing', calls.join() === 'startBoxDrawing,cancelDrawing');
    }
    {
        calls.length = 0;
        const tool = recorder();
        tool.state.drawingMode = 'wall';
        tool.state.wallShape = 'line';
        tool._windowPointerDown(event());
        tool._windowPointerUp(event({ clientX: 300 }));
        check('wall, straight, strokes as a line', calls.join() === 'startLineDrawing,finishLineDrawing');
        calls.length = 0;
        tool.state.wallShape = 'sketch';
        tool._windowPointerDown(event());
        tool._windowPointerUp(event({ clientX: 300 }));
        check('wall, freehand, strokes as a sketch', calls.join() === 'startDrawing,finishDrawing');
        calls.length = 0;
        tool.state.drawingMode = 'terrain';
        tool._windowPointerDown(event());
        tool._windowPointerUp(event({ clientX: 300 }));
        check('terrain strokes as a sketch', calls.join() === 'startDrawing,finishDrawing');
    }
    {
        calls.length = 0;
        const tool = recorder();
        tool.state.drawingMode = 'sketch';
        const right = event({ button: 2 });
        tool._windowPointerDown(right);
        const ctrl = event({ ctrlKey: true });
        tool._windowPointerDown(ctrl);
        tool._windowPointerDown(event({ altKey: true }));
        check('right-drag, Ctrl and Alt are left to Foundry: nothing starts and nothing is swallowed', calls.length === 0 && right.prevented === 0 && ctrl.prevented === 0);
        const left = event();
        tool._windowPointerDown(left);
        check('the left button is swallowed so Foundry does not also act on it', left.prevented === 1);
        tool.state.active = false;
        calls.length = 0;
        tool._windowPointerDown(event());
        check('when drawing is stopped the pointer is Foundry\'s again', calls.length === 0);
        tool.canUserDraw = () => false;
        tool.state.active = true;
        tool._windowPointerDown(event());
        check('a user who may not draw cannot start', calls.length === 0);
    }
    {
        calls.length = 0;
        const tool = recorder();
        tool.state.drawingMode = 'erase';
        tool._windowPointerMove(event({ buttons: 0 }));
        check('the eraser shows its circle before it is pressed, and erases nothing', calls.join() === '_previewEraser');
        calls.length = 0;
        tool._windowPointerDown(event());
        check('pressing erases there at once', calls.join() === '_eraseAtEvent' && tool._erasing === true);
        calls.length = 0;
        tool._windowPointerMove(event({ clientX: 140 }));
        check('dragging erases along the way', calls.join() === '_eraseAtEvent,_previewEraser');
        calls.length = 0;
        tool._windowPointerUp(event());
        check('letting go closes the stroke, as one thing to undo', calls.join() === '_commitErase' && tool._erasing === false);
        calls.length = 0;
        tool._windowPointerMove(event({ buttons: 0, clientX: 300 }));
        check('moving about afterwards erases nothing', calls.join() === '_previewEraser');
    }
    {
        calls.length = 0;
        const tool = recorder();
        tool.state.drawingMode = 'stamp';
        tool.state.stampStyle = 'tree';
        tool._windowPointerMove(event({ buttons: 0 }));
        check('in stamp mode the preview follows the pointer', calls.join() === 'preview');
        calls.length = 0;
        tool._windowPointerDown(event());
        check('pressing puts a stamp down and begins a scatter', calls.join() === 'stampSymbol' && tool._scatter !== null);
        tool._windowPointerUp(event());
        check('letting go ends the scatter', tool._scatter === null);
    }
}

console.log('\nthe press is taken before the canvas sees it');
{
    check('the press is listened for on the window, in the capture phase', src.includes("window.addEventListener('pointerdown', this._handleWindowDown, true)"));
    check('and the listener is taken off again', src.includes("window.removeEventListener('pointerdown', this._handleWindowDown, true)"));
    check('only a press on the canvas itself is taken', /_handleWindowDown = \(event\) => \{\s*if \(!self\._fromWindow \|\| event\.target !== canvas\.app\?\.view\) return;/.test(src));
    check('the canvas\'s own press handler leaves the window\'s way alone, so a press is not handled twice', /_handlePointerDown = \(event\) => \{[^}]*if \(self\._fromWindow\) return false;/s.test(src));
}

console.log('\nthe eraser');
{
    const strokeAndErase = async (setup, at) => {
        scene = makeScene();
        const tool = make();
        await setup(tool);
        tool._eraseAt(at[0], at[1]);
        await tool._commitErase();
        return tool;
    };
    {
        const tool = await strokeAndErase(t => t.createWallStroke([[0, 0], [400, 0]]), [200, 8]);
        check('erasing on a wall stroke takes the wall and its line', scene.walls.size === 0 && scene.drawings.size === 0);
        const entry = tool._kept.at(-1);
        check('and is one thing to undo, holding both', entry.kind === 'erase' && entry.restore.Wall.length === 1 && entry.restore.Drawing.length === 6);
        await tool._undoKept();
        check('undo puts back the wall and the line, with their own ids', scene.walls.size === 1 && scene.drawings.size === 6 && scene.walls.has(entry.restore.Wall[0]._id));
        check('what comes back is what went: the same wall', [...scene.walls.map.values()][0].c.join() === '0,0,400,0');
    }
    {
        await strokeAndErase(t => t.createWallStroke([[0, 0], [400, 0]]), [200, 300]);
        check('erasing away from it takes nothing', scene.walls.size === 1 && scene.drawings.size === 6);
    }
    {
        const tool = await strokeAndErase(async t => { t.state.stamp.keep = true; t._placeStamp('shrub', 640, 480); await new Promise(r => setTimeout(r, 10)); }, [640, 480]);
        check('erasing on a kept stamp takes every piece of it', scene.drawings.size === 0 && tool._kept.at(-1).kind === 'erase');
    }
    {
        scene = makeScene();
        const tool = make();
        tool.state.stamp.keep = true;
        tool._placeStamp('shrub', 640, 480);
        await new Promise(r => setTimeout(r, 10));
        tool._placeStamp('tree', 1500, 480);
        await new Promise(r => setTimeout(r, 10));
        const before = scene.drawings.size;
        tool._eraseAt(640, 480);
        await tool._commitErase();
        check('only the stamp under it goes; the other stays', scene.drawings.size > 0 && scene.drawings.size < before);
    }
    {
        scene = makeScene();
        const tool = make();
        await scene.createEmbeddedDocuments('Drawing', [{ x: 0, y: 0, shape: { type: 'p', width: 100, height: 100, points: [0, 0, 100, 0, 100, 100, 0, 100] }, fillType: 1, fillAlpha: 1, strokeWidth: 0, strokeAlpha: 0, flags: {} }]);
        tool._eraseAt(50, 50);
        await tool._commitErase();
        check('a Drawing the tools did not make is left alone', scene.drawings.size === 1 && tool._kept.length === 0);
    }
    {
        scene = makeScene();
        const tool = make();
        tool.state.stamp.terrain = 'dirt';
        tool.state.stamp.keep = true;
        const stroke = [];
        for (let i = 0; i <= 20; i++) stroke.push([100 + i * 20, 300]);
        tool.createTerrainPath(stroke);
        await new Promise(r => setTimeout(r, 10));
        tool._eraseAt(300, 310);
        await tool._commitErase();
        check('a kept path goes from anywhere along it', scene.drawings.size === 0);
    }
    {
        scene = makeScene();
        const tool = make();
        await tool.createWallStroke([[0, 0], [400, 0]]);
        for (const doc of scene.drawings) doc.isOwner = false;
        isGM = false;
        tool._eraseAt(200, 0);
        await tool._commitErase();
        check('a player cannot erase what is not theirs', scene.drawings.size === 6 && scene.walls.size === 1);
        isGM = true;
    }
    {
        scene = makeScene();
        const tool = make();
        tool._pixiDrawings = [
            { id: 'a', userId: 'u1', startX: 0, startY: 0, points: [[0, 0], [200, 0]], strokeWidth: 6 },
            { id: 'b', userId: 'u1', startX: 0, startY: 200, points: [[0, 0], [200, 0]], strokeWidth: 6 },
            { id: 'c', userId: 'u2', startX: 0, startY: 0, points: [[0, 0], [200, 0]], strokeWidth: 6 },
            { id: 'd', userId: 'u1', type: 'box', graphics: { getLocalBounds: () => ({ x: 400, y: 400, width: 100, height: 100 }) } },
            { id: 'e', userId: 'u1', terrainKind: 'dirt', path: [0, 600, 300, 600], width: 80 }
        ];
        tool._eraseAt(100, 10);
        check('the eraser takes a sketch it is near, and not one further off', tool.deleted.includes('a') && !tool.deleted.includes('b'));
        isGM = false;
        tool._eraseAt(450, 450);
        check('and a box by its bounds', tool.deleted.includes('d'));
        tool._eraseAt(150, 590);
        check('and a path by its line and width', tool.deleted.includes('e'));
        tool._pixiDrawings.push({ id: 'f', userId: 'u2', startX: 0, startY: 800, points: [[0, 0], [200, 0]], strokeWidth: 6 });
        tool._eraseAt(100, 800);
        check('a player cannot take another player\'s sketch', !tool.deleted.includes('f'));
        isGM = true;
        tool._eraseAt(100, 800);
        check('the GM can', tool.deleted.includes('f'));
    }
    {
        const tool = make();
        check('the eraser reaches about a third of a grid square', tool._eraserRadius() === 30);
    }
    {
        scene = makeScene();
        const tool = make();
        await tool.createWallStroke([[0, 0], [400, 0]]);
        await tool.createWallStroke([[0, 300], [400, 300]]);
        confirmAnswer = false;
        await tool.eraseAllKept();
        check('erase all asks first, and does nothing if refused', scene.walls.size === 2 && scene.drawings.size === 12);
        confirmAnswer = true;
        await tool.eraseAllKept();
        check('erase all takes every stroke, walls and lines', scene.walls.size === 0 && scene.drawings.size === 0);
        const entry = tool._kept.at(-1);
        check('as one thing to undo', entry.kind === 'erase' && entry.restore.Wall.length === 2 && entry.restore.Drawing.length === 12);
        await tool._undoKept();
        check('which puts them all back', scene.walls.size === 2 && scene.drawings.size === 12);
        isGM = false;
        scene.creates.length = 0;
        await tool.eraseAllKept();
        check('a player cannot erase all', scene.walls.size === 2);
        isGM = true;
        scene = makeScene();
        notices.length = 0;
        await make().eraseAllKept();
        check('with nothing drawn it says so', notices.some(n => /Nothing to erase/.test(n.title)));
    }
    {
        const tool = make();
        tool.state.drawingMode = 'erase';
        savedMode = 'box';
        tool._leaveErase();
        check('putting the eraser down goes back to the tool that was remembered', tool.state.drawingMode === 'box');
        tool._leaveErase();
        check('and does nothing when it was not the eraser', tool.state.drawingMode === 'box');
        savedMode = 'nonsense';
        tool.state.drawingMode = 'erase';
        tool._leaveErase();
        check('a remembered tool that is not a tool becomes a sketch', tool.state.drawingMode === 'sketch');
        check('the eraser is never remembered', /if \(mode !== 'erase'\) game\.settings\.set\(MODULE\.ID, 'toolbar\.drawingMode', mode\)/.test(src));
    }
}

console.log('\nthe scene');
{
    scene = makeScene();
    scene.tokenVision = true;
    scene.environment = { globalLight: { enabled: false }, darknessLevel: 0.3 };
    const tool = make();
    check('the scene is read as it is', JSON.stringify(tool.sceneState()) === JSON.stringify({ tokenVision: true, globalLight: false, darkness: 0.3 }));
    await tool.setSceneOption('tokenVision', false);
    await tool.setSceneOption('globalLight', true);
    await tool.setSceneOption('darkness', '0.6');
    check('each change is one update of the right field', JSON.stringify(scene.updates) === JSON.stringify([{ tokenVision: false }, { 'environment.globalLight.enabled': true }, { 'environment.darknessLevel': 0.6 }]));
    await tool.setSceneOption('darkness', 7);
    check('darkness is held between none and full', scene.updates.at(-1)['environment.darknessLevel'] === 1);
    scene.updates.length = 0;
    await tool.setSceneOption('nonsense', 1);
    check('an unknown option changes nothing', scene.updates.length === 0);
    isGM = false;
    await tool.setSceneOption('tokenVision', false);
    check('a player cannot change the scene', scene.updates.length === 0 && !tool.canSetScene());
    isGM = true;
    check('a GM can', tool.canSetScene());
}

console.log('\npainting ground: a drag that does not stop');
{
    scene = makeScene();
    added.length = 0;
    const tool = make();
    tool.state.drawingMode = 'stamp';
    tool.state.stampStyle = 'patch-dirt';
    tool.state.stamp.jitter = false;
    const treeStep = make()._scatterStep('tree');
    const patchStep = tool._scatterStep('patch-dirt');
    check('ground is painted at a fraction of its size, so dabs run together', patchStep === 80 * 2.0 * 0.2 && patchStep < 80 * 2.0 * 0.5);
    check('where a tree is put down further apart', treeStep === 80 * 1.5 * 0.6);
    check('wider spacing spreads it, and it never falls below a few pixels', (() => { const t = make(); t.state.stamp.spacing = 3; return t._scatterStep('patch-dirt') === patchStep * 3 && (() => { t.state.symbolSize = 'small'; t.state.stamp.spacing = 0.01; return t._scatterStep('patch-dirt') >= 6; })(); })());
    tool._beginScatter({ x: 0, y: 0 });
    tool.stampSymbol = () => tool._placeStamp('patch-dirt', 0, 0);
    tool.stampSymbol();
    tool._scatterTo({ x: patchStep * 10.5, y: 0 });
    check('one fast drag across ten steps leaves a dab at each, with no gaps', tool._pixiDrawings.length === 11);
    const xs = tool._pixiDrawings.map(d => d.x).sort((a, b) => a - b);
    check('they are evenly along the drag', xs.slice(1).every((x, i) => x - xs[i] < patchStep * 1.2 && x - xs[i] > patchStep * 0.8));
    check('they are one stroke', new Set(tool._pixiDrawings.map(d => d.group)).size === 1 && !!tool._pixiDrawings[0].group);
    tool._scatterTo({ x: patchStep * 10.9, y: 0 });
    check('a little further than the last dab places nothing until a step is made', tool._pixiDrawings.length === 11);
    const before = tool._pixiDrawings.length;
    tool._scatterTo({ x: 1e6, y: 0 });
    check('one stroke is held to a cap, so it cannot bury the scene', tool._pixiDrawings.length <= MAX_SCATTER + 1 && tool._pixiDrawings.length > before);
    tool._endScatter();
    check('letting go ends the stroke', tool._scatter === null);
    tool._lastDrawing = tool._pixiDrawings.at(-1);
    tool.undoLastDrawing();
    check('undo takes back the whole stroke, not a dab', tool._pixiDrawings.length === 0);
    check('and tells everyone, dab by dab', tool.broadcastDeleted.length > 300);
}
{
    scene = makeScene();
    const tool = make();
    tool.state.stampStyle = 'patch-dirt';
    tool.state.stamp.keep = true;
    tool.state.stamp.jitter = false;
    const step = tool._scatterStep('patch-dirt');
    tool._beginScatter({ x: 0, y: 0 });
    tool._placeStamp('patch-dirt', 0, 0);
    tool._scatterTo({ x: step * 4.2, y: 0 });
    await new Promise(resolve => setTimeout(resolve, 10));
    check('kept ground is not written while the button is down', scene.creates.length === 0 && tool._kept.length === 0);
    check('it is drawn faintly meanwhile, a dab at a time', tool.services.canvasLayer.added.length === 5 && tool._scatter.live.length === 5);
    const firstDocs = tool._scatter.docs.length;
    const stroke = tool._scatter;
    tool._endScatter();
    await new Promise(resolve => setTimeout(resolve, 10));
    const written = scene.creates.filter(([type]) => type === 'Drawing');
    check('when it comes up the whole stroke is written in one batch', written.length === 1 && written[0][1].length === tool._kept[0].drawingIds.length);
    check('and is one thing to undo', tool._kept.length === 1 && tool._kept[0].kind === 'stamp');
    check('the faint stand-ins are taken away', tool.services.canvasLayer.added.length === 5 && tool.services.canvasLayer.added.every(g => g.destroyed));
    const patches = written[0][1];
    const perFirst = stampDrawingData(buildStamp('patch-dirt', {}), stampPalette('patch-dirt'), { x: 0, y: 0, size: 160 }).length;
    check('later dabs keep only a few specks, so a long stroke stays light', patches.length < perFirst * 5 && patches.length > perFirst);
    const byGroup = new Map();
    for (const d of patches) byGroup.set(d.flags[MODULE.ID].stamp.id, (byGroup.get(d.flags[MODULE.ID].stamp.id) ?? 0) + 1);
    const counts = [...byGroup.values()];
    check('the first dab has all its texture, and each later one a few specks of it', counts[0] === perFirst && counts.slice(1).every(n => n > 6 && n < perFirst));
    check('what was shown while the button was down is what was written, dab for dab', stroke.live.map(g => g.calls.filter(c => c[0] === 'drawPolygon').length).join() === counts.join());
    check('every dab is its own group, so the eraser can carve the ground', new Set(patches.map(d => d.flags[MODULE.ID].stamp.id)).size === 5);
    await tool._undoKept();
    check('undo takes the whole stroke off the scene', scene.drawings.size === 0);
}
{
    scene = makeScene();
    const tool = make();
    tool.state.stampStyle = 'tree';
    tool.state.stamp.keep = true;
    tool._placeStamp('tree', 100, 100);
    await new Promise(resolve => setTimeout(resolve, 10));
    check('a single stamp, no stroke, is still written at once', scene.creates.filter(([type]) => type === 'Drawing').length === 1);
}

console.log('\nwhat the user may do');
{
    isGM = true;
    check('a GM may make walls and keep stamps', make().canMakeWalls() && make().canKeepOnScene());
    isGM = false;
    canCreate = true;
    check('a player may not make walls, but may keep stamps if the world lets them', !make().canMakeWalls() && make().canKeepOnScene());
    canCreate = false;
    check('a player the world will not let create drawings may not keep stamps', !make().canKeepOnScene());
    isGM = true;
    canCreate = true;
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);

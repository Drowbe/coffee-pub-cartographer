// ==================================================================
// ===== AUTO-WALL: WALLS, DOORS AND WINDOWS ========================
// ==================================================================
//
// The GM clicks a wall on the scene's image and the walls along it are drawn.
// Then, in the other two modes, a click on a door or a window fits one into
// the gap between the wall ends on either side of it.
//
// The picture work is in utils-autowall.js and knows nothing of Foundry; this
// file is the Foundry side of it: reading the scene image, where the click
// lands, the preview over the map, and writing the walls -- tagged, so the
// last run can be taken back whole. The window the GM works in is
// window-autowall.js; it holds no state, and this is where the run lives.

import { MODULE } from './const.js';
import { cartographerToolbar } from './manager-toolbar.js';
import { labBuffer, mapWall, mapOpening, findOpening, cleanupEnds, splitSegmentAt, mergeStraightAt, mergeWalls, openingOnWall, splitWallAt, countNearEnds, SKIP_JOIN } from './utils-autowall.js';
import { AutoWallWindow } from './window-autowall.js';

/** The section of Cartographer's sub-menubar these sit in; registered in manager-toolbar.js. */
const GROUP = 'Walls';
const IDS = {
    map: `${MODULE.ID}-autowall-map`,
    undo: `${MODULE.ID}-autowall-undo`
};
/** Scene flag on every wall this makes: { run, kind }, where run is when it was drawn. */
const FLAG = 'autoWall';
/** The widest the picture is read at, in pixels. A bigger image is shrunk to this to stay quick. */
const MAX_WORK_SIZE = 2400;
/** How far, in screen pixels, a click may move and still be a click, not a drag. */
const CLICK_PIXELS = 4;
/** How near, in screen pixels, the pointer must be to the end of a wall to take hold of it. */
const HANDLE_PIXELS = 12;
/** Two clicks this close in time, in ms, and in screen pixels, on a wall found, are a double-click. */
const DOUBLE_CLICK_MS = 450;
const DOUBLE_CLICK_PIXELS = 8;
/** How near, in grid squares, a wall end must be to an end of a door or window to be fitted to it. */
const ATTACH_SQUARES = 1.25;
/** The longest, in grid squares, a door or window may be. More is taken to be a flood into the wall. */
const MAX_OPENING_SQUARES = 4;
/** The modes, in the order the walls should be done in. */
const MODES = ['wall', 'door', 'window'];
const HINTS = { wall: 'hint', door: 'hintDoor', window: 'hintWindow' };
/** How long, in ms, the controls settle before the walls are worked out again. */
const SETTLE_MS = 160;
const STORE_KEY = `${MODULE.ID}.autowall.options.v2`;

/** What the controls start at, and the limits they move between. */
const DEFAULTS = {
    mode: 'wall', tab: 'map', joinEnds: true, joinDistance: 0.3, match: 20, smoothing: 0.3, widest: 1, snap: false,
    doorState: 'closed', doorSound: '', doorAnimation: '',
    windowDistance: 2, windowAttenuation: true
};
const LIMITS = {
    match: { min: 8, max: 36, step: 1 },
    smoothing: { min: 0.05, max: 1, step: 0.05 },
    widest: { min: 0.25, max: 3, step: 0.05 },
    windowDistance: { min: 0.5, max: 6, step: 0.5 },
    joinDistance: { min: 0.05, max: 1, step: 0.05 }
};

function readOptions() {
    try {
        return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') };
    } catch {
        return { ...DEFAULTS };
    }
}

function writeOptions(options) {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(options));
    } catch {
        // Not remembering is only a convenience lost.
    }
}

class AutoWallManager {
    constructor() {
        this._hooks = [];
        /** The run in progress: { seeds, options, image, result, segments }, or null. segments are the walls in scene pixels, which the GM may drag. */
        this.session = null;
        /** The window the run is worked in. */
        this.window = null;
        /** The clean-up that can be taken back: { sceneId, walls: [{ _id, c }] }, or null. */
        this._cleanupUndo = null;
        this._container = null;
        this._timer = null;
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onDragMove = this._onDragMove.bind(this);
        this._onDragEnd = this._onDragEnd.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
    }

    initialize() {
        if (!game.user.isGM) return;
        this._registerButtons();
        this._hooks.push({ name: 'canvasTearDown', id: Hooks.on('canvasTearDown', () => this.cancel()) });
    }

    _registerButtons() {
        const localize = key => game.i18n.localize(`${MODULE.ID}.autowall.${key}`);
        cartographerToolbar.registerTool(IDS.map, {
            icon: 'fa-solid fa-border-none',
            tooltip: localize('barMap'),
            group: GROUP,
            order: 1,
            toggleable: true,
            active: () => !!this.session,
            onClick: () => (this.session ? this.cancel() : void this.start())
        });
        cartographerToolbar.registerTool(IDS.undo, {
            icon: 'fa-solid fa-rotate-left',
            tooltip: localize('barUndo'),
            group: GROUP,
            order: 2,
            toggleable: false,
            onClick: () => void this.undo()
        });
    }

    _refreshButtons() {
        game.modules.get('coffee-pub-blacksmith')?.api?.updateSecondaryBarItemActive?.(MODULE.ID, IDS.map, !!this.session);
    }

    _localize(key, data) {
        const path = `${MODULE.ID}.autowall.${key}`;
        return data ? game.i18n.format(path, data) : game.i18n.localize(path);
    }

    // ==================================================================
    // ===== STARTING AND STOPPING ======================================
    // ==================================================================

    async start() {
        if (!game.user.isGM || !canvas?.ready || this.session) return;
        const options = readOptions();
        // Joining ends is the module's setting, for the whole of Foundry, not only for this tool.
        options.joinEnds = game.settings.get(MODULE.ID, 'walls.joinEnds');
        options.joinDistance = Number(game.settings.get(MODULE.ID, 'walls.joinDistance'));
        const session = {
            seeds: [], options, mode: MODES.includes(options.mode) ? options.mode : 'wall',
            image: null, result: null, segments: []
        };
        this.session = session;
        this._status = null;
        this._refreshButtons();
        this._cleanupStatus = null;
        await this._openWindow();
        if (this.session !== session) return;
        this._setStatus(this._localize('loading'));
        try {
            session.image = await this._readImage();
        } catch (error) {
            console.error(`${MODULE.NAME}: could not read the scene image`, error);
            if (this.session === session) {
                ui.notifications.warn(this._localize('noImage'));
                this.cancel();
            }
            return;
        }
        if (this.session !== session) return;
        this._listen();
        canvas.app.view.style.cursor = 'crosshair';
        this._drawThumb(session);
        this._setStatus(this._localize(HINTS[session.mode]));
    }

    cancel() {
        clearTimeout(this._timer);
        this._timer = null;
        this._unlisten();
        this._clearPreview();
        // Closing the window reaches onWindowClosed, which finds it already let go.
        const window = this.window;
        this.window = null;
        if (window) void window.close();
        if (canvas?.app?.view) canvas.app.view.style.cursor = '';
        this.session = null;
        this._status = null;
        this._endsCache = null;
        this._refreshButtons();
    }

    // ==================================================================
    // ===== THE SCENE IMAGE ============================================
    // ==================================================================

    /**
     * The scene's background as pixels, shrunk if large, with where it sits on
     * the scene. Read from the sprite Foundry is drawing so it is the picture
     * the GM is looking at, and placed by that sprite so an offset or a
     * resized background still lines up.
     */
    async _readImage() {
        const background = canvas.primary?.background;
        // The file itself, when the scene names one: it is the picture as painted,
        // where the texture Foundry holds may be resized, or released once drawn.
        const src = canvas.level?.background?.src ?? canvas.scene?.background?.src ?? canvas.scene?.img ?? null;
        let source = null;
        let from = 'file';
        if (src && !/\.(webm|mp4|m4v)$/i.test(src)) {
            try {
                source = new Image();
                source.src = src;
                await source.decode();
            } catch (error) {
                console.warn(`${MODULE.NAME}: could not load ${src}; using the texture on screen`, error);
                source = null;
            }
        }
        if (!source) {
            from = 'texture';
            source = background?.texture?.baseTexture?.resource?.source ?? background?.texture?.source?.resource ?? null;
        }
        if (!source) throw new Error('no still image');
        const naturalWidth = source.naturalWidth ?? source.videoWidth ?? source.width;
        const naturalHeight = source.naturalHeight ?? source.videoHeight ?? source.height;
        if (!naturalWidth || !naturalHeight) throw new Error('empty image');

        const shrink = Math.min(1, MAX_WORK_SIZE / Math.max(naturalWidth, naturalHeight));
        const width = Math.max(1, Math.round(naturalWidth * shrink));
        const height = Math.max(1, Math.round(naturalHeight * shrink));
        const surface = document.createElement('canvas');
        surface.width = width;
        surface.height = height;
        const context = surface.getContext('2d', { willReadFrequently: true });
        context.drawImage(source, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height);

        const rect = canvas.dimensions.sceneRect;
        const sceneRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        const placement = this._placement(background) ?? sceneRect;
        const image = { pixels, lab: labBuffer(pixels), placement, scaleX: width / placement.width, scaleY: height / placement.height, surface };
        console.info(`${MODULE.NAME}: auto-wall read the map`, {
            from, src, natural: [naturalWidth, naturalHeight], work: [width, height],
            placement, sceneRect, spriteBox: background ? { x: background.x, y: background.y, width: background.width, height: background.height } : null,
            grid: canvas.scene.grid.size, contrast: this._contrast(pixels)
        });
        return image;
    }

    /**
     * Where the background is drawn, in scene pixels, measured from where it
     * appears on screen and brought back through the stage -- so it is right
     * whatever the sprite's own position, size, anchor and scale mean.
     */
    _placement(background) {
        if (!background || background.destroyed) return null;
        const bounds = background.getBounds();
        if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) return null;
        const topLeft = canvas.stage.toLocal(new PIXI.Point(bounds.x, bounds.y));
        const bottomRight = canvas.stage.toLocal(new PIXI.Point(bounds.x + bounds.width, bounds.y + bounds.height));
        const placement = { x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y };
        return Object.values(placement).every(Number.isFinite) && placement.width > 0 && placement.height > 0 ? placement : null;
    }

    /** How much the picture varies, as the spread of its lightness: near nothing means it was read blank. */
    _contrast({ data, width, height }) {
        let sum = 0, squares = 0, n = 0;
        for (let i = 0; i < width * height; i += 97) {
            const v = data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11;
            sum += v; squares += v * v; n++;
        }
        const mean = sum / n;
        return { mean: Math.round(mean), spread: Math.round(Math.sqrt(Math.max(0, squares / n - mean * mean))) };
    }

    /** Scene pixels to this image's pixels, and back. */
    _toImage(image, [x, y]) {
        return [(x - image.placement.x) * image.scaleX, (y - image.placement.y) * image.scaleY];
    }

    _toScene(image, [x, y]) {
        return [x / image.scaleX + image.placement.x, y / image.scaleY + image.placement.y];
    }

    // ==================================================================
    // ===== WORKING OUT THE WALLS ======================================
    // ==================================================================

    /** The tracer's options, from the controls, in the image's pixels. */
    _tracerOptions(session) {
        const { image, options } = session;
        const grid = Number(canvas.scene.grid.size) || 100;
        const square = grid * image.scaleX;
        return {
            tolerance: options.match,
            stepTolerance: Math.max(3, options.match * 0.25),
            lightnessWeight: 0.5,
            // Room for a whole dungeon's walls joined into one; a flood that leaks is stopped by the thickness test, not by this.
            maxPixels: 1000000,
            maxThickness: Math.max(4, options.widest * square),
            epsilon: Math.max(1.5, options.smoothing * square),
            pruneLength: options.smoothing * square * 3,
            closeRadius: Math.max(1, Math.min(4, Math.round(square * 0.03))),
            minBranch: Math.max(4, Math.round(square * 0.12)),
            weldDistance: Math.max(2, square * 0.06),
            angleSnap: 4,
            lab: image.lab
        };
    }

    /** Work the walls out again from the clicks and the controls, a moment after either changes. */
    _schedule() {
        clearTimeout(this._timer);
        const session = this.session;
        if (!session?.seeds.length) return;
        this._setStatus(this._localize('working'));
        this._timer = setTimeout(() => this._run(session), SETTLE_MS);
    }

    _run(session) {
        if (this.session !== session || !session.seeds.length) return;
        const { image } = session;
        const [first, ...rest] = session.seeds.map(seed => this._toImage(image, seed));
        if (first[0] < 0 || first[1] < 0 || first[0] >= image.pixels.width || first[1] >= image.pixels.height) {
            session.result = null;
            session.segments = [];
            this._clearPreview();
            this._drawThumb(session);
            this._setStatus(this._localize('outside'), 'warn');
            return;
        }
        this._endsCache = null;
        if (session.mode !== 'wall') return this._runOpening(session, first, rest);
        const started = performance.now();
        const result = mapWall(image.pixels, first[0], first[1], { ...this._tracerOptions(session), extraSeeds: rest });
        session.result = result;
        session.segments = this._sceneSegments(session);
        console.info(`${MODULE.NAME}: auto-wall run`, {
            ms: Math.round(performance.now() - started), seeds: session.seeds.map(seed => seed.map(Math.round)),
            seedsInImage: [first, ...rest].map(seed => seed.map(Math.round)), options: { ...this._tracerOptions(session), lab: undefined },
            count: result.count, capped: result.capped, tooThick: result.tooThick, segments: result.segments.length, sceneSegments: session.segments.length, snap: session.options.snap
        });
        this._drawPreview(session);
        this._drawThumb(session);
        this._reportResult(session);
    }

    /**
     * A door or window: the clicked art becomes one line, and the line is fitted
     * to the nearest wall end at each of its ends, so it closes the gap the
     * walls were drawn with.
     */
    _runOpening(session, first, rest) {
        const { image } = session;
        const grid = Number(canvas.scene.grid.size) || 100;

        // The walls were drawn around it, so the door is the gap they left: the two
        // wall ends that face each other with the click between. No picture needed.
        const gap = findOpening(canvas.scene.walls.contents.map(wall => [...wall.c]), session.seeds[0], { grid });
        if (gap) {
            const segment = gap.map(point => point.map(Math.round));
            session.result = {
                capped: false, tooThick: false, tooLong: false, count: 0, viaGap: true,
                mask: new Uint8Array(0), bounds: { x: 0, y: 0, width: 0, height: 0 },
                segments: [segment.map(point => this._toImage(image, point))]
            };
            session.segments = [segment];
            session.onWall = false;
            console.info(`${MODULE.NAME}: auto-wall ${session.mode} run`, { fitted: 'the gap between two wall ends', segment, wallEnds: this._wallEnds().length });
            this._drawPreview(session);
            this._drawThumb(session);
            this._reportResult(session);
            return;
        }

        // No gap to fit: read the art instead, and fit it to wall ends as near as there are.
        const result = mapOpening(image.pixels, first[0], first[1], { ...this._tracerOptions(session), extraSeeds: rest });
        result.segments = result.segment ? [result.segment] : [];
        result.tooThick = false;
        result.tooLong = result.segment ? result.length / image.scaleX > MAX_OPENING_SQUARES * grid : false;
        session.result = result;
        session.segments = [];
        session.onWall = false;
        const candidate = result.segment && !result.capped && !result.tooLong ? result.segment.map(point => this._toScene(image, point)) : null;

        // A wall drawn straight through it: the click is on the wall, away from its ends, and the
        // opening goes there, to be cut out of the wall when it is added.
        const plain = canvas.scene.walls.contents.filter(wall => this._mergeKey(wall) !== null);
        const onWall = openingOnWall(plain.map(wall => [...wall.c]), session.seeds[0], candidate, { grid });
        if (onWall) {
            session.segments = [onWall.segment];
            session.onWall = true;
        } else if (candidate) {
            session.segments = [this._attach(candidate)];
        }
        console.info(`${MODULE.NAME}: auto-wall ${session.mode} run`, {
            seeds: session.seeds.map(seed => seed.map(Math.round)), count: result.count, capped: result.capped,
            lengthSquares: result.length / image.scaleX / grid, tooLong: result.tooLong,
            segment: session.segments[0], wallEnds: this._wallEnds().length
        });
        this._drawPreview(session);
        this._drawThumb(session);
        this._reportResult(session);
    }

    /** Every end of every wall on the scene, in scene pixels. */
    _wallEnds() {
        if (!this._endsCache) {
            this._endsCache = canvas.scene.walls.contents.flatMap(wall => [[wall.c[0], wall.c[1]], [wall.c[2], wall.c[3]]]);
        }
        return this._endsCache;
    }

    /** The wall end nearest a point, if one is within reach. */
    _nearestEnd(point, reach, ends = this._wallEnds()) {
        let best = null;
        for (const end of ends) {
            const distance = Math.hypot(end[0] - point[0], end[1] - point[1]);
            if (distance <= reach && (!best || distance < best.distance)) best = { end, distance };
        }
        return best?.end ?? null;
    }

    /** An opening's two ends, each moved onto the wall end beside it if there is one. */
    _attach([a, b]) {
        const reach = (Number(canvas.scene.grid.size) || 100) * ATTACH_SQUARES;
        let endA = this._nearestEnd(a, reach);
        let endB = this._nearestEnd(b, reach);
        // Both ends cannot go to one wall end; the nearer keeps it.
        if (endA && endB && endA[0] === endB[0] && endA[1] === endB[1]) {
            if (Math.hypot(a[0] - endA[0], a[1] - endA[1]) <= Math.hypot(b[0] - endB[0], b[1] - endB[1])) endB = null;
            else endA = null;
        }
        return [(endA ?? a).map(Math.round), (endB ?? b).map(Math.round)];
    }

    /** How many of an opening's ends sit on a wall end. */
    _attachedEnds(segment) {
        const ends = this._wallEnds();
        return segment.filter(point => ends.some(end => Math.hypot(end[0] - point[0], end[1] - point[1]) <= 1.5)).length;
    }

    /**
     * The picture as the tool read it, small, in the panel, with where it took
     * the clicks to be and what it found. If this does not match the map, the
     * trouble is in the reading and not in the settings.
     */
    _drawThumb(session) {
        const thumb = this._thumb;
        const image = session?.image;
        if (!thumb || !image) return;
        const context = thumb.getContext('2d');
        const scale = Math.min(thumb.width / image.surface.width, thumb.height / image.surface.height);
        context.clearRect(0, 0, thumb.width, thumb.height);
        context.drawImage(image.surface, 0, 0, image.surface.width * scale, image.surface.height * scale);
        const result = session.result;
        if (result?.mask?.length && result.bounds.width) {
            const { x, y, width, height } = result.bounds;
            const layer = document.createElement('canvas');
            layer.width = width;
            layer.height = height;
            const layerContext = layer.getContext('2d');
            const tint = layerContext.createImageData(width, height);
            for (let i = 0; i < result.mask.length; i++) {
                if (result.mask[i]) { tint.data[i * 4] = 40; tint.data[i * 4 + 1] = 200; tint.data[i * 4 + 2] = 230; tint.data[i * 4 + 3] = 160; }
            }
            layerContext.putImageData(tint, 0, 0);
            context.drawImage(layer, x * scale, y * scale, width * scale, height * scale);
        }
        context.lineWidth = 1.5;
        context.strokeStyle = '#e03a2e';
        for (const [a, b] of result?.segments ?? []) {
            context.beginPath();
            context.moveTo(a[0] * scale, a[1] * scale);
            context.lineTo(b[0] * scale, b[1] * scale);
            context.stroke();
        }
        context.strokeStyle = '#3fd16a';
        context.lineWidth = 2;
        for (const seed of session.seeds) {
            const [x, y] = this._toImage(image, seed);
            context.beginPath();
            context.moveTo(x * scale - 6, y * scale);
            context.lineTo(x * scale + 6, y * scale);
            context.moveTo(x * scale, y * scale - 6);
            context.lineTo(x * scale, y * scale + 6);
            context.stroke();
        }
    }

    /** The result in scene pixels, snapped to the grid if asked, with no wall of no length. */
    _sceneSegments(session) {
        const { image, options, result } = session;
        const size = Number(canvas.scene.grid.size) || 100;
        const snapped = new Map();
        const place = point => {
            if (!options.snap) return point;
            const key = `${Math.round(point[0])},${Math.round(point[1])}`;
            if (!snapped.has(key)) {
                const target = canvas.grid.getSnappedPoint({ x: point[0], y: point[1] }, { mode: CONST.GRID_SNAPPING_MODES.VERTEX });
                const near = Math.hypot(target.x - point[0], target.y - point[1]) <= size * 0.2;
                snapped.set(key, near ? [target.x, target.y] : point);
            }
            return snapped.get(key);
        };
        return (result?.segments ?? [])
            .map(([a, b]) => [place(this._toScene(image, a)).map(Math.round), place(this._toScene(image, b)).map(Math.round)])
            .filter(([a, b]) => a[0] !== b[0] || a[1] !== b[1]);
    }

    _reportResult(session) {
        const { result } = session;
        if (session.mode !== 'wall') return this._reportOpening(session);
        if (result.capped) return this._setStatus(this._localize('capped'), 'warn');
        if (result.tooThick) return this._setStatus(this._localize('tooThick'), 'warn');
        const count = session.segments.length;
        // Found, and then lost: to snapping, or to being too short to be a wall.
        if (!count) return this._setStatus(this._localize(result.segments.length ? 'collapsed' : 'nothing'), 'warn');
        this._setStatus(this._localize(count === 1 ? 'resultOne' : 'result', { count }), 'ok');
    }

    _reportOpening(session) {
        const { result } = session;
        const kind = this._localize(session.mode === 'door' ? 'kindDoor' : 'kindWindow');
        if (!this._wallEnds().length) return this._setStatus(this._localize('noWalls'), 'warn');
        // Placed on a wall, it does not matter what the picture made of the click.
        if (session.onWall && session.segments.length) return this._setStatus(this._localize('placedOnWall', { kind }), 'ok');
        if (result.capped) return this._setStatus(this._localize('capped'), 'warn');
        if (result.tooLong) return this._setStatus(this._localize('tooLong'), 'warn');
        if (!session.segments.length) return this._setStatus(this._localize('nothing'), 'warn');
        const attached = this._attachedEnds(session.segments[0]);
        this._setStatus(this._localize(['fittedNone', 'fittedOne', 'fitted'][attached], { kind }), attached ? 'ok' : 'note');
    }

    // ==================================================================
    // ===== THE PREVIEW ================================================
    // ==================================================================

    _layer() {
        if (!canvas?.ready || !canvas.interface) return null;
        if (!this._container || this._container.destroyed) {
            this._container = new PIXI.Container();
            this._container.eventMode = 'none';
            this._container.name = `${MODULE.ID}-autowall`;
            canvas.interface.addChild(this._container);
        }
        return this._container;
    }

    _clearPreview() {
        this._graphics = null;
        if (!this._container || this._container.destroyed) return;
        for (const child of this._container.removeChildren()) child.destroy({ children: true, texture: true, baseTexture: true });
    }

    _drawPreview(session) {
        if (!this._layer()) return;
        this._clearPreview();
        const { image, result } = session;

        // What the click was taken to be wall: the mask, tinted.
        if (result.mask.length && result.bounds.width && !result.capped) {
            const { x, y, width, height } = result.bounds;
            const surface = document.createElement('canvas');
            surface.width = width;
            surface.height = height;
            const context = surface.getContext('2d');
            const tint = context.createImageData(width, height);
            for (let i = 0; i < result.mask.length; i++) {
                if (!result.mask[i]) continue;
                tint.data[i * 4] = 40; tint.data[i * 4 + 1] = 200; tint.data[i * 4 + 2] = 230; tint.data[i * 4 + 3] = 110;
            }
            context.putImageData(tint, 0, 0);
            const sprite = new PIXI.Sprite(PIXI.Texture.from(surface));
            const [sx, sy] = this._toScene(image, [x, y]);
            sprite.position.set(sx, sy);
            sprite.width = width / image.scaleX;
            sprite.height = height / image.scaleY;
            this._container.addChild(sprite);
        }

        this._drawSegments(session);
    }

    /** The walls, their end handles and the clicks. Redrawn alone while an end is dragged. */
    _drawSegments(session) {
        if (!this._layer()) return;
        if (this._graphics && !this._graphics.destroyed) this._graphics.destroy();
        const line = Math.max(3, (Number(canvas.scene.grid.size) || 100) * 0.06);
        const graphics = new PIXI.Graphics();
        const color = { wall: 0xe03a2e, door: 0x5b7bff, window: 0x6fd0ff }[session.mode] ?? 0xe03a2e;
        graphics.lineStyle({ width: line, color, alpha: 0.95, cap: 'round', join: 'round' });
        for (const [a, b] of session.segments) graphics.moveTo(a[0], a[1]).lineTo(b[0], b[1]);
        graphics.lineStyle(0);
        graphics.beginFill(0xffd23f, 1);
        for (const [a, b] of session.segments) {
            graphics.drawCircle(a[0], a[1], line * 0.9);
            graphics.drawCircle(b[0], b[1], line * 0.9);
        }
        graphics.endFill();
        graphics.beginFill(0x3fd16a, 1);
        for (const seed of session.seeds) graphics.drawCircle(seed[0], seed[1], line * 1.1);
        graphics.endFill();
        this._graphics = this._container.addChild(graphics);
    }

    // ==================================================================
    // ===== THE WINDOW =================================================
    // ==================================================================

    async _openWindow() {
        this.window = await AutoWallWindow.open(this);
    }

    _root() {
        return this.window?.element ?? null;
    }

    /** The small picture in the window, when the Map tab is showing. */
    get _thumb() {
        return this._root()?.querySelector('.cartographer-autowall-thumb') ?? null;
    }

    /** The limits a slider moves between. */
    limits(name) {
        return LIMITS[name];
    }

    /** The door sounds Foundry offers, by name, with the default first. */
    doorSoundChoices() {
        const sounds = Object.entries(CONFIG.Wall?.doorSounds ?? {})
            .map(([id, sound]) => [id, game.i18n.localize(sound.label)])
            .sort((a, b) => a[1].localeCompare(b[1]));
        return [['', this._localize('soundDefault')], ...sounds];
    }

    doorAnimationChoices() {
        const types = Object.entries(CONFIG.Wall?.animationTypes ?? {}).map(([id, type]) => [id, game.i18n.localize(type.label)]);
        return [['', this._localize('animationDefault')], ...types];
    }

    /** The window has been drawn again: put back what is written into it rather than built from it. */
    afterRender(window) {
        if (window !== this.window || !this.session) return;
        for (const name of Object.keys(LIMITS)) this._showValue(name);
        this._drawThumb(this.session);
        if (this._status) this._setStatus(this._status.text, this._status.tone);
        if (this._cleanupStatus) this._setCleanupStatus(this._cleanupStatus);
    }

    /** The window was closed by the GM: that ends the run. */
    onWindowClosed(window) {
        if (this.window !== window) return;
        this.window = null;
        this.cancel();
    }

    /** Change what is being mapped. What was found for the last mode is not carried over. */
    setMode(mode) {
        const session = this.session;
        if (!session || !MODES.includes(mode) || mode === session.mode) return;
        clearTimeout(this._timer);
        session.mode = mode;
        session.options.mode = mode;
        session.options.tab = 'map';
        writeOptions(session.options);
        session.seeds = [];
        session.result = null;
        session.segments = [];
        this._clearPreview();
        this._status = { text: this._localize(HINTS[mode]), tone: '' };
        void this.window?.render();
    }

    setTab(tab) {
        const session = this.session;
        if (!session || !['map', 'options'].includes(tab) || session.options.tab === tab) return;
        session.options.tab = tab;
        writeOptions(session.options);
        void this.window?.render();
    }

    _showValue(name) {
        const output = this._root()?.querySelector(`[data-for="${name}"]`);
        if (!output) return;
        const value = Number(this.session.options[name]);
        output.textContent = name === 'match' ? String(value) : ['windowDistance'].includes(name) ? value.toFixed(1) : value.toFixed(2);
    }

    _onControl(event) {
        const session = this.session;
        const input = event.target;
        // The mode radios have their own handler; only a setting is written down here.
        if (!session || !input.name || input.name.startsWith('autowall-')) return;
        session.options[input.name] = input.type === 'checkbox' ? input.checked : input.type === 'range' ? Number(input.value) : input.value;
        writeOptions(session.options);
        if (input.name === 'joinEnds' || input.name === 'joinDistance') void game.settings.set(MODULE.ID, `walls.${input.name}`, session.options[input.name]);
        this._showValue(input.name);
        if (input.name === 'snap') {
            if (!session.result || session.mode !== 'wall') return;
            session.segments = this._sceneSegments(session);
            this._drawSegments(session);
            this._reportResult(session);
        } else if (['match', 'smoothing', 'widest'].includes(input.name)) this._schedule();
    }

    /** The line at the top of the Map tab. A warning keeps Add off; an ok or a note leaves it on. */
    _setStatus(text, tone = '') {
        this._status = { text, tone };
        const root = this._root();
        const status = root?.querySelector('[data-role="status"]');
        if (status) {
            status.textContent = text;
            status.dataset.tone = tone;
        }
        const add = root?.querySelector('[data-action="autowall-add"]');
        if (tone === 'ok' || tone === 'note') add?.removeAttribute('disabled');
        else add?.setAttribute('disabled', '');
    }

    _setCleanupStatus(text) {
        this._cleanupStatus = text;
        const line = this._root()?.querySelector('[data-role="cleanup"]');
        if (line) line.textContent = text;
    }

    // ==================================================================
    // ===== CLEAN UP ===================================================
    // ==================================================================

    /**
     * Join the wall ends that are close, across every wall, door and window on
     * the scene -- not only what this run made -- so that walls drawn by hand
     * and by this meet cleanly. What was moved can be put back.
     */
    async cleanup() {
        const scene = canvas.scene;
        if (!game.user.isGM || !scene || !this.session) return;
        const grid = Number(scene.grid.size) || 100;
        const documents = scene.walls.contents;
        const walls = documents.map(wall => ({ id: wall.id, c: [...wall.c] }));

        // First the ends that are near each other are brought together...
        const { updates: joinedUpdates, joined, skipped } = cleanupEnds(walls, this.session.options.joinDistance * grid);
        const joinedCoords = new Map(joinedUpdates.map(({ id, c }) => [id, c]));
        // ...then walls that run on in a straight line are made one.
        // A joint turning a few degrees is straight, but a curve is made of such joints: no point
        // may end up further than this from the wall it was merged into.
        const deviation = Math.max(2, grid * 0.03);
        const { walls: kept, removed, merged } = mergeWalls(
            documents.map(wall => ({ id: wall.id, c: joinedCoords.get(wall.id) ?? [...wall.c], key: this._mergeKey(wall) })),
            8, deviation
        );
        // Ends that nearly meet but are beyond the join distance: say so, so the GM can raise it.
        const reach = this.session.options.joinDistance * grid;
        const near = countNearEnds(kept, reach, grid);
        const nearNote = near ? ` ${this._localize('cleanupNear', { count: near })}` : '';
        const originals = new Map(documents.map(wall => [wall.id, wall]));
        const updates = kept.filter(wall => wall.c.some((value, index) => value !== originals.get(wall.id).c[index]));
        if (!updates.length && !removed.length) {
            this._setCleanupStatus(`${this._localize('cleanupNothing')}${nearNote}`);
            return;
        }

        // What is needed to put it all back: where each moved wall was, and every wall that went into another.
        const undo = {
            sceneId: scene.id,
            moved: updates.map(({ id }) => ({ _id: id, c: [...originals.get(id).c] })),
            removed: removed.map(id => originals.get(id).toObject())
        };
        if (updates.length) await scene.updateEmbeddedDocuments('Wall', updates.map(({ id, c }) => ({ _id: id, c })), { [SKIP_JOIN]: true });
        if (removed.length) await scene.deleteEmbeddedDocuments('Wall', removed);
        this._cleanupUndo = undo;
        this._endsCache = null;
        const text = this._localize('cleanupDone', { joined, merged });
        this._setCleanupStatus(`${text}${skipped ? ` ${this._localize('cleanupSkipped', { skipped })}` : ''}${nearNote}`);
        void this.window?.render();
    }

    /**
     * What a wall is, for deciding whether two may be one: its senses and
     * direction, door, sound, threshold and levels. Doors and windows have no
     * key, so they are never merged into a wall or each other.
     */
    _mergeKey(wall) {
        const sense = CONST.EDGE_SENSE_TYPES ?? CONST.WALL_SENSE_TYPES;
        const isPlainDoor = wall.door === CONST.WALL_DOOR_TYPES.NONE;
        const isWindow = wall.light === sense.PROXIMITY || wall.sight === sense.PROXIMITY;
        if (!isPlainDoor || isWindow) return null;
        const { light, move, sight, sound, dir } = wall;
        return JSON.stringify({ light, move, sight, sound, dir, levels: [...(wall.levels ?? [])].sort() });
    }

    canUndoCleanup() {
        return !!this._cleanupUndo && this._cleanupUndo.sceneId === canvas.scene?.id;
    }

    async undoCleanup() {
        const scene = canvas.scene;
        if (!this.canUndoCleanup() || !scene) return;
        const { moved, removed } = this._cleanupUndo;
        // The walls that were merged away come back as they were, with their ids...
        if (removed.length) await scene.createEmbeddedDocuments('Wall', removed, { keepId: true, [SKIP_JOIN]: true });
        // ...and the rest go back to where they stood.
        const present = moved.filter(wall => scene.walls.has(wall._id));
        if (present.length) await scene.updateEmbeddedDocuments('Wall', present, { [SKIP_JOIN]: true });
        this._cleanupUndo = null;
        this._endsCache = null;
        this._setCleanupStatus(this._localize('cleanupUndone', { count: present.length + removed.length }));
        void this.window?.render();
    }

    // ==================================================================
    // ===== CLICKS AND KEYS ============================================
    // ==================================================================

    _listen() {
        const view = canvas?.app?.view;
        if (!view || this._listening === view) return;
        this._unlisten();
        view.addEventListener('pointerdown', this._onPointerDown, true);
        view.addEventListener('pointerup', this._onPointerUp, true);
        view.addEventListener('pointermove', this._onPointerMove, true);
        document.addEventListener('keydown', this._onKeyDown, true);
        this._listening = view;
    }

    _unlisten() {
        const view = this._listening;
        if (view) {
            view.removeEventListener('pointerdown', this._onPointerDown, true);
            view.removeEventListener('pointerup', this._onPointerUp, true);
            view.removeEventListener('pointermove', this._onPointerMove, true);
        }
        document.removeEventListener('pointermove', this._onDragMove, true);
        document.removeEventListener('pointerup', this._onDragEnd, true);
        this._drag = null;
        document.removeEventListener('keydown', this._onKeyDown, true);
        this._listening = null;
    }

    _scenePoint(event) {
        const rect = canvas.app.view.getBoundingClientRect();
        const point = canvas.app.stage.toLocal(new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top));
        return Number.isFinite(point.x) && Number.isFinite(point.y) ? [point.x, point.y] : null;
    }

    _swallow(event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }

    /** The end of a wall within reach of the pointer, as a copy of its point, or null. */
    _handleAt(point) {
        const segments = this.session?.segments;
        if (!segments?.length || !point) return null;
        const radius = HANDLE_PIXELS / (canvas.stage?.scale?.x || 1);
        let best = null;
        for (const [a, b] of segments) {
            for (const end of [a, b]) {
                const distance = Math.hypot(end[0] - point[0], end[1] - point[1]);
                if (distance <= radius && (!best || distance < best.distance)) best = { point: end, distance };
            }
        }
        return best ? [...best.point] : null;
    }

    /** Only the left button picks; the others still pan and open menus. */
    _onPointerDown(event) {
        if (event.button !== 0) return;
        this._swallow(event);
        const handle = this._handleAt(this._scenePoint(event));
        if (handle) {
            // An end is taken hold of: it and every end that met it move together.
            this._press = null;
            this._drag = { at: handle, ends: this._wallEnds() };
            document.addEventListener('pointermove', this._onDragMove, true);
            document.addEventListener('pointerup', this._onDragEnd, true);
            return;
        }
        this._press = { x: event.clientX, y: event.clientY };
    }

    /** Over an end, the cursor says it can be moved. */
    _onPointerMove(event) {
        if (this._drag || !this.session?.image) return;
        canvas.app.view.style.cursor = this._handleAt(this._scenePoint(event)) ? 'move' : 'crosshair';
    }

    _onDragMove(event) {
        const drag = this._drag;
        const session = this.session;
        if (!drag || !session) return;
        this._swallow(event);
        let point = this._scenePoint(event);
        if (!point) return;
        // An end let go near another joins it, when asked to; failing that, walls may snap to the grid.
        const reach = HANDLE_PIXELS * 1.5 / (canvas.stage?.scale?.x || 1);
        const own = session.segments.flat().filter(end => Math.hypot(end[0] - drag.at[0], end[1] - drag.at[1]) > 1.5);
        const end = session.options.joinEnds ? this._nearestEnd(point, reach, drag.ends.concat(own)) : null;
        if (end) point = [...end];
        else if (session.mode === 'wall' && session.options.snap) {
            const target = canvas.grid.getSnappedPoint({ x: point[0], y: point[1] }, { mode: CONST.GRID_SNAPPING_MODES.VERTEX });
            point = [target.x, target.y];
        }
        point = point.map(Math.round);
        for (const segment of session.segments) {
            for (const end of segment) {
                if (Math.hypot(end[0] - drag.at[0], end[1] - drag.at[1]) <= 1.5) {
                    end[0] = point[0];
                    end[1] = point[1];
                }
            }
        }
        drag.at = point;
        this._drawSegments(session);
    }

    _onDragEnd(event) {
        this._swallow(event);
        document.removeEventListener('pointermove', this._onDragMove, true);
        document.removeEventListener('pointerup', this._onDragEnd, true);
        const at = this._drag?.at;
        this._drag = null;
        const session = this.session;
        if (!session) return;
        // An end dragged onto the other end of its wall leaves nothing to keep.
        session.segments = session.segments.filter(([a, b]) => a[0] !== b[0] || a[1] !== b[1]);
        // Joined to another wall and running straight on: they are one wall.
        if (at && session.mode === 'wall' && session.options.joinEnds) {
            session.segments = mergeStraightAt(session.segments, at) ?? session.segments;
        }
        // Where it was dropped decides what it is: on a wall that runs through, or fitted to wall ends.
        if (session.mode !== 'wall' && session.segments.length) session.onWall = !!this._splitFor(session.segments[0]);
        this._drawSegments(session);
        this._reportResult(session);
    }

    _onPointerUp(event) {
        if (event.button !== 0) return;
        this._swallow(event);
        const press = this._press;
        this._press = null;
        const session = this.session;
        if (!session?.image || !press) return;
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_PIXELS) return;
        const point = this._scenePoint(event);
        if (!point) return;
        // A click on a wall already found is not a new wall to find: that wall is there. Two of
        // them, quickly, put a point in it where it was clicked.
        if (session.mode === 'wall' && this._onFoundWall(point)) {
            const last = this._lastClick;
            const now = performance.now();
            if (last && now - last.time <= DOUBLE_CLICK_MS && Math.hypot(event.clientX - last.x, event.clientY - last.y) <= DOUBLE_CLICK_PIXELS) {
                this._lastClick = null;
                this._splitAt(point);
            } else {
                this._lastClick = { time: now, x: event.clientX, y: event.clientY };
            }
            return;
        }
        this._lastClick = null;
        // Shift adds to the wall being mapped; a plain click starts a new one.
        if (event.shiftKey && session.seeds.length) session.seeds.push(point);
        else session.seeds = [point];
        this._schedule();
    }

    /** Whether a point is on one of the walls found, and so not a click on the map. */
    _onFoundWall(point) {
        const reach = HANDLE_PIXELS / (canvas.stage?.scale?.x || 1);
        return this.session.segments.some(([a, b]) => {
            const dx = b[0] - a[0];
            const dy = b[1] - a[1];
            const lengthSq = dx * dx + dy * dy;
            const t = lengthSq ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSq)) : 0;
            return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy)) <= reach;
        });
    }

    /** Put a point in the wall at a click, where the walls found are cut in two. */
    _splitAt(point) {
        const session = this.session;
        const split = splitSegmentAt(session.segments, point, HANDLE_PIXELS / (canvas.stage?.scale?.x || 1));
        if (!split) return;
        session.segments = split.segments;
        this._drawSegments(session);
        this._reportResult(session);
    }

    _onKeyDown(event) {
        if (!this.session || event.target?.closest?.('input, textarea, select, [contenteditable]')) return;
        // Enter on a focused button presses that button; it is not also Add.
        if (event.key === 'Enter' && event.target?.closest?.('button')) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.cancel();
        } else if (event.key === 'Enter' && this.session.segments?.length) {
            event.preventDefault();
            event.stopPropagation();
            void this.accept();
        }
    }

    // ==================================================================
    // ===== WRITING AND TAKING BACK ====================================
    // ==================================================================

    /** The wall data for one segment, as Foundry's own wall tool would make it for this mode. */
    _wallData(session, c, run) {
        const sense = CONST.EDGE_SENSE_TYPES ?? CONST.WALL_SENSE_TYPES;
        const { options, mode } = session;
        const data = { c, flags: { [MODULE.ID]: { [FLAG]: { run, kind: mode } } } };
        // On a scene with several levels a wall belongs to the level being looked at.
        if (canvas.scene.levels?.size > 1 && canvas.level?.id) data.levels = [canvas.level.id];
        if (mode === 'door') {
            const states = CONST.WALL_DOOR_STATES;
            Object.assign(data, {
                light: sense.NORMAL, sight: sense.NORMAL, sound: sense.NORMAL, move: sense.NORMAL,
                door: CONST.WALL_DOOR_TYPES.DOOR,
                ds: { closed: states.CLOSED, open: states.OPEN, locked: states.LOCKED }[options.doorState] ?? states.CLOSED
            });
            if (options.doorSound) data.doorSound = options.doorSound;
            if (options.doorAnimation) data.animation = { type: options.doorAnimation };
        } else if (mode === 'window') {
            // As the window tool does: light and sight pass at close range, fading with distance.
            const distance = options.windowDistance * canvas.dimensions.distance;
            Object.assign(data, {
                light: sense.PROXIMITY, sight: sense.PROXIMITY, sound: sense.NORMAL, move: sense.NORMAL,
                threshold: { light: distance, sight: distance, attenuation: !!options.windowAttenuation }
            });
        }
        return data;
    }

    /**
     * The wall an opening lies along, with what is left of it once the opening is cut out, or
     * null when the opening is in a gap or on no wall. Only plain walls are cut: a door or a
     * window is not a wall to put another into.
     */
    _splitFor(segment) {
        for (const wall of canvas.scene.walls.contents) {
            if (this._mergeKey(wall) === null) continue;
            const cut = splitWallAt([...wall.c], segment);
            if (cut) return { wall, pieces: cut.pieces };
        }
        return null;
    }

    async accept() {
        const session = this.session;
        if (!session?.result) return;
        // A flood that leaked, or ran too long to be an opening, is never written -- unless the
        // opening was placed on a wall, which owes nothing to the picture.
        const { capped, tooThick, tooLong } = session.result;
        if ((capped || tooThick || tooLong) && !session.onWall) return;
        const segments = session.segments;
        if (!segments?.length) return;
        const run = Date.now();
        const data = segments.map(([a, b]) => this._wallData(session, [a[0], a[1], b[0], b[1]], run));

        // An opening on a wall that runs through it is cut out of that wall: the wall is cut short
        // to what is before the opening, and what is after it is a wall of its own. The door
        // remembers the wall as it was, so taking the run back puts it back whole.
        const cut = session.mode === 'wall' ? null : this._splitFor(segments[0]);
        if (cut) {
            const original = cut.wall;
            data[0].flags[MODULE.ID][FLAG].splitFrom = { id: original.id, c: [...original.c] };
            if (cut.pieces.length === 2) {
                const tail = original.toObject();
                delete tail._id;
                tail.c = cut.pieces[1];
                tail.flags = { ...tail.flags, [MODULE.ID]: { ...(tail.flags?.[MODULE.ID] ?? {}), [FLAG]: { run, kind: 'wall' } } };
                data.push(tail);
            }
        }
        try {
            await canvas.scene.createEmbeddedDocuments('Wall', data, { [SKIP_JOIN]: true });
            if (cut) await canvas.scene.updateEmbeddedDocuments('Wall', [{ _id: cut.wall.id, c: cut.pieces[0] }], { [SKIP_JOIN]: true });
        } catch (error) {
            console.error(`${MODULE.NAME}: could not add the walls`, error);
            ui.notifications.error(this._localize('failed'));
            return;
        }
        const mode = session.mode;
        if (mode === 'wall') ui.notifications.info(this._localize('added', { count: data.length }));
        else ui.notifications.info(this._localize('addedOpening', { kind: this._localize(mode === 'door' ? 'kindDoor' : 'kindWindow').toLowerCase() }));
        // Ready for the next one: these are real walls now, so the preview and the clicks go.
        session.seeds = [];
        session.result = null;
        session.segments = [];
        session.onWall = false;
        this._endsCache = null;
        this._clearPreview();
        this._setStatus(this._localize(mode === 'wall' ? 'afterWalls' : HINTS[mode]));
    }

    /** The walls this last drew on the scene, as one: every wall of the latest run. */
    async undo() {
        if (!game.user.isGM || !canvas?.scene) return;
        const mine = canvas.scene.walls.filter(wall => Number.isFinite(wall.getFlag(MODULE.ID, FLAG)?.run));
        if (!mine.length) {
            ui.notifications.info(this._localize('noUndo'));
            return;
        }
        const latest = Math.max(...mine.map(wall => wall.getFlag(MODULE.ID, FLAG).run));
        const run = mine.filter(wall => wall.getFlag(MODULE.ID, FLAG).run === latest);
        const ids = run.map(wall => wall.id);
        // A wall an opening was cut out of is made whole again before what was added is taken away.
        const restores = run.map(wall => wall.getFlag(MODULE.ID, FLAG).splitFrom)
            .filter(from => from && canvas.scene.walls.has(from.id))
            .map(from => ({ _id: from.id, c: from.c }));
        if (restores.length) await canvas.scene.updateEmbeddedDocuments('Wall', restores, { [SKIP_JOIN]: true });
        await canvas.scene.deleteEmbeddedDocuments('Wall', ids);
        ui.notifications.info(this._localize('undone', { count: ids.length }));
    }
}

export const autoWallManager = new AutoWallManager();

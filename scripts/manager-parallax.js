// ==================================================================
// ===== PARALLAX MANAGER ===========================================
// ==================================================================

import { MODULE } from './const.js';
import { tileMotionManager } from './manager-tilemotion.js';
import { releaseRepeatingTextures, repeatingTexture } from './utils-textures.js';
import { NONE_GROUP, normalizeActive, shownByGroups, toggledActive } from './utils-groups.js';
import { angleVector, DEFAULT_EASE_SECONDS, easeProgress, motionSpeed, motionTickerPriority, motionTravel, wrap } from './utils-motion.js';

const FLAG_KEY = 'parallax';
const WINDOW_ID = `${MODULE.ID}-parallax`;
/**
 * Whether the GM wants the window up, per browser. Set when they open or close
 * it themselves, and left alone when the window comes and goes with the scene,
 * so a scene with no parallax does not make them reopen it on the next one.
 */
const WINDOW_OPEN_KEY = `${MODULE.ID}.parallax.windowOpen`;
function readWindowOpen() {
    try {
        return localStorage.getItem(WINDOW_OPEN_KEY) === 'true';
    } catch {
        return false;
    }
}
function writeWindowOpen(open) {
    try {
        localStorage.setItem(WINDOW_OPEN_KEY, String(!!open));
    } catch {
        // Storage unavailable: the window just will not reopen on its own.
    }
}

/**
 * Which way the scenery travels, as an angle in degrees on screen: 0 runs it
 * to the right, 90 down, 180 left, 270 up, and anything between runs it on a
 * diagonal. A wagon heading east sees the world go by to the left, so 180 is
 * the usual choice for travel. These are the quick picks the window offers.
 */
export const PARALLAX_DIRECTIONS = {
    left: { angle: 180, icon: 'fa-solid fa-arrow-left' },
    right: { angle: 0, icon: 'fa-solid fa-arrow-right' },
    up: { angle: 270, icon: 'fa-solid fa-arrow-up' },
    down: { angle: 90, icon: 'fa-solid fa-arrow-down' }
};

function normalizeAngle(angle) {
    return ((Math.round(Number(angle) || 0) % 360) + 360) % 360;
}

/** A new layer's speed, in scene pixels per second at a master speed of 1. */
const DEFAULT_LAYER_SPEED = 60;

/**
 * The state every client renders from, stored as a flag on the scene.
 *
 * Positions are never streamed. Each layer stores where it stood at
 * `anchorAt` (server time), and every client works out where it stands now
 * from that and its speed. So players who join late or reload mid-scroll see
 * exactly what everyone else sees, and nothing drifts between clients however
 * long the scene runs. Every change folds the elapsed travel into the
 * offsets first (see _rebase), which is what keeps a speed change from making
 * a layer jump.
 */
function defaultState() {
    return {
        playing: false,
        masterSpeed: 1,
        angle: 180,
        anchorAt: 0,
        // How long a change of speed takes to arrive, in seconds. 0 is instant.
        easeSeconds: DEFAULT_EASE_SECONDS,
        // The master speed actually in effect at anchorAt, which the scroll
        // eases from towards its target. Null means it was already there.
        rampFrom: null,
        layers: [],
        // Named groups of layers -- Base, Snow, Night -- which add together.
        // `activeSets` is which are on: null for All, [] for None, else ids.
        // See utils-groups.js.
        sets: [],
        activeSets: null
    };
}

function defaultLayer(src) {
    const name = decodeURIComponent(src.split('/').pop() ?? src).replace(/\.[^.]+$/, '');
    return {
        id: foundry.utils.randomID(),
        name,
        src,
        speed: DEFAULT_LAYER_SPEED,
        visible: true,
        alpha: 1,
        scale: 1,
        // A band repeats along the scroll axis only, as a strip of trees or a
        // horizon does. Off, the image tiles across the whole scene.
        band: false,
        bandOffset: 0,
        // Overhead layers draw above tokens -- clouds, smoke, birds -- instead
        // of beneath them with the ground.
        overhead: false,
        // Turns this layer's direction away from the scene's angle, in
        // degrees: clouds blown across the road rather than along it.
        angleOffset: 0,
        // Where the tiling sits at rest, in scene pixels, so layers can be
        // lined up with each other. Reset returns here, not to 0,0.
        startX: 0,
        startY: 0,
        // How the layer moves as the camera pans, from -1 to 1. 0 is fixed to
        // the map like everything else. Positive reads as farther away (it
        // trails the map; at 1 it is pinned to the screen); negative reads as
        // nearer, above the map (it runs ahead of it). Local to each viewer,
        // since everyone pans on their own.
        depth: 0,
        // Where the tiling stood at the state's anchorAt. Kept as x and y
        // rather than a distance along the scroll, so turning the angle mid-run
        // carries on from where the layer is instead of jumping.
        offsetX: 0,
        offsetY: 0
    };
}

/**
 * Keep every ground layer ahead of every overhead layer in the array, each
 * group in its own order. The array is draw order, back to front, so the
 * boundary between the two groups is the token line the window shows.
 */
function normalizeOrder(layers) {
    return [...layers.filter(l => !l.overhead), ...layers.filter(l => l.overhead)];
}

class ParallaxManager {
    constructor() {
        this.containers = []; // [ground, overhead]
        this.sprites = new Map(); // layer id -> PIXI.TilingSprite
        this.state = defaultState();
        this.window = null;
        this._hooks = [];
        this._ticker = null;
        this._signature = '';
        this._drawToken = 0;
        /**
         * layer id -> a fade in progress: { from, to, start }. A layer coming
         * into view (its set switched in, its eye turned on, or just added)
         * fades in, and one leaving fades out, over the scene's Ease time.
         * Purely visual and local to each viewer, so it is timed on this
         * client's own clock and never saved.
         */
        this._fades = new Map();
        /** False until the scene's layers have been drawn once; what is there on load just appears. */
        this._fadeReady = false;
        this._tick = this._tick.bind(this);
    }

    // ==================================================================
    // ===== LIFECYCLE ==================================================
    // ==================================================================

    async initialize() {
        this._registerWindow();
        this._registerHooks();
        this._exposeApi();
        await this.refresh({ sceneLoaded: true });
        console.log(`${MODULE.NAME}: Parallax tool initialized`);
    }

    cleanup() {
        for (const hook of this._hooks) Hooks.off(hook.name, hook.id);
        this._hooks = [];
        this._teardown();
    }

    _registerWindow() {
        const api = game.modules.get('coffee-pub-blacksmith')?.api;
        if (!api?.registerWindow) return;
        api.registerWindow(WINDOW_ID, {
            moduleId: MODULE.ID,
            title: game.i18n.localize(`${MODULE.ID}.parallax.windowTitle`),
            open: async () => this.openWindow()
        });
    }

    _registerHooks() {
        const on = (name, fn) => this._hooks.push({ name, id: Hooks.on(name, fn) });

        // The canvas is rebuilt on every scene change, which destroys our
        // container with it, so the layers are drawn afresh each time.
        on('canvasReady', () => void this.refresh({ sceneLoaded: true }));
        on('canvasTearDown', () => {
            this._teardown();
            releaseRepeatingTextures();
            this._fades.clear();
            this._fadeReady = false;
        });
        on('updateScene', (scene, changes) => {
            if (scene.id !== canvas.scene?.id) return;
            if (!foundry.utils.hasProperty(changes, `flags.${MODULE.ID}`)) return;
            void this.refresh();
        });
    }

    /** `game.modules.get('coffee-pub-cartographer').api.parallax` -- for macros and Active Tiles. */
    _exposeApi() {
        const module = game.modules.get(MODULE.ID);
        if (!module) return;
        module.api ??= {};
        module.api.parallax = {
            play: () => this.play(),
            stop: () => this.stop(),
            toggle: () => this.togglePlaying(),
            setSpeed: speed => this.setMasterSpeed(speed),
            setAngle: angle => this.setAngle(angle),
            setGroup: nameOrId => this.setActiveSet(nameOrId),
            toggleGroup: nameOrId => this.toggleSet(nameOrId),
            setEase: seconds => this.setEaseSeconds(seconds),
            open: () => this.openWindow(),
            get state() { return parallaxManager.state; }
        };
    }

    // ==================================================================
    // ===== STATE ======================================================
    // ==================================================================

    _readState(scene = canvas.scene) {
        const stored = scene?.getFlag(MODULE.ID, FLAG_KEY);
        const state = foundry.utils.mergeObject(defaultState(), stored ?? {}, { inplace: false });
        // Scenes saved before the angle existed stored one of four directions.
        if (stored && stored.angle === undefined && PARALLAX_DIRECTIONS[stored.direction]) {
            state.angle = PARALLAX_DIRECTIONS[stored.direction].angle;
        }
        delete state.direction;
        state.layers = normalizeOrder(
            (stored?.layers ?? []).map(layer => ({ ...defaultLayer(layer.src ?? ''), ...layer }))
        );
        // `hidden` is the set's own on/off for each of its layers: still in the
        // set, so it is one click to bring back, but not drawn while it shows.
        // The layer groups. Stored as `sets`, the name they had before they
        // were called groups in the window. Each holds layers, with its own
        // on/off for each (`hidden`). Tiles have groups of their own, in the
        // tile motion manager, chosen independently of these.
        state.sets = (stored?.sets ?? []).map(set => ({
            id: set.id,
            name: set.name,
            layers: [...(set.layers ?? [])],
            hidden: [...(set.hidden ?? [])]
        }));
        this._migrateLayerSets(state);
        const layerIds = new Set(state.layers.map(l => l.id));
        for (const set of state.sets) {
            set.layers = set.layers.filter(id => layerIds.has(id));
            set.hidden = set.hidden.filter(id => set.layers.includes(id));
        }
        // Older saves held one group, as `activeSet`.
        state.activeSets = normalizeActive(stored?.activeSets, stored?.activeSet, state.sets);
        delete state.activeSet;
        return state;
    }

    /**
     * Sets used to be a field on each layer, so a layer could be in only one
     * of them, and a layer in none showed with all of them. Fold that into the
     * set lists, keeping what each set showed: its own layers plus the common
     * ones. Runs only on a scene saved that way, and is written back on the
     * next change.
     */
    _migrateLayerSets(state) {
        if (!state.layers.some(layer => 'set' in layer)) return;
        for (const set of state.sets) {
            if (set.layers.length) continue;
            set.layers = state.layers.filter(l => !l.set || l.set === set.id).map(l => l.id);
        }
        for (const layer of state.layers) delete layer.set;
    }

    /**
     * Where a layer's tiling stands at server time `now`, in scene pixels.
     * A negative master speed runs it backwards along the same angle.
     */
    layerOffset(layer, now = game.time.serverTime, state = this.state) {
        // The scene state carries the motion fields (playing, masterSpeed,
        // easeSeconds, anchorAt, rampFrom) itself; see utils-motion.js.
        const distance = motionTravel(state, now) * layer.speed;
        if (distance === 0) return { x: layer.offsetX, y: layer.offsetY };
        const dir = angleVector(state.angle + (Number(layer.angleOffset) || 0));
        return { x: layer.offsetX + dir.x * distance, y: layer.offsetY + dir.y * distance };
    }

    /** The current state with travel so far folded into each offset, anchored at now. */
    _rebase() {
        const now = game.time.serverTime;
        const state = foundry.utils.deepClone(this.state);
        for (const layer of state.layers) {
            const { x, y } = this.layerOffset(layer, now);
            layer.offsetX = x;
            layer.offsetY = y;
        }
        // Whatever changes next eases from the speed in effect right now, so a
        // change made halfway through an ease carries on from where it was.
        state.rampFrom = motionSpeed(this.state, now);
        state.anchorAt = now;
        return state;
    }

    /**
     * Apply a change and share it. Only the GM writes; players render whatever
     * the scene flag says. The local copy is updated first so the GM's own view
     * responds without waiting for the round trip.
     */
    async _commit(mutate) {
        if (!game.user.isGM || !canvas.scene) return;
        const state = this._rebase();
        mutate(state);
        state.layers = normalizeOrder(state.layers);
        this.state = state;
        this._applyState();
        await canvas.scene.setFlag(MODULE.ID, FLAG_KEY, state);
    }

    // ==================================================================
    // ===== CONTROLS ===================================================
    // ==================================================================

    /** Start the scenery moving, easing up to the master speed. */
    play() { return this._commit(s => { s.playing = true; }); }
    /** Ease the scenery to a halt. The master speed is kept, so Play resumes at it. */
    stop() { return this._commit(s => { s.playing = false; }); }
    togglePlaying() { return this.state.playing ? this.stop() : this.play(); }

    setMasterSpeed(speed) {
        const value = Number(speed);
        if (!Number.isFinite(value)) return;
        return this._commit(s => { s.masterSpeed = value; });
    }

    /** How long changes of speed take, in seconds. 0 makes them instant. */
    setEaseSeconds(seconds) {
        const value = Number(seconds);
        if (!Number.isFinite(value)) return;
        return this._commit(s => { s.easeSeconds = Math.max(0, value); });
    }

    /** Set the scroll angle in degrees, or by name: 'left', 'right', 'up', 'down'. */
    setAngle(angle) {
        const preset = PARALLAX_DIRECTIONS[angle];
        const value = preset ? preset.angle : Number(angle);
        if (!Number.isFinite(value)) return;
        return this._commit(s => { s.angle = normalizeAngle(value); });
    }

    /**
     * Add a layer. With groups on it joins them too; otherwise it would be
     * added and promptly hidden, which reads as the add failing. (Under None
     * it joins nothing and stays hidden, as the window says.)
     */
    addLayer(src) {
        if (!src) return;
        return this._commit(s => {
            const layer = defaultLayer(src);
            s.layers.push(layer);
            for (const set of s.sets) if (s.activeSets?.includes(set.id)) set.layers.push(layer.id);
        });
    }

    removeLayer(id) {
        return this._commit(s => {
            s.layers = s.layers.filter(l => l.id !== id);
            for (const set of s.sets) {
                set.layers = set.layers.filter(layerId => layerId !== id);
                set.hidden = (set.hidden ?? []).filter(layerId => layerId !== id);
            }
        });
    }

    // ==================================================================
    // ===== SETS =======================================================
    // ==================================================================

    /**
     * Whether a layer is part of what is showing: its own eye, then the
     * groups that are on. Groups add together -- Base plus Snow plus Night --
     * and a layer shows when any group that is on shows it.
     */
    isLayerShown(layer, state = this.state) {
        if (!layer.visible) return false;
        return shownByGroups(layer.id, state.sets, state.activeSets, set => set.layers, set => set.hidden);
    }

    /** Turn one of a set's layers on or off within that set only. */
    toggleSetLayer(setId, layerId) {
        return this._commit(s => {
            const set = s.sets.find(entry => entry.id === setId);
            if (!set?.layers.includes(layerId)) return;
            set.hidden ??= [];
            set.hidden = set.hidden.includes(layerId)
                ? set.hidden.filter(id => id !== layerId)
                : [...set.hidden, layerId];
        });
    }

    _findSet(state, nameOrId) {
        if (!nameOrId) return null;
        const key = String(nameOrId).toLowerCase();
        return state.sets.find(set => set.id === nameOrId)
            ?? state.sets.find(set => set.name.toLowerCase() === key)
            ?? null;
    }

    /** Only ids of layers that exist, each once. */
    _cleanLayerIds(state, layerIds) {
        const known = new Set(state.layers.map(l => l.id));
        return [...new Set(layerIds ?? [])].filter(id => known.has(id));
    }

    /** Add a set of the given layers and show it, so the GM sees what they just made. */
    addSet(name, layerIds = []) {
        const label = String(name ?? '').trim();
        if (!label) return;
        return this._commit(s => {
            const set = {
                id: foundry.utils.randomID(),
                name: label,
                layers: this._cleanLayerIds(s, layerIds),
                hidden: []
            };
            s.sets.push(set);
            // Shown on its own, which looks exactly as things did when it was
            // made from what was showing.
            s.activeSets = [set.id];
        });
    }

    /** Change a set's name and/or which layers it holds. */
    updateSet(id, { name, layers } = {}) {
        return this._commit(s => {
            const set = s.sets.find(entry => entry.id === id);
            if (!set) return;
            const label = String(name ?? '').trim();
            if (label) set.name = label;
            if (layers) {
                set.layers = this._cleanLayerIds(s, layers);
                set.hidden = (set.hidden ?? []).filter(layerId => set.layers.includes(layerId));
            }
        });
    }

    /** Remove a set. Its layers are untouched; only the combination goes. */
    removeSet(id) {
        return this._commit(s => {
            s.sets = s.sets.filter(set => set.id !== id);
            if (s.activeSets) {
                const wasOn = s.activeSets.includes(id);
                s.activeSets = s.activeSets.filter(setId => setId !== id);
                // The last group on was the one removed: back to All.
                if (wasOn && !s.activeSets.length) s.activeSets = null;
            }
        });
    }

    /**
     * Show just one group, by id or by name (for macros), or 'all' / null for
     * every layer, or 'none' for none. The built-in None comes before any
     * group a GM happened to name "None".
     */
    setActiveSet(nameOrId) {
        if (!nameOrId || String(nameOrId).toLowerCase() === 'all') return this.setActiveSets(null);
        if (String(nameOrId).toLowerCase() === NONE_GROUP) return this.setActiveSets([]);
        const set = this._findSet(this.state, nameOrId);
        if (!set) return;
        return this.setActiveSets([set.id]);
    }

    /** Turn one group on or off among those on, by id or name. */
    toggleSet(nameOrId) {
        const set = this._findSet(this.state, nameOrId);
        if (!set) return;
        return this.setActiveSets(toggledActive(this.state.activeSets, set.id));
    }

    /** Set exactly which groups are on: null for All, [] for None, else ids. Unknown ids are dropped. */
    setActiveSets(ids) {
        return this._commit(s => {
            s.activeSets = ids === null ? null : [...new Set(ids)].filter(id => s.sets.some(set => set.id === id));
        });
    }

    /**
     * Move a layer one step nearer (+1) or farther (-1). Later layers draw on
     * top. A step across the token line does not swap with the neighbour on
     * the far side; it carries the layer over the line instead, so the nearest
     * ground layer moved nearer becomes the farthest overhead one, and back.
     */
    moveLayer(id, step) {
        return this._commit(s => {
            const from = s.layers.findIndex(l => l.id === id);
            const to = from + step;
            if (from < 0) return;
            const layer = s.layers[from];
            const neighbour = s.layers[to];
            if (!layer.overhead && step > 0 && (!neighbour || neighbour.overhead)) {
                layer.overhead = true;
                return;
            }
            if (layer.overhead && step < 0 && (!neighbour || !neighbour.overhead)) {
                layer.overhead = false;
                return;
            }
            if (!neighbour) return;
            s.layers.splice(from, 1);
            s.layers.splice(to, 0, layer);
        });
    }

    updateLayer(id, changes) {
        return this._commit(s => {
            const layer = s.layers.find(l => l.id === id);
            if (layer) Object.assign(layer, changes);
        });
    }

    /** Put every layer back at its starting position without changing anything else. */
    resetPositions() {
        return this._commit(s => {
            for (const layer of s.layers) {
                layer.offsetX = 0;
                layer.offsetY = 0;
            }
        });
    }

    /**
     * Change the GM's local view only, without writing the flag. Used while a
     * slider is being dragged, so the scene is not updated on every pixel of
     * travel; the release commits it.
     */
    preview(mutate) {
        const state = this._rebase();
        mutate(state);
        this.state = state;
        this._applyState();
    }

    /** Whether this scene has any parallax to run. */
    get isConfigured() {
        return this.state.layers.length > 0;
    }

    /** Open the window because the GM asked to, which also means "keep it up". */
    async openWindow() {
        if (!game.user.isGM) return null;
        writeWindowOpen(true);
        return this._showWindow();
    }

    async _showWindow() {
        if (this.window?.rendered) {
            this.window.bringToFront?.();
            return this.window;
        }
        const { ParallaxWindow } = await import('./window-parallax.js');
        this.window = await ParallaxWindow.open(this);
        return this.window;
    }

    /**
     * Called by the window as it closes. A close the GM made means they want it
     * down; a close made here because the scene has no parallax does not.
     */
    onWindowClosed(window) {
        if (this.window === window) this.window = null;
        if (!this._closingForScene) writeWindowOpen(false);
    }

    /**
     * On each scene load, bring the window up or down to match: up where there
     * is parallax and the GM left it on, down where there is none. A GM can
     * still open it on an empty scene to set one up -- it just is not offered.
     */
    async _syncWindowToScene() {
        if (!game.user.isGM) return;
        // The window runs both the scene's parallax and its animated tiles,
        // so a scene with either is one it belongs on.
        if (this.isConfigured || tileMotionManager.isConfigured) {
            if (readWindowOpen()) await this._showWindow();
            return;
        }
        if (!this.window?.rendered) return;
        this._closingForScene = true;
        try {
            await this.window.close();
        } finally {
            this._closingForScene = false;
        }
    }

    // ==================================================================
    // ===== RENDERING ==================================================
    // ==================================================================

    async refresh({ sceneLoaded = false } = {}) {
        if (!canvas?.ready || !canvas.scene) return;
        this.state = this._readState();
        await this._applyState();
        if (sceneLoaded) await this._syncWindowToScene();
        if (this.window?.rendered) this.window.render();
    }

    /**
     * Bring the canvas in line with this.state. Textures are only reloaded when
     * the set of images changes; everything else is a property update.
     */
    async _applyState() {
        const layers = this.state.layers.filter(l => l.src);
        if (!layers.length) {
            this._teardown();
            return;
        }

        const signature = layers.map(l => `${l.id}:${l.src}:${l.overhead ? 1 : 0}`).join('|');
        if (signature !== this._signature || !this._isBuilt()) {
            // A slower load from an earlier change must not overwrite a newer one.
            const token = ++this._drawToken;
            const textures = await Promise.all(layers.map(l =>
                foundry.canvas.loadTexture(l.src).catch(() => null)));
            if (token !== this._drawToken || !canvas?.ready) return;
            this._build(layers, textures);
            this._signature = signature;
        }

        this._layout();
        this._fadeReady = true;
        this._tick();
    }

    /** Start fading a layer towards shown (1) or hidden (0), from wherever it is now. */
    _setFadeTarget(layerId, target) {
        const now = performance.now();
        const fade = this._fades.get(layerId);
        if (!fade) {
            this._fades.set(layerId, { from: this._fadeReady ? 0 : target, to: target, start: now });
            return;
        }
        if (fade.to === target) return;
        this._fades.set(layerId, { from: this._fadeFactor(layerId, now), to: target, start: now });
    }

    /** How far faded in a layer is, 0 to 1, eased over the scene's Ease time. */
    _fadeFactor(layerId, now = performance.now()) {
        const fade = this._fades.get(layerId);
        if (!fade) return 1;
        const duration = Math.max(0, Number(this.state.easeSeconds) || 0) * 1000;
        if (duration === 0) return fade.to;
        return fade.from + (fade.to - fade.from) * easeProgress((now - fade.start) / duration);
    }

    _isBuilt() {
        return this.containers.length > 0 && this.containers.every(c => !c.destroyed);
    }

    _build(layers, textures) {
        this._teardown({ keepSignature: true });

        const primary = canvas.primary;
        const background = primary.background;
        const SORT_LAYERS = primary.constructor.SORT_LAYERS ?? { SCENE: 0, WEATHER: 1000 };

        // The primary group sorts by elevation, then sortLayer, then sort.
        //
        // Ground layers share the scene background's elevation and layer and
        // sort just above it: over the background image, beneath every tile,
        // so a vehicle tile drawn on top stays on top.
        //
        // Overhead layers sit where Foundry puts its own weather -- infinite
        // elevation, so a token at any elevation is still beneath them -- one
        // step under the weather layer, so rain and snow still fall over the
        // clouds rather than behind them.
        const ground = this._makeContainer('ground', {
            elevation: background?.elevation ?? 0,
            sortLayer: SORT_LAYERS.SCENE,
            sort: (background?.sort ?? 0) + 1,
            zIndex: (background?.zIndex ?? 0) + 1
        });
        const overhead = this._makeContainer('overhead', {
            elevation: Infinity,
            sortLayer: (SORT_LAYERS.WEATHER ?? 1000) - 1,
            sort: 0,
            zIndex: 0
        });

        const rect = canvas.dimensions.sceneRect;
        layers.forEach((layer, index) => {
            const texture = textures[index];
            if (!texture) {
                console.warn(`${MODULE.NAME}: Parallax layer image could not be loaded: ${layer.src}`);
                return;
            }
            // A mipmap-free twin of the image: see utils-textures.js for the seam it prevents.
            const sprite = new PIXI.TilingSprite(repeatingTexture(texture), rect.width, rect.height);
            (layer.overhead ? overhead : ground).addChild(sprite);
            this.sprites.set(layer.id, sprite);
        });

        for (const container of [ground, overhead]) primary.addChild(container);
        primary.sortDirty = true;
        this.containers = [ground, overhead];

        this._ticker = this._tick;
        canvas.app.ticker.add(this._ticker, undefined, motionTickerPriority());
    }

    _makeContainer(kind, { elevation, sortLayer, sort, zIndex }) {
        const container = new PIXI.Container();
        container.name = `${MODULE.ID}.parallax.${kind}`;
        container.elevation = elevation;
        container.sortLayer = sortLayer;
        container.sort = sort;
        container.zIndex = zIndex;
        container.eventMode = 'none';

        const rect = canvas.dimensions.sceneRect;
        container.position.set(rect.x, rect.y);
        const mask = new PIXI.Graphics().beginFill(0xffffff).drawRect(0, 0, rect.width, rect.height).endFill();
        container.addChild(mask);
        container.mask = mask;
        return container;
    }

    /** Size and place each layer from its settings. */
    _layout() {
        const rect = canvas.dimensions.sceneRect;
        // A band lies along whichever axis the scroll mostly follows. On a
        // diagonal the image still drifts both ways inside the strip.
        const dir = angleVector(this.state.angle);
        const horizontal = Math.abs(dir.x) >= Math.abs(dir.y);
        for (const layer of this.state.layers) {
            const sprite = this.sprites.get(layer.id);
            if (!sprite) continue;
            const scale = layer.scale > 0 ? layer.scale : 1;
            sprite.tileScale.set(scale);
            this._setFadeTarget(layer.id, this.isLayerShown(layer) ? 1 : 0);
            const tex = sprite.texture;
            if (layer.band && horizontal) {
                sprite.width = rect.width;
                sprite.height = tex.height * scale;
                sprite.position.set(0, layer.bandOffset);
            } else if (layer.band) {
                sprite.width = tex.width * scale;
                sprite.height = rect.height;
                sprite.position.set(layer.bandOffset, 0);
            } else {
                sprite.width = rect.width;
                sprite.height = rect.height;
                sprite.position.set(0, 0);
            }
        }
    }

    _tick() {
        if (!this._isBuilt()) return;
        const now = game.time.serverTime;
        // How far this viewer's camera sits from the middle of the scene; the
        // depth of each layer decides how much of that it follows.
        const rect = canvas.dimensions.sceneRect;
        const pivot = canvas.stage.pivot;
        const panX = pivot.x - (rect.x + rect.width / 2);
        const panY = pivot.y - (rect.y + rect.height / 2);
        const clock = performance.now();
        for (const layer of this.state.layers) {
            const sprite = this.sprites.get(layer.id);
            if (!sprite) continue;
            const fade = this._fadeFactor(layer.id, clock);
            sprite.alpha = layer.alpha * fade;
            sprite.visible = fade > 0.001;
            const offset = this.layerOffset(layer, now);
            const depth = Number(layer.depth) || 0;
            const scale = layer.scale > 0 ? layer.scale : 1;
            sprite.tilePosition.set(
                wrap(offset.x + (Number(layer.startX) || 0) + panX * depth, sprite.texture.width * scale),
                wrap(offset.y + (Number(layer.startY) || 0) + panY * depth, sprite.texture.height * scale)
            );
        }
    }

    _teardown({ keepSignature = false } = {}) {
        if (this._ticker) canvas?.app?.ticker?.remove(this._ticker);
        this._ticker = null;
        // Textures belong to Foundry's texture cache and are shared, so only
        // the display objects are destroyed.
        for (const container of this.containers) {
            if (container.destroyed) continue;
            container.parent?.removeChild(container);
            container.destroy({ children: true, texture: false, baseTexture: false });
        }
        this.containers = [];
        this.sprites.clear();
        if (!keepSignature) this._signature = '';
    }
}

export const parallaxManager = new ParallaxManager();

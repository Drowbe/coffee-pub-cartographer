// ==================================================================
// ===== PARALLAX MANAGER ===========================================
// ==================================================================

import { MODULE } from './const.js';
import { cartographerToolbar } from './manager-toolbar.js';

const FLAG_KEY = 'parallax';
const TOOL_ID = `${MODULE.ID}-parallax`;
const WINDOW_ID = `${MODULE.ID}-parallax`;

/**
 * Which way the scenery travels across the screen. A wagon heading east sees
 * the world go by to the left, so "left" is the usual choice for travel.
 */
export const PARALLAX_DIRECTIONS = {
    left: { x: -1, y: 0, icon: 'fa-solid fa-arrow-left' },
    right: { x: 1, y: 0, icon: 'fa-solid fa-arrow-right' },
    up: { x: 0, y: -1, icon: 'fa-solid fa-arrow-up' },
    down: { x: 0, y: 1, icon: 'fa-solid fa-arrow-down' }
};

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
        direction: 'left',
        anchorAt: 0,
        layers: []
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
        offset: 0
    };
}

/** Wrap a value into [0, size), so tile positions stay small however far we travel. */
function wrap(value, size) {
    if (!(size > 0)) return 0;
    return ((value % size) + size) % size;
}

class ParallaxManager {
    constructor() {
        this.container = null;
        this.sprites = new Map(); // layer id -> PIXI.TilingSprite
        this.state = defaultState();
        this.window = null;
        this._hooks = [];
        this._ticker = null;
        this._signature = '';
        this._drawToken = 0;
        this._tick = this._tick.bind(this);
    }

    // ==================================================================
    // ===== LIFECYCLE ==================================================
    // ==================================================================

    async initialize() {
        this._registerWindow();
        this._registerToolbarTool();
        this._registerHooks();
        this._exposeApi();
        await this.refresh();
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

    _registerToolbarTool() {
        if (!game.user.isGM) return;
        cartographerToolbar.registerTool(TOOL_ID, {
            icon: 'fa-solid fa-layer-group',
            tooltip: game.i18n.localize(`${MODULE.ID}.parallax.openHint`),
            group: 'Utilities',
            order: 10,
            toggleable: false,
            onClick: () => this.openWindow()
        });
    }

    _registerHooks() {
        const on = (name, fn) => this._hooks.push({ name, id: Hooks.on(name, fn) });

        // The canvas is rebuilt on every scene change, which destroys our
        // container with it, so the layers are drawn afresh each time.
        on('canvasReady', () => void this.refresh());
        on('canvasTearDown', () => this._teardown());
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
            pause: () => this.pause(),
            toggle: () => this.togglePlaying(),
            setSpeed: speed => this.setMasterSpeed(speed),
            setDirection: direction => this.setDirection(direction),
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
        state.layers = (stored?.layers ?? []).map(layer => ({ ...defaultLayer(layer.src ?? ''), ...layer }));
        return state;
    }

    /** Where a layer stands at server time `now`, in scene pixels along the scroll axis. */
    layerOffset(layer, now = game.time.serverTime, state = this.state) {
        if (!state.playing) return layer.offset;
        const elapsed = Math.max(0, now - state.anchorAt) / 1000;
        return layer.offset + elapsed * state.masterSpeed * layer.speed;
    }

    /** The current state with travel so far folded into each offset, anchored at now. */
    _rebase() {
        const now = game.time.serverTime;
        const state = foundry.utils.deepClone(this.state);
        for (const layer of state.layers) layer.offset = this.layerOffset(layer, now);
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
        this.state = state;
        this._applyState();
        await canvas.scene.setFlag(MODULE.ID, FLAG_KEY, state);
    }

    // ==================================================================
    // ===== CONTROLS ===================================================
    // ==================================================================

    play() { return this._commit(s => { s.playing = true; }); }
    pause() { return this._commit(s => { s.playing = false; }); }
    togglePlaying() { return this.state.playing ? this.pause() : this.play(); }

    setMasterSpeed(speed) {
        const value = Number(speed);
        if (!Number.isFinite(value)) return;
        return this._commit(s => { s.masterSpeed = Math.max(0, value); });
    }

    setDirection(direction) {
        if (!PARALLAX_DIRECTIONS[direction]) return;
        return this._commit(s => { s.direction = direction; });
    }

    addLayer(src) {
        if (!src) return;
        return this._commit(s => { s.layers.push(defaultLayer(src)); });
    }

    removeLayer(id) {
        return this._commit(s => { s.layers = s.layers.filter(l => l.id !== id); });
    }

    /** Move a layer one step nearer (+1) or farther (-1). Later layers draw on top. */
    moveLayer(id, step) {
        return this._commit(s => {
            const from = s.layers.findIndex(l => l.id === id);
            const to = from + step;
            if (from < 0 || to < 0 || to >= s.layers.length) return;
            const [layer] = s.layers.splice(from, 1);
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
        return this._commit(s => { for (const layer of s.layers) layer.offset = 0; });
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

    async openWindow() {
        if (!game.user.isGM) return null;
        if (this.window?.rendered) {
            this.window.bringToFront?.();
            return this.window;
        }
        const { ParallaxWindow } = await import('./window-parallax.js');
        this.window = await ParallaxWindow.open(this);
        return this.window;
    }

    // ==================================================================
    // ===== RENDERING ==================================================
    // ==================================================================

    async refresh() {
        if (!canvas?.ready || !canvas.scene) return;
        this.state = this._readState();
        await this._applyState();
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

        const signature = layers.map(l => `${l.id}:${l.src}`).join('|');
        if (signature !== this._signature || !this.container || this.container.destroyed) {
            // A slower load from an earlier change must not overwrite a newer one.
            const token = ++this._drawToken;
            const textures = await Promise.all(layers.map(l =>
                foundry.canvas.loadTexture(l.src).catch(() => null)));
            if (token !== this._drawToken || !canvas?.ready) return;
            this._build(layers, textures);
            this._signature = signature;
        }

        this._layout();
        this._tick();
    }

    _build(layers, textures) {
        this._teardown({ keepSignature: true });

        const primary = canvas.primary;
        const background = primary.background;
        const container = new PIXI.Container();
        container.name = `${MODULE.ID}.parallax`;
        // The primary group sorts by elevation, then layer, then sort. Sharing
        // the scene background's elevation and layer and sorting just above it
        // puts the parallax over the background image and beneath every tile,
        // so a vehicle tile drawn on top stays on top.
        const SORT_LAYERS = primary.constructor.SORT_LAYERS ?? { SCENE: 0 };
        container.elevation = background?.elevation ?? 0;
        container.sortLayer = SORT_LAYERS.SCENE;
        container.sort = (background?.sort ?? 0) + 1;
        container.zIndex = (background?.zIndex ?? 0) + 1;
        container.eventMode = 'none';

        const rect = canvas.dimensions.sceneRect;
        container.position.set(rect.x, rect.y);
        const mask = new PIXI.Graphics().beginFill(0xffffff).drawRect(0, 0, rect.width, rect.height).endFill();
        container.addChild(mask);
        container.mask = mask;

        layers.forEach((layer, index) => {
            const texture = textures[index];
            if (!texture) {
                console.warn(`${MODULE.NAME}: Parallax layer image could not be loaded: ${layer.src}`);
                return;
            }
            const sprite = new PIXI.TilingSprite(texture, rect.width, rect.height);
            container.addChild(sprite);
            this.sprites.set(layer.id, sprite);
        });

        primary.addChild(container);
        primary.sortDirty = true;
        this.container = container;

        this._ticker = this._tick;
        canvas.app.ticker.add(this._ticker);
    }

    /** Size and place each layer from its settings. */
    _layout() {
        const rect = canvas.dimensions.sceneRect;
        const horizontal = PARALLAX_DIRECTIONS[this.state.direction]?.y === 0;
        for (const layer of this.state.layers) {
            const sprite = this.sprites.get(layer.id);
            if (!sprite) continue;
            const scale = layer.scale > 0 ? layer.scale : 1;
            sprite.tileScale.set(scale);
            sprite.alpha = layer.alpha;
            sprite.visible = layer.visible;
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
        if (!this.container || this.container.destroyed) return;
        const dir = PARALLAX_DIRECTIONS[this.state.direction] ?? PARALLAX_DIRECTIONS.left;
        const now = game.time.serverTime;
        for (const layer of this.state.layers) {
            const sprite = this.sprites.get(layer.id);
            if (!sprite) continue;
            const offset = this.layerOffset(layer, now);
            const scale = layer.scale > 0 ? layer.scale : 1;
            sprite.tilePosition.set(
                wrap(dir.x * offset, sprite.texture.width * scale),
                wrap(dir.y * offset, sprite.texture.height * scale)
            );
        }
    }

    _teardown({ keepSignature = false } = {}) {
        if (this._ticker) canvas?.app?.ticker?.remove(this._ticker);
        this._ticker = null;
        // Textures belong to Foundry's texture cache and are shared, so only
        // the display objects are destroyed.
        if (this.container && !this.container.destroyed) {
            this.container.parent?.removeChild(this.container);
            this.container.destroy({ children: true, texture: false, baseTexture: false });
        }
        this.container = null;
        this.sprites.clear();
        if (!keepSignature) this._signature = '';
    }
}

export const parallaxManager = new ParallaxManager();

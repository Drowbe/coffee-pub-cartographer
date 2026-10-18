// ==================================================================
// ===== TILE MOTION MANAGER ========================================
// ==================================================================

import { MODULE } from './const.js';
import {
    angleVector,
    defaultMotion,
    easeProgress,
    motionSpeed,
    motionTickerPriority,
    motionTravel,
    rebaseMotion,
    wrap
} from './utils-motion.js';
import { repeatingTexture } from './utils-textures.js';
import { NONE_GROUP, normalizeActive, shownByGroups, toggledActive } from './utils-groups.js';

/**
 * Scene flag: the shared Play/Stop, speed and ease for every animated tile,
 * where each stood, and the tile groups -- named combinations of tiles, one
 * showing at a time, chosen independently of the parallax layer groups.
 */
const SCENE_FLAG = 'tileMotion';
/** Tile flag: how that tile moves. Kept on the tile so it travels with it when copied. */
const TILE_FLAG = 'motion';
const WINDOW_APP_ID = `${MODULE.ID}-parallax`;

/**
 * How a tile moves, as stored on it. Either part can be on alone or both
 * together: a spinning tile whose image also scrolls is a whirlpool. A tile
 * with this flag at all is one Cartographer manages, moving or not: it can be
 * shown and hidden, and belong to groups, like a parallax layer.
 *
 *   visible        the tile's own show/hide; groups decide the rest
 *   rotate.speed   degrees per second at a master speed of 1; negative spins the other way
 *   rotate.pivotX/Y where it turns, as a fraction of the tile: 0.5, 0.5 is the middle
 *   scroll.speed   scene pixels per second; negative runs it backwards
 *   scroll.angle   which way the image runs, in degrees: 0 right, 90 down
 *   scroll.scale   the image's size as it repeats inside the tile
 */
export function defaultTileMotion() {
    return {
        visible: true,
        rotate: { enabled: false, speed: 30, pivotX: 0.5, pivotY: 0.5 },
        scroll: { enabled: false, speed: 60, angle: 0, scale: 1 }
    };
}

function readTileMotion(tileDocument) {
    const stored = tileDocument?.getFlag?.(MODULE.ID, TILE_FLAG);
    if (!stored) return null;
    const base = defaultTileMotion();
    return {
        visible: stored.visible ?? true,
        rotate: { ...base.rotate, ...(stored.rotate ?? {}) },
        scroll: { ...base.scroll, ...(stored.scroll ?? {}) }
    };
}

/** Whether Cartographer manages a tile: it has motion settings, whether or not it is moving. */
export function isManagedTile(tileDocument) {
    return !!tileDocument?.getFlag?.(MODULE.ID, TILE_FLAG);
}

class TileMotionManager {
    constructor() {
        /** The shared motion, from the scene flag. */
        this.motion = { ...defaultMotion(), offsets: {}, groups: [], activeGroups: null };
        /** tile id -> its motion settings, for every tile Cartographer manages on the scene. */
        this.configs = new Map();
        /** tile id -> a fade in progress: { from, to, start }. As for parallax layers. */
        this._fades = new Map();
        this._fadeReady = false;
        /** tile id -> the TilingSprite drawn in place of a scrolling tile's own image. */
        this.overlays = new Map();
        /** tile ids we have moved, so they can be put back when they stop being animated. */
        this._touched = new Set();
        this._hooks = [];
        this._ticker = null;
        this._renderQueued = false;
        this._tick = this._tick.bind(this);
    }

    // ==================================================================
    // ===== LIFECYCLE ==================================================
    // ==================================================================

    initialize() {
        this._registerHooks();
        this._exposeApi();
        this.refresh();
        console.log(`${MODULE.NAME}: Tile motion initialized`);
    }

    _registerHooks() {
        const on = (name, fn) => this._hooks.push({ name, id: Hooks.on(name, fn) });
        on('canvasReady', () => this.refresh());
        on('canvasTearDown', () => {
            this._teardown();
            this._fades.clear();
            this._fadeReady = false;
        });
        on('updateScene', (scene, changes) => {
            if (scene.id !== canvas.scene?.id) return;
            if (!foundry.utils.hasProperty(changes, `flags.${MODULE.ID}.${SCENE_FLAG}`)) return;
            this.refresh();
        });
        on('updateTile', (tile, changes) => {
            if (tile.parent?.id !== canvas.scene?.id) return;
            if (!foundry.utils.hasProperty(changes, `flags.${MODULE.ID}`)) return;
            this.refresh();
        });
        on('deleteTile', tile => {
            if (tile.parent?.id !== canvas.scene?.id) return;
            this.refresh();
        });
        // The window's tile editor follows the selected tile.
        on('controlTile', () => this._renderWindow());
    }

    /**
     * `game.modules.get('coffee-pub-cartographer').api.tiles` -- for macros
     * and Active Tiles. One Play/Stop and speed drive every animated tile.
     */
    _exposeApi() {
        const module = game.modules.get(MODULE.ID);
        if (!module) return;
        module.api ??= {};
        module.api.tiles = {
            play: () => this.play(),
            stop: () => this.stop(),
            toggle: () => this.togglePlaying(),
            setSpeed: speed => this.setMasterSpeed(speed),
            setEase: seconds => this.setEaseSeconds(seconds),
            /** e.g. setTileMotion(tileId, 'rotate.speed', 90) or (tileId, 'scroll.enabled', true) */
            setTileMotion: (tileId, path, value) => this.setTileMotion(tileId, path, value),
            setGroup: nameOrId => this.setActiveGroup(nameOrId),
            toggleGroup: nameOrId => this.toggleGroup(nameOrId),
            show: tileId => this.setTileMotion(tileId, 'visible', true),
            hide: tileId => this.setTileMotion(tileId, 'visible', false),
            clear: tileId => this.clearTileMotion(tileId),
            get motion() { return tileMotionManager.motion; }
        };
    }

    /** Re-read everything from the scene and its tiles, and redraw. */
    refresh() {
        if (!canvas?.ready || !canvas.scene) return;
        const stored = canvas.scene.getFlag(MODULE.ID, SCENE_FLAG) ?? {};
        this.motion = {
            ...defaultMotion(),
            ...stored,
            offsets: { ...(stored.offsets ?? {}) },
            groups: (stored.groups ?? []).map(group => ({
                ...group,
                tiles: [...(group.tiles ?? [])],
                hidden: [...(group.hidden ?? [])]
            }))
        };
        this.configs.clear();
        for (const tile of canvas.scene.tiles) {
            const config = readTileMotion(tile);
            if (config) this.configs.set(tile.id, config);
        }
        // A group can only hold tiles that are still here and still managed.
        for (const group of this.motion.groups) {
            group.tiles = group.tiles.filter(id => this.configs.has(id));
            group.hidden = group.hidden.filter(id => group.tiles.includes(id));
        }
        // Which tile groups are on: null for All, [] for None, else ids. Older
        // saves held one group, as `activeGroup`.
        this.motion.activeGroups = normalizeActive(stored.activeGroups, stored.activeGroup, this.motion.groups);
        delete this.motion.activeGroup;
        this._sync();
        this._fadeReady = true;
        this._renderWindow();
    }

    /** Whether this scene has any tile Cartographer manages. Reads the documents, so it is right before any refresh. */
    get isConfigured() {
        return !!canvas.scene?.tiles.some(tile => isManagedTile(tile));
    }

    /**
     * Whether a managed tile is part of what is showing: its own show/hide,
     * then the tile groups that are on, which add together.
     */
    isTileShown(tileId, config = this.configs.get(tileId)) {
        if (!config?.visible) return false;
        return shownByGroups(tileId, this.motion.groups, this.motion.activeGroups, group => group.tiles, group => group.hidden);
    }

    // ==================================================================
    // ===== GROUPS =====================================================
    // ==================================================================

    _cleanTileIds(tileIds) {
        return [...new Set(tileIds ?? [])].filter(id => this.configs.has(id));
    }

    /** Add a group of the given tiles and show it, so the GM sees what they just made. */
    addGroup(name, tileIds = []) {
        const label = String(name ?? '').trim();
        if (!label) return;
        return this._commit(m => {
            const group = { id: foundry.utils.randomID(), name: label, tiles: this._cleanTileIds(tileIds), hidden: [] };
            m.groups = [...m.groups, group];
            // Shown on its own, which looks exactly as things did when it was
            // made from what was showing.
            m.activeGroups = [group.id];
        });
    }

    updateGroup(id, { name, tiles } = {}) {
        return this._commit(m => {
            const group = m.groups.find(entry => entry.id === id);
            if (!group) return;
            const label = String(name ?? '').trim();
            if (label) group.name = label;
            if (tiles) {
                group.tiles = this._cleanTileIds(tiles);
                group.hidden = group.hidden.filter(tileId => group.tiles.includes(tileId));
            }
        });
    }

    /** Remove a group. Its tiles are untouched; only the combination goes. */
    removeGroup(id) {
        return this._commit(m => {
            m.groups = m.groups.filter(group => group.id !== id);
            if (m.activeGroups) {
                const wasOn = m.activeGroups.includes(id);
                m.activeGroups = m.activeGroups.filter(groupId => groupId !== id);
                // The last group on was the one removed: back to All.
                if (wasOn && !m.activeGroups.length) m.activeGroups = null;
            }
        });
    }

    _findGroup(nameOrId) {
        if (!nameOrId) return null;
        const key = String(nameOrId).toLowerCase();
        return this.motion.groups.find(entry => entry.id === nameOrId)
            ?? this.motion.groups.find(entry => entry.name.toLowerCase() === key)
            ?? null;
    }

    /**
     * Show just one group, by id or by name (for macros), or 'all' / null for
     * every tile, or 'none' for none. The built-in None comes before any
     * group a GM happened to name "None".
     */
    setActiveGroup(nameOrId) {
        if (!nameOrId || String(nameOrId).toLowerCase() === 'all') return this.setActiveGroups(null);
        if (String(nameOrId).toLowerCase() === NONE_GROUP) return this.setActiveGroups([]);
        const group = this._findGroup(nameOrId);
        if (!group) return;
        return this.setActiveGroups([group.id]);
    }

    /** Turn one group on or off among those on, by id or name. */
    toggleGroup(nameOrId) {
        const group = this._findGroup(nameOrId);
        if (!group) return;
        return this.setActiveGroups(toggledActive(this.motion.activeGroups, group.id));
    }

    /** Set exactly which groups are on: null for All, [] for None, else ids. Unknown ids are dropped. */
    setActiveGroups(ids) {
        return this._commit(m => {
            m.activeGroups = ids === null ? null : [...new Set(ids)].filter(id => m.groups.some(group => group.id === id));
        });
    }

    /** Turn one of a group's tiles on or off within that group only. */
    toggleGroupTile(groupId, tileId) {
        return this._commit(m => {
            const group = m.groups.find(entry => entry.id === groupId);
            if (!group?.tiles.includes(tileId)) return;
            group.hidden = group.hidden.includes(tileId)
                ? group.hidden.filter(id => id !== tileId)
                : [...group.hidden, tileId];
        });
    }

    // ==================================================================
    // ===== STATE ======================================================
    // ==================================================================

    /** Where a tile stands at `now`: its extra rotation in degrees and its image's scroll offset. */
    tilePose(tileId, now = game.time.serverTime, motion = this.motion, config = this.configs.get(tileId)) {
        const at = motion.offsets[tileId] ?? { rot: 0, x: 0, y: 0 };
        if (!config) return { rot: at.rot ?? 0, x: at.x ?? 0, y: at.y ?? 0 };
        const travel = motionTravel(motion, now);
        const rot = (at.rot ?? 0) + (config.rotate.enabled ? travel * config.rotate.speed : 0);
        const dir = angleVector(config.scroll.angle);
        const distance = config.scroll.enabled ? travel * config.scroll.speed : 0;
        return { rot, x: (at.x ?? 0) + dir.x * distance, y: (at.y ?? 0) + dir.y * distance };
    }

    /** The motion with every tile's travel so far folded into its offsets, anchored at now. */
    _rebase() {
        const now = game.time.serverTime;
        const offsets = {};
        for (const [tileId, at] of Object.entries(this.motion.offsets)) offsets[tileId] = { ...at };
        for (const tileId of this.configs.keys()) {
            const pose = this.tilePose(tileId, now);
            // Rotation is kept within one turn; it is an angle, not a distance.
            offsets[tileId] = { rot: ((pose.rot % 360) + 360) % 360, x: pose.x, y: pose.y };
        }
        const groups = this.motion.groups.map(group => ({ ...group, tiles: [...group.tiles], hidden: [...group.hidden] }));
        return { ...rebaseMotion(this.motion, now), offsets, groups };
    }

    /** Apply a change to the shared motion and share it. GM only. */
    async _commit(mutate) {
        if (!game.user.isGM || !canvas.scene) return;
        const motion = this._rebase();
        mutate(motion);
        // Offsets for tiles that no longer exist are dropped.
        for (const tileId of Object.keys(motion.offsets)) {
            if (!canvas.scene.tiles.has(tileId)) delete motion.offsets[tileId];
        }
        this.motion = motion;
        this._renderWindow();
        await canvas.scene.setFlag(MODULE.ID, SCENE_FLAG, motion);
    }

    play() { return this._commit(m => { m.playing = true; }); }
    stop() { return this._commit(m => { m.playing = false; }); }
    togglePlaying() { return this.motion.playing ? this.stop() : this.play(); }

    setMasterSpeed(speed) {
        const value = Number(speed);
        if (!Number.isFinite(value)) return;
        return this._commit(m => { m.masterSpeed = value; });
    }

    setEaseSeconds(seconds) {
        const value = Number(seconds);
        if (!Number.isFinite(value)) return;
        return this._commit(m => { m.easeSeconds = Math.max(0, value); });
    }

    /** Put every tile back at its own rotation and its image at rest. */
    resetPositions() {
        return this._commit(m => {
            for (const tileId of Object.keys(m.offsets)) m.offsets[tileId] = { rot: 0, x: 0, y: 0 };
        });
    }

    /**
     * Change part of a tile's motion, e.g. ('rotate.speed', -45). The shared
     * motion is rebased first, under the old settings, so the tile carries on
     * from where it is rather than jumping to where the new speed would have
     * put it.
     */
    async setTileMotion(tileId, path, value) {
        if (!game.user.isGM) return;
        const tile = canvas.scene?.tiles.get(tileId);
        if (!tile) return;
        const isNew = !isManagedTile(tile);
        const config = readTileMotion(tile) ?? defaultTileMotion();
        foundry.utils.setProperty(config, path, value);
        // A tile brought in while groups are on joins them, as a new layer
        // does; otherwise it would be hidden the moment it was set up.
        await this._commit(m => {
            if (!isNew || !m.activeGroups) return;
            for (const group of m.groups) {
                if (m.activeGroups.includes(group.id) && !group.tiles.includes(tileId)) group.tiles.push(tileId);
            }
        });
        await tile.setFlag(MODULE.ID, TILE_FLAG, config);
    }

    /**
     * The tile's own opacity -- Foundry's, the one in its config sheet -- so
     * it is the same number however the tile is looked at. Not a motion
     * setting, and not saved with one.
     */
    async setTileOpacity(tileId, alpha) {
        if (!game.user.isGM) return;
        const value = Math.min(1, Math.max(0, Number(alpha)));
        if (!Number.isFinite(value)) return;
        await canvas.scene?.tiles.get(tileId)?.update({ alpha: value });
    }

    /** Stop animating a tile and put it back exactly as it was. */
    async clearTileMotion(tileId) {
        if (!game.user.isGM) return;
        const tile = canvas.scene?.tiles.get(tileId);
        if (!tile) return;
        await this._commit(m => {
            delete m.offsets[tileId];
            for (const group of m.groups) {
                group.tiles = group.tiles.filter(id => id !== tileId);
                group.hidden = group.hidden.filter(id => id !== tileId);
            }
        });
        await tile.unsetFlag(MODULE.ID, TILE_FLAG);
    }

    /**
     * Change the GM's local view only, without writing anything. Used while a
     * slider is dragged; the release commits it.
     */
    preview(mutate) {
        this.motion = this._rebase();
        mutate(this.motion, this.configs);
        this._sync();
    }

    /** The settings of the tile the GM has selected, for the window's editor. */
    selectedTile() {
        const tile = canvas.tiles?.controlled?.[0];
        if (!tile) return null;
        return { tile, config: readTileMotion(tile.document) ?? defaultTileMotion() };
    }

    _renderWindow() {
        if (this._renderQueued) return;
        this._renderQueued = true;
        // controlTile fires once per tile in a multi-select; one render covers them.
        setTimeout(() => {
            this._renderQueued = false;
            const app = foundry.applications?.instances?.get(WINDOW_APP_ID);
            if (app?.rendered) app.render();
        }, 0);
    }

    // ==================================================================
    // ===== RENDERING ==================================================
    // ==================================================================

    /** Bring the canvas in line with the current configs: start or stop the ticker, drop stale overlays. */
    _sync() {
        // Tiles no longer animated go back to exactly what Foundry draws.
        for (const tileId of [...this._touched]) {
            if (!this.configs.has(tileId)) this._restoreTile(tileId);
        }
        for (const [tileId, config] of this.configs) {
            if (!config.scroll.enabled) this._removeOverlay(tileId);
        }
        if (this.configs.size && !this._ticker) {
            this._ticker = this._tick;
            canvas.app.ticker.add(this._ticker, undefined, motionTickerPriority());
        } else if (!this.configs.size && this._ticker) {
            canvas.app.ticker.remove(this._ticker);
            this._ticker = null;
        }
        this._tick();
    }

    /**
     * Runs every frame, after Foundry has applied its own refreshes to the
     * tiles, so a refresh that resets a tile's transform is overridden before
     * the frame is drawn, and before Foundry's primary and perception updates,
     * so those see where the tile is now. See motionTickerPriority.
     */
    _tick() {
        if (!canvas?.ready) return;
        const now = game.time.serverTime;
        const clock = performance.now();
        for (const [tileId, config] of this.configs) {
            const tile = canvas.tiles?.get(tileId);
            if (!tile?.mesh || tile.mesh.destroyed) continue;
            this._touched.add(tileId);
            this._setFadeTarget(tileId, this.isTileShown(tileId, config) ? 1 : 0);
            const fade = this._fadeFactor(tileId, clock);
            const pose = this.tilePose(tileId, now, this.motion, config);
            const drawn = config.scroll.enabled ? this._overlayFor(tile) : tile.mesh;
            if (config.scroll.enabled) {
                tile.mesh.renderable = false;
                this._applyScroll(drawn, tile, config, pose, fade);
            } else {
                // Foundry sets the mesh's alpha itself -- half for a hidden
                // tile, as the GM sees it -- so the fade multiplies that.
                tile.mesh.alpha = (tile.alpha ?? 1) * (tile.document.hidden ? 0.5 : 1) * fade;
                tile.mesh.renderable = fade > 0.001;
            }
            this._applyTransform(drawn, tile, config, pose);
        }
    }

    /** Start fading a tile towards shown (1) or hidden (0), from wherever it is now. */
    _setFadeTarget(tileId, target) {
        const fade = this._fades.get(tileId);
        const now = performance.now();
        if (!fade) {
            this._fades.set(tileId, { from: this._fadeReady ? 0 : target, to: target, start: now });
            return;
        }
        if (fade.to === target) return;
        this._fades.set(tileId, { from: this._fadeFactor(tileId, now), to: target, start: now });
    }

    /** How far faded in a tile is, 0 to 1, over the tiles' Ease time. */
    _fadeFactor(tileId, now = performance.now()) {
        const fade = this._fades.get(tileId);
        if (!fade) return 1;
        const duration = Math.max(0, Number(this.motion.easeSeconds) || 0) * 1000;
        if (duration === 0) return fade.to;
        return fade.from + (fade.to - fade.from) * easeProgress((now - fade.start) / duration);
    }

    /**
     * Turn the drawn image about the pivot. The tile's own anchor and position
     * describe where Foundry puts it; the pivot's place in the world is worked
     * out from those, and the image is anchored there instead, so it spins in
     * place about the chosen point.
     */
    _applyTransform(drawn, tile, config, pose) {
        const doc = tile.document;
        const shape = doc.shape ?? doc;
        const width = shape.width;
        const height = shape.height;
        // v14 tiles carry an anchor; earlier ones sit on their middle.
        const anchorX = shape.anchorX ?? 0.5;
        const anchorY = shape.anchorY ?? 0.5;
        const baseX = doc.shape ? shape.x : doc.x + width / 2;
        const baseY = doc.shape ? shape.y : doc.y + height / 2;
        const baseAngle = shape.rotation ?? 0;

        if (!config.rotate.enabled) {
            drawn.anchor.set(anchorX, anchorY);
            drawn.position.set(baseX, baseY);
            drawn.angle = baseAngle;
            return;
        }
        const pivotX = Number(config.rotate.pivotX);
        const pivotY = Number(config.rotate.pivotY);
        const px = (Number.isFinite(pivotX) ? pivotX : 0.5);
        const py = (Number.isFinite(pivotY) ? pivotY : 0.5);
        const dx = (px - anchorX) * width;
        const dy = (py - anchorY) * height;
        const radians = baseAngle * Math.PI / 180;
        const worldX = baseX + dx * Math.cos(radians) - dy * Math.sin(radians);
        const worldY = baseY + dx * Math.sin(radians) + dy * Math.cos(radians);
        drawn.anchor.set(px, py);
        drawn.position.set(worldX, worldY);
        drawn.angle = baseAngle + pose.rot;
    }

    _applyScroll(overlay, tile, config, pose, fade = 1) {
        const doc = tile.document;
        const shape = doc.shape ?? doc;
        const mesh = tile.mesh;
        // A mipmap-free twin of the tile's image: see utils-textures.js for the seam it prevents.
        const texture = repeatingTexture(mesh.texture);
        if (overlay.texture !== texture) overlay.texture = texture;
        overlay.width = shape.width;
        overlay.height = shape.height;
        const scale = config.scroll.scale > 0 ? config.scroll.scale : 1;
        overlay.tileScale.set(scale);
        overlay.tilePosition.set(
            wrap(pose.x, overlay.texture.width * scale),
            wrap(pose.y, overlay.texture.height * scale)
        );
        overlay.visible = mesh.visible && fade > 0.001;
        overlay.alpha = (doc.alpha ?? 1) * (doc.hidden ? 0.5 : 1) * fade;
        overlay.tint = mesh.tint;
        // Sit exactly where the tile's own image does in the draw order.
        overlay.elevation = mesh.elevation;
        overlay.sortLayer = mesh.sortLayer;
        overlay.sort = mesh.sort;
        overlay.zIndex = mesh.zIndex;
    }

    /**
     * A scrolling tile is drawn by a TilingSprite in its place, since a tile's
     * own image cannot repeat. The tile's mesh stays where it is -- hidden, but
     * still what Foundry selects, hovers and occludes with.
     */
    _overlayFor(tile) {
        let overlay = this.overlays.get(tile.id);
        if (overlay && !overlay.destroyed) return overlay;
        overlay = new PIXI.TilingSprite(repeatingTexture(tile.mesh.texture), tile.document.width, tile.document.height);
        overlay.name = `${MODULE.ID}.tileMotion.${tile.id}`;
        overlay.eventMode = 'none';
        canvas.primary.addChild(overlay);
        canvas.primary.sortDirty = true;
        this.overlays.set(tile.id, overlay);
        return overlay;
    }

    _removeOverlay(tileId) {
        const overlay = this.overlays.get(tileId);
        if (overlay && !overlay.destroyed) {
            overlay.parent?.removeChild(overlay);
            overlay.destroy({ texture: false, baseTexture: false });
        }
        this.overlays.delete(tileId);
        const tile = canvas.tiles?.get(tileId);
        if (tile?.mesh && !tile.mesh.destroyed) tile.mesh.renderable = true;
    }

    /** Hand a tile back to Foundry exactly as it would draw it. */
    _restoreTile(tileId) {
        this._removeOverlay(tileId);
        this._touched.delete(tileId);
        const tile = canvas.tiles?.get(tileId);
        if (!tile?.mesh) return;
        tile.mesh.renderable = true;
        // Transform for the spin, state for the alpha the fades multiplied.
        tile.renderFlags.set({ refreshTransform: true, refreshState: true });
    }

    _teardown() {
        if (this._ticker) canvas?.app?.ticker?.remove(this._ticker);
        this._ticker = null;
        for (const tileId of [...this.overlays.keys()]) this._removeOverlay(tileId);
        this._touched.clear();
        this.configs.clear();
    }
}

export const tileMotionManager = new TileMotionManager();

// ==================================================================
// ===== TILE MOTION MANAGER ========================================
// ==================================================================

import { MODULE } from './const.js';
import {
    angleVector,
    defaultMotion,
    motionSpeed,
    motionTravel,
    rebaseMotion,
    wrap
} from './utils-motion.js';
import { repeatingTexture } from './utils-textures.js';

/** Scene flag: the shared Play/Stop, speed and ease for every animated tile, and where each stood. */
const SCENE_FLAG = 'tileMotion';
/** Tile flag: how that tile moves. Kept on the tile so it travels with it when copied. */
const TILE_FLAG = 'motion';
const WINDOW_APP_ID = `${MODULE.ID}-parallax`;

/**
 * How a tile moves, as stored on it. Either part can be on alone or both
 * together: a spinning tile whose image also scrolls is a whirlpool.
 *
 *   rotate.speed   degrees per second at a master speed of 1; negative spins the other way
 *   rotate.pivotX/Y where it turns, as a fraction of the tile: 0.5, 0.5 is the middle
 *   scroll.speed   scene pixels per second; negative runs it backwards
 *   scroll.angle   which way the image runs, in degrees: 0 right, 90 down
 *   scroll.scale   the image's size as it repeats inside the tile
 */
export function defaultTileMotion() {
    return {
        rotate: { enabled: false, speed: 30, pivotX: 0.5, pivotY: 0.5 },
        scroll: { enabled: false, speed: 60, angle: 0, scale: 1 }
    };
}

function readTileMotion(tileDocument) {
    const stored = tileDocument?.getFlag?.(MODULE.ID, TILE_FLAG);
    if (!stored) return null;
    const base = defaultTileMotion();
    return {
        rotate: { ...base.rotate, ...(stored.rotate ?? {}) },
        scroll: { ...base.scroll, ...(stored.scroll ?? {}) }
    };
}

function isAnimated(config) {
    return !!(config?.rotate.enabled || config?.scroll.enabled);
}

class TileMotionManager {
    constructor() {
        /** The shared motion, from the scene flag. */
        this.motion = { ...defaultMotion(), offsets: {} };
        /** tile id -> its motion settings, for every animated tile on the scene. */
        this.configs = new Map();
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
        on('canvasTearDown', () => this._teardown());
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
            clear: tileId => this.clearTileMotion(tileId),
            get motion() { return tileMotionManager.motion; }
        };
    }

    /** Re-read everything from the scene and its tiles, and redraw. */
    refresh() {
        if (!canvas?.ready || !canvas.scene) return;
        const stored = canvas.scene.getFlag(MODULE.ID, SCENE_FLAG) ?? {};
        this.motion = { ...defaultMotion(), ...stored, offsets: { ...(stored.offsets ?? {}) } };
        this.configs.clear();
        for (const tile of canvas.scene.tiles) {
            const config = readTileMotion(tile);
            if (isAnimated(config)) this.configs.set(tile.id, config);
        }
        this._sync();
        this._renderWindow();
    }

    /** Whether this scene has any tile to animate. Reads the documents, so it is right before any refresh. */
    get isConfigured() {
        return !!canvas.scene?.tiles.some(tile => isAnimated(readTileMotion(tile)));
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
        return { ...rebaseMotion(this.motion, now), offsets };
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
        const config = readTileMotion(tile) ?? defaultTileMotion();
        foundry.utils.setProperty(config, path, value);
        await this._commit(() => {});
        await tile.setFlag(MODULE.ID, TILE_FLAG, config);
    }

    /** Stop animating a tile and put it back exactly as it was. */
    async clearTileMotion(tileId) {
        if (!game.user.isGM) return;
        const tile = canvas.scene?.tiles.get(tileId);
        if (!tile) return;
        await this._commit(m => { delete m.offsets[tileId]; });
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
            canvas.app.ticker.add(this._ticker);
        } else if (!this.configs.size && this._ticker) {
            canvas.app.ticker.remove(this._ticker);
            this._ticker = null;
        }
        this._tick();
    }

    /**
     * Runs every frame, after Foundry has applied its own refreshes to the
     * tiles (those run at a higher ticker priority), so a refresh that resets
     * a tile's transform is overridden before the frame is drawn.
     */
    _tick() {
        if (!canvas?.ready) return;
        const now = game.time.serverTime;
        for (const [tileId, config] of this.configs) {
            const tile = canvas.tiles?.get(tileId);
            if (!tile?.mesh || tile.mesh.destroyed) continue;
            this._touched.add(tileId);
            const pose = this.tilePose(tileId, now, this.motion, config);
            const drawn = config.scroll.enabled ? this._overlayFor(tile) : tile.mesh;
            if (config.scroll.enabled) {
                tile.mesh.renderable = false;
                this._applyScroll(drawn, tile, config, pose);
            }
            this._applyTransform(drawn, tile, config, pose);
        }
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

    _applyScroll(overlay, tile, config, pose) {
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
        overlay.visible = mesh.visible;
        overlay.alpha = (doc.alpha ?? 1) * (doc.hidden ? 0.5 : 1);
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
        tile.renderFlags.set({ refreshTransform: true });
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

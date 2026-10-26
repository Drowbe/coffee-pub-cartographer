// ==================================================================
// ===== JOINED WALLS ===============================================
// ==================================================================
//
// Walls that meet at a point are a joint, and a joint should move as one. In
// Foundry a wall dragged by one end moves only that wall's end, so a chain of
// walls comes apart at the joint; and an end let go next to another wall's end
// is left beside it, not on it. For a GM this makes both work the way a drawing
// program's would: let go near another end and it joins it, and moving a joint
// moves the walls on each side of it.
//
// It works on the update, not on the drag, so it follows however the wall was
// changed, and an undo in Foundry -- which moves the one wall back -- brings the
// joint back with it. The geometry is in utils-autowall.js (planJoinedMove).

import { MODULE } from './const.js';
import { planJoinedMove, snapNewWall, splitSegmentAt, SKIP_JOIN } from './utils-autowall.js';

/** How far, in screen pixels, a click may move and still be a click. */
const CLICK_PIXELS = 4;
/** How near, in screen pixels, a click must be to a wall to be on it. */
const WALL_PIXELS = 12;

class WallJoinManager {
    constructor() {
        /** What follows each wall being moved, by its id, between the two hooks. Kept here, not in the options, so nothing depends on Foundry handing them back. */
        this._pending = new Map();
        /** Set while the walls tool has its own run going, which cuts the walls it has found itself. */
        this.suspended = false;
        this._press = null;
        this._onDown = this._onDown.bind(this);
        this._onUp = this._onUp.bind(this);
    }

    initialize() {
        if (!game.user.isGM) return;
        Hooks.on('preUpdateWall', (document, changes, options, userId) => this._plan(document, changes, options, userId));
        Hooks.on('updateWall', (document, _changes, options, userId) => void this._follow(document, options, userId));
        Hooks.on('preCreateWall', (document, data, options, userId) => this._snapNew(document, data, options, userId));
        // Ctrl-click on a wall cuts it in two. The canvas is rebuilt with each scene, so listen to each.
        Hooks.on('canvasReady', () => this._listen());
        Hooks.on('canvasTearDown', () => this._unlisten());
        this._listen();
    }

    _listen() {
        const view = canvas?.app?.view;
        if (!view || this._listening === view) return;
        this._unlisten();
        // Watched, not taken: Foundry still sees the click, which only selects the wall.
        view.addEventListener('pointerdown', this._onDown, true);
        view.addEventListener('pointerup', this._onUp, true);
        this._listening = view;
    }

    _unlisten() {
        this._listening?.removeEventListener('pointerdown', this._onDown, true);
        this._listening?.removeEventListener('pointerup', this._onUp, true);
        this._listening = null;
        this._press = null;
    }

    _onDown(event) {
        this._press = event.button === 0 && (event.ctrlKey || event.metaKey) ? { x: event.clientX, y: event.clientY } : null;
    }

    /** A Ctrl-click, with the pointer where it went down, on the Walls layer: cut the wall under it. */
    _onUp(event) {
        const press = this._press;
        this._press = null;
        if (!press || event.button !== 0 || this.suspended || !canvas.walls?.active) return null;
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_PIXELS) return null;
        const rect = canvas.app.view.getBoundingClientRect();
        const point = canvas.app.stage.toLocal(new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top));
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
        return this.splitWallAt([point.x, point.y]);
    }

    /**
     * Cut the wall nearest a point in two, there. The new wall is a copy of the old, so it is the
     * same kind of wall; nothing is done near an end, where there is already a point. The two are a
     * joint afterwards, and Clean up walls will make them one again if they run straight on.
     */
    async splitWallAt(point) {
        const scene = canvas.scene;
        if (!game.user.isGM || !scene) return false;
        const reach = WALL_PIXELS / (canvas.stage?.scale?.x || 1);
        let best = null;
        for (const wall of scene.walls.contents) {
            const [x1, y1, x2, y2] = wall.c;
            const dx = x2 - x1;
            const dy = y2 - y1;
            const lengthSq = dx * dx + dy * dy;
            const t = lengthSq ? Math.max(0, Math.min(1, ((point[0] - x1) * dx + (point[1] - y1) * dy) / lengthSq)) : 0;
            const distance = Math.hypot(point[0] - (x1 + t * dx), point[1] - (y1 + t * dy));
            if (distance <= reach && (!best || distance < best.distance)) best = { wall, distance };
        }
        if (!best) return false;
        const [x1, y1, x2, y2] = best.wall.c;
        const cut = splitSegmentAt([[[x1, y1], [x2, y2]]], point, reach);
        if (!cut) return false;
        const [at] = [cut.at];
        const tail = best.wall.toObject();
        delete tail._id;
        tail.c = [at[0], at[1], x2, y2];
        try {
            // The new wall first, so if the second step fails there is an overlap and not a gap.
            await scene.createEmbeddedDocuments('Wall', [tail], { [SKIP_JOIN]: true });
            await scene.updateEmbeddedDocuments('Wall', [{ _id: best.wall.id, c: [x1, y1, at[0], at[1]] }], { [SKIP_JOIN]: true });
        } catch (error) {
            console.error(`${MODULE.NAME}: could not cut the wall`, error);
            return false;
        }
        ui.notifications.info(game.i18n.localize(`${MODULE.ID}.walls.splitDone`));
        return true;
    }

    /** Whether it is on, and how near another end an end must be let go to join it, in grid squares. */
    settings() {
        return {
            enabled: game.settings.get(MODULE.ID, 'walls.joinEnds'),
            squares: Number(game.settings.get(MODULE.ID, 'walls.joinDistance')) || 0
        };
    }

    /** A wall being drawn: an end let go near another wall's end joins it. */
    _snapNew(document, data, options, userId) {
        if (userId !== game.user.id || options?.[SKIP_JOIN]) return;
        const { enabled, squares } = this.settings();
        const scene = document.parent;
        if (!enabled || !scene?.walls) return;
        const shift = game.keyboard?.downKeys?.has('ShiftLeft') || game.keyboard?.downKeys?.has('ShiftRight');
        if (shift) return;
        const c = data?.c ?? document.c;
        if (!c || c.length !== 4) return;
        const grid = Number(scene.grid?.size) || 100;
        const snapped = snapNewWall(scene.walls.contents.map(wall => ({ id: wall.id, c: [...wall.c] })), [...c], squares * grid);
        if (snapped.some((value, index) => value !== c[index])) document.updateSource({ c: snapped });
    }

    /**
     * Before a wall is changed: if one end of it is moving, work out which walls go with it and
     * where the end really lands, and carry that to the update that follows.
     */
    _plan(document, changes, options, userId) {
        this._pending.delete(document.id);
        if (userId !== game.user.id || options?.[SKIP_JOIN] || !changes?.c) return;
        const { enabled, squares } = this.settings();
        if (!enabled) return;
        const scene = document.parent;
        if (!scene?.walls) return;
        // Shift is Foundry's own "do not snap"; it holds back the joining to another end too.
        const shift = game.keyboard?.downKeys?.has('ShiftLeft') || game.keyboard?.downKeys?.has('ShiftRight');
        const grid = Number(scene.grid?.size) || 100;
        const walls = scene.walls.contents.map(wall => ({ id: wall.id, c: [...wall.c] }));
        const plan = planJoinedMove(walls, document.id, [...document.c], [...changes.c], { reach: shift ? 0 : squares * grid });
        if (!plan) return;
        changes.c = plan.c;
        if (plan.updates.length || plan.deletes.length) this._pending.set(document.id, { updates: plan.updates, deletes: plan.deletes });
    }

    /** After it: the walls that were joined to the moved end follow it. */
    async _follow(document, options, userId) {
        const joined = this._pending.get(document.id);
        this._pending.delete(document.id);
        if (!joined || userId !== game.user.id || options?.[SKIP_JOIN]) return;
        const scene = document.parent;
        try {
            if (joined.updates.length) await scene.updateEmbeddedDocuments('Wall', joined.updates, { [SKIP_JOIN]: true });
            if (joined.deletes.length) await scene.deleteEmbeddedDocuments('Wall', joined.deletes);
        } catch (error) {
            console.error(`${MODULE.NAME}: could not move the walls joined to ${document.id}`, error);
        }
    }
}

export const wallJoinManager = new WallJoinManager();

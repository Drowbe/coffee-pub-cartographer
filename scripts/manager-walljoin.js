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
import { planJoinedMove, snapNewWall, SKIP_JOIN } from './utils-autowall.js';

class WallJoinManager {
    constructor() {
        /** What follows each wall being moved, by its id, between the two hooks. Kept here, not in the options, so nothing depends on Foundry handing them back. */
        this._pending = new Map();
    }

    initialize() {
        if (!game.user.isGM) return;
        Hooks.on('preUpdateWall', (document, changes, options, userId) => this._plan(document, changes, options, userId));
        Hooks.on('updateWall', (document, _changes, options, userId) => void this._follow(document, options, userId));
        Hooks.on('preCreateWall', (document, data, options, userId) => this._snapNew(document, data, options, userId));
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

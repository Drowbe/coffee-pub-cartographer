// ==================================================================
// ===== COLLECTIONS MANAGER ========================================
// ==================================================================

import { MODULE } from './const.js';
import { parallaxManager } from './manager-parallax.js';
import { tileMotionManager } from './manager-tilemotion.js';
import { sameActive } from './utils-groups.js';

/** Scene flag: the scene's saved collections. */
const FLAG_KEY = 'collections';

/**
 * A collection is a saved look for the whole scene: which layer groups and
 * which tile groups are on. Choosing one switches both, and everything fades
 * to match over each mode's Ease time.
 *
 *   { id, name, layerGroups, tileGroups }
 *
 * Each of layerGroups and tileGroups is saved the way the modes save what is
 * on -- null for All, [] for None, else group ids (see utils-groups.js).
 *
 * Which collection is "current" is not saved. It is whichever one matches
 * what is on now, so it can never disagree with the scene: change a group by
 * hand and no collection is current until the look matches one again.
 */
class CollectionsManager {
    initialize() {
        this._exposeApi();
    }

    /** `game.modules.get('coffee-pub-cartographer').api.collections` -- for macros and Active Tiles. */
    _exposeApi() {
        const module = game.modules.get(MODULE.ID);
        if (!module) return;
        module.api ??= {};
        module.api.collections = {
            apply: nameOrId => this.apply(nameOrId),
            get list() { return collectionsManager.list.map(collection => collection.name); },
            get current() { return collectionsManager.current()?.name ?? null; }
        };
    }

    get list() {
        return foundry.utils.deepClone(canvas.scene?.getFlag(MODULE.ID, FLAG_KEY)?.list ?? []);
    }

    /** What is on now, in both modes. */
    snapshot() {
        return {
            layerGroups: foundry.utils.deepClone(parallaxManager.state.activeSets ?? null),
            tileGroups: foundry.utils.deepClone(tileMotionManager.motion.activeGroups ?? null)
        };
    }

    matches(collection, now = this.snapshot()) {
        return sameActive(collection.layerGroups ?? null, now.layerGroups)
            && sameActive(collection.tileGroups ?? null, now.tileGroups);
    }

    /** The collection that matches what is on now, if any. */
    current() {
        const now = this.snapshot();
        return this.list.find(collection => this.matches(collection, now)) ?? null;
    }

    find(nameOrId) {
        if (!nameOrId) return null;
        const key = String(nameOrId).toLowerCase();
        const list = this.list;
        return list.find(entry => entry.id === nameOrId)
            ?? list.find(entry => entry.name.toLowerCase() === key)
            ?? null;
    }

    async _write(list) {
        if (!game.user.isGM || !canvas.scene) return;
        await canvas.scene.setFlag(MODULE.ID, FLAG_KEY, { list });
    }

    /** Save what is on now as a new collection. */
    async save(name) {
        const label = String(name ?? '').trim();
        if (!label) return;
        await this._write([...this.list, { id: foundry.utils.randomID(), name: label, ...this.snapshot() }]);
    }

    /** Replace a collection's look with what is on now. */
    async update(id) {
        await this._write(this.list.map(entry => (entry.id === id ? { ...entry, ...this.snapshot() } : entry)));
    }

    async rename(id, name) {
        const label = String(name ?? '').trim();
        if (!label) return;
        await this._write(this.list.map(entry => (entry.id === id ? { ...entry, name: label } : entry)));
    }

    /** Copy a collection under a new name, with the same look. */
    async duplicate(id) {
        const list = this.list;
        const index = list.findIndex(entry => entry.id === id);
        if (index < 0) return;
        const copy = {
            ...list[index],
            id: foundry.utils.randomID(),
            name: game.i18n.format(`${MODULE.ID}.parallax.copyName`, { name: list[index].name })
        };
        list.splice(index + 1, 0, copy);
        await this._write(list);
    }

    async remove(id) {
        await this._write(this.list.filter(entry => entry.id !== id));
    }

    /**
     * Switch both modes to a collection's look, by id or name. Groups deleted
     * since it was saved are skipped.
     */
    async apply(nameOrId) {
        if (!game.user.isGM) return;
        const collection = this.find(nameOrId);
        if (!collection) return;
        await parallaxManager.setActiveSets(collection.layerGroups ?? null);
        await tileMotionManager.setActiveGroups(collection.tileGroups ?? null);
    }
}

export const collectionsManager = new CollectionsManager();

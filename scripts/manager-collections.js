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
 * Which collection is "current" is worked out, not saved: it is one that
 * matches what is on now, so it can never disagree with the scene -- change a
 * group by hand and no collection is current until the look matches one again.
 * Two collections can save the same look, though, so the flag also keeps the
 * one last saved or applied (`lastId`), which wins when more than one matches.
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

    /**
     * The collection that matches what is on now, if any. When several do,
     * the one last saved or applied; failing that, the first.
     */
    current() {
        const now = this.snapshot();
        const matching = this.list.filter(collection => this.matches(collection, now));
        const lastId = canvas.scene?.getFlag(MODULE.ID, FLAG_KEY)?.lastId;
        return matching.find(collection => collection.id === lastId) ?? matching[0] ?? null;
    }

    find(nameOrId) {
        if (!nameOrId) return null;
        const key = String(nameOrId).toLowerCase();
        const list = this.list;
        return list.find(entry => entry.id === nameOrId)
            ?? list.find(entry => entry.name.toLowerCase() === key)
            ?? null;
    }

    /** Save the list, and which collection was last saved or applied (kept unless given). */
    async _write(list, lastId = canvas.scene?.getFlag(MODULE.ID, FLAG_KEY)?.lastId ?? null) {
        if (!game.user.isGM || !canvas.scene) return;
        const kept = list.some(entry => entry.id === lastId) ? lastId : null;
        await canvas.scene.setFlag(MODULE.ID, FLAG_KEY, { list, lastId: kept });
    }

    /**
     * Add a collection with the given look -- `layerGroups` and `tileGroups`,
     * each null (All), [] (None) or group ids -- and switch to it, so the GM
     * sees what they just made, as a new group shows itself.
     */
    async create(name, { layerGroups = null, tileGroups = null } = {}) {
        const label = String(name ?? '').trim();
        if (!label) return;
        const collection = { id: foundry.utils.randomID(), name: label, layerGroups, tileGroups };
        await this._write([...this.list, collection], collection.id);
        await this.apply(collection.id);
    }

    /**
     * Change a collection's name and look. If it is the one showing, the scene
     * follows the change, so it does not quietly stop matching.
     */
    async edit(id, { name, layerGroups, tileGroups }) {
        const wasCurrent = this.current()?.id === id;
        const label = String(name ?? '').trim();
        await this._write(this.list.map(entry => (entry.id === id
            ? { ...entry, name: label || entry.name, layerGroups, tileGroups }
            : entry)));
        if (wasCurrent) await this.apply(id);
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
        await this._write(this.list, collection.id);
        await parallaxManager.setActiveSets(collection.layerGroups ?? null);
        await tileMotionManager.setActiveGroups(collection.tileGroups ?? null);
    }
}

export const collectionsManager = new CollectionsManager();

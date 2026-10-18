// ==================================================================
// ===== SCENE MOTION: SUB-MENUBAR ==================================
// ==================================================================

import { MODULE } from './const.js';
import { cartographerToolbar } from './manager-toolbar.js';
import { parallaxManager } from './manager-parallax.js';
import { tileMotionManager } from './manager-tilemotion.js';
import { collectionsManager } from './manager-collections.js';

/** The section of Cartographer's sub-menubar these sit in; registered in manager-toolbar.js. */
const GROUP = 'Scene Motion';
const IDS = {
    window: `${MODULE.ID}-motion-window`,
    layers: `${MODULE.ID}-motion-layers`,
    tiles: `${MODULE.ID}-motion-tiles`
};
const COLLECTION_PREFIX = `${MODULE.ID}-motion-collection-`;
/** More than this many collections and the rest are reached from the window. */
const MAX_COLLECTION_BUTTONS = 6;

/**
 * Quick actions for scene motion in Cartographer's sub-menubar, for the GM:
 * open the window, Play/Stop the parallax layers, Play/Stop the tiles, and a
 * button per collection to switch to it. The Play/Stop buttons light up while
 * their motion runs, and the collection that matches the scene's look lights
 * up too, so the bar doubles as a read-out of what is going on.
 */
class MotionBar {
    constructor() {
        this._collectionIds = [];
        this._collectionSignature = '';
        this._hooks = [];
    }

    initialize() {
        if (!game.user.isGM) return;
        this._registerStaticButtons();
        const on = (name, fn) => this._hooks.push({ name, id: Hooks.on(name, fn) });
        on('canvasReady', () => this.refresh());
        // Play/Stop, groups and collections all live in scene flags.
        on('updateScene', (scene, changes) => {
            if (scene.id !== canvas.scene?.id) return;
            if (!foundry.utils.hasProperty(changes, `flags.${MODULE.ID}`)) return;
            this.refresh();
        });
        this.refresh();
    }

    _registerStaticButtons() {
        const localize = key => game.i18n.localize(`${MODULE.ID}.parallax.${key}`);
        cartographerToolbar.registerTool(IDS.window, {
            icon: 'fa-solid fa-sliders',
            tooltip: localize('barOpenWindow'),
            group: GROUP,
            order: 1,
            toggleable: false,
            onClick: () => parallaxManager.openWindow()
        });
        cartographerToolbar.registerTool(IDS.layers, {
            icon: 'fa-solid fa-mountain-sun',
            tooltip: localize('barPlayLayers'),
            group: GROUP,
            order: 2,
            toggleable: true,
            active: () => !!parallaxManager.state.playing,
            onClick: () => parallaxManager.togglePlaying()
        });
        cartographerToolbar.registerTool(IDS.tiles, {
            icon: 'fa-solid fa-arrows-spin',
            tooltip: localize('barPlayTiles'),
            group: GROUP,
            order: 3,
            toggleable: true,
            active: () => !!tileMotionManager.motion.playing,
            onClick: () => tileMotionManager.togglePlaying()
        });
    }

    /** Bring the buttons in line with the scene: which motion runs, which collections exist, which is current. */
    refresh() {
        if (!game.user.isGM || !canvas?.scene) return;
        this._syncCollectionButtons();
        const api = game.modules.get('coffee-pub-blacksmith')?.api;
        if (typeof api?.updateSecondaryBarItemActive !== 'function') return;
        api.updateSecondaryBarItemActive(MODULE.ID, IDS.layers, !!parallaxManager.state.playing);
        api.updateSecondaryBarItemActive(MODULE.ID, IDS.tiles, !!tileMotionManager.motion.playing);
        const current = collectionsManager.current();
        for (const id of this._collectionIds) {
            api.updateSecondaryBarItemActive(MODULE.ID, `${COLLECTION_PREFIX}${id}`, id === current?.id);
        }
    }

    /**
     * One button per collection on this scene. The bar has no way to rename or
     * reorder a button in place, so when the scene's collections change -- a new
     * scene, or one added, renamed or removed -- the buttons are rebuilt.
     */
    _syncCollectionButtons() {
        const collections = collectionsManager.list.slice(0, MAX_COLLECTION_BUTTONS);
        const signature = collections.map(collection => `${collection.id}:${collection.name}`).join('|');
        if (signature === this._collectionSignature) return;
        for (const id of this._collectionIds) cartographerToolbar.unregisterTool(`${COLLECTION_PREFIX}${id}`);
        const current = collectionsManager.current();
        const tooltip = game.i18n.localize(`${MODULE.ID}.parallax.applyCollection`);
        collections.forEach((collection, index) => {
            cartographerToolbar.registerTool(`${COLLECTION_PREFIX}${collection.id}`, {
                icon: 'fa-solid fa-boxes-stacked',
                label: collection.name,
                tooltip: `${tooltip}: ${collection.name}`,
                group: GROUP,
                order: 10 + index,
                toggleable: true,
                active: collection.id === current?.id,
                onClick: () => collectionsManager.apply(collection.id)
            });
        });
        this._collectionIds = collections.map(collection => collection.id);
        this._collectionSignature = signature;
    }
}

export const motionBar = new MotionBar();

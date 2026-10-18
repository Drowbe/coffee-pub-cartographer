// ==================================================================
// ===== SCENE MOTION: SUB-MENUBAR ==================================
// ==================================================================

import { MODULE } from './const.js';
import { cartographerToolbar } from './manager-toolbar.js';
import { parallaxManager } from './manager-parallax.js';
import { tileMotionManager } from './manager-tilemotion.js';
import { collectionsManager } from './manager-collections.js';
import { NONE_GROUP } from './utils-groups.js';

/** The section of Cartographer's sub-menubar these sit in; registered in manager-toolbar.js. */
const GROUP = 'Scene Motion';
const IDS = {
    window: `${MODULE.ID}-motion-window`,
    layers: `${MODULE.ID}-motion-layers`,
    tiles: `${MODULE.ID}-motion-tiles`,
    looks: `${MODULE.ID}-motion-looks`
};
const MENU_ID = `${MODULE.ID}-motion-looks-menu`;

/**
 * Quick actions for scene motion in Cartographer's sub-menubar, for the GM:
 * open the window, Play/Stop the parallax layers, Play/Stop the tiles, and one
 * button for the scene's look -- a menu of collections, layer groups and tile
 * groups. The Play/Stop buttons light up while their motion runs.
 *
 * The look is one menu rather than a button per collection because the bar
 * has a fixed width and a scene can have any number of collections and groups.
 */
class MotionBar {
    constructor() {
        this._hooks = [];
    }

    initialize() {
        if (!game.user.isGM) return;
        this._registerButtons();
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

    _registerButtons() {
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
        // The same menu on a left click as on a right one: it is the button's
        // whole purpose, so it should not be hidden behind a right click.
        cartographerToolbar.registerTool(IDS.looks, {
            icon: 'fa-solid fa-boxes-stacked',
            tooltip: localize('barLooks'),
            group: GROUP,
            order: 4,
            toggleable: false,
            contextMenuItems: () => this._menuItems(),
            onClick: event => this._openMenu(event)
        });
    }

    /** Bring the Play/Stop buttons in line with the scene. The menu is built fresh each time it opens. */
    refresh() {
        if (!game.user.isGM || !canvas?.scene) return;
        const api = game.modules.get('coffee-pub-blacksmith')?.api;
        if (typeof api?.updateSecondaryBarItemActive !== 'function') return;
        api.updateSecondaryBarItemActive(MODULE.ID, IDS.layers, !!parallaxManager.state.playing);
        api.updateSecondaryBarItemActive(MODULE.ID, IDS.tiles, !!tileMotionManager.motion.playing);
    }

    // ==================================================================
    // ===== THE LOOK MENU ==============================================
    // ==================================================================

    /**
     * Collections, layer groups and tile groups, each a flyout. Collections
     * are a single choice, marked with a dot; groups add together, so they
     * are marked with switches and each click turns one on or off. All and
     * None head each group list.
     */
    _menuItems() {
        const localize = key => game.i18n.localize(`${MODULE.ID}.parallax.${key}`);
        const empty = key => [{ name: localize(key), icon: 'fa-solid fa-ban', disabled: true }];

        const current = collectionsManager.current()?.id ?? null;
        const collections = collectionsManager.list.map(collection => ({
            name: collection.name,
            icon: collection.id === current ? 'fa-solid fa-circle-dot' : 'fa-regular fa-circle',
            onClick: () => collectionsManager.apply(collection.id)
        }));

        const groupItems = (groups, active, { setActive, toggle, allKey, noneKey }) => [
            { name: localize(allKey), icon: active === null ? 'fa-solid fa-circle-dot' : 'fa-regular fa-circle', onClick: () => setActive(null) },
            { name: localize(noneKey), icon: Array.isArray(active) && !active.length ? 'fa-solid fa-circle-dot' : 'fa-regular fa-circle', onClick: () => setActive(NONE_GROUP) },
            ...(groups.length ? [{ separator: true }] : []),
            ...groups.map(group => ({
                name: group.name,
                icon: active?.includes(group.id) ? 'fa-solid fa-toggle-on' : 'fa-solid fa-toggle-off',
                onClick: () => toggle(group.id)
            }))
        ];

        const parallax = parallaxManager.state;
        const tiles = tileMotionManager.motion;
        return [
            {
                name: localize('tabCollections'),
                icon: 'fa-solid fa-boxes-stacked',
                submenu: collections.length ? collections : empty('noCollections')
            },
            {
                name: localize('layerGroups'),
                icon: 'fa-solid fa-layer-group',
                submenu: parallax.layers.length
                    ? groupItems(parallax.sets, parallax.activeSets, {
                        setActive: id => parallaxManager.setActiveSet(id),
                        toggle: id => parallaxManager.toggleSet(id),
                        allKey: 'allLayers',
                        noneKey: 'noLayers'
                    })
                    : empty('collectionsNoLayers')
            },
            {
                name: localize('tileGroups'),
                icon: 'fa-solid fa-arrows-spin',
                submenu: tileMotionManager.configs.size
                    ? groupItems(tiles.groups, tiles.activeGroups, {
                        setActive: id => tileMotionManager.setActiveGroup(id),
                        toggle: id => tileMotionManager.toggleGroup(id),
                        allKey: 'allTiles',
                        noneKey: 'noTiles'
                    })
                    : empty('collectionsNoTiles')
            }
        ];
    }

    /**
     * Open the menu from a left click, through Blacksmith's public context
     * menu, just below the button. The bar's own right-click menu takes the
     * same items in the menubar's shape; this turns them into the context
     * menu's shape (callback for onClick).
     */
    _openMenu(event) {
        const ui = game.modules.get('coffee-pub-blacksmith')?.api?.uiContextMenu;
        if (!ui?.show) return;
        const toMenu = item => item.separator ? { separator: true } : {
            name: item.name,
            icon: item.icon,
            disabled: !!item.disabled,
            submenu: item.submenu?.map(toMenu) ?? null,
            callback: item.submenu ? undefined : () => item.onClick?.()
        };
        const button = event?.target?.closest?.('.secondary-bar-item, button');
        const rect = button?.getBoundingClientRect();
        ui.show({
            id: MENU_ID,
            x: rect ? rect.left : (event?.clientX ?? 0),
            y: rect ? rect.bottom + 4 : (event?.clientY ?? 0),
            zones: this._menuItems().map(toMenu),
            zoneClass: 'core'
        });
    }
}

export const motionBar = new MotionBar();

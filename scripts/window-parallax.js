// ==================================================================
// ===== PARALLAX TOOL WINDOW =======================================
// ==================================================================

import { MODULE } from './const.js';
import { PARALLAX_DIRECTIONS } from './manager-parallax.js';
import { defaultTileMotion, tileMotionManager } from './manager-tilemotion.js';
import { collectionsManager } from './manager-collections.js';
import { NONE_GROUP } from './utils-groups.js';
// Imported from the bridge, not module.api: see the note in window-mapping.js.
import { BlacksmithToolWindowBaseV2 } from '/modules/coffee-pub-blacksmith/api/blacksmith-api.js';

const APP_ID = `${MODULE.ID}-parallax`;

/**
 * The range each slider offers. Speeds are scene pixels per second.
 *
 * Master speed is centred on zero: right of centre runs the scenery in its
 * forward direction, left of centre runs it in reverse, and the middle stops
 * it. One control then carries both how fast and which way, which is what a GM
 * reaches for mid-scene ("the wagon backs up").
 */
const SLIDER_RANGES = {
    masterSpeed: { min: -4, max: 4, step: 0.05 },
    angle: { min: 0, max: 359, step: 1 },
    easeSeconds: { min: 0, max: 10, step: 0.5 },
    // Centred on zero like the master: a layer can run against the others.
    speed: { min: -600, max: 600, step: 5 },
    alpha: { min: 0, max: 1, step: 0.05 },
    scale: { min: 0.1, max: 4, step: 0.05 },
    angleOffset: { min: -180, max: 180, step: 1 },
    depth: { min: -1, max: 1, step: 0.05 },
    // Tile mode.
    rotateSpeed: { min: -360, max: 360, step: 5 },
    pivot: { min: 0, max: 1, step: 0.05 },
    scrollSpeed: { min: -600, max: 600, step: 5 },
    scrollAngle: { min: 0, max: 359, step: 1 },
    scrollScale: { min: 0.1, max: 4, step: 0.05 }
};
/** A master speed this close to zero snaps to a stop, so the middle is easy to find by hand. */
const MASTER_SNAP = 0.1;
/** The same, for a layer's own speed in pixels per second. */
const LAYER_SNAP = 10;
/** The same, for a tile's spin (degrees per second) and scroll (pixels per second). */
const TILE_SNAP = { 'rotate.speed': 5, 'scroll.speed': 10 };

/** The two things the window can run: the scene's parallax, or its animated tiles. */
/**
 * The three things the window can run: the scene's parallax layers, its
 * animated tiles, or its collections -- saved looks across both, which is why
 * they are a mode of their own rather than a tab inside either.
 */
const TARGETS = [
    { id: 'scene', icon: 'fa-solid fa-layer-group', labelKey: 'targetScene' },
    { id: 'tiles', icon: 'fa-solid fa-arrows-spin', labelKey: 'targetTiles' },
    { id: 'collections', icon: 'fa-solid fa-boxes-stacked', labelKey: 'targetCollections' }
];

function tileName(tileDocument) {
    const src = tileDocument.texture?.src ?? '';
    return decodeURIComponent(src.split('/').pop() ?? '').replace(/\.[^.]+$/, '') || tileDocument.id;
}

/**
 * Window preferences, per browser. They describe how this GM likes to read the
 * window, not anything about the scene, so they are kept out of the scene flag
 * that every player receives.
 */
const PREFS_KEY = `${MODULE.ID}.parallax.windowPrefs`;
/** The settings tabs in the parallax and tiles modes. Collections mode has one panel and no tabs. */
const TABS = [
    { id: 'movement', icon: 'fa-solid fa-gauge-high', labelKey: 'tabMovement' },
    { id: 'layers', icon: 'fa-solid fa-layer-group', labelKey: 'tabLayers' },
    { id: 'sets', icon: 'fa-solid fa-swatchbook', labelKey: 'tabSets' }
];
const TILE_TABS = [
    { id: 'movement', icon: 'fa-solid fa-gauge-high', labelKey: 'tabMovement' },
    { id: 'tiles', icon: 'fa-solid fa-arrows-spin', labelKey: 'tabTiles' },
    { id: 'sets', icon: 'fa-solid fa-swatchbook', labelKey: 'tabSets' }
];
/** The bar's choice when what is on matches no single group or collection. */
const MIXED = '__mixed__';
function readPrefs() {
    try {
        return JSON.parse(localStorage.getItem(PREFS_KEY)) ?? {};
    } catch {
        return {};
    }
}
function writePrefs(prefs) {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
        // Storage unavailable: the preference lasts for this session only.
    }
}

function formatMaster(value) {
    const n = Number(value) || 0;
    if (n === 0) return '0×';
    return `${n > 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}×`;
}

export class ParallaxWindow extends BlacksmithToolWindowBaseV2 {
    // A plain object, not a copy of super's merged in. Foundry already merges
    // DEFAULT_OPTIONS down the class chain (concatenating arrays), so copying
    // super's in re-contributes core's v14 window.controls and duplicates the
    // Detach / Re-attach menu entries. See window-tool-base.js in Blacksmith.
    // The base class's own 'blacksmith-window-tool' arrives through that merge.
    static DEFAULT_OPTIONS = {
        id: APP_ID,
        classes: ['cartographer-parallax-window'],
        // A fixed height, not 'auto'. With 'auto', Foundry refits the window to
        // its content on every re-render -- every click, slider release and
        // scene update here -- and pushes it back on screen when that makes it
        // taller, so it kept resizing and moving by itself. With a number the
        // window keeps whatever size and place the GM gives it; the body
        // scrolls when there is more than fits.
        position: { width: 400, height: 560 },
        window: {
            title: `${MODULE.ID}.parallax.windowTitle`,
            icon: 'fa-solid fa-layer-group',
            resizable: true,
            minimizable: true
        },
        toolTheme: 'glass',
        // No minimum height: with settings hidden the window is only its bar.
        windowSizeConstraints: { minWidth: 380 }
    };

    static ACTION_HANDLERS = {
        'toggle-play': (_event, _target, app) => void app._motion().togglePlaying(),
        'set-target': (_event, target, app) => app.setTarget(target.dataset.target),
        'toggle-tile-part': (_event, target, _app) => {
            const config = tileMotionManager.configs.get(target.dataset.tileId);
            const part = target.dataset.part;
            if (config && part) void tileMotionManager.setTileMotion(target.dataset.tileId, `${part}.enabled`, !config[part].enabled);
        },
        'toggle-tile-visible': (_event, target, _app) => {
            const config = tileMotionManager.configs.get(target.dataset.tileId);
            if (config) void tileMotionManager.setTileMotion(target.dataset.tileId, 'visible', !config.visible);
        },
        'toggle-tile-collapse': (_event, target, app) => app.toggleTileCollapsed(target.dataset.tileId),
        'collapse-all-tiles': (_event, _target, app) => app.setAllTilesCollapsed(true),
        'expand-all-tiles': (_event, _target, app) => app.setAllTilesCollapsed(false),
        'manage-selected-tile': (_event, target, _app) => void tileMotionManager.setTileMotion(target.dataset.tileId, 'visible', true),
        'toggle-set-tile': (_event, target, _app) => void tileMotionManager.toggleGroupTile(target.dataset.setId, target.dataset.tileId),
        'select-tile': (_event, target, app) => app.selectTile(target.dataset.tileId),
        'clear-tile-motion': (_event, target, app) => app.confirmClearTile(target.dataset.tileId),
        'reset-tile-positions': (_event, _target, _app) => void tileMotionManager.resetPositions(),
        'reset-positions': (_event, _target, app) => void app.manager.resetPositions(),
        'set-direction': (_event, target, app) => void app.manager.setAngle(target.dataset.direction),
        'toggle-settings': (_event, _target, app) => app.toggleSettings(),
        'set-tab': (_event, target, app) => app.setTab(target.dataset.tab),
        'toggle-collapse': (_event, target, app) => app.toggleCollapsed(target.dataset.layerId),
        'collapse-all': (_event, _target, app) => app.setAllCollapsed(true),
        'expand-all': (_event, _target, app) => app.setAllCollapsed(false),
        'add-layer': (_event, _target, app) => app.pickImage(src => app.manager.addLayer(src)),
        'replace-layer': (_event, target, app) => {
            const layer = app._layer(target.dataset.layerId);
            if (layer) app.pickImage(src => app.manager.updateLayer(layer.id, { src }), layer.src);
        },
        'remove-layer': (_event, target, app) => app.confirmRemoveLayer(target.dataset.layerId),
        'duplicate-layer': (_event, target, app) => void app.manager.duplicateLayer(target.dataset.layerId),
        'copy-from-scene': (_event, _target, app) => app.promptCopyFromScene(),
        'export-parallax': (_event, _target, app) => app.exportParallax(),
        'import-parallax': (_event, _target, app) => app.promptImportParallax(),
        'move-up': (_event, target, app) => void app.manager.moveLayer(target.dataset.layerId, 1),
        'move-down': (_event, target, app) => void app.manager.moveLayer(target.dataset.layerId, -1),
        'select-set': (_event, target, app) => void app._groups().setActive(target.dataset.setId || null),
        'toggle-group': (_event, target, app) => void app._groups().toggle(target.dataset.setId),
        // Collections tab: both modes' groups, and the saved looks.
        'toggle-layer-group': (_event, target, app) => void app.manager.toggleSet(target.dataset.setId),
        'toggle-tile-group': (_event, target, _app) => void tileMotionManager.toggleGroup(target.dataset.setId),
        'layer-groups-all': (_event, _target, app) => void app.manager.setActiveSets(null),
        'layer-groups-none': (_event, _target, app) => void app.manager.setActiveSets([]),
        'tile-groups-all': (_event, _target, _app) => void tileMotionManager.setActiveGroups(null),
        'tile-groups-none': (_event, _target, _app) => void tileMotionManager.setActiveGroups([]),
        'save-collection': (_event, _target, app) => app.promptCollectionName('saveCollection').then(name => name && collectionsManager.save(name)),
        'apply-collection': (_event, target, _app) => void collectionsManager.apply(target.dataset.collectionId),
        'update-collection': (_event, target, _app) => void collectionsManager.update(target.dataset.collectionId),
        'rename-collection': (_event, target, app) => {
            const collection = collectionsManager.find(target.dataset.collectionId);
            if (collection) app.promptCollectionName('renameCollection', collection.name).then(name => name && collectionsManager.rename(collection.id, name));
        },
        'remove-collection': (_event, target, app) => app.confirmRemoveCollection(target.dataset.collectionId),
        'duplicate-collection': (_event, target, _app) => void collectionsManager.duplicate(target.dataset.collectionId),
        'add-set': (_event, _target, app) => app.editSet(null),
        'edit-set': (_event, target, app) => app.editSet(target.dataset.setId),
        'duplicate-set': (_event, target, app) => void app._groups().duplicate(target.dataset.setId),
        'toggle-set-expand': (_event, target, app) => app.toggleSetExpanded(target.dataset.setId),
        'toggle-set-layer': (_event, target, app) => void app.manager.toggleSetLayer(target.dataset.setId, target.dataset.layerId),
        'remove-set': (_event, target, app) => app.confirmRemoveSet(target.dataset.setId),
        'set-band': (_event, target, app) => void app.manager.updateLayer(target.dataset.layerId, { band: target.dataset.band === 'true' }),
        'toggle-visible': (_event, target, app) => {
            const layer = app._layer(target.dataset.layerId);
            if (layer) void app.manager.updateLayer(layer.id, { visible: !layer.visible });
        }
    };

    constructor(manager, options = {}) {
        super(options);
        this.manager = manager;
        const prefs = readPrefs();
        /**
         * Whether the settings tabs are showing. Hidden, the window is just its
         * control bar -- play/stop, speed and set -- which is all a GM needs
         * mid-scene. Older prefs stored this as a 'control' mode.
         */
        this.settingsOpen = prefs.settingsOpen ?? prefs.mode !== 'control';
        /** The height the window had with settings showing, to return to. */
        this._settingsHeight = prefs.settingsHeight ?? null;
        this.collapsed = new Set(prefs.collapsed ?? []);
        /** Sets opened out in the Sets tab to show their layers. */
        this.expandedSets = new Set(prefs.expandedSets ?? []);
        this.tab = TABS.some(tab => tab.id === prefs.tab) ? prefs.tab : 'layers';
        this.tileTab = TILE_TABS.some(tab => tab.id === prefs.tileTab) ? prefs.tileTab : 'tiles';
        /** Managed tiles folded to one line in the Tiles tab. */
        this.collapsedTiles = new Set(prefs.collapsedTiles ?? []);
        /** Which the bar and settings are running: 'scene' parallax or 'tiles'. */
        this.target = TARGETS.some(entry => entry.id === prefs.target) ? prefs.target : 'scene';
        this._onInput = this._onInput.bind(this);
        this._onChange = this._onChange.bind(this);
        this._onDragStart = this._onDragStart.bind(this);
        this._onDragOver = this._onDragOver.bind(this);
        this._onDrop = this._onDrop.bind(this);
        this._onDragEnd = this._onDragEnd.bind(this);
        /** The layer being dragged in the Layers tab, while a drag is under way. */
        this._dragLayerId = null;
    }

    static async open(manager) {
        const existing = foundry.applications?.instances?.get(APP_ID);
        if (existing) {
            existing.manager = manager;
            existing.bringToFront?.();
            return existing;
        }
        const window = new ParallaxWindow(manager);
        await window.render({ force: true });
        return window;
    }

    _layer(id) {
        return this.manager.state.layers.find(l => l.id === id) ?? null;
    }

    pickImage(callback, current = '') {
        const FilePicker = foundry.applications.apps.FilePicker.implementation;
        new FilePicker({ type: 'imagevideo', current, callback }).browse();
    }

    // ==================================================================
    // ===== GROUPS =====================================================
    // ==================================================================

    /**
     * The groups for the mode the window is in. Parallax groups hold layers;
     * tile groups hold tiles; each mode has its own and shows one at a time,
     * independently of the other. This gives the window one shape for both:
     * a list of groups, each with its item ids and the ids switched off in it,
     * and the operations on them. (Parallax groups are stored as `sets`, the
     * name they had first.)
     */
    _groups() {
        if (this.target === 'tiles') {
            const motion = tileMotionManager.motion;
            return {
                list: motion.groups.map(group => ({ id: group.id, name: group.name, items: group.tiles, off: group.hidden })),
                active: motion.activeGroups,
                setActive: id => tileMotionManager.setActiveGroup(id),
                toggle: id => tileMotionManager.toggleGroup(id),
                duplicate: id => tileMotionManager.duplicateGroup(id),
                add: (name, items) => tileMotionManager.addGroup(name, items),
                update: (id, { name, items }) => tileMotionManager.updateGroup(id, { name, tiles: items }),
                remove: id => tileMotionManager.removeGroup(id)
            };
        }
        const state = this.manager.state;
        return {
            list: state.sets.map(set => ({ id: set.id, name: set.name, items: set.layers, off: set.hidden })),
            active: state.activeSets,
            setActive: id => this.manager.setActiveSet(id),
            toggle: id => this.manager.toggleSet(id),
            duplicate: id => this.manager.duplicateSet(id),
            add: (name, items) => this.manager.addSet(name, items),
            update: (id, { name, items }) => this.manager.updateSet(id, { name, layers: items }),
            remove: id => this.manager.removeSet(id)
        };
    }

    /**
     * Add a group (id null) or edit one: a name and a checkbox per item. In
     * parallax mode the items are layers, listed as the Layers tab lists them
     * -- nearest first, split at the token line; in tiles mode, the managed
     * tiles.
     */
    async editSet(id) {
        const groups = this._groups();
        const group = id ? groups.list.find(entry => entry.id === id) : null;
        if (id && !group) return;
        const isTiles = this.target === 'tiles';
        const localize = key => game.i18n.localize(`${MODULE.ID}.parallax.${key}`);
        const esc = value => foundry.utils.escapeHTML(String(value ?? ''));
        const isVideo = src => foundry.helpers.media.VideoHelper.hasVideoExtension(src ?? '');
        const state = this.manager.state;
        const managedTiles = (canvas.scene?.tiles ?? []).filter(tile => tileMotionManager.configs.has(tile.id));
        // A new group starts from what is showing now, which is usually the
        // nearest thing to what the GM wants and leaves them to adjust it.
        const checked = new Set(group ? group.items : (isTiles
            ? managedTiles.filter(tile => tileMotionManager.isTileShown(tile.id)).map(tile => tile.id)
            : state.layers.filter(l => this.manager.isLayerShown(l)).map(l => l.id)));

        const row = ({ id: itemId, name, src, icon }) => `
            <label class="cartographer-parallax-set-dialog-row">
                <input type="checkbox" name="items" value="${esc(itemId)}" ${checked.has(itemId) ? 'checked' : ''}>
                <span class="cartographer-parallax-set-dialog-thumb">${isVideo(src) ? '<i class="fa-solid fa-film"></i>' : `<img src="${esc(src)}" alt="">`}</span>
                <span class="cartographer-parallax-set-dialog-name">${esc(name)}</span>
                ${icon ?? ''}
            </label>`;
        let list;
        if (isTiles) {
            list = managedTiles.map(tile => row({ id: tile.id, name: tileName(tile), src: tile.texture?.src })).join('');
        } else if (state.layers.length) {
            const layerRow = layer => row({
                ...layer,
                icon: layer.overhead ? `<i class="fa-solid fa-cloud" data-tooltip="${esc(localize('overheadLayer'))}"></i>` : ''
            });
            const nearestFirst = [...state.layers].reverse();
            list = nearestFirst.filter(l => l.overhead).map(layerRow).join('')
                + `<div class="cartographer-parallax-set-dialog-line"><span><i class="fa-solid fa-chess-pawn"></i> ${esc(localize('tokenLine'))}</span></div>`
                + nearestFirst.filter(l => !l.overhead).map(layerRow).join('');
        }
        if (!list) list = `<p class="cartographer-parallax-set-dialog-empty">${esc(localize(isTiles ? 'groupNoTiles' : 'setNoLayers'))}</p>`;

        const content = `
            <div class="cartographer-parallax-set-dialog-body">
                <label class="cartographer-parallax-set-dialog-field">
                    <span>${esc(localize('setName'))}</span>
                    <input type="text" name="name" value="${esc(group?.name ?? '')}" placeholder="${esc(localize('setNamePlaceholder'))}" autofocus>
                </label>
                <div class="cartographer-parallax-set-dialog-head">
                    <span>${esc(localize(isTiles ? 'groupTiles' : 'setLayers'))}</span>
                    <span class="cartographer-parallax-set-dialog-bulk">
                        <a data-bulk="all">${esc(localize('selectAll'))}</a> · <a data-bulk="none">${esc(localize('selectNone'))}</a>
                    </span>
                </div>
                <div class="cartographer-parallax-set-dialog-list">${list}</div>
            </div>`;

        const result = await foundry.applications.api.DialogV2.prompt({
            classes: ['cartographer-parallax-set-dialog'],
            window: { title: localize(group ? 'editSet' : 'addSet'), icon: 'fa-solid fa-swatchbook' },
            position: { width: 360 },
            content,
            ok: {
                label: localize(group ? 'saveSet' : 'addSet'),
                callback: (_event, button) => ({
                    name: button.form.elements.name.value,
                    items: new FormData(button.form).getAll('items')
                })
            },
            render: (_event, dialog) => {
                // Select all / none, wired here because the dialog is its own application.
                dialog.element.querySelectorAll('[data-bulk]').forEach(link => link.addEventListener('click', () => {
                    const on = link.dataset.bulk === 'all';
                    dialog.element.querySelectorAll('input[name="items"]').forEach(box => { box.checked = on; });
                }));
            },
            rejectClose: false
        });
        if (!result) return;
        const name = result.name.trim() || game.i18n.format(`${MODULE.ID}.parallax.setDefaultName`, { n: groups.list.length + 1 });
        if (group) await groups.update(group.id, { name, items: result.items });
        else await groups.add(name, result.items);
    }

    async promptCollectionName(titleKey, value = '') {
        const localize = key => game.i18n.localize(`${MODULE.ID}.parallax.${key}`);
        const esc = text => foundry.utils.escapeHTML(String(text ?? ''));
        const name = await foundry.applications.api.DialogV2.prompt({
            window: { title: localize(titleKey), icon: 'fa-solid fa-boxes-stacked' },
            content: `<input type="text" name="name" value="${esc(value)}" placeholder="${esc(localize('collectionNamePlaceholder'))}" autofocus>`,
            ok: { callback: (_event, button) => button.form.elements.name.value },
            rejectClose: false
        });
        return String(name ?? '').trim()
            || (name === null ? '' : game.i18n.format(`${MODULE.ID}.parallax.collectionDefaultName`, { n: collectionsManager.list.length + 1 }));
    }

    async _confirm(titleKey, bodyKey, data) {
        const localize = key => game.i18n.localize(`${MODULE.ID}.parallax.${key}`);
        return foundry.applications.api.DialogV2.confirm({
            window: { title: localize(titleKey) },
            content: `<p>${foundry.utils.escapeHTML(game.i18n.format(`${MODULE.ID}.parallax.${bodyKey}`, data))}</p>`,
            rejectClose: false
        });
    }

    async confirmRemoveLayer(id) {
        const layer = this._layer(id);
        if (layer && await this._confirm('removeLayer', 'removeLayerConfirm', { name: layer.name })) {
            await this.manager.removeLayer(id);
        }
    }

    async confirmClearTile(id) {
        const tile = canvas.scene?.tiles.get(id);
        if (tile && await this._confirm('clearTileMotion', 'clearTileConfirm', { name: tileName(tile) })) {
            await tileMotionManager.clearTileMotion(id);
        }
    }

    /** The Append / Replace choice shared by Copy from Scene and Import. */
    _importModeField() {
        const localize = key => foundry.utils.escapeHTML(game.i18n.localize(`${MODULE.ID}.parallax.${key}`));
        return `<fieldset class="cartographer-parallax-import-mode">
            <label><input type="radio" name="mode" value="append" checked> ${localize('importAppend')}</label>
            <label><input type="radio" name="mode" value="replace"> ${localize('importReplace')}</label>
        </fieldset>`;
    }

    /** Bring the layers, groups and motion settings over from another scene. */
    async promptCopyFromScene() {
        const localize = key => game.i18n.localize(`${MODULE.ID}.parallax.${key}`);
        const esc = text => foundry.utils.escapeHTML(String(text ?? ''));
        const scenes = this.manager.scenesWithParallax();
        if (!scenes.length) {
            ui.notifications.info(localize('copyNoScenes'));
            return;
        }
        const options = scenes.map(scene => {
            const count = scene.getFlag(MODULE.ID, 'parallax')?.layers?.length ?? 0;
            return `<option value="${esc(scene.id)}">${esc(scene.name)} (${count})</option>`;
        }).join('');
        const result = await foundry.applications.api.DialogV2.prompt({
            window: { title: localize('copyFromScene'), icon: 'fa-solid fa-copy' },
            content: `<div class="cartographer-parallax-import-body">
                <label>${esc(localize('copySourceScene'))} <select name="scene">${options}</select></label>
                ${this._importModeField()}
            </div>`,
            ok: {
                label: localize('copyFromScene'),
                callback: (_event, button) => ({ scene: button.form.elements.scene.value, mode: button.form.elements.mode.value })
            },
            rejectClose: false
        });
        if (result) await this.manager.copyFromScene(result.scene, result.mode);
    }

    /** Save this scene's layers, groups and motion settings to a file. */
    exportParallax() {
        const name = (canvas.scene?.name ?? 'scene').replace(/[^\w-]+/g, '-').toLowerCase();
        foundry.utils.saveDataToFile(JSON.stringify(this.manager.exportData(), null, 2), 'text/json', `${name}-parallax.json`);
    }

    async promptImportParallax() {
        const localize = key => game.i18n.localize(`${MODULE.ID}.parallax.${key}`);
        const result = await foundry.applications.api.DialogV2.prompt({
            window: { title: localize('importParallax'), icon: 'fa-solid fa-file-import' },
            content: `<div class="cartographer-parallax-import-body">
                <input type="file" name="file" accept=".json,application/json">
                ${this._importModeField()}
            </div>`,
            ok: {
                label: localize('importParallax'),
                callback: (_event, button) => ({ file: button.form.elements.file.files?.[0], mode: button.form.elements.mode.value })
            },
            rejectClose: false
        });
        if (!result?.file) return;
        try {
            const data = JSON.parse(await foundry.utils.readTextFromFile(result.file));
            await this.manager.importData(data, result.mode);
        } catch (error) {
            ui.notifications.error(`${localize('importFailed')} ${error.message}`);
        }
    }

    async confirmRemoveCollection(id) {
        const collection = collectionsManager.find(id);
        if (!collection) return;
        const localize = key => game.i18n.localize(`${MODULE.ID}.parallax.${key}`);
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: localize('removeCollection') },
            content: `<p>${foundry.utils.escapeHTML(game.i18n.format(`${MODULE.ID}.parallax.removeCollectionConfirm`, { name: collection.name }))}</p>`,
            rejectClose: false
        });
        if (confirmed) await collectionsManager.remove(id);
    }

    /**
     * The Collections tab: every layer group and tile group with an on/off
     * each, which together are the scene's current look, and the saved looks.
     */
    _collectionsContext(state) {
        const localize = key => game.i18n.localize(`${MODULE.ID}.parallax.${key}`);
        const layerOn = state.activeSets;
        const tileOn = tileMotionManager.motion.activeGroups;
        const describe = (on, groups, allKey, noneKey) => {
            if (on === null) return localize(allKey);
            if (!on.length) return localize(noneKey);
            return on.map(id => groups.find(group => group.id === id)?.name).filter(Boolean).join(', ');
        };
        const now = collectionsManager.snapshot();
        const collections = collectionsManager.list.map(collection => ({
            ...collection,
            current: collectionsManager.matches(collection, now),
            summary: `${describe(collection.layerGroups ?? null, state.sets, 'allLayers', 'noLayers')} · ${describe(collection.tileGroups ?? null, tileMotionManager.motion.groups, 'allTiles', 'noTiles')}`
        }));
        return {
            hasLayers: state.layers.length > 0,
            hasTiles: tileMotionManager.configs.size > 0,
            layerAll: layerOn === null,
            layerNone: Array.isArray(layerOn) && !layerOn.length,
            layerGroups: state.sets.map(set => ({ id: set.id, name: set.name, on: !!layerOn?.includes(set.id) })),
            tileAll: tileOn === null,
            tileNone: Array.isArray(tileOn) && !tileOn.length,
            tileGroups: tileMotionManager.motion.groups.map(group => ({ id: group.id, name: group.name, on: !!tileOn?.includes(group.id) })),
            collections,
            hasCollections: collections.length > 0
        };
    }

    async confirmRemoveSet(id) {
        const groups = this._groups();
        const group = groups.list.find(entry => entry.id === id);
        if (!group) return;
        const localize = key => game.i18n.localize(`${MODULE.ID}.parallax.${key}`);
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: localize('removeSet') },
            content: `<p>${foundry.utils.escapeHTML(game.i18n.format(`${MODULE.ID}.parallax.removeSetConfirm`, { name: group.name }))}</p>`,
            rejectClose: false
        });
        if (confirmed) await groups.remove(id);
    }

    // ==================================================================
    // ===== VIEW PREFERENCES ===========================================
    // ==================================================================

    _savePrefs() {
        // Ids of layers since deleted are dropped, so the list cannot grow forever.
        const known = new Set(this.manager.state.layers.map(l => l.id));
        writePrefs({
            settingsOpen: this.settingsOpen,
            settingsHeight: this._settingsHeight,
            tab: this.tab,
            tileTab: this.tileTab,
            collapsedTiles: [...this.collapsedTiles].filter(id => tileMotionManager.configs.has(id)),
            target: this.target,
            collapsed: [...this.collapsed].filter(id => known.has(id)),
            expandedSets: [...this.expandedSets].filter(id => this.manager.state.sets.some(set => set.id === id)
                || tileMotionManager.motion.groups.some(group => group.id === id))
        });
    }

    /**
     * Show or hide the settings. Hiding shrinks the window to its bar, since
     * there is nothing below it to show; showing brings back the height the
     * GM last had with settings open, rather than refitting to the content.
     */
    async toggleSettings() {
        const rect = this.element?.getBoundingClientRect();
        if (this.settingsOpen && rect?.height) this._settingsHeight = rect.height;
        this.settingsOpen = !this.settingsOpen;
        this._savePrefs();
        await this.render();
        if (this.minimized) return;
        // Width and place are left alone; only the height follows the settings.
        if (this.settingsOpen) {
            this.setPosition({ height: this._settingsHeight ?? this.options.position.height });
            return;
        }
        // Closed, fit the bar, then pin that number so later renders leave it be.
        this.setPosition({ height: 'auto' });
        const barHeight = this.element?.getBoundingClientRect().height;
        if (barHeight) this.setPosition({ height: barHeight });
    }

    /** Each mode remembers its own tab. */
    setTab(tab) {
        const isTiles = this.target === 'tiles';
        const tabs = isTiles ? TILE_TABS : TABS;
        const current = isTiles ? this.tileTab : this.tab;
        if (!tabs.some(entry => entry.id === tab) || tab === current) return;
        if (isTiles) this.tileTab = tab;
        else this.tab = tab;
        this._savePrefs();
        return this.render();
    }

    toggleTileCollapsed(id) {
        if (this.collapsedTiles.has(id)) this.collapsedTiles.delete(id);
        else this.collapsedTiles.add(id);
        this._savePrefs();
        return this.render();
    }

    setAllTilesCollapsed(collapsed) {
        this.collapsedTiles = collapsed ? new Set(tileMotionManager.configs.keys()) : new Set();
        this._savePrefs();
        return this.render();
    }

    /**


    /** The motion the bar is running: the scene's parallax or its tiles. Both answer play/stop/speed alike. */
    _motion() {
        if (this.target === 'tiles') return tileMotionManager;
        if (this.target === 'collections') return this._bothMotions();
        return this.manager;
    }

    /**
     * In collections mode, Play/Stop runs the layers and the tiles together.
     * It reads as playing if either is, so Stop is offered whenever anything
     * moves, and stops both.
     */
    _bothMotions() {
        const parallax = this.manager;
        const configured = [parallax.isConfigured && parallax, tileMotionManager.isConfigured && tileMotionManager].filter(Boolean);
        const playing = configured.some(motion => motion === parallax ? parallax.state.playing : tileMotionManager.motion.playing);
        return {
            playing,
            configured: configured.length > 0,
            togglePlaying: async () => {
                for (const motion of configured) await (playing ? motion.stop() : motion.play());
            }
        };
    }

    setTarget(target) {
        if (!TARGETS.some(entry => entry.id === target) || target === this.target) return;
        this.target = target;
        this._savePrefs();
        return this.render();
    }

    /** Select a tile from the list: switch to the Tiles layer, select it, and bring it into view. */
    selectTile(tileId) {
        const tile = canvas.tiles?.get(tileId);
        if (!tile) return;
        if (!canvas.tiles.active) canvas.tiles.activate();
        tile.control({ releaseOthers: true });
        canvas.animatePan({ x: tile.center.x, y: tile.center.y });
    }

    toggleSetExpanded(id) {
        if (this.expandedSets.has(id)) this.expandedSets.delete(id);
        else this.expandedSets.add(id);
        this._savePrefs();
        return this.render();
    }

    toggleCollapsed(id) {
        if (this.collapsed.has(id)) this.collapsed.delete(id);
        else this.collapsed.add(id);
        this._savePrefs();
        return this.render();
    }

    setAllCollapsed(collapsed) {
        this.collapsed = collapsed ? new Set(this.manager.state.layers.map(l => l.id)) : new Set();
        this._savePrefs();
        return this.render();
    }

    // ==================================================================
    // ===== RENDERING ==================================================
    // ==================================================================

    async getData() {
        const state = this.manager.state;
        const localize = key => game.i18n.localize(`${MODULE.ID}.parallax.${key}`);
        // Listed nearest first, which is how a GM thinks about the stack, even
        // though the state stores them back to front (the draw order). The
        // ends only stop a move at the very top and bottom: a step across the
        // token line carries the layer over it (see ParallaxManager.moveLayer).
        const last = state.layers.length - 1;
        const layers = state.layers.map((layer, index) => ({
            ...layer,
            isFirst: index === last && layer.overhead,
            isLast: index === 0 && !layer.overhead,
            collapsed: this.collapsed.has(layer.id),
            isVideo: foundry.helpers.media.VideoHelper.hasVideoExtension(layer.src),
            // Which sets a layer is in, as information only. The Layers tab is
            // the layers themselves; which set is showing is the control bar's
            // business, and mixing the two here made it easy to edit one while
            // thinking about the other.
            setNames: state.sets.filter(set => set.layers.includes(layer.id)).map(set => set.name)
        })).reverse();
        const isTiles = this.target === 'tiles';
        const isCollections = this.target === 'collections';
        const tab = isTiles ? this.tileTab : this.tab;
        const tiles = this._tileContext(state);
        const tileById = new Map(tiles.managed.map(tile => [tile.id, tile]));
        const groups = this._groups();
        const counts = { layers: state.layers.length, tiles: tiles.managed.length, sets: groups.list.length };
        const bodyContent = !this.settingsOpen ? '' : await foundry.applications.handlebars.renderTemplate(
            `modules/${MODULE.ID}/templates/window-parallax.hbs`,
            {
                state,
                isTiles,
                isCollections,
                tiles,
                tab,
                tabs: (isTiles ? TILE_TABS : TABS).map(entry => ({
                    id: entry.id,
                    icon: entry.icon,
                    label: localize(entry.labelKey),
                    active: entry.id === tab,
                    count: counts[entry.id] ?? 0
                })),
                directions: Object.entries(PARALLAX_DIRECTIONS).map(([id, dir]) => ({
                    id,
                    icon: dir.icon,
                    label: localize(`direction.${id}`),
                    active: state.angle === dir.angle
                })),
                allCollapsed: state.layers.length > 0 && state.layers.every(l => this.collapsed.has(l.id)),
                // The Groups tab shows the current mode's groups. Each lists
                // its members -- layers nearest first and split at the token
                // line, or tiles -- each with its on/off in that group.
                sets: groups.list.map(group => {
                    const member = item => ({ ...item, setId: group.id, offInSet: group.off.includes(item.id) });
                    return {
                        id: group.id,
                        name: group.name,
                        active: !!groups.active?.includes(group.id),
                        itemCount: group.items.length,
                        expanded: this.expandedSets.has(group.id),
                        overheadMembers: isTiles ? [] : layers.filter(l => l.overhead && group.items.includes(l.id)).map(member),
                        groundMembers: isTiles ? [] : layers.filter(l => !l.overhead && group.items.includes(l.id)).map(member),
                        tileMembers: isTiles ? group.items.map(id => tileById.get(id)).filter(Boolean).map(member) : []
                    };
                }),
                allActive: groups.active === null,
                noneActive: Array.isArray(groups.active) && !groups.active.length,
                collections: this._collectionsContext(state),
                noneId: NONE_GROUP,
                noneLabel: localize(isTiles ? 'noTiles' : 'noLayers'),
                noneHint: localize(isTiles ? 'noTilesHint' : 'noLayersHint'),
                // Shown on the Layers or Tiles tab while None is chosen, since
                // nothing there -- not even something just added -- will show.
                noneShowing: Array.isArray(groups.active) && !groups.active.length
                    ? localize(isTiles ? 'noneShowingTiles' : 'noneShowingLayers')
                    : null,
                itemTotal: isTiles ? tiles.managed.length : state.layers.length,
                allLabel: localize(isTiles ? 'allTiles' : 'allLayers'),
                allHint: localize(isTiles ? 'allTilesHint' : 'allLayersHint'),
                groupsHint: localize(isTiles ? 'tileGroupsHint' : 'setsHint'),
                overheadLayers: layers.filter(l => l.overhead),
                groundLayers: layers.filter(l => !l.overhead),
                hasLayers: layers.length > 0,
                ranges: SLIDER_RANGES,
                hasScene: !!canvas.scene
            }
        );
        return {
            appId: this.id,
            bodyContent,
            showToolBar: true,
            // Which mode comes first, since it decides what everything after it drives.
            toolBarLeft: this._buildTargetSwitch(localize)
                + '<span class="cartographer-parallax-divider"></span>'
                + this._buildModeControls(state, localize),
            // The look: this mode's groups, or in collections mode, a collection.
            toolBarRight: (isCollections ? this._buildCollectionControl(localize) : this._buildSetControl(groups, localize))
                + this._buildSettingsToggle(localize),
            showToolFooter: false
        };
    }

    /**
     * One button that says what pressing it will do, and so also what the
     * scenery is doing now: Stop while it runs, Play while it is still. Stop
     * leaves the speed alone and eases the scenery to a halt; Play eases it
     * back up to that same speed.
     */
    _buildPlayControl(state, localize, configured) {
        const disabled = !configured;
        return this._button({
            action: 'toggle-play',
            icon: state.playing ? 'fa-solid fa-stop' : 'fa-solid fa-play',
            label: disabled
                ? localize(this.target === 'tiles' ? 'tilesNotConfigured' : 'notConfigured')
                : localize(state.playing ? 'stop' : 'play'),
            text: localize(state.playing ? 'stop' : 'play'),
            className: state.playing && !disabled ? 'is-active' : '',
            disabled
        });
    }

    /**
     * Master speed, centred on zero: right runs the scenery forward, left runs
     * it in reverse. The arrows either end point the way it will run on that
     * side, turned to the current angle.
     */
    _buildSpeedControl(state, localize) {
        const esc = value => foundry.utils.escapeHTML(String(value));
        const range = SLIDER_RANGES.masterSpeed;
        const label = esc(localize('masterSpeed'));
        const disabled = this.manager.isConfigured ? '' : ' disabled';
        return `<div class="cartographer-parallax-field cartographer-parallax-bar-speed${disabled ? ' is-disabled' : ''}">
            <i class="fa-solid fa-arrow-right cartographer-parallax-arrow" data-arrow="reverse" style="transform: rotate(${(state.angle + 180) % 360}deg)" data-tooltip="${esc(localize('reverse'))}"></i>
            <input type="range" data-field="masterSpeed" value="${esc(state.masterSpeed)}" min="${range.min}" max="${range.max}" step="${range.step}"
                list="cartographer-parallax-zero" aria-label="${label}" data-tooltip="${label}"${disabled}>
            <i class="fa-solid fa-arrow-right cartographer-parallax-arrow" data-arrow="forward" style="transform: rotate(${state.angle}deg)" data-tooltip="${esc(localize('forward'))}"></i>
            <span class="cartographer-parallax-value">${esc(formatMaster(state.masterSpeed))}</span>
            <datalist id="cartographer-parallax-zero"><option value="0"></option></datalist>
        </div>`;
    }

    /** The tiles' master speed: the same centred slider, with spin arrows either end. */
    _buildTileSpeedControl(motion, localize) {
        const esc = value => foundry.utils.escapeHTML(String(value));
        const range = SLIDER_RANGES.masterSpeed;
        const label = esc(localize('masterSpeed'));
        const disabled = tileMotionManager.isConfigured ? '' : ' disabled';
        return `<div class="cartographer-parallax-field cartographer-parallax-bar-speed${disabled ? ' is-disabled' : ''}">
            <i class="fa-solid fa-rotate-left cartographer-parallax-arrow" data-tooltip="${esc(localize('reverse'))}"></i>
            <input type="range" data-field="tileMasterSpeed" value="${esc(motion.masterSpeed)}" min="${range.min}" max="${range.max}" step="${range.step}"
                list="cartographer-parallax-zero" aria-label="${label}" data-tooltip="${label}"${disabled}>
            <i class="fa-solid fa-rotate-right cartographer-parallax-arrow" data-tooltip="${esc(localize('forward'))}"></i>
            <span class="cartographer-parallax-value">${esc(formatMaster(motion.masterSpeed))}</span>
            <datalist id="cartographer-parallax-zero"><option value="0"></option></datalist>
        </div>`;
    }

    /**
     * What sits between the mode switch and the look: Play/Stop and the speed
     * for this mode. In collections mode, Play/Stop runs both modes together;
     * there is no speed, since each mode keeps its own.
     */
    _buildModeControls(state, localize) {
        if (this.target === 'collections') {
            const both = this._bothMotions();
            return this._buildPlayControl(both, localize, both.configured);
        }
        if (this.target === 'tiles') {
            return this._buildPlayControl(tileMotionManager.motion, localize, tileMotionManager.isConfigured)
                + this._buildTileSpeedControl(tileMotionManager.motion, localize);
        }
        return this._buildPlayControl(state, localize, this.manager.isConfigured)
            + this._buildSpeedControl(state, localize);
    }

    /**
     * The collection the scene is showing, from the bar. When what is on
     * matches no collection (a group changed by hand), it reads Custom rather
     * than claim one.
     */
    _buildCollectionControl(localize) {
        const collections = collectionsManager.list;
        if (!collections.length) return '';
        const esc = value => foundry.utils.escapeHTML(String(value));
        const current = collectionsManager.current();
        const label = esc(localize('activeCollection'));
        const options = collections.map(collection =>
            `<option value="${esc(collection.id)}"${current?.id === collection.id ? ' selected' : ''}>${esc(collection.name)}</option>`).join('');
        const custom = current ? '' : `<option value="${MIXED}" selected disabled>${esc(localize('customLook'))}</option>`;
        return `<select class="cartographer-parallax-set-select" data-field="collection" aria-label="${label}" data-tooltip="${label}">${custom}${options}</select>`;
    }

    /** Parallax, Tiles or Collections: which the bar and settings are running. */
    _buildTargetSwitch(localize) {
        const buttons = TARGETS.map(entry => this._button({
            action: 'set-target',
            icon: entry.icon,
            label: localize(entry.labelKey),
            className: `cartographer-parallax-segment${entry.id === this.target ? ' is-active' : ''}`,
            dataset: { target: entry.id }
        })).join('');
        return `<div class="cartographer-parallax-segmented cartographer-parallax-target" role="radiogroup">${buttons}</div>`;
    }

    /** What the Tiles settings show: the shared ease, the selected tile's editor, and every animated tile. */
    /**
     * What the Tiles settings show: every tile Cartographer manages, each with
     * its settings, and a way to bring in the tile selected on the canvas if
     * it is not managed yet.
     */
    _tileContext(state) {
        const localize = key => game.i18n.localize(`${MODULE.ID}.parallax.${key}`);
        const isVideo = src => foundry.helpers.media.VideoHelper.hasVideoExtension(src ?? '');
        const selectedId = canvas.tiles?.controlled?.[0]?.id ?? null;
        const managed = (canvas.scene?.tiles ?? []).filter(tile => tileMotionManager.configs.has(tile.id)).map(tile => {
            const config = tileMotionManager.configs.get(tile.id) ?? defaultTileMotion();
            const parts = [];
            if (config.rotate.enabled) parts.push(`${localize('rotate')} ${config.rotate.speed}°/s`);
            if (config.scroll.enabled) parts.push(`${localize('scroll')} ${config.scroll.speed} px/s`);
            if (!config.visible) parts.push(localize('hidden'));
            return {
                ...config,
                id: tile.id,
                name: tileName(tile),
                src: tile.texture?.src,
                isVideo: isVideo(tile.texture?.src),
                alpha: tile.alpha ?? 1,
                collapsed: this.collapsedTiles.has(tile.id),
                selected: tile.id === selectedId,
                setNames: state.sets.filter(set => set.tiles?.includes(tile.id)).map(set => set.name),
                summary: parts.join(' · ') || localize('still')
            };
        });
        const selectedDoc = selectedId ? canvas.scene?.tiles.get(selectedId) : null;
        const selectedUnmanaged = selectedDoc && !tileMotionManager.configs.has(selectedId)
            ? { id: selectedId, name: tileName(selectedDoc) }
            : null;
        return {
            motion: tileMotionManager.motion,
            managed,
            hasManaged: managed.length > 0,
            allCollapsed: managed.length > 0 && managed.every(tile => tile.collapsed),
            selectedUnmanaged
        };
    }

    /** Which of this mode's groups is showing. Absent until there is a group to choose. */
    /**
     * This mode's groups, from the bar: All, None, or one group on its own.
     * With several on (set by hand) it reads Mixed rather than claim one.
     */
    _buildSetControl(groups, localize) {
        const esc = value => foundry.utils.escapeHTML(String(value));
        // All and None are always there, so the choice is offered as soon as
        // the mode has anything to show or hide, groups or not.
        const isTiles = this.target === 'tiles';
        const hasItems = isTiles ? tileMotionManager.configs.size > 0 : this.manager.state.layers.length > 0;
        if (!hasItems) return '';
        const active = groups.active;
        const selected = active === null ? ''
            : (!active.length ? NONE_GROUP : (active.length === 1 ? active[0] : MIXED));
        const option = (id, name) => `<option value="${esc(id)}"${selected === id ? ' selected' : ''}>${esc(name)}</option>`;
        const label = esc(localize('activeSet'));
        const mixed = selected === MIXED ? `<option value="${MIXED}" selected disabled>${esc(localize('mixedGroups'))}</option>` : '';
        return `<select class="cartographer-parallax-set-select" data-field="activeSet" aria-label="${label}" data-tooltip="${label}">
            ${mixed}${option('', localize(isTiles ? 'allTiles' : 'allLayers'))}${option(NONE_GROUP, localize(isTiles ? 'noTiles' : 'noLayers'))}${groups.list.map(group => option(group.id, group.name)).join('')}
        </select>`;
    }

    _buildSettingsToggle(localize) {
        return this._button({
            action: 'toggle-settings',
            icon: 'fa-solid fa-gear',
            label: localize(this.settingsOpen ? 'hideSettings' : 'showSettings'),
            className: this.settingsOpen ? 'is-active' : ''
        });
    }

    _button({ action, icon, label, text = '', className = '', dataset = {}, disabled = false }) {
        const safeLabel = foundry.utils.escapeHTML(label ?? '');
        const classes = [className, text ? 'is-labelled' : ''].filter(Boolean).join(' ');
        const data = Object.entries(dataset)
            .map(([name, value]) => ` data-${name}="${foundry.utils.escapeHTML(String(value))}"`)
            .join('');
        const caption = text ? `<span>${foundry.utils.escapeHTML(text)}</span>` : '';
        return `<button type="button" class="cartographer-parallax-button ${classes}" data-action="${action}" data-tooltip="${safeLabel}" aria-label="${safeLabel}"${data}${disabled ? ' disabled' : ''}><i class="${icon}"></i>${caption}</button>`;
    }

    // ==================================================================
    // ===== INPUTS =====================================================
    // ==================================================================

    /**
     * Sliders preview locally while they move and write the scene once, on
     * release. The frame survives part re-renders, so binding here once is
     * enough to catch every render's inputs.
     */
    _onRender(context, options) {
        super._onRender?.(context, options);
        this.element?.classList.toggle('is-settings-closed', !this.settingsOpen);
        if (this._inputsBound || !this.element) return;
        this.element.addEventListener('input', this._onInput);
        this.element.addEventListener('change', this._onChange);
        this.element.addEventListener('dragstart', this._onDragStart);
        this.element.addEventListener('dragover', this._onDragOver);
        this.element.addEventListener('drop', this._onDrop);
        this.element.addEventListener('dragend', this._onDragEnd);
        this._inputsBound = true;
    }

    // ==================================================================
    // ===== DRAG TO REORDER ============================================
    // ==================================================================

    /**
     * Layers are dragged by their grip. Dropped on another layer they land
     * just above or below it, by which half of it the pointer is over, and
     * cross the token line with it if it is on the other side. Dropped on the
     * token line itself, a layer crosses to the other side and sits next to
     * the line.
     */
    _onDragStart(event) {
        const handle = event.target.closest?.('[data-drag-layer]');
        if (!handle) return;
        this._dragLayerId = handle.dataset.dragLayer;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', this._dragLayerId);
        handle.closest('[data-layer-row]')?.classList.add('is-dragging');
    }

    _dropTarget(event) {
        const row = event.target.closest?.('[data-layer-row]');
        if (row) {
            const rect = row.getBoundingClientRect();
            return { row, layerId: row.dataset.layerRow, nearer: event.clientY < rect.top + rect.height / 2 };
        }
        const line = event.target.closest?.('[data-drop-line]');
        return line ? { line } : null;
    }

    _clearDropMarks() {
        for (const el of this.element?.querySelectorAll('.is-drop-above, .is-drop-below, .is-drop-line') ?? []) {
            el.classList.remove('is-drop-above', 'is-drop-below', 'is-drop-line');
        }
    }

    _onDragOver(event) {
        if (!this._dragLayerId) return;
        const target = this._dropTarget(event);
        if (!target || target.layerId === this._dragLayerId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        this._clearDropMarks();
        if (target.row) target.row.classList.add(target.nearer ? 'is-drop-above' : 'is-drop-below');
        else target.line.classList.add('is-drop-line');
    }

    _onDrop(event) {
        if (!this._dragLayerId) return;
        const target = this._dropTarget(event);
        const layerId = this._dragLayerId;
        this._onDragEnd();
        if (!target) return;
        event.preventDefault();
        // The drop is ours; nothing behind the window should also act on it.
        event.stopPropagation();
        if (target.row) {
            if (target.layerId !== layerId) void this.manager.reorderLayer(layerId, target.layerId, target.nearer);
            return;
        }
        const layer = this._layer(layerId);
        if (layer) void this.manager.setOverhead(layerId, !layer.overhead);
    }

    _onDragEnd() {
        this._dragLayerId = null;
        this._clearDropMarks();
        for (const el of this.element?.querySelectorAll('.is-dragging') ?? []) el.classList.remove('is-dragging');
    }

    _readInput(target) {
        const field = target.dataset.field;
        if (!field) return null;
        if (target.tagName === 'SELECT') return { field, value: target.value || null, layerId: null };
        if (field === 'tile') {
            const path = target.dataset.path;
            let value = Number(target.value);
            if (!path || !Number.isFinite(value)) return null;
            if (TILE_SNAP[path] && Math.abs(value) < TILE_SNAP[path]) value = 0;
            return { field, path, value, tileId: target.dataset.tileId };
        }
        let value = target.type === 'checkbox' ? target.checked : Number(target.value);
        if (typeof value === 'number' && !Number.isFinite(value)) return null;
        if ((field === 'masterSpeed' || field === 'tileMasterSpeed') && Math.abs(value) < MASTER_SNAP) value = 0;
        if (field === 'speed' && Math.abs(value) < LAYER_SNAP) value = 0;
        if (field === 'angleOffset' && Math.abs(value) < 5) value = 0;
        if (field === 'depth' && Math.abs(value) < 0.05) value = 0;
        return { field, value, layerId: target.dataset.layerId ?? null, tileId: target.dataset.tileId ?? null };
    }

    _onInput(event) {
        const input = this._readInput(event.target);
        if (!input || event.target.type === 'checkbox' || event.target.tagName === 'SELECT') return;
        const readout = event.target.closest('.cartographer-parallax-field')
            ?.querySelector('.cartographer-parallax-value');
        if (readout) readout.textContent = this._formatReadout(input);
        if (input.field === 'tileAlpha') {
            // The tile's own opacity is saved on release; nothing to preview.
        } else if (input.field === 'tile') {
            tileMotionManager.preview((_motion, configs) => {
                const config = configs.get(input.tileId);
                if (config) foundry.utils.setProperty(config, input.path, input.value);
            });
        } else if (input.field === 'tileMasterSpeed') {
            tileMotionManager.preview(motion => { motion.masterSpeed = input.value; });
        } else if (input.field === 'tileEaseSeconds') {
            tileMotionManager.preview(motion => { motion.easeSeconds = input.value; });
        } else {
            this.manager.preview(state => this._assign(state, input));
        }
    }

    _formatReadout({ field, value, path }) {
        if (field === 'masterSpeed' || field === 'tileMasterSpeed') return formatMaster(value);
        if (field === 'easeSeconds' || field === 'tileEaseSeconds') return `${value}s`;
        if (field === 'tile') {
            if (path === 'rotate.speed') return `${value}°/s`;
            if (path === 'scroll.angle') return `${value}°`;
            return String(value);
        }
        if (field === 'angleOffset') return `${value > 0 ? '+' : ''}${value}°`;
        if (field === 'depth') return value > 0 ? `+${value}` : String(value);
        if (field === 'angle') {
            this._turnArrows(value);
            return `${value}°`;
        }
        return String(value);
    }

    /** Keep the forward and reverse arrows pointing along the angle while it is dragged. */
    _turnArrows(angle) {
        for (const arrow of this.element?.querySelectorAll('[data-arrow]') ?? []) {
            const turn = arrow.dataset.arrow === 'reverse' ? angle + 180 : angle;
            arrow.style.transform = `rotate(${turn}deg)`;
        }
    }

    _onChange(event) {
        const input = this._readInput(event.target);
        if (!input) return;
        if (input.field === 'tileAlpha') void tileMotionManager.setTileOpacity(input.tileId, input.value);
        else if (input.field === 'tile') void tileMotionManager.setTileMotion(input.tileId, input.path, input.value);
        else if (input.field === 'tileMasterSpeed') void tileMotionManager.setMasterSpeed(input.value);
        else if (input.field === 'tileEaseSeconds') void tileMotionManager.setEaseSeconds(input.value);
        else if (input.layerId) void this.manager.updateLayer(input.layerId, { [input.field]: input.value });
        else if (input.field === 'masterSpeed') void this.manager.setMasterSpeed(input.value);
        else if (input.field === 'activeSet') void this._groups().setActive(input.value);
        else if (input.field === 'collection') void collectionsManager.apply(input.value);
        else if (input.field === 'angle') void this.manager.setAngle(input.value);
        else if (input.field === 'easeSeconds') void this.manager.setEaseSeconds(input.value);
    }

    _assign(state, { field, value, layerId }) {
        if (!layerId) {
            state[field] = value;
            return;
        }
        const layer = state.layers.find(l => l.id === layerId);
        if (layer) layer[field] = value;
    }

    _onClose(options) {
        this.manager?.onWindowClosed(this);
        return super._onClose?.(options);
    }
}

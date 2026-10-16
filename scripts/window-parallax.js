// ==================================================================
// ===== PARALLAX TOOL WINDOW =======================================
// ==================================================================

import { MODULE } from './const.js';
import { PARALLAX_DIRECTIONS } from './manager-parallax.js';
import { defaultTileMotion, tileMotionManager } from './manager-tilemotion.js';
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
const TARGETS = [
    { id: 'scene', icon: 'fa-solid fa-layer-group', labelKey: 'targetScene' },
    { id: 'tiles', icon: 'fa-solid fa-arrows-spin', labelKey: 'targetTiles' }
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
/** Setup mode's tabs, in the order they are offered. */
const TABS = [
    { id: 'movement', icon: 'fa-solid fa-gauge-high', labelKey: 'tabMovement' },
    { id: 'layers', icon: 'fa-solid fa-layer-group', labelKey: 'tabLayers' },
    { id: 'sets', icon: 'fa-solid fa-swatchbook', labelKey: 'tabSets' }
];
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
        position: { width: 400, height: 'auto' },
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
        'toggle-tile-part': (_event, target, app) => {
            const config = app._selectedConfig();
            const part = target.dataset.part;
            if (config && part) void tileMotionManager.setTileMotion(target.dataset.tileId, `${part}.enabled`, !config[part].enabled);
        },
        'select-tile': (_event, target, app) => app.selectTile(target.dataset.tileId),
        'clear-tile-motion': (_event, target, _app) => void tileMotionManager.clearTileMotion(target.dataset.tileId),
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
        'remove-layer': (_event, target, app) => void app.manager.removeLayer(target.dataset.layerId),
        'move-up': (_event, target, app) => void app.manager.moveLayer(target.dataset.layerId, 1),
        'move-down': (_event, target, app) => void app.manager.moveLayer(target.dataset.layerId, -1),
        'select-set': (_event, target, app) => void app.manager.setActiveSet(target.dataset.setId),
        'add-set': (_event, _target, app) => app.editSet(null),
        'edit-set': (_event, target, app) => app.editSet(target.dataset.setId),
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
        /** Which the bar and settings are running: 'scene' parallax or 'tiles'. */
        this.target = TARGETS.some(entry => entry.id === prefs.target) ? prefs.target : 'scene';
        this._onInput = this._onInput.bind(this);
        this._onChange = this._onChange.bind(this);
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
    // ===== SETS =======================================================
    // ==================================================================

    /**
     * Add a set (id null) or edit one: a name and a checkbox per layer. The
     * layers are listed as the Layers tab lists them -- nearest first, split at
     * the token line -- so the GM recognises the stack they built.
     */
    async editSet(id) {
        const state = this.manager.state;
        const set = id ? state.sets.find(entry => entry.id === id) : null;
        if (id && !set) return;
        const localize = key => game.i18n.localize(`${MODULE.ID}.parallax.${key}`);
        const esc = value => foundry.utils.escapeHTML(String(value ?? ''));
        // A new set starts from what is showing now, which is usually the
        // nearest thing to what the GM wants and leaves them to adjust it.
        const checked = new Set(set ? set.layers : state.layers.filter(l => this.manager.isLayerShown(l)).map(l => l.id));
        const defaultName = set?.name ?? '';

        const row = layer => `
            <label class="cartographer-parallax-set-dialog-row">
                <input type="checkbox" name="layers" value="${esc(layer.id)}" ${checked.has(layer.id) ? 'checked' : ''}>
                <span class="cartographer-parallax-set-dialog-thumb">${foundry.helpers.media.VideoHelper.hasVideoExtension(layer.src)
                    ? '<i class="fa-solid fa-film"></i>'
                    : `<img src="${esc(layer.src)}" alt="">`}</span>
                <span class="cartographer-parallax-set-dialog-name">${esc(layer.name)}</span>
                ${layer.overhead ? `<i class="fa-solid fa-cloud" data-tooltip="${esc(localize('toggleOverhead'))}"></i>` : ''}
            </label>`;
        const nearestFirst = [...state.layers].reverse();
        const overhead = nearestFirst.filter(l => l.overhead).map(row).join('');
        const ground = nearestFirst.filter(l => !l.overhead).map(row).join('');
        const list = state.layers.length
            ? `${overhead}<div class="cartographer-parallax-set-dialog-line"><span><i class="fa-solid fa-chess-pawn"></i> ${esc(localize('tokenLine'))}</span></div>${ground}`
            : `<p class="cartographer-parallax-set-dialog-empty">${esc(localize('setNoLayers'))}</p>`;

        const content = `
            <div class="cartographer-parallax-set-dialog-body">
                <label class="cartographer-parallax-set-dialog-field">
                    <span>${esc(localize('setName'))}</span>
                    <input type="text" name="name" value="${esc(defaultName)}" placeholder="${esc(localize('setNamePlaceholder'))}" autofocus>
                </label>
                <div class="cartographer-parallax-set-dialog-head">
                    <span>${esc(localize('setLayers'))}</span>
                    <span class="cartographer-parallax-set-dialog-bulk">
                        <a data-bulk="all">${esc(localize('selectAll'))}</a> · <a data-bulk="none">${esc(localize('selectNone'))}</a>
                    </span>
                </div>
                <div class="cartographer-parallax-set-dialog-list">${list}</div>
            </div>`;

        const result = await foundry.applications.api.DialogV2.prompt({
            classes: ['cartographer-parallax-set-dialog'],
            window: { title: localize(set ? 'editSet' : 'addSet'), icon: 'fa-solid fa-swatchbook' },
            position: { width: 360 },
            content,
            ok: {
                label: localize(set ? 'saveSet' : 'addSet'),
                callback: (_event, button) => ({
                    name: button.form.elements.name.value,
                    layers: new FormData(button.form).getAll('layers')
                })
            },
            render: (_event, dialog) => {
                // Select all / none, wired here because the dialog is its own application.
                dialog.element.querySelectorAll('[data-bulk]').forEach(link => link.addEventListener('click', () => {
                    const on = link.dataset.bulk === 'all';
                    dialog.element.querySelectorAll('input[name="layers"]').forEach(box => { box.checked = on; });
                }));
            },
            rejectClose: false
        });
        if (!result) return;
        const name = result.name.trim() || game.i18n.format(`${MODULE.ID}.parallax.setDefaultName`, { n: state.sets.length + 1 });
        if (set) await this.manager.updateSet(set.id, { name, layers: result.layers });
        else await this.manager.addSet(name, result.layers);
    }

    async confirmRemoveSet(id) {
        const set = this.manager.state.sets.find(entry => entry.id === id);
        if (!set) return;
        const localize = key => game.i18n.localize(`${MODULE.ID}.parallax.${key}`);
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: localize('removeSet') },
            content: `<p>${foundry.utils.escapeHTML(game.i18n.format(`${MODULE.ID}.parallax.removeSetConfirm`, { name: set.name }))}</p>`,
            rejectClose: false
        });
        if (confirmed) await this.manager.removeSet(id);
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
            target: this.target,
            collapsed: [...this.collapsed].filter(id => known.has(id)),
            expandedSets: [...this.expandedSets].filter(id => this.manager.state.sets.some(set => set.id === id))
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
        const height = this.settingsOpen ? (this._settingsHeight ?? 'auto') : 'auto';
        this.setPosition({ width: rect?.width, height });
    }

    setTab(tab) {
        if (!TABS.some(entry => entry.id === tab) || tab === this.tab) return;
        this.tab = tab;
        this._savePrefs();
        return this._renderKeepingSize();
    }

    /**
     * Re-render without the frame changing size. Tab switches swap
     * the whole body, and with an 'auto' height the window would grow and
     * shrink under the pointer each time; pinning the measured size keeps it
     * where the GM put it, and the body scrolls instead.
     */
    async _renderKeepingSize() {
        const rect = this.element?.getBoundingClientRect();
        await this.render();
        if (rect?.height && !this.minimized) this.setPosition({ width: rect.width, height: rect.height });
    }

    /** The motion the bar is running: the scene's parallax or its tiles. Both answer play/stop/speed alike. */
    _motion() {
        return this.target === 'tiles' ? tileMotionManager : this.manager;
    }

    setTarget(target) {
        if (!TARGETS.some(entry => entry.id === target) || target === this.target) return;
        this.target = target;
        this._savePrefs();
        return this._renderKeepingSize();
    }

    /** The selected tile's motion settings, for the editor. */
    _selectedConfig() {
        return tileMotionManager.selectedTile()?.config ?? null;
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
        const activeSet = state.sets.find(set => set.id === state.activeSet) ?? null;
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
        const bodyContent = !this.settingsOpen ? '' : await foundry.applications.handlebars.renderTemplate(
            `modules/${MODULE.ID}/templates/window-parallax.hbs`,
            {
                state,
                isTiles,
                tiles: isTiles ? this._tileContext() : null,
                tab: this.tab,
                tabs: TABS.map(tab => ({
                    id: tab.id,
                    icon: tab.icon,
                    label: localize(tab.labelKey),
                    active: tab.id === this.tab,
                    count: tab.id === 'layers' ? state.layers.length : (tab.id === 'sets' ? state.sets.length : 0)
                })),
                directions: Object.entries(PARALLAX_DIRECTIONS).map(([id, dir]) => ({
                    id,
                    icon: dir.icon,
                    label: localize(`direction.${id}`),
                    active: state.angle === dir.angle
                })),
                allCollapsed: state.layers.length > 0 && state.layers.every(l => this.collapsed.has(l.id)),
                sets: state.sets.map(set => ({
                    ...set,
                    active: set.id === state.activeSet,
                    layerCount: set.layers.length,
                    expanded: this.expandedSets.has(set.id),
                    // The set's layers, nearest first and split at the token
                    // line as everywhere else, each with its on/off in this set.
                    overheadMembers: layers.filter(l => l.overhead && set.layers.includes(l.id))
                        .map(l => ({ ...l, setId: set.id, offInSet: set.hidden?.includes(l.id) })),
                    groundMembers: layers.filter(l => !l.overhead && set.layers.includes(l.id))
                        .map(l => ({ ...l, setId: set.id, offInSet: set.hidden?.includes(l.id) }))
                })),
                allActive: !activeSet,
                layerTotal: state.layers.length,
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
            toolBarLeft: isTiles
                ? this._buildPlayControl(tileMotionManager.motion, localize, tileMotionManager.isConfigured)
                    + this._buildTileSpeedControl(tileMotionManager.motion, localize)
                : this._buildPlayControl(state, localize, this.manager.isConfigured)
                    + this._buildSpeedControl(state, localize),
            toolBarRight: (isTiles ? '' : this._buildSetControl(state, localize))
                + this._buildTargetSwitch(localize) + this._buildSettingsToggle(localize),
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

    /** Scene or Tiles: which the bar and settings are running. */
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
    _tileContext() {
        const selected = tileMotionManager.selectedTile();
        const isVideo = src => foundry.helpers.media.VideoHelper.hasVideoExtension(src ?? '');
        const editor = selected ? {
            id: selected.tile.id,
            name: tileName(selected.tile.document),
            src: selected.tile.document.texture?.src,
            isVideo: isVideo(selected.tile.document.texture?.src),
            ...selected.config
        } : null;
        const animated = (canvas.scene?.tiles ?? []).filter(tile => tileMotionManager.configs.has(tile.id)).map(tile => {
            const config = tileMotionManager.configs.get(tile.id) ?? defaultTileMotion();
            return {
                id: tile.id,
                name: tileName(tile),
                src: tile.texture?.src,
                isVideo: isVideo(tile.texture?.src),
                rotates: config.rotate.enabled,
                scrolls: config.scroll.enabled,
                selected: tile.id === editor?.id
            };
        });
        return { motion: tileMotionManager.motion, editor, animated, hasAnimated: animated.length > 0 };
    }

    /** Which set is showing. Absent until there is a set to choose. */
    _buildSetControl(state, localize) {
        if (!state.sets.length) return '';
        const esc = value => foundry.utils.escapeHTML(String(value));
        const option = (id, name) => `<option value="${esc(id)}"${(state.activeSet ?? '') === id ? ' selected' : ''}>${esc(name)}</option>`;
        const label = esc(localize('activeSet'));
        return `<select class="cartographer-parallax-set-select" data-field="activeSet" aria-label="${label}" data-tooltip="${label}">
            ${option('', localize('allLayers'))}${state.sets.map(set => option(set.id, set.name)).join('')}
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
        this._inputsBound = true;
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
        return { field, value, layerId: target.dataset.layerId ?? null };
    }

    _onInput(event) {
        const input = this._readInput(event.target);
        if (!input || event.target.type === 'checkbox' || event.target.tagName === 'SELECT') return;
        const readout = event.target.closest('.cartographer-parallax-field')
            ?.querySelector('.cartographer-parallax-value');
        if (readout) readout.textContent = this._formatReadout(input);
        if (input.field === 'tile') {
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
        if (input.field === 'tile') void tileMotionManager.setTileMotion(input.tileId, input.path, input.value);
        else if (input.field === 'tileMasterSpeed') void tileMotionManager.setMasterSpeed(input.value);
        else if (input.field === 'tileEaseSeconds') void tileMotionManager.setEaseSeconds(input.value);
        else if (input.layerId) void this.manager.updateLayer(input.layerId, { [input.field]: input.value });
        else if (input.field === 'masterSpeed') void this.manager.setMasterSpeed(input.value);
        else if (input.field === 'activeSet') void this.manager.setActiveSet(input.value);
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

// ==================================================================
// ===== PARALLAX TOOL WINDOW =======================================
// ==================================================================

import { MODULE } from './const.js';
import { PARALLAX_DIRECTIONS } from './manager-parallax.js';
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
    speed: { min: 0, max: 600, step: 5 },
    alpha: { min: 0, max: 1, step: 0.05 },
    scale: { min: 0.1, max: 4, step: 0.05 }
};
/** A master speed this close to zero snaps to a stop, so the middle is easy to find by hand. */
const MASTER_SNAP = 0.1;

/**
 * Window preferences, per browser. They describe how this GM likes to read the
 * window, not anything about the scene, so they are kept out of the scene flag
 * that every player receives.
 */
const PREFS_KEY = `${MODULE.ID}.parallax.windowPrefs`;
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
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(
        foundry.utils.mergeObject({}, super.DEFAULT_OPTIONS ?? {}),
        {
            id: APP_ID,
            classes: ['blacksmith-window-tool', 'cartographer-parallax-window'],
            position: { width: 400, height: 'auto' },
            window: {
                title: `${MODULE.ID}.parallax.windowTitle`,
                icon: 'fa-solid fa-layer-group',
                resizable: true,
                minimizable: true
            },
            toolTheme: 'glass',
            windowSizeConstraints: { minWidth: 300, minHeight: 120 }
        }
    );

    static ACTION_HANDLERS = {
        'toggle-play': (_event, _target, app) => void app.manager.togglePlaying(),
        'stop': (_event, _target, app) => void app.manager.setMasterSpeed(0),
        'reset-positions': (_event, _target, app) => void app.manager.resetPositions(),
        'set-direction': (_event, target, app) => void app.manager.setAngle(target.dataset.direction),
        'set-mode': (_event, target, app) => app.setMode(target.dataset.mode),
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
        'toggle-overhead': (_event, target, app) => void app.manager.toggleOverhead(target.dataset.layerId),
        'toggle-visible': (_event, target, app) => {
            const layer = app._layer(target.dataset.layerId);
            if (layer) void app.manager.updateLayer(layer.id, { visible: !layer.visible });
        }
    };

    constructor(manager, options = {}) {
        super(options);
        this.manager = manager;
        const prefs = readPrefs();
        /** 'setup' builds the stack; 'control' is the trimmed panel for running it in play. */
        this.mode = prefs.mode === 'control' ? 'control' : 'setup';
        this.collapsed = new Set(prefs.collapsed ?? []);
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
    // ===== VIEW PREFERENCES ===========================================
    // ==================================================================

    _savePrefs() {
        // Ids of layers since deleted are dropped, so the list cannot grow forever.
        const known = new Set(this.manager.state.layers.map(l => l.id));
        writePrefs({ mode: this.mode, collapsed: [...this.collapsed].filter(id => known.has(id)) });
    }

    setMode(mode) {
        this.mode = mode === 'control' ? 'control' : 'setup';
        this._savePrefs();
        // The two modes differ a lot in height; let the frame refit.
        this.setPosition({ height: 'auto' });
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
        const isControl = this.mode === 'control';
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
            isVideo: foundry.helpers.media.VideoHelper.hasVideoExtension(layer.src)
        })).reverse();
        const bodyContent = await foundry.applications.handlebars.renderTemplate(
            `modules/${MODULE.ID}/templates/window-parallax.hbs`,
            {
                state,
                isControl,
                masterLabel: formatMaster(state.masterSpeed),
                reverseAngle: (state.angle + 180) % 360,
                overheadLayers: layers.filter(l => l.overhead),
                groundLayers: layers.filter(l => !l.overhead),
                hasLayers: layers.length > 0,
                ranges: SLIDER_RANGES,
                hasScene: !!canvas.scene
            }
        );
        const status = `<span class="cartographer-parallax-status${state.playing ? ' is-playing' : ''}"><i class="fa-solid fa-circle"></i> ${foundry.utils.escapeHTML(localize(state.playing ? 'statusPlaying' : 'statusPaused'))}</span>`;
        return {
            appId: this.id,
            bodyContent,
            showToolBar: true,
            toolBarLeft: this._buildPlayControls(state, localize, isControl),
            toolBarRight: (isControl ? '' : this._buildDirectionControls(state, localize)) + this._buildModeToggle(localize, isControl),
            showToolFooter: true,
            toolFooterLeft: status,
            toolFooterRight: isControl ? '' : this._buildSetupFooter(localize)
        };
    }

    _buildPlayControls(state, localize, isControl) {
        const play = this._button({
            action: 'toggle-play',
            icon: state.playing ? 'fa-solid fa-pause' : 'fa-solid fa-play',
            label: localize(state.playing ? 'pause' : 'play'),
            text: localize(state.playing ? 'pause' : 'play'),
            className: state.playing ? 'is-active' : ''
        });
        const stop = this._button({
            action: 'stop',
            icon: 'fa-solid fa-stop',
            label: localize('stop')
        });
        if (isControl) return play + stop;
        return play + stop + this._button({
            action: 'reset-positions',
            icon: 'fa-solid fa-rotate-left',
            label: localize('resetPositions')
        });
    }

    /**
     * In setup these are quick picks for the forward angle; the angle slider in
     * the body sets anything between, and the master slider's sign reverses it.
     */
    _buildDirectionControls(state, localize) {
        return Object.entries(PARALLAX_DIRECTIONS).map(([id, dir]) => this._button({
            action: 'set-direction',
            icon: dir.icon,
            label: localize(`direction.${id}`),
            className: state.angle === dir.angle ? 'is-active' : '',
            dataset: { direction: id }
        })).join('');
    }

    _buildModeToggle(localize, isControl) {
        return `<span class="cartographer-parallax-divider"></span>` + this._button({
            action: 'set-mode',
            icon: isControl ? 'fa-solid fa-sliders' : 'fa-solid fa-gamepad',
            label: localize(isControl ? 'modeSetupHint' : 'modeControlHint'),
            text: localize(isControl ? 'modeSetup' : 'modeControl'),
            dataset: { mode: isControl ? 'setup' : 'control' }
        });
    }

    _buildSetupFooter(localize) {
        const allCollapsed = this.manager.state.layers.length > 0
            && this.manager.state.layers.every(l => this.collapsed.has(l.id));
        const collapse = this.manager.state.layers.length
            ? this._button({
                action: allCollapsed ? 'expand-all' : 'collapse-all',
                icon: allCollapsed ? 'fa-solid fa-angles-down' : 'fa-solid fa-angles-up',
                label: localize(allCollapsed ? 'expandAll' : 'collapseAll')
            })
            : '';
        return collapse + this._button({
            action: 'add-layer',
            icon: 'fa-solid fa-plus',
            label: localize('addLayer'),
            text: localize('addLayer')
        });
    }

    _button({ action, icon, label, text = '', className = '', dataset = {} }) {
        const safeLabel = foundry.utils.escapeHTML(label ?? '');
        const classes = [className, text ? 'is-labelled' : ''].filter(Boolean).join(' ');
        const data = Object.entries(dataset)
            .map(([name, value]) => ` data-${name}="${foundry.utils.escapeHTML(String(value))}"`)
            .join('');
        const caption = text ? `<span>${foundry.utils.escapeHTML(text)}</span>` : '';
        return `<button type="button" class="cartographer-parallax-button ${classes}" data-action="${action}" data-tooltip="${safeLabel}" aria-label="${safeLabel}"${data}><i class="${icon}"></i>${caption}</button>`;
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
        if (this._inputsBound || !this.element) return;
        this.element.addEventListener('input', this._onInput);
        this.element.addEventListener('change', this._onChange);
        this._inputsBound = true;
    }

    _readInput(target) {
        const field = target.dataset.field;
        if (!field) return null;
        let value = target.type === 'checkbox' ? target.checked : Number(target.value);
        if (typeof value === 'number' && !Number.isFinite(value)) return null;
        if (field === 'masterSpeed' && Math.abs(value) < MASTER_SNAP) value = 0;
        return { field, value, layerId: target.dataset.layerId ?? null };
    }

    _onInput(event) {
        const input = this._readInput(event.target);
        if (!input || event.target.type === 'checkbox') return;
        const readout = event.target.closest('.cartographer-parallax-field')
            ?.querySelector('.cartographer-parallax-value');
        if (readout) readout.textContent = this._formatReadout(input);
        this.manager.preview(state => this._assign(state, input));
    }

    _formatReadout({ field, value }) {
        if (field === 'masterSpeed') return formatMaster(value);
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
        if (input.layerId) void this.manager.updateLayer(input.layerId, { [input.field]: input.value });
        else if (input.field === 'masterSpeed') void this.manager.setMasterSpeed(input.value);
        else if (input.field === 'angle') void this.manager.setAngle(input.value);
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
        if (this.manager?.window === this) this.manager.window = null;
        return super._onClose?.(options);
    }
}

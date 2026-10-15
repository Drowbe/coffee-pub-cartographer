// ==================================================================
// ===== PARALLAX TOOL WINDOW =======================================
// ==================================================================

import { MODULE } from './const.js';
import { PARALLAX_DIRECTIONS } from './manager-parallax.js';
// Imported from the bridge, not module.api: see the note in window-mapping.js.
import { BlacksmithToolWindowBaseV2 } from '/modules/coffee-pub-blacksmith/api/blacksmith-api.js';

const APP_ID = `${MODULE.ID}-parallax`;

/** The range each slider offers. Speeds are scene pixels per second. */
const SLIDER_RANGES = {
    masterSpeed: { min: 0, max: 4, step: 0.05 },
    speed: { min: 0, max: 600, step: 5 },
    alpha: { min: 0, max: 1, step: 0.05 },
    scale: { min: 0.1, max: 4, step: 0.05 }
};

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
            windowSizeConstraints: { minWidth: 340, minHeight: 200 }
        }
    );

    static ACTION_HANDLERS = {
        'toggle-play': (_event, _target, app) => void app.manager.togglePlaying(),
        'reset-positions': (_event, _target, app) => void app.manager.resetPositions(),
        'set-direction': (_event, target, app) => void app.manager.setDirection(target.dataset.direction),
        'add-layer': (_event, _target, app) => app.pickImage(src => app.manager.addLayer(src)),
        'replace-layer': (_event, target, app) => {
            const layer = app._layer(target.dataset.layerId);
            if (layer) app.pickImage(src => app.manager.updateLayer(layer.id, { src }), layer.src);
        },
        'remove-layer': (_event, target, app) => void app.manager.removeLayer(target.dataset.layerId),
        'move-up': (_event, target, app) => void app.manager.moveLayer(target.dataset.layerId, 1),
        'move-down': (_event, target, app) => void app.manager.moveLayer(target.dataset.layerId, -1),
        'toggle-visible': (_event, target, app) => {
            const layer = app._layer(target.dataset.layerId);
            if (layer) void app.manager.updateLayer(layer.id, { visible: !layer.visible });
        }
    };

    constructor(manager, options = {}) {
        super(options);
        this.manager = manager;
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
    // ===== RENDERING ==================================================
    // ==================================================================

    async getData() {
        const state = this.manager.state;
        const localize = key => game.i18n.localize(`${MODULE.ID}.parallax.${key}`);
        // Listed nearest first, which is how a GM thinks about the stack, even
        // though the state stores them back to front (the draw order).
        const layers = state.layers.map((layer, index) => ({
            ...layer,
            isFirst: index === state.layers.length - 1,
            isLast: index === 0,
            isVideo: foundry.helpers.media.VideoHelper.hasVideoExtension(layer.src)
        })).reverse();
        const bodyContent = await foundry.applications.handlebars.renderTemplate(
            `modules/${MODULE.ID}/templates/window-parallax.hbs`,
            {
                state,
                layers,
                hasLayers: layers.length > 0,
                ranges: SLIDER_RANGES,
                hasScene: !!canvas.scene
            }
        );
        return {
            appId: this.id,
            bodyContent,
            showToolBar: true,
            toolBarLeft: this._buildPlayControls(state, localize),
            toolBarRight: this._buildDirectionControls(state, localize),
            showToolFooter: true,
            toolFooterLeft: `<span class="cartographer-parallax-status${state.playing ? ' is-playing' : ''}"><i class="fa-solid fa-circle"></i> ${foundry.utils.escapeHTML(localize(state.playing ? 'statusPlaying' : 'statusPaused'))}</span>`,
            toolFooterRight: this._button({ action: 'add-layer', icon: 'fa-solid fa-plus', label: localize('addLayer'), text: localize('addLayer') })
        };
    }

    _buildPlayControls(state, localize) {
        return this._button({
            action: 'toggle-play',
            icon: state.playing ? 'fa-solid fa-pause' : 'fa-solid fa-play',
            label: localize(state.playing ? 'pause' : 'play'),
            text: localize(state.playing ? 'pause' : 'play'),
            className: state.playing ? 'is-active' : ''
        }) + this._button({
            action: 'reset-positions',
            icon: 'fa-solid fa-rotate-left',
            label: localize('resetPositions')
        });
    }

    _buildDirectionControls(state, localize) {
        return Object.entries(PARALLAX_DIRECTIONS).map(([id, dir]) => this._button({
            action: 'set-direction',
            icon: dir.icon,
            label: localize(`direction.${id}`),
            className: state.direction === id ? 'is-active' : '',
            dataset: { direction: id }
        })).join('');
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
        const value = target.type === 'checkbox' ? target.checked : Number(target.value);
        if (typeof value === 'number' && !Number.isFinite(value)) return null;
        return { field, value, layerId: target.dataset.layerId ?? null };
    }

    _onInput(event) {
        const input = this._readInput(event.target);
        if (!input || event.target.type === 'checkbox') return;
        const readout = event.target.closest('.cartographer-parallax-field')
            ?.querySelector('.cartographer-parallax-value');
        if (readout) readout.textContent = String(input.value);
        this.manager.preview(state => this._assign(state, input));
    }

    _onChange(event) {
        const input = this._readInput(event.target);
        if (!input) return;
        if (input.layerId) void this.manager.updateLayer(input.layerId, { [input.field]: input.value });
        else if (input.field === 'masterSpeed') void this.manager.setMasterSpeed(input.value);
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

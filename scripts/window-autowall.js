// ==================================================================
// ===== AUTO-WALL WINDOW ===========================================
// ==================================================================
//
// The window for mapping walls, doors and windows from the scene image: a Map
// tab and an Options tab, and Add and Cancel in its footer where they stay in
// reach whichever tab is showing. It is a Blacksmith tool window, so it can be
// moved and remembers where it was put, and it is built from Blacksmith's own
// tool-window components -- the underline tabs, the segmented control for the
// mode, sections, toggles, range sliders, buttons and footer buttons -- so it
// follows Light, Dark and Glass without styles of its own for any of them.
//
// It holds no state. The run -- what was clicked, what was found, the choices
// -- is the manager's (manager-autowall.js); this builds the window from it and
// hands every click and change back.

import { MODULE } from './const.js';
// Imported from the bridge, not module.api: see the note in window-mapping.js.
import { BlacksmithToolWindowBaseV2 } from '/modules/coffee-pub-blacksmith/api/blacksmith-api.js';

const APP_ID = `${MODULE.ID}-autowall`;

/** The modes, in the order the walls should be done in. */
const MODES = [
    { id: 'wall', icon: 'fa-solid fa-border-none', labelKey: 'modeWall' },
    { id: 'door', icon: 'fa-solid fa-door-closed', labelKey: 'modeDoor' },
    { id: 'window', icon: 'fa-solid fa-window-maximize', labelKey: 'modeWindow' }
];
const TABS = [
    { id: 'map', icon: 'fa-solid fa-map', labelKey: 'tabMap' },
    { id: 'draw', icon: 'fa-solid fa-pen-ruler', labelKey: 'tabDraw' },
    { id: 'options', icon: 'fa-solid fa-sliders', labelKey: 'tabOptions' }
];

export class AutoWallWindow extends BlacksmithToolWindowBaseV2 {
    // A plain object: see the note on ParallaxWindow.DEFAULT_OPTIONS.
    static DEFAULT_OPTIONS = {
        id: APP_ID,
        classes: ['cartographer-autowall-window'],
        // A number, not 'auto', for the reason given on ParallaxWindow.
        position: { width: 380, height: 600 },
        window: {
            title: `${MODULE.ID}.autowall.title`,
            icon: 'fa-solid fa-border-none',
            resizable: true,
            minimizable: true
        },
        toolTheme: 'glass',
        windowSizeConstraints: { minWidth: 320 }
    };

    static ACTION_HANDLERS = {
        'autowall-mode': (_event, target, app) => app.manager.setMode(target.dataset.mode),
        'autowall-tab': (_event, target, app) => app.manager.setTab(target.dataset.tab),
        'autowall-snap': (_event, target, app) => app.manager.setSnap(target.dataset.snap),
        'autowall-draw-tool': (_event, target, app) => app.manager.setDrawTool(target.dataset.tool),
        'autowall-draw-kind': (_event, target, app) => app.manager.setDrawKind(target.dataset.kind),
        'autowall-draw-toggle': (_event, _target, app) => app.manager.toggleDraw(),
        'autowall-draw-undo': (_event, _target, app) => void app.manager.drawBack(),
        'autowall-add': (_event, _target, app) => void app.manager.accept(),
        'autowall-cancel': (_event, _target, app) => app.manager.cancel(),
        'autowall-cleanup': (_event, _target, app) => void app.manager.cleanup(),
        'autowall-cleanup-undo': (_event, _target, app) => void app.manager.undoCleanup()
    };

    /** Open the window for the manager's run, or bring the one that is open forward. */
    static async open(manager) {
        const existing = foundry.applications?.instances?.get(APP_ID);
        if (existing) {
            existing.manager = manager;
            existing.bringToFront?.();
            await existing.render();
            return existing;
        }
        // Beside the map, not over the middle of it: the GM is about to click there.
        const left = Math.max(16, window.innerWidth - 380 - 24);
        const window_ = new AutoWallWindow(manager, { position: { left, top: 90 } });
        await window_.render({ force: true });
        return window_;
    }

    constructor(manager, options = {}) {
        super(options);
        this.manager = manager;
    }

    _localize(key) {
        return game.i18n.localize(`${MODULE.ID}.autowall.${key}`);
    }

    _escape(value) {
        return foundry.utils.escapeHTML(String(value ?? ''));
    }

    // ==================================================================
    // ===== BUILDING ===================================================
    // ==================================================================

    async getData() {
        const session = this.manager?.session;
        if (!session) return { appId: this.id, bodyContent: '', showToolBar: false, showToolFooter: false };
        return {
            appId: this.id,
            bodyContent: this._buildBody(session),
            // The tabs are the top of the window, so there is no bar above them.
            showToolBar: false,
            showToolFooter: true,
            toolFooterLeft: this._buildFooterLeft(),
            toolFooterRight: this._buildFooterRight()
        };
    }

    /** Cancel, in the footer's left slot: secondary actions go there, the primary on the right. */
    _buildFooterLeft() {
        return `<button type="button" class="blacksmith-window-btn-secondary" data-action="autowall-cancel"><i class="fa-solid fa-xmark"></i> ${this._escape(this._localize('cancel'))}</button>`;
    }

    /** Add, off until there is something to add; the manager turns it on. */
    _buildFooterRight() {
        // On the Draw tab walls are made as they are drawn, so there is nothing to add.
        if (this.manager.session?.options.tab === 'draw') return '';
        const mode = this.manager.session?.mode ?? 'wall';
        const addKey = { wall: 'add', door: 'addDoor', window: 'addWindow' }[mode];
        return `<button type="button" class="blacksmith-window-btn-primary" data-action="autowall-add" disabled><i class="fa-solid fa-check"></i> ${this._escape(this._localize(addKey))}</button>`;
    }

    _button({ action, icon, label, text = '', dataset = {}, disabled = false }) {
        const safe = this._escape(label);
        const caption = text ? `<span>${this._escape(text)}</span>` : '';
        const data = Object.entries(dataset).map(([name, value]) => ` data-${name}="${this._escape(value)}"`).join('');
        return `<button type="button" class="blacksmith-tool-btn" data-action="${action}" data-tooltip="${safe}" aria-label="${safe}"${data}${disabled ? ' disabled' : ''}><i class="${icon}"></i>${caption}</button>`;
    }

    /** A section: a rule and a caption, with whatever the section holds beneath. */
    _section(icon, title, content) {
        return `<section class="blacksmith-tool-section">
                <header class="blacksmith-tool-section-head">
                    <span class="blacksmith-tool-section-title"><i class="${icon}"></i> ${this._escape(title)}</span>
                </header>
                ${content}
            </section>`;
    }

    /** A range, with its label beside it. The track, thumb and value readout are all Blacksmith's. */
    _slider(name, label, hint) {
        const { min, max, step } = this.manager.limits(name);
        const value = this.manager.session.options[name];
        return `<label class="cartographer-autowall-row" title="${this._escape(hint)}">
                <span class="cartographer-autowall-label">${this._escape(label)}</span>
                <span class="blacksmith-slider"><input type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${value}"><span data-for="${name}"></span></span>
            </label>`;
    }

    _select(name, label, choices) {
        const value = this.manager.session.options[name];
        const options = choices
            .map(([id, text]) => `<option value="${this._escape(id)}"${String(value) === String(id) ? ' selected' : ''}>${this._escape(text)}</option>`)
            .join('');
        return `<label class="cartographer-autowall-row">
                <span class="cartographer-autowall-label">${this._escape(label)}</span>
                <select class="cartographer-autowall-select" name="${name}">${options}</select>
            </label>`;
    }

    /** An on or off, as Blacksmith's toggle switch with its label. */
    _toggle(name, label, hint = '') {
        const checked = this.manager.session.options[name] ? ' checked' : '';
        return `<label class="blacksmith-toggle-row" title="${this._escape(hint)}">
                <span class="blacksmith-toggle-label">${this._escape(label)}</span>
                <span class="blacksmith-toggle">
                    <input type="checkbox" class="blacksmith-toggle-input" name="${name}"${checked}>
                    <span class="blacksmith-toggle-slider"></span>
                </span>
            </label>`;
    }

    /** The tabs, at the top of the window, as Blacksmith's underline tabs. */
    _buildTabs(tab) {
        const buttons = TABS.map(entry => `<button type="button" class="blacksmith-tool-tab${entry.id === tab ? ' is-active' : ''}" role="tab" aria-selected="${entry.id === tab}" data-action="autowall-tab" data-tab="${entry.id}">
                <i class="${entry.icon}"></i><span>${this._escape(this._localize(entry.labelKey))}</span></button>`).join('');
        return `<nav class="blacksmith-tool-tabs is-fill" role="tablist">${buttons}</nav>`;
    }

    _buildBody(session) {
        const tab = ['options', 'draw'].includes(session.options.tab) ? session.options.tab : 'map';
        const content = { map: () => this._buildMap(session), draw: () => this._buildDraw(session), options: () => this._buildOptions() }[tab]();
        return `${this._buildTabs(tab)}
            <div class="blacksmith-tool-stack cartographer-autowall-panel">${content}</div>`;
    }

    /** The choice of what to map: a segmented control, since it changes what a click does. */
    _buildModes(session) {
        const segments = MODES.map(mode => `<label class="blacksmith-tool-segment">
                <input type="radio" name="autowall-mode" value="${mode.id}" data-action="autowall-mode" data-mode="${mode.id}"${session.mode === mode.id ? ' checked' : ''}>
                <i class="${mode.icon}"></i><span>${this._escape(this._localize(mode.labelKey))}</span>
            </label>`).join('');
        return `<div class="blacksmith-tool-segmented is-fill" role="radiogroup" aria-label="${this._escape(this._localize('mapWhat'))}">${segments}</div>`;
    }

    /** The Map tab: what to map, what is happening, the picture, and the settings for the mode. */
    _buildMap(session) {
        const localize = key => this._localize(key);
        const match = this._slider('match', localize('match'), localize('matchHint'));
        const controls = {
            wall: () => match
                + this._slider('smoothing', localize('smoothing'), localize('smoothingHint'))
                + this._slider('widest', localize('widest'), localize('widestHint')),
            door: () => match
                + this._select('doorState', localize('doorState'), [['closed', localize('stateClosed')], ['open', localize('stateOpen')], ['locked', localize('stateLocked')]])
                + this._select('doorSound', localize('doorSound'), this.manager.doorSoundChoices())
                + this._select('doorAnimation', localize('doorAnimation'), this.manager.doorAnimationChoices()),
            window: () => match
                + this._slider('windowDistance', localize('windowDistance'), localize('windowDistanceHint'))
                + this._toggle('windowAttenuation', localize('windowAttenuation'))
        }[session.mode]();
        return this._section('fa-solid fa-bullseye', localize('mapWhat'), this._buildModes(session))
            + this._section('fa-solid fa-wand-magic-sparkles', localize('resultTitle'), `<div class="cartographer-autowall-status" data-role="status"></div>
                <canvas class="cartographer-autowall-thumb" width="316" height="150"></canvas>
                <div class="blacksmith-tool-hint" data-role="source"></div>`)
            + this._section('fa-solid fa-sliders', localize('settingsTitle'), controls);
    }

    /** A choice of one from a few, as Blacksmith's segmented control, each a native radio. */
    _segmented(group, label, choices, current, dataKey) {
        const segments = choices.map(choice => `<label class="blacksmith-tool-segment">
                <input type="radio" name="${group}" value="${choice.id}" data-action="${group}" data-${dataKey}="${choice.id}"${current === choice.id ? ' checked' : ''}>
                <i class="${choice.icon}"></i><span>${this._escape(this._localize(choice.labelKey))}</span>
            </label>`).join('');
        return `<div class="blacksmith-tool-segmented is-fill" role="radiogroup" aria-label="${this._escape(label)}">${segments}</div>`;
    }

    /** The Draw tab: walls made by hand, as they are drawn. */
    _buildDraw(session) {
        const localize = key => this._localize(key);
        const { options } = session;
        const draw = session.draw;
        const how = this._segmented('autowall-draw-tool', localize('drawHow'), [
            { id: 'point', icon: 'fa-solid fa-location-dot', labelKey: 'drawPoint' },
            { id: 'sketch', icon: 'fa-solid fa-pen', labelKey: 'drawSketch' }
        ], options.drawTool, 'tool') + (options.drawTool === 'sketch' ? this._slider('smoothing', localize('smoothing'), localize('smoothingHint')) : '');
        const kindSettings = {
            wall: () => '',
            door: () => this._select('doorState', localize('doorState'), [['closed', localize('stateClosed')], ['open', localize('stateOpen')], ['locked', localize('stateLocked')]])
                + this._select('doorSound', localize('doorSound'), this.manager.doorSoundChoices())
                + this._select('doorAnimation', localize('doorAnimation'), this.manager.doorAnimationChoices()),
            window: () => this._slider('windowDistance', localize('windowDistance'), localize('windowDistanceHint'))
                + this._toggle('windowAttenuation', localize('windowAttenuation'))
        }[options.drawKind ?? 'wall']();
        const what = this._segmented('autowall-draw-kind', localize('drawWhat'), MODES, options.drawKind, 'kind') + kindSettings;
        const buttons = `<div class="cartographer-autowall-buttons">
                <button type="button" class="blacksmith-tool-btn${draw.active ? ' is-active' : ''}" data-action="autowall-draw-toggle"><i class="${draw.active ? 'fa-solid fa-stop' : 'fa-solid fa-play'}"></i><span>${this._escape(localize(draw.active ? 'drawStop' : 'drawStart'))}</span></button>
                ${this._button({ action: 'autowall-draw-undo', icon: 'fa-solid fa-rotate-left', label: localize('drawUndoHint'), text: localize('drawUndo') })}
            </div>
            <div class="cartographer-autowall-status" data-role="draw-status"></div>`;
        return this._section('fa-solid fa-pen', localize('drawHow'), how)
            + this._section('fa-solid fa-bullseye', localize('drawWhat'), what)
            + this._section('fa-solid fa-play', localize('drawTitle'), buttons);
    }

    /** The Options tab: how ends join, snapping, and tidying the walls already there. */
    _buildOptions() {
        const localize = key => this._localize(key);
        const undo = this.manager.canUndoCleanup();
        const placing = this._segmented('autowall-snap', localize('snapMode'), [
            { id: 'grid', icon: 'fa-solid fa-border-all', labelKey: 'snap' },
            { id: 'free', icon: 'fa-solid fa-hand', labelKey: 'snapFree' }
        ], this.manager.session.options.freeform ? 'free' : 'grid', 'snap') + `<div class="blacksmith-tool-hint">${this._escape(localize('snapHint'))}</div>`;
        const joining = this._toggle('joinEnds', localize('joinEnds'), localize('joinEndsHint'))
            + this._slider('joinDistance', localize('joinDistance'), localize('joinDistanceHint'));
        const cleanup = `<div class="blacksmith-tool-hint">${this._escape(localize('cleanupHint'))}</div>
                <div class="cartographer-autowall-buttons">
                    ${this._button({ action: 'autowall-cleanup', icon: 'fa-solid fa-broom', label: localize('cleanupHint'), text: localize('cleanup') })}
                    ${this._button({ action: 'autowall-cleanup-undo', icon: 'fa-solid fa-rotate-left', label: localize('cleanupUndo'), text: localize('cleanupUndo'), disabled: !undo })}
                </div>
                <div class="cartographer-autowall-status" data-role="cleanup"></div>`;
        return this._section('fa-solid fa-border-all', localize('placing'), placing)
            + this._section('fa-solid fa-link', localize('joining'), joining)
            + this._section('fa-solid fa-broom', localize('cleanupTitle'), cleanup);
    }

    // ==================================================================
    // ===== LIFECYCLE ==================================================
    // ==================================================================

    _onRender(context, options) {
        super._onRender?.(context, options);
        // One listener for the window's life: the controls are rebuilt on each render,
        // but their events reach the element, which is not.
        if (!this._inputsBound && this.element) {
            this.element.addEventListener('input', event => this.manager?._onControl(event));
            this._inputsBound = true;
        }
        this.manager?.afterRender(this);
    }

    _onClose(options) {
        this.manager?.onWindowClosed(this);
        return super._onClose?.(options);
    }
}

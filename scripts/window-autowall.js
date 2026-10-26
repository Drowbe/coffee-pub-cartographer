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

    /** A range, with its label beside it and its value after it. The track and thumb are Blacksmith's. */
    _slider(name, label, hint) {
        const { min, max, step } = this.manager.limits(name);
        const value = this.manager.session.options[name];
        return `<label class="cartographer-autowall-row" title="${this._escape(hint)}">
                <span class="cartographer-autowall-label">${this._escape(label)}</span>
                <span class="blacksmith-slider"><input type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${value}"></span>
                <output class="cartographer-autowall-value" data-for="${name}"></output>
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
        const tab = session.options.tab === 'options' ? 'options' : 'map';
        return `${this._buildTabs(tab)}
            <div class="blacksmith-tool-stack cartographer-autowall-panel">${tab === 'options' ? this._buildOptions() : this._buildMap(session)}</div>`;
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
                <canvas class="cartographer-autowall-thumb" width="316" height="150"></canvas>`)
            + this._section('fa-solid fa-sliders', localize('settingsTitle'), controls);
    }

    /** The Options tab: how ends join, snapping, and tidying the walls already there. */
    _buildOptions() {
        const localize = key => this._localize(key);
        const undo = this.manager.canUndoCleanup();
        const joining = this._toggle('joinEnds', localize('joinEnds'), localize('joinEndsHint'))
            + this._slider('joinDistance', localize('joinDistance'), localize('joinDistanceHint'))
            + this._toggle('snap', localize('snap'), localize('snapHint'));
        const cleanup = `<div class="blacksmith-tool-hint">${this._escape(localize('cleanupHint'))}</div>
                <div class="cartographer-autowall-buttons">
                    ${this._button({ action: 'autowall-cleanup', icon: 'fa-solid fa-broom', label: localize('cleanupHint'), text: localize('cleanup') })}
                    ${this._button({ action: 'autowall-cleanup-undo', icon: 'fa-solid fa-rotate-left', label: localize('cleanupUndo'), text: localize('cleanupUndo'), disabled: !undo })}
                </div>
                <div class="cartographer-autowall-status" data-role="cleanup"></div>`;
        return this._section('fa-solid fa-link', localize('joining'), joining)
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

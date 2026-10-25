// ==================================================================
// ===== AUTO-WALL WINDOW ===========================================
// ==================================================================
//
// The window for mapping walls, doors and windows from the scene image: the
// three modes in its bar, a Map tab and an Options tab, and Add and Cancel in
// its footer where they stay in reach whichever tab is showing. It is a
// Blacksmith tool window, so it can be moved and remembers where it was put.
//
// It holds no state. The run -- what was clicked, what was found, the choices
// -- is the manager's (manager-autowall.js); this builds the window from it and
// hands every click and change back. It shares the scene-motion window's styles
// (`cartographer-parallax-window`) for its bar, tabs and buttons.

import { MODULE } from './const.js';
// Imported from the bridge, not module.api: see the note in window-mapping.js.
import { BlacksmithToolWindowBaseV2 } from '/modules/coffee-pub-blacksmith/api/blacksmith-api.js';

const APP_ID = `${MODULE.ID}-autowall`;

/** The modes, in the order the walls should be done in, with their buttons. */
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
        classes: ['cartographer-parallax-window', 'cartographer-autowall-window'],
        // A number, not 'auto', for the reason given on ParallaxWindow.
        position: { width: 380, height: 560 },
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
            showToolBar: true,
            toolBarLeft: this._buildModes(session),
            toolBarRight: '',
            showToolFooter: true,
            toolFooterRight: this._buildFooter()
        };
    }

    _button({ action, icon, label, text = '', className = '', dataset = {}, disabled = false }) {
        const safe = this._escape(label);
        const caption = text ? `<span>${this._escape(text)}</span>` : '';
        const data = Object.entries(dataset).map(([name, value]) => ` data-${name}="${this._escape(value)}"`).join('');
        return `<button type="button" class="cartographer-parallax-button ${className}${text ? ' is-labelled' : ''}" data-action="${action}" data-tooltip="${safe}" aria-label="${safe}"${data}${disabled ? ' disabled' : ''}><i class="${icon}"></i>${caption}</button>`;
    }

    /** The three modes, in the bar: walls first, then the doors and windows that go in them. */
    _buildModes(session) {
        return MODES.map(mode => this._button({
            action: 'autowall-mode',
            icon: mode.icon,
            label: this._localize(mode.labelKey),
            text: this._localize(mode.labelKey),
            className: session.mode === mode.id ? 'is-active' : '',
            dataset: { mode: mode.id }
        })).join('');
    }

    /** Add and Cancel. Add is off until there is something to add; the manager turns it on. */
    _buildFooter() {
        const mode = this.manager.session?.mode ?? 'wall';
        const addKey = { wall: 'add', door: 'addDoor', window: 'addWindow' }[mode];
        return this._button({ action: 'autowall-add', icon: 'fa-solid fa-check', label: this._localize(addKey), text: this._localize(addKey), disabled: true })
            + this._button({ action: 'autowall-cancel', icon: 'fa-solid fa-xmark', label: this._localize('cancel'), text: this._localize('cancel') });
    }

    _slider(name, label, hint) {
        const { min, max, step } = this.manager.limits(name);
        const value = this.manager.session.options[name];
        return `<label class="cartographer-autowall-row" title="${this._escape(hint)}">
                <span class="cartographer-autowall-label">${this._escape(label)}</span>
                <input type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${value}">
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

    _check(name, label, hint = '') {
        const checked = this.manager.session.options[name] ? ' checked' : '';
        return `<label class="cartographer-autowall-check" title="${this._escape(hint)}">
                <input type="checkbox" name="${name}"${checked}>
                <span>${this._escape(label)}</span>
            </label>`;
    }

    _buildBody(session) {
        const tab = session.options.tab === 'options' ? 'options' : 'map';
        const tabs = TABS.map(entry => `<button type="button" role="tab" class="cartographer-parallax-tab${entry.id === tab ? ' is-active' : ''}" data-action="autowall-tab" data-tab="${entry.id}" aria-selected="${entry.id === tab}">
                <i class="${entry.icon}"></i><span>${this._escape(this._localize(entry.labelKey))}</span></button>`).join('');
        return `<nav class="cartographer-parallax-tabs" role="tablist">${tabs}</nav>
            <div class="cartographer-parallax-panel cartographer-autowall-panel">${tab === 'options' ? this._buildOptions() : this._buildMap(session)}</div>`;
    }

    /** The Map tab: what is happening, the picture, and the settings for the mode. */
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
                + this._check('windowAttenuation', localize('windowAttenuation'))
        }[session.mode]();
        return `<div class="cartographer-autowall-status" data-role="status"></div>
            <canvas class="cartographer-autowall-thumb" width="316" height="150"></canvas>
            ${controls}`;
    }

    /** The Options tab: how ends join, snapping, and tidying the walls already there. */
    _buildOptions() {
        const localize = key => this._localize(key);
        const undo = this.manager.canUndoCleanup();
        return `${this._check('joinEnds', localize('joinEnds'), localize('joinEndsHint'))}
            ${this._check('snap', localize('snap'), localize('snapHint'))}
            ${this._slider('joinDistance', localize('joinDistance'), localize('joinDistanceHint'))}
            <div class="cartographer-autowall-cleanup">
                <div class="cartographer-autowall-buttons">
                    ${this._button({ action: 'autowall-cleanup', icon: 'fa-solid fa-broom', label: localize('cleanupHint'), text: localize('cleanup') })}
                    ${this._button({ action: 'autowall-cleanup-undo', icon: 'fa-solid fa-rotate-left', label: localize('cleanupUndo'), text: localize('cleanupUndo'), disabled: !undo })}
                </div>
                <p class="cartographer-parallax-hint">${this._escape(localize('cleanupHint'))}</p>
                <div class="cartographer-autowall-status" data-role="cleanup"></div>
            </div>`;
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

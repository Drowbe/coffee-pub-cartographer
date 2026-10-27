// ==================================================================
// ===== DRAWING TOOLS WINDOW =======================================
// ==================================================================
//
// The window for the drawing tools: a Drawing tab -- sketch, line, box, ellipse and, for the
// GM, wall -- and a Stamps tab of trees, shrubs, grass, rocks and the rest, for quick maps. It is
// a Blacksmith tool window, so it can be moved and remembers where it was put, and it is built
// from Blacksmith's own tool-window components -- the underline tabs, the segmented control,
// sections, toggles, range sliders and footer buttons -- so it follows Light, Dark and Glass.
//
// It holds no state of its own. The tool's state -- the mode, the brush, the stamp -- is the
// drawing tool's (manager-drawing.js); this builds the window from it and hands every click and
// change back. The buttons in the menubar stay, and the two stay in step.

import { MODULE } from './const.js';
import { STAMPS, STAMP_CATEGORIES, stampSvg, parseColor } from './utils-stamps.js';
import { TERRAINS, terrainSvg } from './utils-terrain.js';
// Imported from the bridge, not module.api: see the note in window-mapping.js.
import { BlacksmithToolWindowBaseV2 } from '/modules/coffee-pub-blacksmith/api/blacksmith-api.js';

const APP_ID = `${MODULE.ID}-drawing-tools`;

/** The tabs, in order. */
const TABS = [
    { id: 'draw', icon: 'fa-solid fa-pen-ruler', labelKey: 'tabDrawing' },
    { id: 'stamps', icon: 'fa-solid fa-stamp', labelKey: 'tabStamps' },
    { id: 'terrain', icon: 'fa-solid fa-road', labelKey: 'tabTerrain' }
];
/** How wide a path is, in grid squares. */
const PATH_WIDTHS = [
    { id: '0.5', icon: 'fa-solid fa-minus', labelKey: 'widthNarrow' },
    { id: '1', icon: 'fa-solid fa-grip-lines', labelKey: 'widthMedium' },
    { id: '2', icon: 'fa-solid fa-bars', labelKey: 'widthWide' }
];
/** What a drag draws. Wall is the GM's: it writes real walls. */
const TOOLS = [
    { id: 'sketch', icon: 'fa-solid fa-pen', labelKey: 'toolSketch' },
    { id: 'line', icon: 'fa-solid fa-slash-forward', labelKey: 'toolLine' },
    { id: 'box', icon: 'fa-regular fa-square', labelKey: 'toolBox' },
    { id: 'ellipse', icon: 'fa-regular fa-circle', labelKey: 'toolEllipse' },
    { id: 'wall', icon: 'fa-solid fa-border-none', labelKey: 'toolWall', gmOnly: true }
];
const WALL_SHAPES = [
    { id: 'line', icon: 'fa-solid fa-slash-forward', labelKey: 'wallStraight' },
    { id: 'sketch', icon: 'fa-solid fa-pen', labelKey: 'wallFreehand' }
];
const WEIGHTS = [
    { id: '3', icon: 'fa-solid fa-minus', labelKey: 'weightThin' },
    { id: '6', icon: 'fa-solid fa-grip-lines', labelKey: 'weightMedium' },
    { id: '12', icon: 'fa-solid fa-bars', labelKey: 'weightThick' }
];
const LINE_STYLES = [
    { id: 'solid', icon: 'fa-solid fa-pipe', labelKey: 'styleSolid' },
    { id: 'dotted', icon: 'fa-solid fa-ellipsis-vertical', labelKey: 'styleDotted' },
    { id: 'dashed', icon: 'fa-sharp fa-solid fa-ellipsis-vertical', labelKey: 'styleDashed' }
];
const SIZES = [
    { id: 'small', icon: 'fa-solid fa-circle-s', labelKey: 'sizeSmall' },
    { id: 'medium', icon: 'fa-solid fa-circle-m', labelKey: 'sizeMedium' },
    { id: 'large', icon: 'fa-solid fa-circle-l', labelKey: 'sizeLarge' }
];
/** The brush colours, by the drawing tool's own palette constants. */
const COLORS = [
    { id: 'black', source: 'strColor1', labelKey: 'colorBlack' },
    { id: 'red', source: 'strColor2', labelKey: 'colorRed' },
    { id: 'blue', source: 'strColor3', labelKey: 'colorBlue' },
    { id: 'green', source: 'strColor4', labelKey: 'colorGreen' },
    { id: 'yellow', source: 'strColor5', labelKey: 'colorYellow' }
];

export class DrawingToolsWindow extends BlacksmithToolWindowBaseV2 {
    // A plain object: see the note on ParallaxWindow.DEFAULT_OPTIONS.
    static DEFAULT_OPTIONS = {
        id: APP_ID,
        classes: ['cartographer-drawing-window'],
        // A number, not 'auto', for the reason given on ParallaxWindow.
        position: { width: 400, height: 640 },
        window: {
            title: `${MODULE.ID}.drawingTools.title`,
            icon: 'fa-solid fa-pen-ruler',
            resizable: true,
            minimizable: true
        },
        toolTheme: 'glass',
        windowSizeConstraints: { minWidth: 340 }
    };

    static ACTION_HANDLERS = {
        'drawing-tab': (_event, target, app) => app.setTab(target.dataset.tab),
        'drawing-mode': (_event, target, app) => app.manager.chooseMode(target.dataset.mode),
        'drawing-wall-shape': (_event, target, app) => app.manager.setWallOption('shape', target.dataset.shape),
        'drawing-weight': (_event, target, app) => app.manager.setBrushSettings({ size: Number(target.dataset.size) }, true),
        'drawing-style': (_event, target, app) => app.manager.setLineStyle(target.dataset.style),
        'drawing-color': (_event, target, app) => app.manager.setBrushSettings({ color: target.dataset.color }, true),
        'drawing-stamp': (_event, target, app) => app.manager.chooseStamp(target.dataset.kind),
        'drawing-terrain': (_event, target, app) => app.manager.chooseTerrain(target.dataset.kind),
        'drawing-path-width': (_event, target, app) => app.manager.setStampOption('pathWidth', Number(target.dataset.width)),
        'drawing-size': (_event, target, app) => app.manager.setSymbolSize(target.dataset.size),
        'drawing-undo': (_event, _target, app) => app.manager.undoLastDrawing(),
        'drawing-clear': (_event, _target, app) => app.manager.clearMine(),
        'drawing-clear-all': (_event, _target, app) => app.manager.clearEveryone(),
        'drawing-toggle': (_event, _target, app) => app.toggleDrawing()
    };

    /** Open the window, on a tab if one is asked for, or bring the one that is open forward. */
    static async open(manager, tab = null) {
        const existing = foundry.applications?.instances?.get(APP_ID);
        if (existing) {
            existing.manager = manager;
            if (tab) existing.tab = tab;
            existing.bringToFront?.();
            await existing.render();
            return existing;
        }
        // Beside the map, not over the middle of it: the user is about to draw there.
        const left = Math.max(16, window.innerWidth - 400 - 24);
        const window_ = new DrawingToolsWindow(manager, { position: { left, top: 90 } });
        if (tab) window_.tab = tab;
        await window_.render({ force: true });
        return window_;
    }

    constructor(manager, options = {}) {
        super(options);
        this.manager = manager;
        this.tab = 'draw';
    }

    setTab(tab) {
        if (!TABS.some(entry => entry.id === tab)) return;
        this.tab = tab;
        void this.render();
    }

    /** The big button: start drawing with what is chosen, or stop. */
    toggleDrawing() {
        if (this.manager.state.active) this.manager.stopFromWindow();
        else this.manager.startFromWindow();
    }

    _localize(key) {
        return game.i18n.localize(`${MODULE.ID}.drawingTools.${key}`);
    }

    _escape(value) {
        return foundry.utils.escapeHTML(String(value ?? ''));
    }

    // ==================================================================
    // ===== BUILDING ===================================================
    // ==================================================================

    async getData() {
        return {
            appId: this.id,
            bodyContent: this._buildBody(),
            // The tabs are the top of the window, so there is no bar above them.
            showToolBar: false,
            showToolFooter: true,
            toolFooterLeft: this._buildFooterLeft(),
            toolFooterRight: this._buildFooterRight()
        };
    }

    /** Undo, in the footer's left slot: it is the same on both tabs. */
    _buildFooterLeft() {
        const label = this._escape(this._localize('undoHint'));
        const disabled = this.manager.canUndo() ? '' : ' disabled';
        return `<button type="button" class="blacksmith-window-btn-secondary" data-action="drawing-undo" data-tooltip="${label}"${disabled}><i class="fa-solid fa-rotate-left"></i> ${this._escape(this._localize('undo'))}</button>`;
    }

    /** Start or stop, in the footer's right slot: the primary action. */
    _buildFooterRight() {
        const active = !!this.manager.state.active;
        const icon = active ? 'fa-solid fa-stop' : 'fa-solid fa-play';
        const label = this._localize(active ? 'stop' : 'start');
        return `<button type="button" class="blacksmith-window-btn-primary" data-action="drawing-toggle"><i class="${icon}"></i> ${this._escape(label)}</button>`;
    }

    _button({ action, icon, label, text = '', dataset = {}, disabled = false, active = false }) {
        const safe = this._escape(label);
        const caption = text ? `<span>${this._escape(text)}</span>` : '';
        const data = Object.entries(dataset).map(([name, value]) => ` data-${name}="${this._escape(value)}"`).join('');
        return `<button type="button" class="blacksmith-tool-btn${active ? ' is-active' : ''}" data-action="${action}" data-tooltip="${safe}" aria-label="${safe}"${data}${disabled ? ' disabled' : ''}><i class="${icon}"></i>${caption}</button>`;
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

    /** A choice of one from a few, as Blacksmith's segmented control, each a native radio. */
    _segmented(group, label, choices, current, dataKey) {
        const segments = choices.map(choice => `<label class="blacksmith-tool-segment">
                <input type="radio" name="${group}" value="${choice.id}" data-action="${group}" data-${dataKey}="${choice.id}"${String(current) === String(choice.id) ? ' checked' : ''}>
                <i class="${choice.icon}"></i><span>${this._escape(this._localize(choice.labelKey))}</span>
            </label>`).join('');
        return `<div class="blacksmith-tool-segmented is-fill" role="radiogroup" aria-label="${this._escape(label)}">${segments}</div>`;
    }

    /** An on or off, as Blacksmith's toggle switch with its label. */
    _toggle(name, label, checked, { hint = '', disabled = false } = {}) {
        return `<label class="blacksmith-toggle-row" title="${this._escape(hint)}">
                <span class="blacksmith-toggle-label">${this._escape(label)}</span>
                <span class="blacksmith-toggle">
                    <input type="checkbox" class="blacksmith-toggle-input" name="${name}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}>
                    <span class="blacksmith-toggle-slider"></span>
                </span>
            </label>`;
    }

    /** A range, with its label beside it. The track, thumb and value readout are all Blacksmith's. */
    _slider(name, label, hint, { min, max, step, value }) {
        return `<label class="cartographer-drawing-row" title="${this._escape(hint)}">
                <span class="cartographer-drawing-label">${this._escape(label)}</span>
                <span class="blacksmith-slider"><input type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${value}"><span data-for="${name}"></span></span>
            </label>`;
    }

    _hint(text) {
        return `<div class="blacksmith-tool-hint">${this._escape(text)}</div>`;
    }

    /** The tabs, at the top of the window, as Blacksmith's underline tabs. */
    _buildTabs(tab) {
        const buttons = TABS.map(entry => `<button type="button" class="blacksmith-tool-tab${entry.id === tab ? ' is-active' : ''}" role="tab" aria-selected="${entry.id === tab}" data-action="drawing-tab" data-tab="${entry.id}">
                <i class="${entry.icon}"></i><span>${this._escape(this._localize(entry.labelKey))}</span></button>`).join('');
        return `<nav class="blacksmith-tool-tabs is-fill" role="tablist">${buttons}</nav>`;
    }

    _buildBody() {
        const tab = TABS.some(entry => entry.id === this.tab) ? this.tab : 'draw';
        const content = { stamps: () => this._buildStamps(), terrain: () => this._buildTerrain(), draw: () => this._buildDraw() }[tab]();
        return `${this._buildTabs(tab)}
            <div class="blacksmith-tool-stack cartographer-drawing-panel">${content}</div>`;
    }

    /** The brush colour as [r, g, b], to tell which swatch it is. */
    _brushChannels() {
        return parseColor(this.manager.state.brushSettings.color) ?? [0, 0, 0];
    }

    /** The swatches: the player's own colour, then the palette. */
    _buildColors() {
        const tool = this.manager.constructor;
        const current = this._brushChannels().join(',');
        const user = parseColor(game.user?.color?.css ?? String(game.user?.color ?? ''));
        const swatches = [];
        if (user) swatches.push({ id: 'player', css: `rgba(${user.join(', ')}, 1)`, label: this._localize('colorPlayer') });
        for (const color of COLORS) swatches.push({ id: color.id, css: tool[color.source], label: this._localize(color.labelKey) });
        return `<div class="cartographer-drawing-swatches" role="radiogroup" aria-label="${this._escape(this._localize('color'))}">${swatches.map(swatch => {
            const channels = parseColor(swatch.css) ?? [0, 0, 0];
            const active = channels.join(',') === current;
            const label = this._escape(swatch.label);
            return `<button type="button" class="cartographer-drawing-swatch${active ? ' is-active' : ''}" role="radio" aria-checked="${active}" data-action="drawing-color" data-color="${this._escape(swatch.css)}" data-tooltip="${label}" aria-label="${label}" style="--swatch: rgb(${channels.join(', ')})"></button>`;
        }).join('')}</div>`;
    }

    /** The Drawing tab: the tool, what it is drawn with, and tidying up. */
    _buildDraw() {
        const localize = key => this._localize(key);
        const { state } = this.manager;
        const gm = this.manager.canMakeWalls();
        const tools = TOOLS.filter(tool => !tool.gmOnly || gm);
        let sections = this._section('fa-solid fa-pen', localize('tool'), this._segmented('drawing-mode', localize('tool'), tools, state.drawingMode, 'mode'));
        if (state.drawingMode === 'wall' && gm) {
            sections += this._section('fa-solid fa-border-none', localize('wall'),
                this._segmented('drawing-wall-shape', localize('wallShape'), WALL_SHAPES, state.wallShape, 'shape')
                + this._toggle('wallSnap', localize('wallSnap'), state.wallSnap, { hint: localize('wallSnapHint') })
                + this._hint(localize('wallHint')));
        }
        sections += this._section('fa-solid fa-grip-lines', localize('line'),
            this._segmented('drawing-weight', localize('weight'), WEIGHTS, state.brushSettings.size, 'size')
            + this._segmented('drawing-style', localize('style'), LINE_STYLES, state.lineStyle, 'style'));
        sections += this._section('fa-solid fa-palette', localize('color'), this._buildColors());
        const clear = [this._button({ action: 'drawing-clear', icon: 'fa-solid fa-eraser', label: localize('clearOwnHint'), text: localize('clearOwn') })];
        if (game.user?.isGM) clear.push(this._button({ action: 'drawing-clear-all', icon: 'fa-solid fa-trash-can', label: localize('clearAllHint'), text: localize('clearAll') }));
        sections += this._section('fa-solid fa-broom', localize('tidy'),
            `<div class="cartographer-drawing-buttons">${clear.join('')}</div>`
            + this._toggle('timedErase', localize('timedErase'), state.timedEraseEnabled, { hint: localize('timedEraseHint') })
            + this._hint(localize('holdHint')));
        return sections;
    }

    /** One stamp, as a picture with its name. */
    _buildStamp(stamp, tint) {
        const { state } = this.manager;
        const active = state.drawingMode === 'stamp' && state.stampStyle === stamp.id;
        const label = this._escape(this._localize(stamp.labelKey));
        const art = stampSvg(stamp.id, { tint: stamp.legacy || !state.stamp.natural ? tint : null });
        return `<button type="button" class="cartographer-stamp${active ? ' is-active' : ''}" data-action="drawing-stamp" data-kind="${stamp.id}" data-tooltip="${label}" aria-label="${label}" aria-pressed="${active}">
                <span class="cartographer-stamp-art">${art}</span><span class="cartographer-stamp-name">${label}</span></button>`;
    }

    /** The Stamps tab: every stamp by kind, how big, and how it is put down. */
    _buildStamps() {
        const localize = key => this._localize(key);
        const { state } = this.manager;
        const tint = state.brushSettings.color;
        let sections = '';
        for (const category of STAMP_CATEGORIES) {
            const stamps = STAMPS.filter(stamp => stamp.category === category.id);
            if (!stamps.length) continue;
            const icon = { trees: 'fa-solid fa-tree', plants: 'fa-solid fa-seedling', rocks: 'fa-solid fa-mountain', features: 'fa-solid fa-campground', markers: 'fa-solid fa-location-dot' }[category.id];
            sections += this._section(icon, localize(category.labelKey),
                `<div class="cartographer-stamp-grid">${stamps.map(stamp => this._buildStamp(stamp, tint)).join('')}</div>`);
        }
        const canKeep = this.manager.canKeepOnScene();
        const options = this._segmented('drawing-size', localize('size'), SIZES, state.symbolSize, 'size')
            + this._toggle('natural', localize('natural'), state.stamp.natural, { hint: localize('naturalHint') })
            + this._toggle('rotate', localize('rotate'), state.stamp.rotate, { hint: localize('rotateHint') })
            + this._toggle('jitter', localize('jitter'), state.stamp.jitter, { hint: localize('jitterHint') })
            + this._slider('spacing', localize('spacing'), localize('spacingHint'), { min: 0.5, max: 3, step: 0.25, value: state.stamp.spacing })
            + this._toggle('keep', localize('keep'), state.stamp.keep && canKeep, { hint: localize(canKeep ? 'keepHint' : 'keepDenied'), disabled: !canKeep })
            + this._hint(localize('stampHint'));
        sections += this._section('fa-solid fa-sliders', localize('options'), options);
        return sections;
    }

    /** The Terrain tab: the kinds of path, how wide, and whether it is kept. */
    _buildTerrain() {
        const localize = key => this._localize(key);
        const { state } = this.manager;
        const tiles = TERRAINS.map(terrain => {
            const active = state.drawingMode === 'terrain' && state.stamp.terrain === terrain.id;
            const label = this._escape(localize(terrain.labelKey));
            return `<button type="button" class="cartographer-stamp${active ? ' is-active' : ''}" data-action="drawing-terrain" data-kind="${terrain.id}" data-tooltip="${label}" aria-label="${label}" aria-pressed="${active}">
                <span class="cartographer-stamp-art">${terrainSvg(terrain.id)}</span><span class="cartographer-stamp-name">${label}</span></button>`;
        }).join('');
        const canKeep = this.manager.canKeepOnScene();
        const options = this._segmented('drawing-path-width', localize('pathWidth'), PATH_WIDTHS, state.stamp.pathWidth, 'width')
            + this._toggle('keep', localize('keep'), state.stamp.keep && canKeep, { hint: localize(canKeep ? 'keepHint' : 'keepDenied'), disabled: !canKeep })
            + this._hint(localize('terrainHint'));
        return this._section('fa-solid fa-road', localize('terrain'), `<div class="cartographer-stamp-grid">${tiles}</div>`)
            + this._section('fa-solid fa-sliders', localize('options'), options);
    }

    // ==================================================================
    // ===== LIFECYCLE ==================================================
    // ==================================================================

    /** A switch or slider was changed: tell the drawing tool. */
    _onControl(event) {
        const target = event.target;
        const name = target?.name;
        if (!name || target.dataset?.action) return;
        const manager = this.manager;
        if (['natural', 'rotate', 'jitter', 'keep'].includes(name)) manager.setStampOption(name, target.checked);
        else if (name === 'spacing') manager.setStampOption('spacing', target.value);
        else if (name === 'wallSnap') manager.setWallOption('snap', target.checked);
        else if (name === 'timedErase') manager.setTimedErase(target.checked);
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        // One listener for the window's life: the controls are rebuilt on each render,
        // but their events reach the element, which is not.
        if (!this._controlsBound && this.element) {
            this.element.addEventListener('change', event => this._onControl(event));
            this._controlsBound = true;
        }
    }

    _onClose(options) {
        this.manager?.onWindowClosed(this);
        return super._onClose?.(options);
    }
}

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
import { WALL_KINDS, wallKindSvg, isDoorKind, isOpeningKind, WALL_MATERIALS, wallMaterialSvg } from './utils-drawing.js';
// Imported from the bridge, not module.api: see the note in window-mapping.js.
import { LAYERS } from './utils-layers.js';
import { BlacksmithToolWindowBaseV2 } from '/modules/coffee-pub-blacksmith/api/blacksmith-api.js';

const APP_ID = `${MODULE.ID}-drawing-tools`;

/** The tabs, in order. */
const TABS = [
    { id: 'draw', icon: 'fa-solid fa-pen-ruler', labelKey: 'tabDrawing' },
    { id: 'stamps', icon: 'fa-solid fa-stamp', labelKey: 'tabStamps' },
    { id: 'terrain', icon: 'fa-solid fa-road', labelKey: 'tabTerrain' },
    { id: 'walls', icon: 'fa-solid fa-border-none', labelKey: 'tabWalls', gmOnly: true },
    { id: 'utilities', icon: 'fa-solid fa-screwdriver-wrench', labelKey: 'tabUtilities' }
];
/** The stamps that are ground and what grows on it, not things standing on it: they are shown with the paths. */
const TERRAIN_CATEGORIES = ['ground', 'fields'];
/** How wide a path is, in grid squares. */
const PATH_WIDTHS = [
    { id: '0.5', icon: 'fa-solid fa-minus', labelKey: 'widthNarrow' },
    { id: '1', icon: 'fa-solid fa-grip-lines', labelKey: 'widthMedium' },
    { id: '2', icon: 'fa-solid fa-bars', labelKey: 'widthWide' }
];
/** What a drag draws on the Drawing tab. Walls have a tab of their own. */
const TOOLS = [
    { id: 'sketch', icon: 'fa-solid fa-pen', labelKey: 'toolSketch' },
    { id: 'line', icon: 'fa-solid fa-slash-forward', labelKey: 'toolLine' },
    { id: 'box', icon: 'fa-regular fa-square', labelKey: 'toolBox' },
    { id: 'ellipse', icon: 'fa-regular fa-circle', labelKey: 'toolEllipse' }
];
/** The state a door is drawn in. */
const DOOR_STATES = [
    { id: 'closed', icon: 'fa-solid fa-door-closed', labelKey: 'doorClosed' },
    { id: 'open', icon: 'fa-solid fa-door-open', labelKey: 'doorOpen' },
    { id: 'locked', icon: 'fa-solid fa-lock', labelKey: 'doorLocked' }
];
/** How thick a wall is, as part of a grid square. */
const THICKNESSES = [
    { id: 'thin', icon: 'fa-solid fa-minus', labelKey: 'weightThin' },
    { id: 'medium', icon: 'fa-solid fa-grip-lines', labelKey: 'weightMedium' },
    { id: 'thick', icon: 'fa-solid fa-bars', labelKey: 'weightThick' }
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
/** How far a stamp that is turned a quarter at a time is turned. */
const TURNS = [
    { id: '0', icon: 'fa-solid fa-arrow-up', labelKey: 'turn0' },
    { id: '1', icon: 'fa-solid fa-arrow-right', labelKey: 'turn1' },
    { id: '2', icon: 'fa-solid fa-arrow-down', labelKey: 'turn2' },
    { id: '3', icon: 'fa-solid fa-arrow-left', labelKey: 'turn3' }
];
/** What the eraser takes from: every layer, or the one. The top layer first, as they are in the world. */
const ERASE_LAYERS = [{ id: 'all', icon: 'fa-solid fa-layer-group', labelKey: 'layerAll' }, ...[...LAYERS].reverse()];
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
        'drawing-wall': (_event, target, app) => app.manager.chooseWall(target.dataset.kind),
        'drawing-wall-material': (_event, target, app) => app.manager.chooseMaterial(target.dataset.material),
        'drawing-wall-thickness': (_event, target, app) => app.manager.setWallOption('thickness', target.dataset.thickness),
        'drawing-wall-door': (_event, target, app) => app.manager.setWallOption('door', target.dataset.door),
        'drawing-wall-shape': (_event, target, app) => app.manager.setWallOption('shape', target.dataset.shape),
        'drawing-weight': (_event, target, app) => app.manager.setBrushSettings({ size: Number(target.dataset.size) }, true),
        'drawing-style': (_event, target, app) => app.manager.setLineStyle(target.dataset.style),
        'drawing-color': (_event, target, app) => app.manager.setBrushSettings({ color: target.dataset.color }, true),
        'drawing-stamp': (_event, target, app) => app.manager.chooseStamp(target.dataset.kind),
        'drawing-terrain': (_event, target, app) => app.manager.chooseTerrain(target.dataset.kind),
        'drawing-path-width': (_event, target, app) => app.manager.setStampOption('pathWidth', Number(target.dataset.width)),
        'drawing-size': (_event, target, app) => app.manager.setSymbolSize(target.dataset.size),
        'drawing-turn': (_event, target, app) => app.manager.setStampOption('turn', Number(target.dataset.turn)),
        'drawing-erase-layer': (_event, target, app) => app.manager.setEraseLayer(target.dataset.layer),
        'drawing-erase': (_event, _target, app) => app.manager.chooseErase(),
        'drawing-erase-all': (_event, _target, app) => void app.manager.eraseAllKept(),
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
        // Beside the map, not over the middle of it: the user is about to draw there. Left of the sidebar (the
        // chat), not over it, when it is open.
        const sidebar = document.getElementById('sidebar')?.getBoundingClientRect();
        const edge = sidebar && sidebar.width > 0 && sidebar.left > 0 && sidebar.left < window.innerWidth ? sidebar.left : window.innerWidth;
        const left = Math.max(16, edge - 400 - 24);
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
            // The tabs are in the window's bar, above the body, so they stay put when the body scrolls.
            showToolBar: true,
            toolBarLeft: this._buildTabs(this._currentTab()),
            toolBarRight: '',
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

    /** Switches laid out in a grid, each label in a column of one width so the switches line up. */
    _toggles(...switches) {
        return `<div class="cartographer-drawing-toggles">${switches.join('')}</div>`;
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
    /** The tabs this user has: walls are the GM's. */
    _tabs() {
        return TABS.filter(entry => !entry.gmOnly || this.manager.canMakeWalls());
    }

    _buildTabs(tab) {
        const buttons = this._tabs().map(entry => `<button type="button" class="blacksmith-tool-tab${entry.id === tab ? ' is-active' : ''}" role="tab" aria-selected="${entry.id === tab}" data-action="drawing-tab" data-tab="${entry.id}">
                <i class="${entry.icon}"></i><span>${this._escape(this._localize(entry.labelKey))}</span></button>`).join('');
        return `<nav class="blacksmith-tool-tabs is-fill" role="tablist">${buttons}</nav>`;
    }

    /** The tab showing: the one asked for, if this user has it. */
    _currentTab() {
        return this._tabs().some(entry => entry.id === this.tab) ? this.tab : 'draw';
    }

    _buildBody() {
        const content = { walls: () => this._buildWalls(), stamps: () => this._buildStamps(), terrain: () => this._buildTerrain(), utilities: () => this._buildUtilities(), draw: () => this._buildDraw() }[this._currentTab()]();
        return `<div class="blacksmith-tool-stack cartographer-drawing-panel">${content}</div>`;
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
        let sections = this._section('fa-solid fa-pen', localize('tool'), this._segmented('drawing-mode', localize('tool'), TOOLS, state.drawingMode, 'mode'));
        sections += this._section('fa-solid fa-grip-lines', localize('line'),
            this._segmented('drawing-weight', localize('weight'), WEIGHTS, state.brushSettings.size, 'size')
            + this._segmented('drawing-style', localize('style'), LINE_STYLES, state.lineStyle, 'style'));
        sections += this._section('fa-solid fa-palette', localize('color'), this._buildColors());
        sections += this._hint(localize('holdHint'));
        return sections;
    }

    /** The Walls tab (the GM's): the kinds of wall, and how they are drawn. */
    _buildWalls() {
        const localize = key => this._localize(key);
        const { state } = this.manager;
        const opening = isOpeningKind(state.wallKind);
        // How they are drawn comes first, since it applies to the kinds and materials below. The shapes are the
        // drawing tools' own; a door or a window is two points, so it has none to choose.
        const door = isDoorKind(state.wallKind) ? this._segmented('drawing-wall-door', localize('doorState'), DOOR_STATES, state.wallDoor, 'door') : '';
        const how = (opening ? this._hint(localize('wallOpeningHint')) : this._segmented('drawing-wall-shape', localize('wallShape'), TOOLS, state.wallShape, 'shape'))
            + door
            + this._segmented('drawing-wall-thickness', localize('wallThickness'), THICKNESSES, state.wallThickness, 'thickness')
            + this._toggles(this._toggle('wallSnap', localize('wallSnap'), state.wallSnap, { hint: localize('wallSnapHint') }))
            + this._hint(localize('wallHint'));
        const tiles = WALL_KINDS.map(kind => {
            const active = state.drawingMode === 'wall' && state.wallKind === kind.id;
            const label = this._escape(localize(kind.labelKey));
            return `<button type="button" class="cartographer-stamp${active ? ' is-active' : ''}" data-action="drawing-wall" data-kind="${kind.id}" data-tooltip="${label}" aria-label="${label}" aria-pressed="${active}">
                <span class="cartographer-stamp-art">${wallKindSvg(kind.id)}</span><span class="cartographer-stamp-name">${label}</span></button>`;
        }).join('');
        // What it is drawn as. A door and a window are always drawn as themselves.
        const materials = opening ? '' : this._section('fa-solid fa-brush', localize('wallMaterial'),
            `<div class="cartographer-stamp-grid">${WALL_MATERIALS.map(material => {
                const active = state.wallMaterial === material.id;
                const label = this._escape(localize(material.labelKey));
                return `<button type="button" class="cartographer-stamp${active ? ' is-active' : ''}" data-action="drawing-wall-material" data-material="${material.id}" data-tooltip="${label}" aria-label="${label}" aria-pressed="${active}">
                    <span class="cartographer-stamp-art">${wallMaterialSvg(material.id)}</span><span class="cartographer-stamp-name">${label}</span></button>`;
            }).join('')}</div>` + this._hint(localize('materialHint')));
        return this._section('fa-solid fa-pen-ruler', localize('wallHow'), how)
            + this._section('fa-solid fa-border-none', localize('wallKind'), `<div class="cartographer-stamp-grid">${tiles}</div>`)
            + materials;
    }

    /** The Utilities tab: erasing, and how the scene is seen. */
    _buildUtilities() {
        const localize = key => this._localize(key);
        const { state } = this.manager;
        const gm = !!game.user?.isGM;
        const erase = [this._button({ action: 'drawing-erase', icon: 'fa-solid fa-eraser', label: localize('eraserHint'), text: localize('eraser'), active: state.drawingMode === 'erase' })];
        if (gm) erase.push(this._button({ action: 'drawing-erase-all', icon: 'fa-solid fa-trash-can', label: localize('eraseAllHint'), text: localize('eraseAll') }));
        // Which layer it takes from is above the eraser it controls.
        let sections = this._section('fa-solid fa-eraser', localize('erase'),
            `<div class="cartographer-drawing-layers">${this._segmented('drawing-erase-layer', localize('eraseLayer'), ERASE_LAYERS, state.eraseLayer, 'layer')}</div>`
            + this._hint(localize('eraseLayerHint'))
            + `<div class="cartographer-drawing-buttons">${erase.join('')}</div>` + this._hint(localize('eraseHint')));
        const clear = [this._button({ action: 'drawing-clear', icon: 'fa-solid fa-eraser', label: localize('clearOwnHint'), text: localize('clearOwn') })];
        if (gm) clear.push(this._button({ action: 'drawing-clear-all', icon: 'fa-solid fa-trash-can', label: localize('clearAllHint'), text: localize('clearAll') }));
        sections += this._section('fa-solid fa-broom', localize('tidy'),
            `<div class="cartographer-drawing-buttons">${clear.join('')}</div>`
            + this._toggles(this._toggle('timedErase', localize('timedErase'), state.timedEraseEnabled, { hint: localize('timedEraseHint') })));
        if (this.manager.canSetScene()) {
            const scene = this.manager.sceneState();
            sections += this._section('fa-solid fa-lightbulb', localize('scene'),
                this._toggles(
                    this._toggle('tokenVision', localize('sceneVision'), scene.tokenVision, { hint: localize('sceneVisionHint') }),
                    this._toggle('globalLight', localize('sceneGlobalLight'), scene.globalLight, { hint: localize('sceneGlobalLightHint') }))
                + this._slider('darkness', localize('sceneDarkness'), localize('sceneDarknessHint'), { min: 0, max: 1, step: 0.05, value: scene.darkness })
                + this._hint(localize('sceneHint')));
        }
        return sections;
    }

    /** One stamp, as a picture with its name. */
    _buildStamp(stamp, tint) {
        const { state } = this.manager;
        const active = state.drawingMode === 'stamp' && state.stampStyle === stamp.id;
        const label = this._escape(this._localize(stamp.labelKey));
        const art = stampSvg(stamp.id, { tint: stamp.legacy || !state.stamp.natural ? tint : null });
        // The tooltip says where it goes: on which layer, and whether it is one or many, fixed or scaled.
        const many = stamp.paint === 'scatter';
        const scales = stamp.size === 'scale';
        const how = this._escape([this._localize(`layer${stamp.layer[0].toUpperCase()}${stamp.layer.slice(1)}`), this._localize(many ? 'paintMany' : 'paintOne'), this._localize(scales ? 'sizeScales' : 'sizeFixed')].join(' · '));
        return `<button type="button" class="cartographer-stamp${active ? ' is-active' : ''}" data-action="drawing-stamp" data-kind="${stamp.id}" data-tooltip="${label} — ${how}" aria-label="${label}" aria-pressed="${active}">
                <span class="cartographer-stamp-art">${art}</span><span class="cartographer-stamp-name">${label}</span></button>`;
    }

    /** The Stamps tab: every stamp by kind, how big, and how it is put down. */
    _buildStamps() {
        const localize = key => this._localize(key);
        const { state } = this.manager;
        const tint = state.brushSettings.color;
        const canKeep = this.manager.canKeepOnScene();
        // The options come first: they apply to every stamp below them.
        const options = this._segmented('drawing-size', localize('size'), SIZES, state.symbolSize, 'size')
            + this._hint(localize('sizeHint'))
            + this._segmented('drawing-turn', localize('turn'), TURNS, String(state.stamp.turn), 'turn')
            + this._hint(localize('turnHint'))
            + this._toggles(
                this._toggle('natural', localize('natural'), state.stamp.natural, { hint: localize('naturalHint') }),
                this._toggle('rotate', localize('rotate'), state.stamp.rotate, { hint: localize('rotateHint') }),
                this._toggle('jitter', localize('jitter'), state.stamp.jitter, { hint: localize('jitterHint') }),
                this._toggle('snap', localize('snap'), state.stamp.snap, { hint: localize('snapHint') }),
                this._toggle('keep', localize('keep'), state.stamp.keep && canKeep, { hint: localize(canKeep ? 'keepHint' : 'keepDenied'), disabled: !canKeep }))
            + this._slider('spacing', localize('spacing'), localize('spacingHint'), { min: 0.5, max: 3, step: 0.25, value: state.stamp.spacing })
            + this._hint(localize('stampHint'));
        let sections = this._section('fa-solid fa-sliders', localize('options'), options);
        for (const category of STAMP_CATEGORIES) {
            // Ground patches and fields are terrain, and are on the Terrain tab.
            if (TERRAIN_CATEGORIES.includes(category.id)) continue;
            const stamps = STAMPS.filter(stamp => stamp.category === category.id);
            if (!stamps.length) continue;
            const icon = { trees: 'fa-solid fa-tree', plants: 'fa-solid fa-seedling', ground: 'fa-solid fa-circle-half-stroke', fields: 'fa-solid fa-wheat-awn', furniture: 'fa-solid fa-chair', storage: 'fa-solid fa-box', kitchen: 'fa-solid fa-utensils', rocks: 'fa-solid fa-mountain', features: 'fa-solid fa-campground', markers: 'fa-solid fa-location-dot' }[category.id];
            sections += this._section(icon, localize(category.labelKey),
                `<div class="cartographer-stamp-grid">${stamps.map(stamp => this._buildStamp(stamp, tint)).join('')}</div>`);
        }
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
        // Keeping on the scene is for everything on this tab, so it is first, where it is seen.
        const canKeep = this.manager.canKeepOnScene();
        const options = this._toggles(this._toggle('keep', localize('keep'), state.stamp.keep && canKeep, { hint: localize(canKeep ? 'keepHint' : 'keepDenied'), disabled: !canKeep }));
        // Each control is above what it controls: the width above the paths, the size above the patches and fields.
        const paths = this._segmented('drawing-path-width', localize('pathWidth'), PATH_WIDTHS, state.stamp.pathWidth, 'width')
            + `<div class="cartographer-stamp-grid">${tiles}</div>`
            + this._hint(localize('terrainHint'));
        const grounds = TERRAIN_CATEGORIES.map(id => {
            const category = STAMP_CATEGORIES.find(entry => entry.id === id);
            const stamps = STAMPS.filter(stamp => stamp.category === id);
            const icon = id === 'fields' ? 'fa-solid fa-wheat-awn' : 'fa-solid fa-circle-half-stroke';
            return this._section(icon, localize(category.labelKey), `<div class="cartographer-stamp-grid">${stamps.map(stamp => this._buildStamp(stamp, state.brushSettings.color)).join('')}</div>`);
        }).join('');
        const size = this._segmented('drawing-size', localize('patchSize'), SIZES, state.symbolSize, 'size')
            + this._hint(localize('patchHint')) + this._hint(localize('fieldHint'));
        return this._section('fa-solid fa-sliders', localize('options'), options)
            + this._section('fa-solid fa-road', localize('terrain'), paths)
            + this._section('fa-solid fa-up-right-and-down-left-from-center', localize('size'), size)
            + grounds;
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
        if (['natural', 'rotate', 'jitter', 'snap', 'keep'].includes(name)) manager.setStampOption(name, target.checked);
        else if (name === 'spacing') manager.setStampOption('spacing', target.value);
        else if (name === 'wallSnap') manager.setWallOption('snap', target.checked);
        else if (name === 'timedErase') manager.setTimedErase(target.checked);
        else if (name === 'tokenVision' || name === 'globalLight') void manager.setSceneOption(name, target.checked);
        else if (name === 'darkness') void manager.setSceneOption('darkness', target.value);
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        // One listener for the window's life: the controls are rebuilt on each render,
        // but their events reach the element, which is not.
        if (!this._controlsBound && this.element) {
            this.element.addEventListener('change', event => this._onControl(event));
            this._controlsBound = true;
            // The scene's vision, lighting and darkness are changed from elsewhere too: keep up.
            this._sceneHook = Hooks.on('updateScene', () => this.render());
        }
    }

    _onClose(options) {
        if (this._sceneHook !== undefined) Hooks.off('updateScene', this._sceneHook);
        this.manager?.onWindowClosed(this);
        return super._onClose?.(options);
    }
}

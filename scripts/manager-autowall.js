// ==================================================================
// ===== AUTO-WALL: MAP THIS WALL ===================================
// ==================================================================
//
// The GM clicks a wall on the scene's image and the walls along it are drawn.
// The picture work is in utils-autowall.js and knows nothing of Foundry; this
// file is the Foundry side of it: reading the scene image, where the click
// lands, the preview over the map, the panel with its few controls, and
// writing the walls -- tagged, so the last run can be taken back whole.

import { MODULE } from './const.js';
import { cartographerToolbar } from './manager-toolbar.js';
import { labBuffer, mapWall } from './utils-autowall.js';

/** The section of Cartographer's sub-menubar these sit in; registered in manager-toolbar.js. */
const GROUP = 'Walls';
const IDS = {
    map: `${MODULE.ID}-autowall-map`,
    undo: `${MODULE.ID}-autowall-undo`
};
/** Scene flag on every wall this makes: { run }, where run is when it was drawn. */
const FLAG = 'autoWall';
/** The widest the picture is read at, in pixels. A bigger image is shrunk to this to stay quick. */
const MAX_WORK_SIZE = 2400;
/** How far, in screen pixels, a click may move and still be a click, not a drag. */
const CLICK_PIXELS = 4;
/** How long, in ms, the controls settle before the walls are worked out again. */
const SETTLE_MS = 160;
const STORE_KEY = `${MODULE.ID}.autowall.options`;

/** What the controls start at, and the limits they move between. */
const DEFAULTS = { match: 20, smoothing: 0.06, widest: 1, snap: false };
const LIMITS = {
    match: { min: 8, max: 36, step: 1 },
    smoothing: { min: 0.02, max: 0.3, step: 0.01 },
    widest: { min: 0.25, max: 3, step: 0.05 }
};

function readOptions() {
    try {
        return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') };
    } catch {
        return { ...DEFAULTS };
    }
}

function writeOptions(options) {
    try {
        localStorage.setItem(STORE_KEY, JSON.stringify(options));
    } catch {
        // Not remembering is only a convenience lost.
    }
}

class AutoWallManager {
    constructor() {
        this._hooks = [];
        /** The run in progress: { seeds, options, image, result, token }, or null. */
        this.session = null;
        this._container = null;
        this._timer = null;
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
    }

    initialize() {
        if (!game.user.isGM) return;
        this._registerButtons();
        this._hooks.push({ name: 'canvasTearDown', id: Hooks.on('canvasTearDown', () => this.cancel()) });
    }

    _registerButtons() {
        const localize = key => game.i18n.localize(`${MODULE.ID}.autowall.${key}`);
        cartographerToolbar.registerTool(IDS.map, {
            icon: 'fa-solid fa-border-none',
            tooltip: localize('barMap'),
            group: GROUP,
            order: 1,
            toggleable: true,
            active: () => !!this.session,
            onClick: () => (this.session ? this.cancel() : void this.start())
        });
        cartographerToolbar.registerTool(IDS.undo, {
            icon: 'fa-solid fa-rotate-left',
            tooltip: localize('barUndo'),
            group: GROUP,
            order: 2,
            toggleable: false,
            onClick: () => void this.undo()
        });
    }

    _refreshButtons() {
        game.modules.get('coffee-pub-blacksmith')?.api?.updateSecondaryBarItemActive?.(MODULE.ID, IDS.map, !!this.session);
    }

    _localize(key, data) {
        const path = `${MODULE.ID}.autowall.${key}`;
        return data ? game.i18n.format(path, data) : game.i18n.localize(path);
    }

    // ==================================================================
    // ===== STARTING AND STOPPING ======================================
    // ==================================================================

    async start() {
        if (!game.user.isGM || !canvas?.ready || this.session) return;
        const session = { seeds: [], options: readOptions(), image: null, result: null, token: 0, working: false };
        this.session = session;
        this._refreshButtons();
        this._buildPanel();
        this._setStatus(this._localize('loading'));
        try {
            session.image = await this._readImage();
        } catch (error) {
            console.error(`${MODULE.NAME}: could not read the scene image`, error);
            if (this.session === session) {
                ui.notifications.warn(this._localize('noImage'));
                this.cancel();
            }
            return;
        }
        if (this.session !== session) return;
        this._listen();
        canvas.app.view.style.cursor = 'crosshair';
        this._drawThumb(session);
        this._setStatus(this._localize('hint'));
    }

    cancel() {
        clearTimeout(this._timer);
        this._timer = null;
        this._unlisten();
        this._clearPreview();
        this._panel?.remove();
        this._panel = null;
        if (canvas?.app?.view) canvas.app.view.style.cursor = '';
        this.session = null;
        this._refreshButtons();
    }

    // ==================================================================
    // ===== THE SCENE IMAGE ============================================
    // ==================================================================

    /**
     * The scene's background as pixels, shrunk if large, with where it sits on
     * the scene. Read from the sprite Foundry is drawing so it is the picture
     * the GM is looking at, and placed by that sprite so an offset or a
     * resized background still lines up.
     */
    async _readImage() {
        const background = canvas.primary?.background;
        // The file itself, when the scene names one: it is the picture as painted,
        // where the texture Foundry holds may be resized, or released once drawn.
        const src = canvas.level?.background?.src ?? canvas.scene?.background?.src ?? canvas.scene?.img ?? null;
        let source = null;
        let from = 'file';
        if (src && !/\.(webm|mp4|m4v)$/i.test(src)) {
            try {
                source = new Image();
                source.src = src;
                await source.decode();
            } catch (error) {
                console.warn(`${MODULE.NAME}: could not load ${src}; using the texture on screen`, error);
                source = null;
            }
        }
        if (!source) {
            from = 'texture';
            source = background?.texture?.baseTexture?.resource?.source ?? background?.texture?.source?.resource ?? null;
        }
        if (!source) throw new Error('no still image');
        const naturalWidth = source.naturalWidth ?? source.videoWidth ?? source.width;
        const naturalHeight = source.naturalHeight ?? source.videoHeight ?? source.height;
        if (!naturalWidth || !naturalHeight) throw new Error('empty image');

        const shrink = Math.min(1, MAX_WORK_SIZE / Math.max(naturalWidth, naturalHeight));
        const width = Math.max(1, Math.round(naturalWidth * shrink));
        const height = Math.max(1, Math.round(naturalHeight * shrink));
        const surface = document.createElement('canvas');
        surface.width = width;
        surface.height = height;
        const context = surface.getContext('2d', { willReadFrequently: true });
        context.drawImage(source, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height);

        const rect = canvas.dimensions.sceneRect;
        const sceneRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        const placement = this._placement(background) ?? sceneRect;
        const image = { pixels, lab: labBuffer(pixels), placement, scaleX: width / placement.width, scaleY: height / placement.height, surface };
        console.info(`${MODULE.NAME}: auto-wall read the map`, {
            from, src, natural: [naturalWidth, naturalHeight], work: [width, height],
            placement, sceneRect, spriteBox: background ? { x: background.x, y: background.y, width: background.width, height: background.height } : null,
            grid: canvas.scene.grid.size, contrast: this._contrast(pixels)
        });
        return image;
    }

    /**
     * Where the background is drawn, in scene pixels, measured from where it
     * appears on screen and brought back through the stage -- so it is right
     * whatever the sprite's own position, size, anchor and scale mean.
     */
    _placement(background) {
        if (!background || background.destroyed) return null;
        const bounds = background.getBounds();
        if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) return null;
        const topLeft = canvas.stage.toLocal(new PIXI.Point(bounds.x, bounds.y));
        const bottomRight = canvas.stage.toLocal(new PIXI.Point(bounds.x + bounds.width, bounds.y + bounds.height));
        const placement = { x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y };
        return Object.values(placement).every(Number.isFinite) && placement.width > 0 && placement.height > 0 ? placement : null;
    }

    /** How much the picture varies, as the spread of its lightness: near nothing means it was read blank. */
    _contrast({ data, width, height }) {
        let sum = 0, squares = 0, n = 0;
        for (let i = 0; i < width * height; i += 97) {
            const v = data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11;
            sum += v; squares += v * v; n++;
        }
        const mean = sum / n;
        return { mean: Math.round(mean), spread: Math.round(Math.sqrt(Math.max(0, squares / n - mean * mean))) };
    }

    /** Scene pixels to this image's pixels, and back. */
    _toImage(image, [x, y]) {
        return [(x - image.placement.x) * image.scaleX, (y - image.placement.y) * image.scaleY];
    }

    _toScene(image, [x, y]) {
        return [x / image.scaleX + image.placement.x, y / image.scaleY + image.placement.y];
    }

    // ==================================================================
    // ===== WORKING OUT THE WALLS ======================================
    // ==================================================================

    /** The tracer's options, from the controls, in the image's pixels. */
    _tracerOptions(session) {
        const { image, options } = session;
        const grid = Number(canvas.scene.grid.size) || 100;
        const square = grid * image.scaleX;
        return {
            tolerance: options.match,
            stepTolerance: Math.max(3, options.match * 0.25),
            lightnessWeight: 0.5,
            maxPixels: 600000,
            maxThickness: Math.max(4, options.widest * square),
            epsilon: Math.max(1.5, options.smoothing * square),
            closeRadius: Math.max(1, Math.min(4, Math.round(square * 0.03))),
            minBranch: Math.max(4, Math.round(square * 0.12)),
            weldDistance: Math.max(2, square * 0.06),
            angleSnap: 4,
            lab: image.lab
        };
    }

    /** Work the walls out again from the clicks and the controls, a moment after either changes. */
    _schedule() {
        clearTimeout(this._timer);
        const session = this.session;
        if (!session?.seeds.length) return;
        this._setStatus(this._localize('working'));
        this._timer = setTimeout(() => this._run(session), SETTLE_MS);
    }

    _run(session) {
        if (this.session !== session || !session.seeds.length) return;
        const { image } = session;
        const [first, ...rest] = session.seeds.map(seed => this._toImage(image, seed));
        if (first[0] < 0 || first[1] < 0 || first[0] >= image.pixels.width || first[1] >= image.pixels.height) {
            session.result = null;
            this._clearPreview();
            this._drawThumb(session);
            this._setStatus(this._localize('outside'), 'warn');
            return;
        }
        const started = performance.now();
        const result = mapWall(image.pixels, first[0], first[1], { ...this._tracerOptions(session), extraSeeds: rest });
        session.result = result;
        console.info(`${MODULE.NAME}: auto-wall run`, {
            ms: Math.round(performance.now() - started), seeds: session.seeds.map(seed => seed.map(Math.round)),
            seedsInImage: [first, ...rest].map(seed => seed.map(Math.round)), options: { ...this._tracerOptions(session), lab: undefined },
            count: result.count, capped: result.capped, tooThick: result.tooThick, segments: result.segments.length
        });
        this._drawPreview(session);
        this._drawThumb(session);
        this._reportResult(session);
    }

    /**
     * The picture as the tool read it, small, in the panel, with where it took
     * the clicks to be and what it found. If this does not match the map, the
     * trouble is in the reading and not in the settings.
     */
    _drawThumb(session) {
        const thumb = this._thumb;
        const image = session?.image;
        if (!thumb || !image) return;
        const context = thumb.getContext('2d');
        const scale = Math.min(thumb.width / image.surface.width, thumb.height / image.surface.height);
        context.clearRect(0, 0, thumb.width, thumb.height);
        context.drawImage(image.surface, 0, 0, image.surface.width * scale, image.surface.height * scale);
        const result = session.result;
        if (result?.mask?.length && result.bounds.width) {
            const { x, y, width, height } = result.bounds;
            const layer = document.createElement('canvas');
            layer.width = width;
            layer.height = height;
            const layerContext = layer.getContext('2d');
            const tint = layerContext.createImageData(width, height);
            for (let i = 0; i < result.mask.length; i++) {
                if (result.mask[i]) { tint.data[i * 4] = 40; tint.data[i * 4 + 1] = 200; tint.data[i * 4 + 2] = 230; tint.data[i * 4 + 3] = 160; }
            }
            layerContext.putImageData(tint, 0, 0);
            context.drawImage(layer, x * scale, y * scale, width * scale, height * scale);
        }
        context.lineWidth = 1.5;
        context.strokeStyle = '#e03a2e';
        for (const [a, b] of result?.segments ?? []) {
            context.beginPath();
            context.moveTo(a[0] * scale, a[1] * scale);
            context.lineTo(b[0] * scale, b[1] * scale);
            context.stroke();
        }
        context.strokeStyle = '#3fd16a';
        context.lineWidth = 2;
        for (const seed of session.seeds) {
            const [x, y] = this._toImage(image, seed);
            context.beginPath();
            context.moveTo(x * scale - 6, y * scale);
            context.lineTo(x * scale + 6, y * scale);
            context.moveTo(x * scale, y * scale - 6);
            context.lineTo(x * scale, y * scale + 6);
            context.stroke();
        }
    }

    /** The result in scene pixels, snapped to the grid if asked, with no wall of no length. */
    _sceneSegments(session) {
        const { image, options, result } = session;
        const size = Number(canvas.scene.grid.size) || 100;
        const snapped = new Map();
        const place = point => {
            if (!options.snap) return point;
            const key = `${Math.round(point[0])},${Math.round(point[1])}`;
            if (!snapped.has(key)) {
                const target = canvas.grid.getSnappedPoint({ x: point[0], y: point[1] }, { mode: CONST.GRID_SNAPPING_MODES.VERTEX });
                const near = Math.hypot(target.x - point[0], target.y - point[1]) <= size * 0.2;
                snapped.set(key, near ? [target.x, target.y] : point);
            }
            return snapped.get(key);
        };
        return (result?.segments ?? [])
            .map(([a, b]) => [place(this._toScene(image, a)).map(Math.round), place(this._toScene(image, b)).map(Math.round)])
            .filter(([a, b]) => a[0] !== b[0] || a[1] !== b[1]);
    }

    _reportResult(session) {
        const { result } = session;
        if (result.capped) return this._setStatus(this._localize('capped'), 'warn');
        if (result.tooThick) return this._setStatus(this._localize('tooThick'), 'warn');
        const count = this._sceneSegments(session).length;
        if (!count) return this._setStatus(this._localize('nothing'), 'warn');
        this._setStatus(this._localize(count === 1 ? 'resultOne' : 'result', { count }), 'ok');
        this._panel?.querySelector('[data-action="add"]')?.removeAttribute('disabled');
    }

    // ==================================================================
    // ===== THE PREVIEW ================================================
    // ==================================================================

    _layer() {
        if (!canvas?.ready || !canvas.interface) return null;
        if (!this._container || this._container.destroyed) {
            this._container = new PIXI.Container();
            this._container.eventMode = 'none';
            this._container.name = `${MODULE.ID}-autowall`;
            canvas.interface.addChild(this._container);
        }
        return this._container;
    }

    _clearPreview() {
        if (!this._container || this._container.destroyed) return;
        for (const child of this._container.removeChildren()) child.destroy({ children: true, texture: true, baseTexture: true });
    }

    _drawPreview(session) {
        if (!this._layer()) return;
        this._clearPreview();
        const { image, result } = session;
        const grid = Number(canvas.scene.grid.size) || 100;
        const line = Math.max(3, grid * 0.06);

        // What the click was taken to be wall: the mask, tinted.
        if (result.mask.length && result.bounds.width && !result.capped) {
            const { x, y, width, height } = result.bounds;
            const surface = document.createElement('canvas');
            surface.width = width;
            surface.height = height;
            const context = surface.getContext('2d');
            const tint = context.createImageData(width, height);
            for (let i = 0; i < result.mask.length; i++) {
                if (!result.mask[i]) continue;
                tint.data[i * 4] = 40; tint.data[i * 4 + 1] = 200; tint.data[i * 4 + 2] = 230; tint.data[i * 4 + 3] = 110;
            }
            context.putImageData(tint, 0, 0);
            const sprite = new PIXI.Sprite(PIXI.Texture.from(surface));
            const [sx, sy] = this._toScene(image, [x, y]);
            sprite.position.set(sx, sy);
            sprite.width = width / image.scaleX;
            sprite.height = height / image.scaleY;
            this._container.addChild(sprite);
        }

        const graphics = new PIXI.Graphics();
        const segments = this._sceneSegments(session);
        graphics.lineStyle({ width: line, color: 0xe03a2e, alpha: 0.95, cap: 'round', join: 'round' });
        for (const [a, b] of segments) graphics.moveTo(a[0], a[1]).lineTo(b[0], b[1]);
        graphics.lineStyle(0);
        graphics.beginFill(0xffd23f, 1);
        for (const [a, b] of segments) {
            graphics.drawCircle(a[0], a[1], line * 0.9);
            graphics.drawCircle(b[0], b[1], line * 0.9);
        }
        graphics.endFill();
        graphics.beginFill(0x3fd16a, 1);
        for (const seed of session.seeds) graphics.drawCircle(seed[0], seed[1], line * 1.1);
        graphics.endFill();
        this._container.addChild(graphics);
    }

    // ==================================================================
    // ===== THE PANEL ==================================================
    // ==================================================================

    _buildPanel() {
        const localize = key => this._localize(key);
        const options = this.session.options;
        const slider = (name, label, hint) => {
            const { min, max, step } = LIMITS[name];
            return `<label class="cartographer-autowall-row" title="${foundry.utils.escapeHTML(hint)}">
                <span class="cartographer-autowall-label">${foundry.utils.escapeHTML(label)}</span>
                <input type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${options[name]}">
                <output class="cartographer-autowall-value" data-for="${name}"></output>
            </label>`;
        };
        const panel = document.createElement('div');
        panel.className = 'cartographer-autowall-panel';
        panel.innerHTML = `
            <div class="cartographer-autowall-title"><i class="fa-solid fa-border-none"></i> ${localize('title')}</div>
            <div class="cartographer-autowall-status" data-role="status"></div>
            <canvas class="cartographer-autowall-thumb" width="316" height="150"></canvas>
            ${slider('match', localize('match'), localize('matchHint'))}
            ${slider('smoothing', localize('smoothing'), localize('smoothingHint'))}
            ${slider('widest', localize('widest'), localize('widestHint'))}
            <label class="cartographer-autowall-check">
                <input type="checkbox" name="snap" ${options.snap ? 'checked' : ''}>
                <span>${localize('snap')}</span>
            </label>
            <div class="cartographer-autowall-buttons">
                <button type="button" data-action="add" disabled><i class="fa-solid fa-check"></i> ${localize('add')}</button>
                <button type="button" data-action="cancel"><i class="fa-solid fa-xmark"></i> ${localize('cancel')}</button>
            </div>`;
        panel.addEventListener('input', event => this._onControl(event));
        panel.addEventListener('click', event => {
            const action = event.target.closest('[data-action]')?.dataset.action;
            if (action === 'add') void this.accept();
            else if (action === 'cancel') this.cancel();
        });
        document.body.appendChild(panel);
        this._panel = panel;
        this._thumb = panel.querySelector('.cartographer-autowall-thumb');
        for (const name of Object.keys(LIMITS)) this._showValue(name);
    }

    _showValue(name) {
        const output = this._panel?.querySelector(`[data-for="${name}"]`);
        if (!output) return;
        const value = this.session.options[name];
        output.textContent = name === 'match' ? String(value) : `${Number(value).toFixed(2)}`;
    }

    _onControl(event) {
        const session = this.session;
        const input = event.target;
        if (!session || !input.name) return;
        session.options[input.name] = input.type === 'checkbox' ? input.checked : Number(input.value);
        writeOptions(session.options);
        this._showValue(input.name);
        if (input.name === 'snap' && session.result) {
            this._drawPreview(session);
            this._reportResult(session);
        } else this._schedule();
    }

    _setStatus(text, tone = '') {
        const status = this._panel?.querySelector('[data-role="status"]');
        if (!status) return;
        status.textContent = text;
        status.dataset.tone = tone;
        if (tone !== 'ok') this._panel.querySelector('[data-action="add"]')?.setAttribute('disabled', '');
    }

    // ==================================================================
    // ===== CLICKS AND KEYS ============================================
    // ==================================================================

    _listen() {
        const view = canvas?.app?.view;
        if (!view || this._listening === view) return;
        this._unlisten();
        view.addEventListener('pointerdown', this._onPointerDown, true);
        view.addEventListener('pointerup', this._onPointerUp, true);
        document.addEventListener('keydown', this._onKeyDown, true);
        this._listening = view;
    }

    _unlisten() {
        const view = this._listening;
        if (view) {
            view.removeEventListener('pointerdown', this._onPointerDown, true);
            view.removeEventListener('pointerup', this._onPointerUp, true);
        }
        document.removeEventListener('keydown', this._onKeyDown, true);
        this._listening = null;
    }

    _scenePoint(event) {
        const rect = canvas.app.view.getBoundingClientRect();
        const point = canvas.app.stage.toLocal(new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top));
        return Number.isFinite(point.x) && Number.isFinite(point.y) ? [point.x, point.y] : null;
    }

    _swallow(event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }

    /** Only the left button picks; the others still pan and open menus. */
    _onPointerDown(event) {
        if (event.button !== 0) return;
        this._swallow(event);
        this._press = { x: event.clientX, y: event.clientY };
    }

    _onPointerUp(event) {
        if (event.button !== 0) return;
        this._swallow(event);
        const press = this._press;
        this._press = null;
        const session = this.session;
        if (!session?.image || !press) return;
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_PIXELS) return;
        const point = this._scenePoint(event);
        if (!point) return;
        // Shift adds to the wall being mapped; a plain click starts a new one.
        if (event.shiftKey && session.seeds.length) session.seeds.push(point);
        else session.seeds = [point];
        this._schedule();
    }

    _onKeyDown(event) {
        if (!this.session || event.target?.closest?.('input, textarea, select, [contenteditable]')) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.cancel();
        } else if (event.key === 'Enter' && this.session.result?.segments.length) {
            event.preventDefault();
            event.stopPropagation();
            void this.accept();
        }
    }

    // ==================================================================
    // ===== WRITING AND TAKING BACK ====================================
    // ==================================================================

    async accept() {
        const session = this.session;
        if (!session?.result || session.result.capped || session.result.tooThick) return;
        const segments = this._sceneSegments(session);
        if (!segments.length) return;
        const run = Date.now();
        const data = segments.map(([a, b]) => ({ c: [a[0], a[1], b[0], b[1]], flags: { [MODULE.ID]: { [FLAG]: { run } } } }));
        try {
            await canvas.scene.createEmbeddedDocuments('Wall', data);
        } catch (error) {
            console.error(`${MODULE.NAME}: could not add the walls`, error);
            ui.notifications.error(this._localize('failed'));
            return;
        }
        ui.notifications.info(this._localize('added', { count: data.length }));
        // Ready for the next wall: the walls are real now, so the preview and the clicks go.
        session.seeds = [];
        session.result = null;
        this._clearPreview();
        this._setStatus(this._localize('hint'));
    }

    /** The walls this last drew on the scene, as one: every wall of the latest run. */
    async undo() {
        if (!game.user.isGM || !canvas?.scene) return;
        const mine = canvas.scene.walls.filter(wall => Number.isFinite(wall.getFlag(MODULE.ID, FLAG)?.run));
        if (!mine.length) {
            ui.notifications.info(this._localize('noUndo'));
            return;
        }
        const latest = Math.max(...mine.map(wall => wall.getFlag(MODULE.ID, FLAG).run));
        const ids = mine.filter(wall => wall.getFlag(MODULE.ID, FLAG).run === latest).map(wall => wall.id);
        await canvas.scene.deleteEmbeddedDocuments('Wall', ids);
        ui.notifications.info(this._localize('undone', { count: ids.length }));
    }
}

export const autoWallManager = new AutoWallManager();

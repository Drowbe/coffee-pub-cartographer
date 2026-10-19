// ==================================================================
// ===== ROUTES =====================================================
// ==================================================================

import { MODULE } from './const.js';
import { cartographerToolbar } from './manager-toolbar.js';
import { cleanPoints, legPixels, routePixels, gridDistance, pointAlong, convertDistance } from './utils-routes.js';
import { formatDistance } from './utils-travel.js';

/** Scene flag holding `{ list }` of routes. */
const FLAG_KEY = 'routes';
/** The section of Cartographer's sub-menubar these sit in; registered in manager-toolbar.js. */
const GROUP = 'Routes';
const IDS = {
    draw: `${MODULE.ID}-routes-draw`,
    window: `${MODULE.ID}-routes-window`
};
/** The colours a route can be drawn in; a new route takes the next unused one. */
export const ROUTE_COLORS = ['#b03a2e', '#1f618d', '#1e8449', '#7d3c98', '#ca6f1e', '#212f3c'];

/**
 * Routes: lines of waypoints a GM draws on a map scene to measure a journey.
 *
 * A route is `{ id, name, color, points }`, with points as [[x, y], ...] in
 * scene pixels, saved in the scene's `routes` flag so it lasts and every
 * client draws it. Its length is the true length of the line on the scene's
 * grid (see utils-routes.js).
 *
 * Drawing is click by click: each click places a waypoint and the distance
 * so far follows the pointer; a double-click or Enter finishes, Backspace
 * takes back the last point, and Escape gives up. Right-drag still pans.
 *
 * Scene motion's odometer can follow a route on another scene: the route's
 * length is its destination, and how far it has come is how far along the
 * route the party is (see manager-parallax.js, `travel.route`).
 */
class RoutesManager {
    constructor() {
        this._hooks = [];
        /** The route being drawn: { points, cursor }, or null. */
        this.draft = null;
        this.window = null;
        this._container = null;
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onDoubleClick = this._onDoubleClick.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
    }

    initialize() {
        this._exposeApi();
        if (game.user.isGM) this._registerButtons();
        const on = (name, fn) => this._hooks.push({ name, id: Hooks.on(name, fn) });
        on('canvasReady', () => this.draw());
        on('canvasTearDown', () => {
            this.cancelDrawing();
            this._container = null;
        });
        on('updateScene', (scene, changes) => {
            if (!foundry.utils.hasProperty(changes, `flags.${MODULE.ID}.${FLAG_KEY}`)) return;
            if (scene.id === canvas.scene?.id) this.draw();
            // The window lists this scene's routes; the odometer may follow one on another.
            this.window?.render();
            Hooks.callAll(`${MODULE.ID}.routesChanged`, scene);
        });
        this.draw();
    }

    /** `game.modules.get('coffee-pub-cartographer').api.routes` -- for macros and other modules. */
    _exposeApi() {
        const module = game.modules.get(MODULE.ID);
        if (!module) return;
        module.api ??= {};
        module.api.routes = {
            /** The routes on a scene (default: the one on the canvas), with their lengths. */
            list: (sceneId) => {
                const scene = sceneId ? game.scenes.get(sceneId) : canvas.scene;
                return this.routes(scene).map(route => ({ ...route, ...this.measure(route, scene) }));
            },
            /** Where a distance (in that scene's units) along a route reaches, in scene pixels. */
            pointAt: (routeId, distance, sceneId) => this.pointAt(routeId, distance, sceneId),
            draw: () => this.startDrawing(),
            open: () => this.openWindow()
        };
    }

    _registerButtons() {
        const localize = key => game.i18n.localize(`${MODULE.ID}.routes.${key}`);
        cartographerToolbar.registerTool(IDS.draw, {
            icon: 'fa-solid fa-route',
            tooltip: localize('barDraw'),
            group: GROUP,
            order: 1,
            toggleable: true,
            active: () => !!this.draft,
            onClick: () => (this.draft ? this.finishDrawing() : this.startDrawing())
        });
        cartographerToolbar.registerTool(IDS.window, {
            icon: 'fa-solid fa-list-ol',
            tooltip: localize('barWindow'),
            group: GROUP,
            order: 2,
            toggleable: false,
            onClick: () => this.openWindow()
        });
    }

    /** The Draw button, and the window's, say whether a route is being drawn. */
    _refreshButton() {
        const api = game.modules.get('coffee-pub-blacksmith')?.api;
        api?.updateSecondaryBarItemActive?.(MODULE.ID, IDS.draw, !!this.draft);
        if (this.window?.rendered) this.window.render();
    }

    // ==================================================================
    // ===== STATE ======================================================
    // ==================================================================

    /** A scene's routes (default: the one on the canvas). */
    routes(scene = canvas.scene) {
        return foundry.utils.deepClone(scene?.getFlag(MODULE.ID, FLAG_KEY)?.list ?? []);
    }

    get(id, scene = canvas.scene) {
        return this.routes(scene).find(route => route.id === id) ?? null;
    }

    /**
     * A route's length on its scene's grid: { pixels, distance, units, legs },
     * with distances in the scene's units and legs as each leg's distance.
     */
    measure(route, scene = canvas.scene) {
        const grid = scene?.grid;
        const points = route?.points ?? [];
        return {
            pixels: routePixels(points),
            distance: gridDistance(routePixels(points), grid),
            units: grid?.units ?? '',
            legs: legPixels(points).map(pixels => gridDistance(pixels, grid))
        };
    }

    /** Every scene with routes, and its routes, for choosing one to follow. */
    allRoutes() {
        return game.scenes.contents
            .map(scene => ({ scene, routes: this.routes(scene) }))
            .filter(entry => entry.routes.length);
    }

    /**
     * A route an odometer follows (`{ sceneId, routeId }`), with its length
     * both in its own scene's units and converted to `units` -- the
     * odometer's scene's. `converted` is null when the two cannot be
     * compared (hexes and feet). Null when the route is gone.
     */
    linked(link, units) {
        const scene = link?.sceneId ? game.scenes.get(link.sceneId) : null;
        const route = scene ? this.get(link.routeId, scene) : null;
        if (!route) return null;
        const { distance, units: own } = this.measure(route, scene);
        return { route, scene, distance, units: own, converted: convertDistance(distance, own, units) };
    }

    /** Where a distance in the route's scene units along it reaches: { x, y, angle } in pixels. */
    pointAt(routeId, distance, sceneId) {
        const scene = sceneId ? game.scenes.get(sceneId) : canvas.scene;
        const route = this.get(routeId, scene);
        const grid = scene?.grid;
        if (!route || !grid?.size || !grid?.distance) return null;
        return pointAlong(route.points, (Number(distance) / grid.distance) * grid.size);
    }

    async _write(list, scene = canvas.scene) {
        if (!game.user.isGM || !scene) return;
        await scene.setFlag(MODULE.ID, FLAG_KEY, { list });
    }

    async add({ name, points, color }) {
        const list = this.routes();
        const route = {
            id: foundry.utils.randomID(),
            name: String(name ?? '').trim() || this._nextName(list),
            color: color ?? ROUTE_COLORS.find(c => !list.some(r => r.color === c)) ?? ROUTE_COLORS[list.length % ROUTE_COLORS.length],
            points: cleanPoints(points)
        };
        await this._write([...list, route]);
        return route;
    }

    /** Rename or recolour a route. */
    async update(id, changes) {
        const list = this.routes();
        const route = list.find(r => r.id === id);
        if (!route) return;
        if ('name' in changes) route.name = String(changes.name ?? '').trim() || route.name;
        if ('color' in changes && changes.color) route.color = changes.color;
        await this._write(list);
    }

    async remove(id) {
        await this._write(this.routes().filter(route => route.id !== id));
    }

    _nextName(list) {
        const base = game.i18n.localize(`${MODULE.ID}.routes.defaultName`);
        let n = list.length + 1;
        while (list.some(route => route.name === `${base} ${n}`)) n++;
        return `${base} ${n}`;
    }

    // ==================================================================
    // ===== DRAWING A ROUTE ============================================
    // ==================================================================

    startDrawing() {
        if (!game.user.isGM || !canvas?.ready || this.draft) return;
        if (!canvas.scene?.grid?.size) return;
        this.draft = { points: [], cursor: null };
        const view = canvas.app.view;
        view.addEventListener('pointerdown', this._onPointerDown, true);
        view.addEventListener('pointerup', this._onPointerUp, true);
        view.addEventListener('pointermove', this._onPointerMove, true);
        view.addEventListener('dblclick', this._onDoubleClick, true);
        document.addEventListener('keydown', this._onKeyDown, true);
        view.style.cursor = 'crosshair';
        ui.notifications.info(game.i18n.localize(`${MODULE.ID}.routes.drawHint`));
        this._refreshButton();
        this.draw();
    }

    /** Stop listening, and forget the draft. */
    _endDrawing() {
        const view = canvas?.app?.view;
        if (view) {
            view.removeEventListener('pointerdown', this._onPointerDown, true);
            view.removeEventListener('pointerup', this._onPointerUp, true);
            view.removeEventListener('pointermove', this._onPointerMove, true);
            view.removeEventListener('dblclick', this._onDoubleClick, true);
            view.style.cursor = '';
        }
        document.removeEventListener('keydown', this._onKeyDown, true);
        this.draft = null;
        this._refreshButton();
        this.draw();
    }

    cancelDrawing() {
        if (this.draft) this._endDrawing();
    }

    /** Save the route drawn so far, asking for its name. Fewer than two points is nothing to save. */
    async finishDrawing() {
        if (!this.draft) return;
        const points = cleanPoints(this.draft.points);
        this._endDrawing();
        if (points.length < 2) return;
        const localize = key => game.i18n.localize(`${MODULE.ID}.routes.${key}`);
        const suggested = this._nextName(this.routes());
        const length = formatDistance(gridDistance(routePixels(points), canvas.scene.grid), canvas.scene.grid.units);
        const name = await foundry.applications.api.DialogV2.prompt({
            window: { title: localize('nameTitle'), icon: 'fa-solid fa-route' },
            content: `<p>${foundry.utils.escapeHTML(game.i18n.format(`${MODULE.ID}.routes.nameBody`, { length }))}</p>`
                + `<input type="text" name="name" value="${foundry.utils.escapeHTML(suggested)}" autofocus>`,
            ok: { label: localize('save'), callback: (_event, button) => button.form.elements.name.value },
            rejectClose: false
        });
        // Closing the dialog discards the route; that is the way out of a mis-drawn one.
        if (name === null || name === undefined) return;
        await this.add({ name, points });
        this.openWindow();
    }

    removeLastPoint() {
        if (!this.draft?.points.length) return;
        this.draft.points.pop();
        this.draw();
    }

    _scenePoint(event) {
        const rect = canvas.app.view.getBoundingClientRect();
        const point = canvas.app.stage.toLocal(new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top));
        return Number.isFinite(point.x) && Number.isFinite(point.y) ? [point.x, point.y] : null;
    }

    /** Only the left button places points; the others still pan and open menus. */
    _onPointerDown(event) {
        if (!this.draft || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const point = this._scenePoint(event);
        if (point) this.draft.points.push(point);
        this.draw();
    }

    _onPointerUp(event) {
        if (!this.draft || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }

    _onPointerMove(event) {
        if (!this.draft) return;
        this.draft.cursor = this._scenePoint(event);
        this._drawDraft();
    }

    _onDoubleClick(event) {
        if (!this.draft) return;
        event.preventDefault();
        event.stopPropagation();
        void this.finishDrawing();
    }

    /**
     * Enter, Backspace and Escape belong to the route while one is drawn --
     * Backspace would otherwise delete whatever token is selected -- unless
     * the GM is typing somewhere.
     */
    _onKeyDown(event) {
        if (!this.draft) return;
        const target = event.target;
        if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        const handled = { Enter: () => this.finishDrawing(), Escape: () => this.cancelDrawing(), Backspace: () => this.removeLastPoint(), Delete: () => this.removeLastPoint() }[event.key];
        if (!handled) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        void handled();
    }

    // ==================================================================
    // ===== ON THE CANVAS ==============================================
    // ==================================================================

    /**
     * The routes, drawn over the map for everyone, with the one being drawn.
     * They sit in the interface group, above tokens, so a route is never lost
     * under a token standing on it.
     */
    _layer() {
        if (!canvas?.ready || !canvas.interface) return null;
        if (!this._container || this._container.destroyed) {
            this._container = new PIXI.Container();
            this._container.eventMode = 'none';
            this._container.name = `${MODULE.ID}-routes`;
            this._routes = this._container.addChild(new PIXI.Container());
            this._draftLayer = this._container.addChild(new PIXI.Container());
            canvas.interface.addChild(this._container);
        }
        return this._container;
    }

    /** Line, dot and text sizes from the grid, so routes read the same on any map. */
    _sizes() {
        const size = Number(canvas.scene?.grid?.size) || 100;
        const line = Math.max(3, size * 0.05);
        return { line, dot: line * 1.1, font: Math.max(14, Math.round(size * 0.22)) };
    }

    draw() {
        if (!this._layer()) return;
        for (const child of this._routes.removeChildren()) child.destroy({ children: true });
        const sizes = this._sizes();
        for (const route of this.routes()) {
            if ((route.points?.length ?? 0) < 2) continue;
            const color = Number.parseInt(String(route.color ?? ROUTE_COLORS[0]).replace('#', ''), 16);
            this._routes.addChild(this._line(route.points, color, sizes));
            const { distance, units } = this.measure(route);
            const middle = pointAlong(route.points, routePixels(route.points) / 2);
            this._routes.addChild(this._label(`${route.name} · ${formatDistance(distance, units)}`, middle, sizes));
        }
        this._drawDraft();
    }

    _line(points, color, sizes, alpha = 1) {
        const graphics = new PIXI.Graphics();
        // A dark edge under the colour, so the line reads on light and dark maps.
        for (const [width, tint, a] of [[sizes.line + 3, 0x111111, 0.55 * alpha], [sizes.line, color, alpha]]) {
            graphics.lineStyle({ width, color: tint, alpha: a, cap: 'round', join: 'round' });
            graphics.moveTo(points[0][0], points[0][1]);
            for (const [x, y] of points.slice(1)) graphics.lineTo(x, y);
        }
        graphics.lineStyle(0);
        points.forEach(([x, y], index) => {
            const end = index === 0 || index === points.length - 1;
            graphics.beginFill(0x111111, 0.55 * alpha).drawCircle(x, y, (end ? sizes.dot * 1.6 : sizes.dot) + 1.5).endFill();
            graphics.beginFill(end ? 0xffffff : color, alpha).drawCircle(x, y, end ? sizes.dot * 1.6 : sizes.dot).endFill();
        });
        return graphics;
    }

    _label(text, at, sizes) {
        const label = new PIXI.Text(text, {
            fontFamily: 'Signika, sans-serif',
            fontSize: sizes.font,
            fontWeight: '600',
            fill: '#ffffff',
            stroke: '#111111',
            strokeThickness: Math.max(3, sizes.font / 5),
            align: 'center'
        });
        label.resolution = 2;
        label.anchor.set(0.5, 1.2);
        label.position.set(at?.x ?? 0, at?.y ?? 0);
        return label;
    }

    /** The route being drawn, out to the pointer, with the distance so far beside it. */
    _drawDraft() {
        if (!this._layer()) return;
        for (const child of this._draftLayer.removeChildren()) child.destroy({ children: true });
        const draft = this.draft;
        if (!draft?.points.length) return;
        const sizes = this._sizes();
        const points = draft.cursor ? [...draft.points, draft.cursor] : draft.points;
        const color = Number.parseInt(ROUTE_COLORS[0].replace('#', ''), 16);
        if (points.length > 1) this._draftLayer.addChild(this._line(points, color, sizes, 0.8));
        else this._draftLayer.addChild(this._line([points[0], points[0]], color, sizes, 0.8));
        const grid = canvas.scene.grid;
        const total = formatDistance(gridDistance(routePixels(points), grid), grid.units);
        const legs = legPixels(points);
        const leg = legs.length ? formatDistance(gridDistance(legs.at(-1), grid), grid.units) : null;
        const text = leg && legs.length > 1 ? `${total}  (+${leg})` : total;
        const at = points.at(-1);
        this._draftLayer.addChild(this._label(text, { x: at[0], y: at[1] - sizes.dot * 2 }, sizes));
    }

    // ==================================================================
    // ===== THE WINDOW =================================================
    // ==================================================================

    async openWindow() {
        if (!game.user.isGM) return null;
        if (this.window?.rendered) {
            this.window.bringToFront?.();
            return this.window;
        }
        const { RoutesWindow } = await import('./window-routes.js');
        this.window = await RoutesWindow.open(this);
        return this.window;
    }

    onWindowClosed(window) {
        if (this.window === window) this.window = null;
    }

    /** Pan the canvas to show a whole route. */
    async focus(id) {
        const route = this.get(id);
        if (!route?.points?.length || !canvas?.ready) return;
        const xs = route.points.map(p => p[0]);
        const ys = route.points.map(p => p[1]);
        const width = Math.max(...xs) - Math.min(...xs);
        const height = Math.max(...ys) - Math.min(...ys);
        const screen = canvas.screenDimensions ?? [window.innerWidth, window.innerHeight];
        const scale = Math.min(screen[0] / (width * 1.4 || 1), screen[1] / (height * 1.4 || 1), canvas.stage.scale.x * 2);
        await canvas.animatePan({
            x: (Math.max(...xs) + Math.min(...xs)) / 2,
            y: (Math.max(...ys) + Math.min(...ys)) / 2,
            scale: Math.max(0.1, Math.min(3, scale)),
            duration: 500
        });
    }
}

export const routesManager = new RoutesManager();

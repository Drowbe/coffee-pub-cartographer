// ==================================================================
// ===== ROUTES =====================================================
// ==================================================================

import { MODULE } from './const.js';
import { cartographerToolbar } from './manager-toolbar.js';
import { socketManager } from './manager-sockets.js';
import {
    cleanPoints, legPixels, routePixels, gridDistance, distancePixels, pointAlong, convertDistance,
    nearestWaypoint, nearestOnRoute
} from './utils-routes.js';
import { formatDistance } from './utils-travel.js';

/** Scene flag holding `{ list }` of routes. */
const FLAG_KEY = 'routes';
/** Whether this viewer shows routes on the map at all, per browser. */
const SHOW_KEY = `${MODULE.ID}.routes.show`;
/** The section of Cartographer's sub-menubar these sit in; registered in manager-toolbar.js. */
const GROUP = 'Routes';
const IDS = {
    draw: `${MODULE.ID}-routes-draw`,
    show: `${MODULE.ID}-routes-show`,
    window: `${MODULE.ID}-routes-window`
};
/** The colours a route can be drawn in; a new route takes the next unused one. */
export const ROUTE_COLORS = ['#b03a2e', '#1f618d', '#1e8449', '#7d3c98', '#ca6f1e', '#212f3c'];
/** How near, in screen pixels, a pointer must be to a waypoint or the line to take hold of it. */
const HIT_PIXELS = 12;

function readShow() {
    try {
        return localStorage.getItem(SHOW_KEY) !== 'false';
    } catch {
        return true;
    }
}

function writeShow(show) {
    try {
        localStorage.setItem(SHOW_KEY, String(!!show));
    } catch {
        // Storage can be unavailable (private windows); the choice lasts the session.
    }
}

/**
 * Routes: lines of waypoints drawn on a map scene to measure a journey.
 *
 * A route is `{ id, name, color, points, userId, hidden }`, with points as
 * [[x, y], ...] in scene pixels, saved in the scene's `routes` flag. Its
 * length is the true length of the line on the scene's grid, square or hex
 * (see utils-routes.js).
 *
 * Anyone can draw a route; its maker and the GM can change it. Only the GM
 * writes the scene, so a player's change is sent to the active GM, who checks
 * it is theirs to make and saves it -- the way mapping's changes travel.
 * A hidden route is drawn only for its maker and the GM, faintly; anyone can
 * also turn routes off on their own screen.
 *
 * Drawing is click by click: each click places a waypoint and the distance
 * so far follows the pointer; a double-click or Enter finishes, Backspace
 * takes back the last point, and Escape gives up. Right-drag still pans.
 *
 * Editing: double-click your own route's line to add a waypoint there, which
 * also starts editing it. While editing, drag a waypoint to move it, and
 * right-click (or Alt-click) one to remove it; Enter or Escape stops.
 *
 * Scene motion's odometer can follow a route on another scene: the route's
 * length is its destination (see manager-travel.js, `_syncRoute`).
 */
class RoutesManager {
    constructor() {
        this._hooks = [];
        /** The route being drawn: { points, cursor }, or null. */
        this.draft = null;
        /** The route whose waypoints are being edited: { id, points, drag }, or null. */
        this.editing = null;
        this.window = null;
        this.show = readShow();
        this._container = null;
        this._queue = Promise.resolve();
        this._onPointerDown = this._onPointerDown.bind(this);
        this._onPointerUp = this._onPointerUp.bind(this);
        this._onPointerMove = this._onPointerMove.bind(this);
        this._onDoubleClick = this._onDoubleClick.bind(this);
        this._onContextMenu = this._onContextMenu.bind(this);
        this._onKeyDown = this._onKeyDown.bind(this);
    }

    initialize() {
        this._exposeApi();
        this._registerButtons();
        socketManager.registerToolHandlers('routes', {
            request: data => this._handleRequest(data)
        });
        const on = (name, fn) => this._hooks.push({ name, id: Hooks.on(name, fn) });
        on('canvasReady', () => {
            this._listen();
            this.draw();
        });
        on('canvasTearDown', () => {
            this.cancelDrawing();
            this.stopEditing();
            this._unlisten();
            this._container = null;
        });
        on('updateScene', (scene, changes) => {
            if (!foundry.utils.hasProperty(changes, `flags.${MODULE.ID}.${FLAG_KEY}`)) return;
            if (scene.id === canvas.scene?.id) {
                // A route being edited that someone deleted stops being edited.
                if (this.editing && !this.get(this.editing.id)) this.stopEditing();
                this.draw();
            }
            this.window?.render();
            Hooks.callAll(`${MODULE.ID}.routesChanged`, scene);
        });
        this._listen();
        this.draw();
    }

    /** `game.modules.get('coffee-pub-cartographer').api.routes` -- for macros and other modules. */
    _exposeApi() {
        const module = game.modules.get(MODULE.ID);
        if (!module) return;
        module.api ??= {};
        module.api.routes = {
            /** The routes on a scene (default: the one on the canvas) this user can see, with their lengths. */
            list: (sceneId) => {
                const scene = sceneId ? game.scenes.get(sceneId) : canvas.scene;
                return this.visibleRoutes(scene).map(route => ({ ...route, ...this.measure(route, scene) }));
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
        cartographerToolbar.registerTool(IDS.show, {
            icon: 'fa-solid fa-eye',
            tooltip: localize('barShow'),
            group: GROUP,
            order: 2,
            toggleable: true,
            active: () => this.show,
            onClick: () => this.setShow(!this.show)
        });
        cartographerToolbar.registerTool(IDS.window, {
            icon: 'fa-solid fa-list-ol',
            tooltip: localize('barWindow'),
            group: GROUP,
            order: 3,
            toggleable: false,
            onClick: () => this.openWindow()
        });
    }

    /** The bar's buttons, and the window, say what is going on. */
    _refreshButtons() {
        const api = game.modules.get('coffee-pub-blacksmith')?.api;
        api?.updateSecondaryBarItemActive?.(MODULE.ID, IDS.draw, !!this.draft);
        api?.updateSecondaryBarItemActive?.(MODULE.ID, IDS.show, this.show);
        if (this.window?.rendered) this.window.render();
    }

    /** Show routes on this screen, or not. Only this viewer's; nothing is saved to the scene. */
    setShow(show) {
        this.show = !!show;
        writeShow(this.show);
        this._refreshButtons();
        this.draw();
    }

    // ==================================================================
    // ===== STATE ======================================================
    // ==================================================================

    /** A scene's routes, all of them (default: the one on the canvas). */
    routes(scene = canvas.scene) {
        return foundry.utils.deepClone(scene?.getFlag(MODULE.ID, FLAG_KEY)?.list ?? []);
    }

    /** The routes this user sees: every route that is not hidden, and their own, and all of them for the GM. */
    visibleRoutes(scene = canvas.scene, user = game.user) {
        return this.routes(scene).filter(route => !route.hidden || this.canEdit(route, user));
    }

    get(id, scene = canvas.scene) {
        return this.routes(scene).find(route => route.id === id) ?? null;
    }

    /** A route's maker and the GM can change it. A route from before routes had makers is the GM's. */
    canEdit(route, user = game.user) {
        return !!user && (user.isGM || (!!route?.userId && route.userId === user.id));
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
        if (!route || !scene?.grid?.distance) return null;
        return pointAlong(route.points, distancePixels(Number(distance) || 0, scene.grid));
    }

    _nextName(list) {
        const base = game.i18n.localize(`${MODULE.ID}.routes.defaultName`);
        let n = list.length + 1;
        while (list.some(route => route.name === `${base} ${n}`)) n++;
        return `${base} ${n}`;
    }

    // ==================================================================
    // ===== CHANGES, THROUGH THE GM ====================================
    // ==================================================================

    async add({ name, points, color }) {
        return this._request({ action: 'create', route: { name, points, color } });
    }

    /** Rename, recolour, hide or show, or reshape a route. */
    async update(id, changes) {
        return this._request({ action: 'update', id, changes });
    }

    async remove(id) {
        return this._request({ action: 'remove', id });
    }

    /**
     * Make a change to this scene's routes. The GM makes it; anyone else asks
     * the active GM to. Without a GM online, a player's change cannot be saved.
     */
    async _request(change) {
        const data = { ...change, sceneId: canvas.scene?.id, userId: game.user.id };
        if (game.user.isGM) return this._apply(data, game.user);
        if (!game.users.activeGM) {
            ui.notifications.warn(game.i18n.localize(`${MODULE.ID}.routes.needsGM`));
            return null;
        }
        await socketManager.broadcast('routes', 'request', data);
        return null;
    }

    /** The active GM, on hearing a player's change. */
    _handleRequest(data) {
        if (!game.user.isGM || !game.users.activeGM?.isSelf) return;
        const user = game.users.get(data?.userId);
        if (!user?.active) return;
        void this._apply(data, user);
    }

    /**
     * Make a change on a user's behalf, if it is theirs to make. Changes are
     * made one at a time, each reading the list as the last left it, so two
     * players drawing at once do not overwrite each other.
     */
    _apply(data, user) {
        const run = async () => {
            const scene = game.scenes.get(data.sceneId);
            if (!scene) return null;
            const list = this.routes(scene);
            if (data.action === 'create') {
                const points = cleanPoints(data.route?.points);
                if (points.length < 2) return null;
                const route = {
                    id: foundry.utils.randomID(),
                    name: String(data.route.name ?? '').trim().slice(0, 100) || this._nextName(list),
                    color: ROUTE_COLORS.includes(data.route.color) ? data.route.color
                        : ROUTE_COLORS.find(c => !list.some(r => r.color === c)) ?? ROUTE_COLORS[list.length % ROUTE_COLORS.length],
                    points,
                    userId: user.id,
                    hidden: false
                };
                await scene.setFlag(MODULE.ID, FLAG_KEY, { list: [...list, route] });
                return route;
            }
            const route = list.find(r => r.id === data.id);
            if (!route || !this.canEdit(route, user)) return null;
            if (data.action === 'remove') {
                await scene.setFlag(MODULE.ID, FLAG_KEY, { list: list.filter(r => r.id !== data.id) });
                return null;
            }
            const changes = data.changes ?? {};
            if ('name' in changes) route.name = String(changes.name ?? '').trim().slice(0, 100) || route.name;
            if ('color' in changes && ROUTE_COLORS.includes(changes.color)) route.color = changes.color;
            if ('hidden' in changes) route.hidden = !!changes.hidden;
            if ('points' in changes) {
                const points = cleanPoints(changes.points);
                if (points.length >= 2) route.points = points;
            }
            await scene.setFlag(MODULE.ID, FLAG_KEY, { list });
            return route;
        };
        this._queue = this._queue.catch(() => {}).then(run);
        return this._queue;
    }

    // ==================================================================
    // ===== POINTER AND KEYS ===========================================
    // ==================================================================

    /**
     * The canvas listens all the time, in the capture phase, but only acts on
     * a route: while one is drawn, while one is edited, or for a double-click
     * on the line of a route the user may change. Anything else passes through
     * to Foundry untouched.
     */
    _listen() {
        const view = canvas?.app?.view;
        if (!view || this._listening === view) return;
        this._unlisten();
        view.addEventListener('pointerdown', this._onPointerDown, true);
        view.addEventListener('pointerup', this._onPointerUp, true);
        view.addEventListener('pointermove', this._onPointerMove, true);
        view.addEventListener('dblclick', this._onDoubleClick, true);
        view.addEventListener('contextmenu', this._onContextMenu, true);
        document.addEventListener('keydown', this._onKeyDown, true);
        this._listening = view;
    }

    _unlisten() {
        const view = this._listening;
        if (view) {
            view.removeEventListener('pointerdown', this._onPointerDown, true);
            view.removeEventListener('pointerup', this._onPointerUp, true);
            view.removeEventListener('pointermove', this._onPointerMove, true);
            view.removeEventListener('dblclick', this._onDoubleClick, true);
            view.removeEventListener('contextmenu', this._onContextMenu, true);
            view.style.cursor = '';
        }
        document.removeEventListener('keydown', this._onKeyDown, true);
        this._listening = null;
    }

    _scenePoint(event) {
        const rect = canvas.app.view.getBoundingClientRect();
        const point = canvas.app.stage.toLocal(new PIXI.Point(event.clientX - rect.left, event.clientY - rect.top));
        return Number.isFinite(point.x) && Number.isFinite(point.y) ? [point.x, point.y] : null;
    }

    /** The hit distance in scene pixels at the current zoom. */
    _hitRadius() {
        return HIT_PIXELS / (canvas.stage?.scale?.x || 1);
    }

    _swallow(event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }

    _onPointerDown(event) {
        if (this.draft) {
            // Only the left button places points; the others still pan and open menus.
            if (event.button !== 0) return;
            this._swallow(event);
            const point = this._scenePoint(event);
            if (point) this.draft.points.push(point);
            this.draw();
            return;
        }
        if (!this.editing) return;
        const point = this._scenePoint(event);
        const hit = point ? nearestWaypoint(this.editing.points, point) : null;
        if (!hit || hit.distance > this._hitRadius()) return;
        this._swallow(event);
        if (event.button === 2 || (event.button === 0 && event.altKey)) {
            this._removeWaypoint(hit.index);
            return;
        }
        if (event.button === 0) this.editing.drag = hit.index;
    }

    _onPointerUp(event) {
        if (this.draft) {
            if (event.button === 0) this._swallow(event);
            return;
        }
        if (this.editing?.drag !== null && this.editing?.drag !== undefined) {
            this._swallow(event);
            this.editing.drag = null;
            void this._saveEdit();
        }
    }

    _onPointerMove(event) {
        if (this.draft) {
            this.draft.cursor = this._scenePoint(event);
            this._drawDraft();
            return;
        }
        if (!this.editing) return;
        const point = this._scenePoint(event);
        if (!point) return;
        if (this.editing.drag !== null && this.editing.drag !== undefined) {
            this._swallow(event);
            this.editing.points[this.editing.drag] = point;
            this._drawEditing();
            return;
        }
        // A grab cursor over a waypoint says it can be dragged.
        const hit = nearestWaypoint(this.editing.points, point);
        canvas.app.view.style.cursor = hit && hit.distance <= this._hitRadius() ? 'grab' : '';
    }

    /** Right-clicking a waypoint removes it; that click is not Foundry's. */
    _onContextMenu(event) {
        if (this.draft) return;
        if (!this.editing) return;
        const point = this._scenePoint(event);
        const hit = point ? nearestWaypoint(this.editing.points, point) : null;
        if (hit && hit.distance <= this._hitRadius()) this._swallow(event);
    }

    /**
     * Finish a route being drawn; or on the line of a route the user may
     * change, add a waypoint there, starting to edit it if they were not.
     */
    _onDoubleClick(event) {
        if (this.draft) {
            this._swallow(event);
            void this.finishDrawing();
            return;
        }
        const point = this._scenePoint(event);
        if (!point || !this.show) return;
        const radius = this._hitRadius();
        const candidates = this.editing
            ? [{ id: this.editing.id, points: this.editing.points }]
            : this.visibleRoutes().filter(route => this.canEdit(route));
        let best = null;
        for (const route of candidates) {
            const hit = nearestOnRoute(route.points, point);
            if (hit && hit.distance <= radius && (!best || hit.distance < best.hit.distance)) best = { route, hit };
        }
        if (!best) return;
        this._swallow(event);
        // Not on top of a waypoint that is already there.
        const near = nearestWaypoint(best.route.points, best.hit.point);
        if (near.distance <= radius) {
            if (!this.editing) this.startEditing(best.route.id);
            return;
        }
        if (!this.editing || this.editing.id !== best.route.id) this.startEditing(best.route.id);
        this.editing.points.splice(best.hit.index + 1, 0, best.hit.point);
        this._drawEditing();
        void this._saveEdit();
    }

    /**
     * While drawing, Enter, Backspace and Escape belong to the route --
     * Backspace would otherwise delete whatever token is selected. While
     * editing, Enter and Escape stop. Unless someone is typing.
     */
    _onKeyDown(event) {
        if (!this.draft && !this.editing) return;
        if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        const keys = this.draft
            ? { Enter: () => this.finishDrawing(), Escape: () => this.cancelDrawing(), Backspace: () => this.removeLastPoint(), Delete: () => this.removeLastPoint() }
            : { Enter: () => this.stopEditing(), Escape: () => this.stopEditing() };
        const handled = keys[event.key];
        if (!handled) return;
        this._swallow(event);
        void handled();
    }

    // ==================================================================
    // ===== DRAWING A ROUTE ============================================
    // ==================================================================

    startDrawing() {
        if (!canvas?.ready || this.draft || !canvas.scene?.grid?.distance) return;
        this.stopEditing();
        this._listen();
        this.draft = { points: [], cursor: null };
        canvas.app.view.style.cursor = 'crosshair';
        ui.notifications.info(game.i18n.localize(`${MODULE.ID}.routes.drawHint`));
        this._refreshButtons();
        this.draw();
    }

    _endDrawing() {
        this.draft = null;
        if (canvas?.app?.view) canvas.app.view.style.cursor = '';
        this._refreshButtons();
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

    // ==================================================================
    // ===== EDITING WAYPOINTS ==========================================
    // ==================================================================

    startEditing(id) {
        const route = this.get(id);
        if (!route || !this.canEdit(route)) return;
        this.cancelDrawing();
        this._listen();
        this.editing = { id, points: route.points.map(point => [...point]), drag: null };
        if (!this._editHinted) {
            ui.notifications.info(game.i18n.localize(`${MODULE.ID}.routes.editHint`));
            this._editHinted = true;
        }
        this._refreshButtons();
        this.draw();
    }

    stopEditing() {
        if (!this.editing) return;
        this.editing = null;
        if (canvas?.app?.view) canvas.app.view.style.cursor = '';
        this._refreshButtons();
        this.draw();
    }

    toggleEditing(id) {
        if (this.editing?.id === id) this.stopEditing();
        else this.startEditing(id);
    }

    _removeWaypoint(index) {
        if (!this.editing || this.editing.points.length <= 2) return;
        this.editing.points.splice(index, 1);
        this._drawEditing();
        void this._saveEdit();
    }

    async _saveEdit() {
        if (!this.editing) return;
        await this.update(this.editing.id, { points: this.editing.points });
    }

    // ==================================================================
    // ===== ON THE CANVAS ==============================================
    // ==================================================================

    /**
     * The routes, drawn over the map, with the one being drawn or edited.
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
        // Turned off on this screen, routes are not drawn -- except one being edited.
        this._routes.visible = this.show || !!this.editing;
        const sizes = this._sizes();
        for (const route of this.visibleRoutes()) {
            if (!this.show && this.editing?.id !== route.id) continue;
            const points = this.editing?.id === route.id ? this.editing.points : route.points;
            if ((points?.length ?? 0) < 2) continue;
            // Hidden routes are only drawn for those who may change them, and faintly.
            const alpha = route.hidden ? 0.35 : 1;
            const color = Number.parseInt(String(route.color ?? ROUTE_COLORS[0]).replace('#', ''), 16);
            const editing = this.editing?.id === route.id;
            this._routes.addChild(this._line(points, color, sizes, alpha, editing));
            const distance = gridDistance(routePixels(points), canvas.scene.grid);
            const middle = pointAlong(points, routePixels(points) / 2);
            const label = this._label(`${route.name} · ${formatDistance(distance, canvas.scene.grid.units)}`, middle, sizes);
            label.alpha = alpha;
            this._routes.addChild(label);
        }
        this._drawDraft();
    }

    _drawEditing() {
        this.draw();
    }

    _line(points, color, sizes, alpha = 1, editing = false) {
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
            // Being edited, every waypoint is a handle: larger, and ringed in the route's colour.
            const radius = editing ? sizes.dot * 2 : end ? sizes.dot * 1.6 : sizes.dot;
            graphics.beginFill(0x111111, 0.55 * alpha).drawCircle(x, y, radius + 1.5).endFill();
            if (editing) {
                graphics.beginFill(color, alpha).drawCircle(x, y, radius).endFill();
                graphics.beginFill(0xffffff, alpha).drawCircle(x, y, radius * 0.55).endFill();
            } else {
                graphics.beginFill(end ? 0xffffff : color, alpha).drawCircle(x, y, radius).endFill();
            }
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
        this._draftLayer.addChild(this._line(points.length > 1 ? points : [points[0], points[0]], color, sizes, 0.8));
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

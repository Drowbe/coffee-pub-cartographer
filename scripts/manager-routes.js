// ==================================================================
// ===== ROUTES =====================================================
// ==================================================================

import { MODULE } from './const.js';
import { cartographerToolbar } from './manager-toolbar.js';
import { socketManager } from './manager-sockets.js';
import {
    cleanPoints, legPixels, routePixels, gridDistance, distancePixels, pointAlong, convertDistance,
    nearestWaypoint, nearestOnRoute, legTerrains, terrainFactor, insertWaypoint, removeWaypoint,
    snapTo, chainRoutes, TERRAINS, pathLegs, totalEffort, distanceForEffort, legIndexAt,
    defaultPathTravel, travelEffort, DEFAULT_HOURS_PER_DAY, timelineWith, timelineRate
} from './utils-routes.js';
import { motionSpeed } from './utils-motion.js';
import { formatDistance } from './utils-travel.js';

/** Scene flag holding `{ list, journeys }`. */
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
/** How near, in screen pixels, a waypoint must come to another route's end to snap onto it. */
const SNAP_PIXELS = 18;
/** Two routes whose ends are this close, in scene pixels, meet: a snapped join is exact, this allows for rounding. */
const JOIN_TOLERANCE = 2;

/** Just the route or journey a link names, without its scene. */
function pathRef(link) {
    return link?.journeyId ? { journeyId: link.journeyId } : { routeId: link?.routeId };
}

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
 * A route is `{ id, name, color, points, terrain, userId, hidden }`, with
 * points as [[x, y], ...] in scene pixels and terrain as one id per leg
 * (see TERRAINS in utils-routes.js), saved in the scene's `routes` flag. Its
 * length is the true length of the line on the scene's grid, square or hex;
 * its time at a pace is slowed, leg by leg, by difficult terrain.
 *
 * A journey is `{ id, name, routeIds, userId }`: routes in order, each run in
 * whichever direction joins it to the last (see chainRoutes). Routes join
 * when one's end is snapped to another's -- drawing or dragging a waypoint
 * near another route's end puts it exactly there -- but a join is not
 * required: a gap is crossed in a straight line and shown.
 *
 * Anyone can draw a route or make a journey; the maker and the GM can change
 * it. Only the GM writes the scene, so a player's change is sent to the
 * active GM, who checks it is theirs to make and saves it -- the way
 * mapping's changes travel. A hidden route is drawn only for its maker and
 * the GM, faintly; anyone can also turn routes off on their own screen.
 *
 * Drawing is click by click: each click places a waypoint and the distance
 * so far follows the pointer; a double-click or Enter finishes, Backspace
 * takes back the last point, and Escape gives up. Right-drag still pans.
 *
 * Editing: double-click your own route's line to add a waypoint there, which
 * also starts editing it. While editing, click a waypoint to select it and
 * drag to move it; Delete removes the selected one, as does right-click or
 * Alt-click on any; Enter or Escape stops.
 *
 * Scene motion's odometer can follow a route or a journey on another scene:
 * its length is the destination (see manager-travel.js, `_syncRoute`).
 */
class RoutesManager {
    constructor() {
        this._hooks = [];
        /** The route being drawn: { points, cursor }, or null. */
        this.draft = null;
        /** The route whose waypoints are being edited: { id, points, terrain, drag, selected }, or null. */
        this.editing = null;
        /** Where the pointer has snapped to another route's end, for the ring that shows it. */
        this._snapped = null;
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
        // When the world time last changed here, for carrying it on smoothly between updates.
        this._hooks.push({ name: 'updateWorldTime', id: Hooks.on('updateWorldTime', () => { this._worldSeenAt = performance.now(); }) });
        // Which routes are drawn depends on what is moving, which the world
        // time changes without any write: a scrub, an arrival. Checked a few
        // times a second, redrawn only when it changes.
        this._movingSignature = '';
        setInterval(() => {
            if (!canvas?.ready) return;
            const ids = this.travellingRouteIds();
            const signature = ids ? [...ids].sort().join() : '';
            if (signature === this._movingSignature) return;
            this._movingSignature = signature;
            this.draw();
        }, 300);
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
            /** The journeys on a scene, with their lengths and any gaps. */
            journeys: (sceneId) => {
                const scene = sceneId ? game.scenes.get(sceneId) : canvas.scene;
                return this.journeys(scene).map(journey => {
                    const path = this.path({ journeyId: journey.id }, scene);
                    return { ...journey, ...this.measure(path, scene), gaps: path.gaps.length };
                });
            },
            /** Where a distance (in that scene's units) along a route or journey reaches, in scene pixels. */
            pointAt: (id, distance, sceneId) => this.pointAt(id, distance, sceneId),
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

    /** A map's travel plan, { hoursPerDay }, and the route or journey its Play button runs, { active }. */
    settings(scene = canvas.scene) {
        const stored = scene?.getFlag(MODULE.ID, FLAG_KEY)?.settings ?? {};
        const hours = Number(stored.hoursPerDay);
        const active = stored.active?.journeyId && this.getJourney(stored.active.journeyId, scene) ? { journeyId: stored.active.journeyId }
            : stored.active?.routeId && this.get(stored.active.routeId, scene) ? { routeId: stored.active.routeId }
            : null;
        // Whether the map's routes and journeys follow the world clock: one setting for
        // the map, since there is one party and one clock.
        return {
            hoursPerDay: hours > 0 && hours <= 24 ? hours : DEFAULT_HOURS_PER_DAY,
            active,
            followClock: !!stored.followClock,
            // The party has been set down off every route: nothing to travel until it is put on one.
            offRoute: !!stored.offRoute
        };
    }

    /** Change the map's travel plan. The GM's; it is the same plan for everyone. */
    /** Change a map's settings (default: the map on the canvas). GM only. */
    async setSettings(changes, sceneId = canvas.scene?.id) {
        if (!game.user.isGM) return null;
        return this._apply({ action: 'settings', sceneId, changes }, game.user);
    }

    /**
     * The route or journey a map shows -- in its bar, its odometer and its
     * party marker: whichever is moving, from the map or from an animated
     * scene following it (the map's active one first, if it is); when
     * nothing is, the active one, the last played there. Null if neither.
     */
    shownPath(scene = canvas.scene) {
        if (!scene) return null;
        const active = this.settings(scene).active;
        const activeLink = active ? { sceneId: scene.id, ...active } : null;
        // Under way: going, not easing to a stop after one. Following the clock,
        // the timeline says; otherwise Play does.
        const underWay = link => {
            const progress = this.progress(link);
            return !!progress?.moving && (progress.travel.followClock || progress.travel.motion.playing);
        };
        if (activeLink && underWay(activeLink)) return activeLink;
        const links = [
            ...this.journeys(scene).filter(j => j.travel).map(j => ({ sceneId: scene.id, journeyId: j.id })),
            ...this.routes(scene).filter(r => r.travel).map(r => ({ sceneId: scene.id, routeId: r.id }))
        ];
        // Set down off every route, the party is on none until something moves it.
        return links.find(underWay) ?? (this.settings(scene).offRoute ? null : activeLink);
    }

    /**
     * Make a route or journey the one its map shows -- its bar, odometer and
     * party marker -- and stop any other moving there: there is one party.
     * For a route or journey set going from somewhere other than its map's
     * own bar, such as an animated scene following it. GM only.
     */
    async claimActive(link) {
        if (!game.user.isGM || !link?.sceneId) return;
        const scene = game.scenes.get(link.sceneId);
        if (!scene) return;
        const same = other => (link.journeyId ? other.journeyId === link.journeyId : (!other.journeyId && other.routeId === link.routeId));
        const active = this.settings(scene).active;
        if (!active || !same(active)) await this.setSettings({ active: link.journeyId ? { journeyId: link.journeyId } : { routeId: link.routeId } }, scene.id);
        const others = [
            ...this.journeys(scene).filter(j => j.travel?.motion?.playing).map(j => ({ sceneId: scene.id, journeyId: j.id })),
            ...this.routes(scene).filter(r => r.travel?.motion?.playing).map(r => ({ sceneId: scene.id, routeId: r.id }))
        ].filter(other => !same(other));
        for (const other of others) await this.setPathTravel(other, { playing: false });
    }

    /**
     * The routes a moving route or journey on this map is travelling: while
     * one is under way, only those are drawn. Null when nothing is moving.
     */
    travellingRouteIds(scene = canvas.scene) {
        if (!scene) return null;
        const ids = new Set();
        let moving = false;
        for (const route of this.routes(scene)) {
            if (!route.travel || !this.progress({ sceneId: scene.id, routeId: route.id })?.moving) continue;
            moving = true;
            ids.add(route.id);
        }
        for (const journey of this.journeys(scene)) {
            if (!journey.travel || !this.progress({ sceneId: scene.id, journeyId: journey.id })?.moving) continue;
            moving = true;
            for (const id of journey.routeIds) ids.add(id);
        }
        return moving ? ids : null;
    }

    /** A scene's journeys. */
    journeys(scene = canvas.scene) {
        return foundry.utils.deepClone(scene?.getFlag(MODULE.ID, FLAG_KEY)?.journeys ?? []);
    }

    /** The routes this user sees: every route that is not hidden, and their own, and all of them for the GM. */
    visibleRoutes(scene = canvas.scene, user = game.user) {
        return this.routes(scene).filter(route => !route.hidden || this.canEdit(route, user));
    }

    get(id, scene = canvas.scene) {
        return this.routes(scene).find(route => route.id === id) ?? null;
    }

    getJourney(id, scene = canvas.scene) {
        return this.journeys(scene).find(journey => journey.id === id) ?? null;
    }

    /** A route's or journey's maker and the GM can change it. One from before they had makers is the GM's. */
    canEdit(item, user = game.user) {
        return !!user && (user.isGM || (!!item?.userId && item.userId === user.id));
    }

    /**
     * A route or a journey as one line to travel: { name, points, terrain,
     * gaps }. `ref` is { routeId } or { journeyId }. A journey's routes are
     * chained end to end; its gaps are where two do not meet.
     */
    path(ref, scene = canvas.scene) {
        if (ref?.routeId) {
            const route = this.get(ref.routeId, scene);
            if (!route) return null;
            return { name: route.name, points: route.points, terrain: legTerrains(route.points, route.terrain), gaps: [] };
        }
        if (ref?.journeyId) {
            const journey = this.getJourney(ref.journeyId, scene);
            if (!journey) return null;
            const routes = this.routes(scene);
            const chain = chainRoutes(journey.routeIds.map(id => routes.find(r => r.id === id)).filter(Boolean), JOIN_TOLERANCE);
            return { name: journey.name, points: chain.points, terrain: chain.terrain, gaps: chain.gaps };
        }
        return null;
    }

    /**
     * A route's or path's length on its scene's grid: { pixels, distance,
     * units, legs }, with distances in the scene's units and legs as each
     * leg's distance.
     */
    measure(item, scene = canvas.scene) {
        const grid = scene?.grid;
        const points = item?.points ?? [];
        return {
            pixels: routePixels(points),
            distance: gridDistance(routePixels(points), grid),
            units: grid?.units ?? '',
            legs: legPixels(points).map(pixels => gridDistance(pixels, grid))
        };
    }

    /** Every scene with routes, and its routes and journeys, for choosing one to follow. */
    allRoutes() {
        return game.scenes.contents
            .map(scene => ({ scene, routes: this.routes(scene), journeys: this.journeys(scene) }))
            .filter(entry => entry.routes.length);
    }

    /**
     * A route or journey an odometer follows (`{ sceneId, routeId }` or
     * `{ sceneId, journeyId }`), with its length both in its own scene's
     * units and converted to `units` -- the odometer's scene's. `converted`
     * is null when the two cannot be compared (hexes and feet). Null when it
     * is gone.
     */
    linked(link, units) {
        const scene = link?.sceneId ? game.scenes.get(link.sceneId) : null;
        const path = scene ? this.path(link, scene) : null;
        if (!path) return null;
        const { distance, units: own } = this.measure(path, scene);
        return { path, scene, name: path.name, distance, units: own, converted: convertDistance(distance, own, units) };
    }

    // ==================================================================
    // ===== PROGRESS ===================================================
    // ==================================================================

    /** The route or journey a link names, as stored: the record that holds its travel. */
    _pathItem(link, scene) {
        if (link?.journeyId) return this.getJourney(link.journeyId, scene);
        if (link?.routeId) return this.get(link.routeId, scene);
        return null;
    }

    /**
     * Where the party is on a route or journey at `now`: its travel, as
     * stored on the path, worked out into distance, the leg and its terrain,
     * and the point on the map. Progress lives here, with the path on the
     * map; an animated scene that shows the journey reads it.
     *
     * Returns { scene, path, legs, travel, effort, totalEffort, distance,
     * length, leg, factor, terrain, point } in the map's units, or null.
     */
    /**
     * The world time now, carried on between the world clock's updates at its
     * rate while it runs, so a marker following the clock moves smoothly
     * rather than stepping at each update. A few seconds at most: past that,
     * the clock has stalled and the stored time is the truth.
     */
    worldTime() {
        const base = Number(game.time?.worldTime) || 0;
        const clock = game.modules.get('coffee-pub-blacksmith')?.api?.worldClock;
        if (!clock?.running || !(Number(clock.rate) > 0) || this._worldSeenAt === undefined) return base;
        const elapsed = Math.min(10, Math.max(0, (performance.now() - this._worldSeenAt) / 1000));
        return base + Number(clock.rate) * elapsed;
    }

    progress(link, now = game.time.serverTime, world = this.worldTime()) {
        const scene = link?.sceneId ? game.scenes.get(link.sceneId) : null;
        const item = scene ? this._pathItem(link, scene) : null;
        const path = item ? this.path(link, scene) : null;
        if (!path || !scene.grid?.distance) return null;
        const legs = pathLegs(path.points, path.terrain, scene.grid);
        const travel = { ...defaultPathTravel(), ...(item.travel ?? {}) };
        travel.motion = { ...defaultPathTravel().motion, ...(item.travel?.motion ?? {}) };
        const total = totalEffort(legs);
        const effort = Math.min(total, Math.max(0, travelEffort(travel, now, world)));
        const distance = distanceForEffort(legs, effort);
        // Whether the party is moving at this moment: following the clock, read
        // from the timeline at this world time, so a scrub to a time they were
        // travelling shows them travelling; otherwise from the motion, easing
        // included. Never past the end they are heading for.
        const rate = travel.followClock && travel.timeline?.length
            ? timelineRate(travel.timeline, world)
            : (travel.motion.playing ? Number(travel.motion.masterSpeed) || 0 : motionSpeed(travel.motion, now));
        const moving = rate > 0 ? effort < total : rate < 0 ? effort > 0 : false;
        const leg = legIndexAt(legs, distance);
        return {
            scene,
            path,
            legs,
            travel,
            effort,
            totalEffort: total,
            distance,
            length: legs.reduce((sum, l) => sum + l.distance, 0),
            leg,
            moving,
            factor: legs[leg]?.factor ?? 1,
            terrain: path.terrain[leg] ?? null,
            point: pointAlong(path.points, distancePixels(distance, scene.grid))
        };
    }

    /**
     * Change a path's travel, GM only: fold the effort so far into it (within
     * the path's ends, so running back from past the end starts back at once),
     * re-anchor the motion at `now` so a change of speed eases from the speed
     * in effect, then apply `changes` -- any of playing, masterSpeed,
     * easeSeconds, clockFactor (on the motion) and effort, pace, arrived.
     */
    async setPathTravel(link, changes, now = game.time.serverTime) {
        if (!game.user.isGM || !link?.sceneId) return null;
        return this._apply({ action: 'travel', sceneId: link.sceneId, link, changes, now, world: this.worldTime() }, game.user);
    }

    /** Where a distance in the scene's units along a route or journey reaches: { x, y, angle } in pixels. */
    pointAt(id, distance, sceneId) {
        const scene = sceneId ? game.scenes.get(sceneId) : canvas.scene;
        const path = this.path({ routeId: id }, scene) ?? this.path({ journeyId: id }, scene);
        if (!path || !scene?.grid?.distance) return null;
        return pointAlong(path.points, distancePixels(Number(distance) || 0, scene.grid));
    }

    _nextName(list, key = 'defaultName') {
        const base = game.i18n.localize(`${MODULE.ID}.routes.${key}`);
        let n = list.length + 1;
        while (list.some(item => item.name === `${base} ${n}`)) n++;
        return `${base} ${n}`;
    }

    // ==================================================================
    // ===== CHANGES, THROUGH THE GM ====================================
    // ==================================================================

    async add({ name, points, color }) {
        return this._request({ action: 'create', route: { name, points, color } });
    }

    /** Rename, recolour, hide or show, reshape, or set the terrain of a route. */
    async update(id, changes) {
        return this._request({ action: 'update', id, changes });
    }

    async remove(id) {
        return this._request({ action: 'remove', id });
    }

    async addJourney({ name, routeIds = [] }) {
        return this._request({ action: 'journey-create', journey: { name, routeIds } });
    }

    /** Rename a journey, or change its routes and their order. */
    async updateJourney(id, changes) {
        return this._request({ action: 'journey-update', id, changes });
    }

    async removeJourney(id) {
        return this._request({ action: 'journey-remove', id });
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
     * made one at a time, each reading the scene as the last left it, so two
     * players drawing at once do not overwrite each other.
     */
    _apply(data, user) {
        const run = async () => {
            const scene = game.scenes.get(data.sceneId);
            if (!scene) return null;
            const list = this.routes(scene);
            let journeys = this.journeys(scene);
            // The map's settings ride along unchanged, so no write can lose them.
            const settings = scene.getFlag(MODULE.ID, FLAG_KEY)?.settings;
            const save = () => scene.setFlag(MODULE.ID, FLAG_KEY, { list, journeys, ...(settings ? { settings } : {}) });
            const name = (value, fallback) => String(value ?? '').trim().slice(0, 100) || fallback;

            if (data.action === 'create') {
                const points = cleanPoints(data.route?.points);
                if (points.length < 2) return null;
                const route = {
                    id: foundry.utils.randomID(),
                    name: name(data.route.name, this._nextName(list)),
                    color: ROUTE_COLORS.includes(data.route.color) ? data.route.color
                        : ROUTE_COLORS.find(c => !list.some(r => r.color === c)) ?? ROUTE_COLORS[list.length % ROUTE_COLORS.length],
                    points,
                    terrain: legTerrains(points, data.route.terrain),
                    userId: user.id,
                    hidden: false
                };
                list.push(route);
                await save();
                return route;
            }

            if (data.action === 'settings') {
                if (!user.isGM) return null;
                const stored = scene.getFlag(MODULE.ID, FLAG_KEY)?.settings ?? {};
                const hours = Number(data.changes?.hoursPerDay);
                const settings = { ...stored, ...(hours > 0 && hours <= 24 ? { hoursPerDay: Math.round(hours * 4) / 4 } : {}) };
                if ('followClock' in (data.changes ?? {})) settings.followClock = !!data.changes.followClock;
                // The party set down somewhere on the map that is on no route.
                if ('offRoute' in (data.changes ?? {})) settings.offRoute = !!data.changes.offRoute;
                // Choosing what the map runs puts the party back on it.
                if ('active' in (data.changes ?? {}) && data.changes.active && !('offRoute' in data.changes)) settings.offRoute = false;
                // The route or journey the map's bar and Play button run: the last one played here.
                if ('active' in (data.changes ?? {})) {
                    const active = data.changes.active;
                    settings.active = active?.journeyId && journeys.some(j => j.id === active.journeyId) ? { journeyId: active.journeyId }
                        : active?.routeId && list.some(r => r.id === active.routeId) ? { routeId: active.routeId }
                        : null;
                }
                await scene.setFlag(MODULE.ID, FLAG_KEY, { list, journeys, settings });
                return settings;
            }

            if (data.action === 'travel') {
                if (!user.isGM) return null;
                const item = data.link?.journeyId ? journeys.find(j => j.id === data.link.journeyId) : list.find(r => r.id === data.link?.routeId);
                if (!item) return null;
                const travel = { ...defaultPathTravel(), ...(item.travel ?? {}) };
                travel.motion = { ...defaultPathTravel().motion, ...(item.travel?.motion ?? {}) };
                // A path setting out for the first time follows the clock if its map does.
                if (!item.travel) travel.followClock = !!settings?.followClock;
                const now = Number(data.now) || game.time.serverTime;
                const world = Number.isFinite(Number(data.world)) ? Number(data.world) : this.worldTime();
                const path = this.path(data.link, scene);
                const total = path ? totalEffort(pathLegs(path.points, path.terrain, scene.grid)) : 0;
                travel.effort = Math.min(total, Math.max(0, travelEffort(travel, now, world)));
                travel.motion.rampFrom = motionSpeed(travel.motion, now);
                travel.motion.anchorAt = now;
                const changes = data.changes ?? {};
                for (const key of ['playing', 'masterSpeed', 'easeSeconds', 'clockFactor']) {
                    if (key in changes) travel.motion[key] = key === 'playing' ? !!changes[key] : Number(changes[key]) || 0;
                }
                if ('effort' in changes) travel.effort = Math.min(total, Math.max(0, Number(changes.effort) || 0));
                if ('pace' in changes) travel.pace = Math.max(0, Number(changes.pace) || 0);
                if ('arrived' in changes) travel.arrived = !!changes.arrived;
                if ('followClock' in changes) travel.followClock = !!changes.followClock;
                // Following the clock, the change goes on the timeline at this world
                // time, replacing whatever a scrub back had left after it.
                travel.timeline = travel.followClock
                    ? timelineWith(travel.timeline, {
                        w: world,
                        effort: travel.effort,
                        // Following the clock, the clock is the time: the party goes at its pace,
                        // onward or back, and the master speed gives only the direction.
                        rate: travel.motion.playing ? (travel.pace / 3600) * Math.sign(Number(travel.motion.masterSpeed) || 0) : 0
                    })
                    : [];
                item.travel = travel;
                await save();
                // For the journey's marker on the map (manager-travelpins.js), on the GM's client.
                Hooks.callAll(`${MODULE.ID}.pathTravelChanged`, { link: { sceneId: scene.id, ...pathRef(data.link) }, travel });
                return travel;
            }

            if (data.action === 'journey-create') {
                const journey = {
                    id: foundry.utils.randomID(),
                    name: name(data.journey?.name, this._nextName(journeys, 'defaultJourney')),
                    routeIds: (data.journey?.routeIds ?? []).filter(id => list.some(r => r.id === id)),
                    userId: user.id
                };
                journeys.push(journey);
                await save();
                return journey;
            }

            if (data.action.startsWith('journey-')) {
                const journey = journeys.find(j => j.id === data.id);
                if (!journey || !this.canEdit(journey, user)) return null;
                if (data.action === 'journey-remove') {
                    journeys = journeys.filter(j => j.id !== data.id);
                    await save();
                    Hooks.callAll(`${MODULE.ID}.pathRemoved`, { sceneId: scene.id, journeyId: data.id });
                    return null;
                }
                const changes = data.changes ?? {};
                if ('name' in changes) journey.name = name(changes.name, journey.name);
                // Any route on the map may be part of anyone's journey; a journey only reads it.
                if (Array.isArray(changes.routeIds)) journey.routeIds = changes.routeIds.filter(id => list.some(r => r.id === id));
                await save();
                return journey;
            }

            const route = list.find(r => r.id === data.id);
            if (!route || !this.canEdit(route, user)) return null;
            if (data.action === 'remove') {
                const at = list.indexOf(route);
                list.splice(at, 1);
                for (const journey of journeys) journey.routeIds = journey.routeIds.filter(id => id !== data.id);
                await save();
                Hooks.callAll(`${MODULE.ID}.pathRemoved`, { sceneId: scene.id, routeId: data.id });
                return null;
            }
            const changes = data.changes ?? {};
            if ('name' in changes) route.name = name(changes.name, route.name);
            // Any colour, as #rrggbb: what a colour picker gives, and nothing else gets in.
            if ('color' in changes && /^#[0-9a-f]{6}$/i.test(String(changes.color))) route.color = String(changes.color).toLowerCase();
            if ('hidden' in changes) route.hidden = !!changes.hidden;
            if ('points' in changes) {
                const points = cleanPoints(changes.points);
                if (points.length >= 2) route.points = points;
            }
            // Terrain is one per leg; it follows the points when both change together.
            if ('terrain' in changes || 'points' in changes) {
                route.terrain = legTerrains(route.points, 'terrain' in changes ? changes.terrain : route.terrain);
            }
            await save();
            return route;
        };
        this._queue = this._queue.catch(() => {}).then(run);
        return this._queue;
    }

    /** One leg's terrain, or every leg's when `leg` is null. */
    async setTerrain(id, leg, terrain) {
        const route = this.get(id);
        if (!route || !TERRAINS.some(t => t.id === terrain)) return;
        const legs = legTerrains(route.points, route.terrain);
        const next = leg === null || leg === undefined ? legs.map(() => terrain) : legs.map((t, i) => (i === Number(leg) ? terrain : t));
        if (this.editing?.id === id) this.editing.terrain = next;
        await this.update(id, { terrain: next });
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

    /** A screen distance in scene pixels at the current zoom. */
    _toScene(screenPixels) {
        return screenPixels / (canvas.stage?.scale?.x || 1);
    }

    _hitRadius() {
        return this._toScene(HIT_PIXELS);
    }

    /**
     * A point, moved onto another route's end if it is near one, so routes
     * can be joined into a journey exactly. Ends of the route being edited
     * are not targets for its own waypoints.
     */
    _snap(point, exceptId = null) {
        if (!point) return point;
        const ends = this.visibleRoutes()
            .filter(route => route.id !== exceptId && route.points?.length >= 2)
            .flatMap(route => [route.points[0], route.points.at(-1)]);
        const snapped = snapTo(point, ends, this._toScene(SNAP_PIXELS));
        this._snapped = snapped;
        return snapped ?? point;
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
            const point = this._snap(this._scenePoint(event));
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
        if (event.button === 0) {
            this.editing.selected = hit.index;
            this.editing.drag = hit.index;
            this.draw();
        }
    }

    _onPointerUp(event) {
        if (this.draft) {
            if (event.button === 0) this._swallow(event);
            return;
        }
        if (this.editing?.drag !== null && this.editing?.drag !== undefined) {
            this._swallow(event);
            const moved = this.editing.moved;
            this.editing.drag = null;
            this.editing.moved = false;
            this._snapped = null;
            if (moved) void this._saveEdit();
            this.draw();
        }
    }

    _onPointerMove(event) {
        if (this.draft) {
            this.draft.cursor = this._snap(this._scenePoint(event));
            this._drawDraft();
            return;
        }
        if (!this.editing) return;
        const point = this._scenePoint(event);
        if (!point) return;
        if (this.editing.drag !== null && this.editing.drag !== undefined) {
            this._swallow(event);
            this.editing.points[this.editing.drag] = this._snap(point, this.editing.id);
            this.editing.moved = true;
            this.draw();
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
        if (!this.editing || this.editing.id !== best.route.id) this.startEditing(best.route.id);
        // On top of a waypoint that is already there, just select it.
        const near = nearestWaypoint(this.editing.points, best.hit.point);
        if (near.distance <= radius) {
            this.editing.selected = near.index;
            this.draw();
            return;
        }
        const next = insertWaypoint(this.editing.points, this.editing.terrain, best.hit.index, best.hit.point);
        this.editing.points = next.points;
        this.editing.terrain = next.terrain;
        this.editing.selected = best.hit.index + 1;
        this.draw();
        void this._saveEdit();
    }

    /**
     * While drawing, Enter, Backspace and Escape belong to the route --
     * Backspace would otherwise delete whatever token is selected. While
     * editing, Delete or Backspace removes the selected waypoint, and Enter
     * and Escape stop. Unless someone is typing.
     */
    _onKeyDown(event) {
        if (!this.draft && !this.editing) return;
        if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
        const removeSelected = () => {
            if (Number.isInteger(this.editing?.selected)) this._removeWaypoint(this.editing.selected);
        };
        const keys = this.draft
            ? { Enter: () => this.finishDrawing(), Escape: () => this.cancelDrawing(), Backspace: () => this.removeLastPoint(), Delete: () => this.removeLastPoint() }
            : { Enter: () => this.stopEditing(), Escape: () => this.stopEditing(), Delete: removeSelected, Backspace: removeSelected };
        const handled = keys[event.key];
        if (!handled) return;
        this._swallow(event);
        void handled();
    }

    // ==================================================================
    // ===== DRAWING A ROUTE ============================================
    // ==================================================================

    /** Start drawing a route, from a point if given: where the party stands, say. */
    startDrawing(from = null) {
        if (!canvas?.ready || this.draft || !canvas.scene?.grid?.distance) return;
        this.stopEditing();
        this._listen();
        this.draft = { points: from ? [[from.x, from.y]] : [], cursor: null };
        canvas.app.view.style.cursor = 'crosshair';
        ui.notifications.info(game.i18n.localize(`${MODULE.ID}.routes.drawHint`));
        this._refreshButtons();
        this.draw();
    }

    _endDrawing() {
        this.draft = null;
        this._snapped = null;
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
        this.editing = {
            id,
            points: route.points.map(point => [...point]),
            terrain: legTerrains(route.points, route.terrain),
            drag: null,
            moved: false,
            selected: null
        };
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
        this._snapped = null;
        if (canvas?.app?.view) canvas.app.view.style.cursor = '';
        this._refreshButtons();
        this.draw();
    }

    toggleEditing(id) {
        if (this.editing?.id === id) this.stopEditing();
        else this.startEditing(id);
    }

    /** Remove a waypoint of the route being edited. A route keeps at least two. */
    _removeWaypoint(index) {
        if (!this.editing || this.editing.points.length <= 2) return;
        const next = removeWaypoint(this.editing.points, this.editing.terrain, index);
        this.editing.points = next.points;
        this.editing.terrain = next.terrain;
        this.editing.selected = null;
        this.draw();
        void this._saveEdit();
    }

    async _saveEdit() {
        if (!this.editing) return;
        await this.update(this.editing.id, { points: this.editing.points, terrain: this.editing.terrain });
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
        // While a route or journey is under way, only the routes it travels are drawn.
        const travelling = this.editing || this.draft ? null : this.travellingRouteIds();
        for (const route of this.visibleRoutes()) {
            if (!this.show && this.editing?.id !== route.id) continue;
            if (travelling && !travelling.has(route.id)) continue;
            const editing = this.editing?.id === route.id;
            const points = editing ? this.editing.points : route.points;
            if ((points?.length ?? 0) < 2) continue;
            const terrain = editing ? this.editing.terrain : legTerrains(points, route.terrain);
            // Hidden routes are only drawn for those who may change them, and faintly.
            const alpha = route.hidden ? 0.35 : 1;
            const color = Number.parseInt(String(route.color ?? ROUTE_COLORS[0]).replace('#', ''), 16);
            this._routes.addChild(this._line(points, color, sizes, { alpha, terrain, editing, selected: editing ? this.editing.selected : null, ring: editing }));
            const distance = gridDistance(routePixels(points), canvas.scene.grid);
            const middle = pointAlong(points, routePixels(points) / 2);
            const label = this._label(`${route.name} · ${formatDistance(distance, canvas.scene.grid.units)}`, middle, sizes);
            label.alpha = alpha;
            this._routes.addChild(label);
        }
        this._drawDraft();
    }

    /** A dashed segment, for a leg across difficult terrain. */
    _dash(graphics, [ax, ay], [bx, by], length) {
        const total = Math.hypot(bx - ax, by - ay);
        if (!total) return;
        const ux = (bx - ax) / total;
        const uy = (by - ay) / total;
        for (let at = 0; at < total; at += length * 2) {
            const end = Math.min(total, at + length);
            graphics.moveTo(ax + ux * at, ay + uy * at);
            graphics.lineTo(ax + ux * end, ay + uy * end);
        }
    }

    /**
     * A route's line. Legs over difficult terrain are dashed. Being edited,
     * every waypoint is a handle -- larger, ringed in the route's colour --
     * and the selected one is filled.
     */
    _line(points, color, sizes, { alpha = 1, terrain = [], editing = false, selected = null, ring = false } = {}) {
        const graphics = new PIXI.Graphics();
        const dash = sizes.line * 2.5;
        // A dark edge under the colour, so the line reads on light and dark maps.
        for (const [width, tint, a] of [[sizes.line + 3, 0x111111, 0.55 * alpha], [sizes.line, color, alpha]]) {
            graphics.lineStyle({ width, color: tint, alpha: a, cap: 'round', join: 'round' });
            for (let i = 1; i < points.length; i++) {
                if (terrainFactor(terrain[i - 1]) < 1) this._dash(graphics, points[i - 1], points[i], dash);
                else {
                    graphics.moveTo(points[i - 1][0], points[i - 1][1]);
                    graphics.lineTo(points[i][0], points[i][1]);
                }
            }
        }
        graphics.lineStyle(0);
        // Waypoints are handles: drawn while a route is edited or drawn, not on a route at rest.
        const showPoints = editing || ring;
        points.forEach(([x, y], index) => {
            if (!showPoints) return;
            const end = index === 0 || index === points.length - 1;
            const radius = editing ? sizes.dot * 2 : end ? sizes.dot * 1.6 : sizes.dot;
            graphics.beginFill(0x111111, 0.55 * alpha).drawCircle(x, y, radius + 1.5).endFill();
            if (editing) {
                graphics.beginFill(color, alpha).drawCircle(x, y, radius).endFill();
                graphics.beginFill(index === selected ? color : 0xffffff, alpha).drawCircle(x, y, radius * 0.55).endFill();
                if (index === selected) {
                    graphics.lineStyle({ width: 2, color: 0xffffff, alpha });
                    graphics.drawCircle(x, y, radius + 4);
                    graphics.lineStyle(0);
                }
            } else {
                graphics.beginFill(end ? 0xffffff : color, alpha).drawCircle(x, y, radius).endFill();
            }
        });
        // The end a dragged or drawn point has snapped to.
        if (ring && this._snapped) {
            graphics.lineStyle({ width: 3, color: 0xffffff, alpha: 0.9 });
            graphics.drawCircle(this._snapped[0], this._snapped[1], sizes.dot * 3);
            graphics.lineStyle(0);
        }
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
        if (!draft) return;
        const sizes = this._sizes();
        if (!draft.points.length) {
            // Before the first click, show where it would snap.
            if (this._snapped) this._draftLayer.addChild(this._line([this._snapped, this._snapped], 0xffffff, sizes, { alpha: 0.8, ring: true }));
            return;
        }
        const points = draft.cursor ? [...draft.points, draft.cursor] : draft.points;
        const color = Number.parseInt(ROUTE_COLORS[0].replace('#', ''), 16);
        this._draftLayer.addChild(this._line(points.length > 1 ? points : [points[0], points[0]], color, sizes, { alpha: 0.8, ring: true }));
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

    /** Pan the canvas to show a whole route or journey. */
    async focus(ref) {
        const path = typeof ref === 'string' ? this.path({ routeId: ref }) : this.path(ref);
        if (!path?.points?.length || !canvas?.ready) return;
        const xs = path.points.map(p => p[0]);
        const ys = path.points.map(p => p[1]);
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

// ==================================================================
// ===== THE PARTY'S MARKER =========================================
// ==================================================================

import { MODULE } from './const.js';
import { notify } from './utils-toast.js';
import { routesManager } from './manager-routes.js';
import { formatDistance } from './utils-travel.js';
import { journeysManager } from './manager-journeys.js';
import { nearestOnRoute, legPixels, gridDistance, pathLegs, effortForDistance } from './utils-routes.js';

/** The pin type Cartographer's marker is, for Blacksmith's pins UI. */
const PIN_TYPE = 'journey';
/** A marker this far, in scene pixels, from where it should be is moved. */
const MOVE_EPSILON = 0.5;
/** How often the GM's client may save the marker where a party at rest is, in ms. */
const SAVE_EVERY_MS = 500;
/** How near, in screen pixels, a dropped marker must be to a route's line to land on it. */
const DROP_SNAP_PIXELS = 24;

/**
 * The party's marker on a map: one Blacksmith pin per map, standing where
 * the party is along the route or journey the map runs -- the one its bar
 * and Play button run, the last one played there. There is one party, so
 * there is one marker; choosing another route or journey moves it there.
 *
 * It is an ordinary pin, so the GM styles it in Blacksmith's Configure Pin
 * window -- an icon, a portrait, a wagon, its label and size. Cartographer
 * creates it (as the GM, once the map's route or journey has set out), shows
 * and hides it from players, and moves it.
 *
 * Moving: every client works out where the party is, every frame, and
 * wherever that differs from the saved position -- moving, or moved by a
 * scrub of the world time -- puts the pin there with Blacksmith's
 * client-local live position, which is never saved or sent and locks the pin
 * against dragging. When the party is at rest, the GM's client saves the pin
 * there, and each client lets go of its live position once the saved one
 * has caught up, so nothing jumps.
 *
 * Without the live position (an older Blacksmith), the pin moves only when
 * the GM saves it, at rest.
 */
class TravelPinsManager {
    constructor() {
        this._hooks = [];
        /** Pins this client has given a live position, by pin id: the last point set. */
        this._live = new Map();
        this._busy = new Set();
        this._lastSave = 0;
        this._tick = this._tick.bind(this);
        this._ticking = false;
    }

    initialize() {
        const pins = TravelPinsManager.pins();
        if (pins) pins.registerPinType?.(MODULE.ID, PIN_TYPE, game.i18n.localize(`${MODULE.ID}.routes.pinType`));
        const on = (name, fn) => this._hooks.push({ name, id: Hooks.on(name, fn) });
        on('canvasReady', () => {
            this._live.clear();
            this._start();
            void this._removeOldPins();
            void this._renameMarker();
        });
        // The party renamed: its marker follows, unless the GM labelled it otherwise.
        this._partyName = TravelPinsManager.partyName();
        on('updateActor', (actor, changes) => {
            if (!('name' in (changes ?? {})) || actor !== TravelPinsManager.partyActor()) return;
            void this._renameMarker();
        });
        on('canvasTearDown', () => this._stop());
        this._start();
        void this._removeOldPins();
        // The GM can pick the party up and put it down: on a route, or anywhere.
        if (pins && game.user.isGM) {
            pins.on('dragStart', event => this._onDragStart(event), { moduleId: MODULE.ID, dragEvents: true });
            pins.on('dragEnd', event => this._onDragEnd(event), { moduleId: MODULE.ID, dragEvents: true });
            pins.on('deleted', event => this._onPinDeleted(event), { moduleId: MODULE.ID });
        }
        // A route clicked on the map: the one the party is to travel.
        if (game.user.isGM) on(`${MODULE.ID}.routeClicked`, link => this.chooseTrip(link));
    }

    /**
     * Choose what the map runs -- from the bar, or a click on a route -- never
     * moving the party: the marker is where the party is. Already where the
     * party stands on it, nothing more; with the marker on its line elsewhere,
     * the party is put there, as a drop would; anywhere else, the trip is
     * chosen but the party is not on it -- the GM is told to move the marker
     * there, and Play waits until they do. GM only.
     */
    async chooseTrip(link, scene = canvas.scene) {
        if (!game.user.isGM || !scene) return;
        const pin = this.pinFor(scene.id);
        // The marker is held while the choice is made: the map would otherwise
        // move it to the trip chosen before this has looked at where it stands.
        // Off the trip until it is seen to be on it, so no client draws the marker
        // on the trip chosen in the meantime.
        this._dragging = true;
        try {
            if (link && pin) await routesManager.setSettings({ offRoute: true }, scene.id);
            await journeysManager.choose(link, scene);
            if (!link) return;
            const onIt = () => routesManager.setSettings({ offRoute: false }, scene.id);
            if (!pin) return onIt();
            const shown = routesManager.shownPath(scene);
            const point = shown ? routesManager.progress(shown)?.point : null;
            if (!point) return;
            const radius = DROP_SNAP_PIXELS / (canvas.stage?.scale?.x || 1);
            if (Math.hypot(point.x - pin.x, point.y - pin.y) <= radius) return onIt();
            const ids = shown.journeyId ? routesManager.getJourney(shown.journeyId, scene)?.routeIds ?? [] : [routesManager.routeLinkOf(shown)?.routeId];
            const placed = await this.placeParty(scene, { x: pin.x, y: pin.y }, radius, { only: ids });
            if (placed.onRoute) return;
            notify(game.i18n.format(`${MODULE.ID}.routes.partyNotOnRoute`, {
                party: TravelPinsManager.partyName(), name: routesManager.path(shown, scene)?.name ?? ''
            }), { type: 'warn' });
        } finally {
            this._dragging = false;
        }
    }

    // ==================================================================
    // ===== PICKING THE PARTY UP =======================================
    // ==================================================================

    _isPartyPin(event) {
        return !!canvas?.scene && event?.pinId === TravelPinsManager.pinId(canvas.scene.id);
    }

    /** Picked up: the party stops, wherever it was going. */
    async _onDragStart(event) {
        if (!game.user.isGM || !this._isPartyPin(event)) return;
        this._dragging = true;
        this._clearLive(event.pinId);
        await this._stopAll(canvas.scene);
    }

    /** Put down: where it lands is where the party is. */
    async _onDragEnd(event) {
        if (!game.user.isGM || !this._isPartyPin(event)) return;
        // Blacksmith fires dragEnd once the drop is saved: event.pin is where it landed.
        const pin = event.pin ?? TravelPinsManager.pins()?.get?.(event.pinId, { sceneId: canvas.scene.id });
        if (!pin) {
            this._dragging = false;
            return;
        }
        const scene = canvas.scene;
        // Where the party was: on a trip, or set down off every route.
        const was = routesManager.settings(scene).offRoute ? null : routesManager.shownPath(scene);
        const wasName = was ? routesManager.path(was, scene)?.name : null;
        // Still the GM's until the drop is settled: part way through, the map still
        // shows the trip it left, and the marker would be saved back on to it.
        let result;
        try {
            result = await this.placeParty(scene, { x: pin.x, y: pin.y }, DROP_SNAP_PIXELS / (canvas.stage?.scale?.x || 1));
        } finally {
            this._dragging = false;
        }
        const message = this.dropMessage(result, wasName, scene);
        if (message) notify(message);
    }

    /**
     * What to tell the GM about a drop: "<party> has moved on to <trip> at
     * <where>", or "<party> has moved off of <trip>". Moved from off every
     * route to elsewhere off every route, nothing.
     */
    dropMessage(result, wasName, scene) {
        const format = (key, data) => game.i18n.format(`${MODULE.ID}.routes.${key}`, data);
        const party = TravelPinsManager.partyName();
        if (!result?.onRoute) return wasName ? format('partyMovedOff', { party, name: wasName }) : null;
        const progress = routesManager.progress(result.link);
        if (!progress) return null;
        // Where on it, by the names of its ends where they have them: "at Phlan", "12 mi from Phlan".
        const [start, end] = progress.path.ends ?? [];
        const distance = formatDistance(progress.distance, scene.grid?.units);
        const where = progress.distance <= 1e-9 ? (start ? format('atPlace', { place: start }) : game.i18n.localize(`${MODULE.ID}.routes.atStart`))
            : progress.distance >= progress.length - 1e-9 ? (end ? format('atPlace', { place: end }) : game.i18n.localize(`${MODULE.ID}.routes.atEnd`))
            : start ? format('atDistanceFrom', { distance, place: start }) : format('atDistance', { distance });
        return format('partyMovedOn', { party, name: progress.path.name, where });
    }

    /**
     * Stop every route and journey moving on a map: there is one party. Moving
     * at all -- playing, or carried along by the clock's timeline -- not only
     * playing, so nothing goes on showing as the party's trip.
     */
    async _stopAll(scene) {
        const links = [
            ...routesManager.journeys(scene).map(j => ({ sceneId: scene.id, journeyId: j.id })),
            ...routesManager.routes(scene).map(r => ({ sceneId: scene.id, routeId: r.id }))
        ].filter(link => {
            const progress = routesManager.progress(link);
            return !!progress && (progress.travel.motion.playing || progress.moving);
        });
        for (const link of links) await journeysManager.stop(link);
    }

    /**
     * Set the party down at a point on a map, GM only. Within `radius` scene
     * pixels of a route's line, it lands on the line: on that route, which
     * becomes the map's (still within the journey being followed, if it is
     * one of its routes); its progress is that point, and it is stopped. Put
     * down at the end it was heading for, it sets out from there: on to the
     * journey's next route, or turned round. Off
     * every route, it stays where it was put, on no route, until it is put on
     * one. Whatever was moving there stops either way, and the trip it was
     * on, if it is put down anywhere but back on that trip, is cancelled:
     * reset to the start. `only`: the routes it may land on -- off them, it
     * changes nothing (for a trip just chosen; see chooseTrip).
     */
    async placeParty(scene, point, radius, { only = null } = {}) {
        if (!game.user.isGM || !scene) return { onRoute: false };
        const shown = routesManager.shownPath(scene);
        let best = null;
        for (const route of routesManager.visibleRoutes(scene)) {
            if (only && !only.includes(route.id)) continue;
            const hit = nearestOnRoute(route.points, [point.x, point.y]);
            if (hit && hit.distance <= radius && (!best || hit.distance < best.hit.distance)) best = { route, hit };
        }
        if (only && !best) return { onRoute: false };
        await this._stopAll(scene);
        // Put down anywhere but back on the trip it was on, that trip is
        // cancelled: stopped, and back to its start -- a journey to its first
        // route. Put down on another route of the journey it follows, it keeps
        // to the journey, and only the route it was on goes back to its start.
        const was = shown ? routesManager.routeLinkOf(shown) : null;
        const cancel = async trip => {
            if (trip && routesManager.progress(trip)) await journeysManager.reset(trip);
        };
        if (!best) {
            await cancel(shown);
            await routesManager.setSettings({ active: null, offRoute: true }, scene.id);
            return { onRoute: false };
        }
        const link = { sceneId: scene.id, routeId: best.route.id };
        const journey = shown?.journeyId ? routesManager.getJourney(shown.journeyId, scene) : null;
        const keep = journey?.routeIds.includes(link.routeId) ? journey.id : null;
        if (was?.routeId !== link.routeId) await cancel(keep ? was : shown);
        const path = routesManager.path(link, scene);
        const along = nearestOnRoute(path.points, [point.x, point.y]);
        const before = legPixels(path.points.slice(0, along.index + 1)).reduce((sum, leg) => sum + leg, 0);
        const start = path.points[along.index];
        let pixels = before + Math.hypot(along.point[0] - start[0], along.point[1] - start[1]);
        // Near either end, it is at that end exactly; anywhere else, where it was put.
        const total = legPixels(path.points).reduce((sum, leg) => sum + leg, 0);
        if (pixels <= radius) pixels = 0;
        else if (total - pixels <= radius) pixels = total;
        const effort = effortForDistance(pathLegs(path.points, path.terrain, scene.grid), gridDistance(pixels, scene.grid));
        await routesManager.setPathTravel(link, { effort, playing: false, arrived: false });
        await routesManager.setSettings({ active: keep ? { journeyId: keep, routeId: link.routeId } : { routeId: link.routeId }, offRoute: false }, scene.id);
        // Put down at the end it is heading for, the party is setting out from there:
        // on to the next route of the journey it follows, else turned round, at
        // the start of the way back.
        let on = link;
        if (pixels === total && total > 0) {
            const trip = keep ? { sceneId: scene.id, journeyId: keep } : null;
            const view = trip ? routesManager.journeyView(trip, scene) : null;
            if (view && view.index < view.order.length - 1) {
                await routesManager.journeyStep(trip, view.index + 1);
                on = routesManager.routeLinkOf(trip) ?? link;
            } else await routesManager.setPathTravel(link, { reversed: !routesManager.progress(link)?.path.reversed });
        }
        await this.savePosition(on);
        return { onRoute: true, link: on };
    }

    /** The world's party, from Blacksmith: its primary party actor, or null when none is set. */
    static partyActor() {
        return game.modules.get('coffee-pub-blacksmith')?.api?.party?.actor?.() ?? null;
    }

    /** What the marker is called: the party's name, or "The party" when the world has none set. */
    static partyName() {
        return TravelPinsManager.partyActor()?.name || game.i18n.localize(`${MODULE.ID}.routes.partyMarker`);
    }

    /**
     * Keep the marker's label the party's name, GM only. Only a label that is
     * still one Cartographer gave it -- the generic name or the party's
     * earlier one -- changes; one the GM typed in Configure Pin stays.
     */
    async _renameMarker() {
        const pins = TravelPinsManager.pins();
        const scene = canvas?.scene;
        if (!game.user.isGM || !pins || !scene) return;
        const name = TravelPinsManager.partyName();
        const pin = this.pinFor(scene.id);
        const ours = [game.i18n.localize(`${MODULE.ID}.routes.partyMarker`), this._partyName];
        if (pin && pin.text !== name && ours.includes(pin.text)) await pins.update(pin.id, { text: name }, { sceneId: scene.id });
        this._partyName = name;
    }

    /** Blacksmith's pins API, when it is there and ready. */
    static pins() {
        const pins = game.modules.get('coffee-pub-blacksmith')?.api?.pins;
        return pins?.isAvailable?.() ? pins : null;
    }

    /** Whether Blacksmith can move a pin without saving it. */
    static canMoveLive() {
        return typeof TravelPinsManager.pins()?.setLivePosition === 'function';
    }

    /** The party's pin on a map. */
    static pinId(sceneId) {
        return `${MODULE.ID}-party-${sceneId}`;
    }

    /** The route or journey a map's marker follows: the one its bar runs -- unless the party is not on it. */
    static followed(scene) {
        return scene && !routesManager.settings(scene).offRoute ? routesManager.shownPath(scene) : null;
    }

    _start() {
        if (this._ticking || !canvas?.app?.ticker) return;
        canvas.app.ticker.add(this._tick);
        this._ticking = true;
    }

    _stop() {
        if (this._ticking) canvas?.app?.ticker?.remove(this._tick);
        this._ticking = false;
        this._live.clear();
    }

    /** Run a change at most once at a time per key. */
    _once(key, fn) {
        if (this._busy.has(key)) return;
        this._busy.add(key);
        Promise.resolve(fn()).finally(() => this._busy.delete(key));
    }

    // ==================================================================
    // ===== EVERY FRAME ================================================
    // ==================================================================

    /**
     * On every client: put the map's marker where the party is. On the GM's,
     * also make the marker if the map has a route or journey under way and no
     * marker yet, and save it where a party at rest is.
     */
    _tick() {
        const pins = TravelPinsManager.pins();
        const scene = canvas?.scene;
        if (!pins || !canvas?.ready || !scene) return;
        const link = TravelPinsManager.followed(scene);
        const id = TravelPinsManager.pinId(scene.id);
        // On no trip -- set down off every route -- the marker stands where it was saved,
        // not where a live position from the trip it left would draw it.
        if (!link) {
            this._clearLive(id);
            return;
        }
        if (!pins.exists?.(id, { sceneId: scene.id })) {
            // Deleted by the GM, it stays deleted until they add it again.
            if (game.user.isGM && !routesManager.settings(scene).marker?.removed) this._once(`create-${id}`, () => this._ensurePin(link));
            return;
        }
        const progress = routesManager.progress(link);
        const point = progress?.point;
        if (!point) return;
        // While the GM carries it, the marker is theirs.
        if (this._dragging) return;
        const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= MOVE_EPSILON;
        const stored = pins.get?.(id, { sceneId: scene.id });
        const settled = stored && near(stored, point);
        if (game.user.isGM && !settled && !progress.moving && performance.now() - this._lastSave > SAVE_EVERY_MS) {
            this._lastSave = performance.now();
            this._once(`save-${id}`, () => this.savePosition(link));
        }
        if (!TravelPinsManager.canMoveLive()) return;
        const live = this._live.get(id);
        if (settled) {
            this._clearLive(id);
            return;
        }
        if (live && near(live, point)) return;
        // The GM may still pick it up while it moves (where Blacksmith allows it).
        pins.setLivePosition(id, { x: point.x, y: point.y }, { draggable: game.user.isGM });
        this._live.set(id, { x: point.x, y: point.y });
    }

    /**
     * Drop a live position, so the marker is drawn where it is saved. Asked of
     * Blacksmith, not only of what this client remembers setting: one left
     * over -- set before the GM picked the marker up, say -- would go on
     * drawing it there.
     */
    _clearLive(id) {
        const pins = TravelPinsManager.pins();
        this._live.delete(id);
        if (!TravelPinsManager.canMoveLive()) return;
        if (pins.getLivePosition && !pins.getLivePosition(id)) return;
        pins.clearLivePosition(id);
    }

    // ==================================================================
    // ===== THE GM'S SIDE ==============================================
    // ==================================================================

    /** Make the map's marker where the party is, if it has none. GM only. */
    /**
     * Make the map's marker where the party is, if it has none. GM only. In
     * the look given -- the one it had when the GM deleted it -- or the
     * default: a walking figure, labelled with the party's name.
     */
    async _ensurePin(link, look = null) {
        const pins = TravelPinsManager.pins();
        const id = TravelPinsManager.pinId(link.sceneId);
        if (!game.user.isGM || !pins || pins.exists?.(id)) return;
        const progress = routesManager.progress(link);
        const scene = game.scenes.get(link.sceneId);
        if (!progress?.point || !scene) return;
        const size = Math.max(40, Math.round((Number(scene.grid?.size) || 100) * 0.6));
        await pins.create({
            text: TravelPinsManager.partyName(),
            image: '<i class="fa-solid fa-person-hiking"></i>',
            size: { w: size, h: size },
            ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
            config: { blacksmithAccess: 'gm', blacksmithVisibility: 'visible' },
            ...(look ?? {}),
            // What makes it the party's marker, and where the party is, whatever the look.
            id,
            moduleId: MODULE.ID,
            type: PIN_TYPE,
            x: progress.point.x,
            y: progress.point.y
        }, { sceneId: link.sceneId });
    }

    /**
     * The GM deleted the party marker from the pin's own menu: it stays
     * deleted -- the trip and its odometer carry on, with nothing on the map
     * -- and its look is kept, for Add marker to put it back as it was.
     */
    async _onPinDeleted(event) {
        if (!game.user.isGM || !event?.pinId?.startsWith(`${MODULE.ID}-party-`)) return;
        const sceneId = event.sceneId ?? event.pinId.slice(`${MODULE.ID}-party-`.length);
        const pin = event.pin ?? {};
        const { id, x, y, sceneId: _scene, moduleId, type, ...look } = pin;
        this._live.delete(event.pinId);
        await routesManager.setSettings({ marker: { removed: true, look: Object.keys(look).length ? look : null } }, sceneId);
    }

    /** Put the party marker back on a map, where the party is, as it looked when deleted. GM only. */
    async addMarker(sceneId) {
        const scene = game.scenes.get(sceneId);
        const link = scene ? routesManager.shownPath(scene) : null;
        if (!game.user.isGM || !link) return;
        const look = routesManager.settings(scene).marker?.look ?? null;
        await routesManager.setSettings({ marker: { removed: false, look: null } }, sceneId);
        await this._ensurePin(link, look);
    }

    /**
     * Open Blacksmith's Configure Pin window for the map's marker, where the
     * GM sets its look: image or icon, shape, size, label, colours,
     * animations. Before the party has set out there is no marker yet, so it
     * is made first, at the start of the way, to be styled in advance.
     */
    async configure(sceneId) {
        const pins = TravelPinsManager.pins();
        const scene = game.scenes.get(sceneId);
        const active = scene ? routesManager.settings(scene).active : null;
        if (!game.user.isGM || !pins || !active) return null;
        const id = TravelPinsManager.pinId(sceneId);
        if (!pins.exists?.(id)) await this._ensurePin({ sceneId, ...active });
        if (!pins.exists?.(id)) return null;
        return pins.configure(id, { sceneId });
    }

    /** Save the marker where the party is now. GM only; the pin moves for everyone through Blacksmith. */
    async savePosition(link) {
        const pins = TravelPinsManager.pins();
        if (!game.user.isGM || !pins) return;
        const id = TravelPinsManager.pinId(link.sceneId);
        const point = routesManager.progress(link)?.point;
        if (!point || !pins.exists?.(id)) return;
        await pins.update(id, { x: point.x, y: point.y }, { sceneId: link.sceneId });
    }

    /**
     * An earlier version gave every route and journey its own marker; there
     * is one party, so those go, on the GM's client, as each map loads.
     */
    async _removeOldPins() {
        const pins = TravelPinsManager.pins();
        const scene = canvas?.scene;
        if (!game.user.isGM || !pins || !scene) return;
        const old = [
            ...routesManager.routes(scene).map(route => `${MODULE.ID}-travel-r-${route.id}`),
            ...routesManager.journeys(scene).map(journey => `${MODULE.ID}-travel-j-${journey.id}`)
        ];
        for (const id of old) if (pins.exists?.(id)) await pins.delete(id, { sceneId: scene.id });
    }

    // ==================================================================
    // ===== SHOWN OR HIDDEN ============================================
    // ==================================================================

    /** The map's marker, as Blacksmith holds it, or null. */
    pinFor(sceneId) {
        const pins = TravelPinsManager.pins();
        const id = TravelPinsManager.pinId(sceneId);
        return pins?.exists?.(id) ? pins.get(id, { sceneId }) : null;
    }

    /** Whether players see the map's marker. Blacksmith's pin visibility; the GM always sees it. */
    isShown(sceneId) {
        return this.pinFor(sceneId)?.config?.blacksmithVisibility !== 'hidden';
    }

    /** Show the map's marker to players, or hide it from them. GM only. */
    async setShown(sceneId, shown) {
        const pins = TravelPinsManager.pins();
        const pin = this.pinFor(sceneId);
        if (!game.user.isGM || !pins || !pin) return;
        await pins.update(pin.id, { config: { ...(pin.config ?? {}), blacksmithVisibility: shown ? 'visible' : 'hidden' } }, { sceneId });
        routesManager.window?.render();
    }
}

export const travelPinsManager = new TravelPinsManager();
export { TravelPinsManager };

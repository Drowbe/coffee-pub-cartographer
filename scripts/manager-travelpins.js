// ==================================================================
// ===== THE JOURNEY'S MARKER =======================================
// ==================================================================

import { MODULE } from './const.js';
import { routesManager } from './manager-routes.js';

/** The pin type Cartographer's markers are, for Blacksmith's pins UI. */
const PIN_TYPE = 'journey';
/** A marker this far, in scene pixels, from where it should be is moved. */
const MOVE_EPSILON = 0.5;

/**
 * The party's marker on the map: a Blacksmith pin for each route or journey
 * that has set out, standing where the party is along it.
 *
 * It is an ordinary pin, so the GM styles it in Blacksmith's Configure Pin
 * window -- an icon, a portrait, a wagon, its label and size -- and it shows
 * in Blacksmith's pin filters like any other. Cartographer creates it (as the
 * GM, the first time the journey moves), shows and hides it from players,
 * and moves it.
 *
 * Moving: every client works out where the party is from the journey's
 * progress and the shared clock, every frame, and puts the pin there with
 * Blacksmith's client-local live position, which is never saved or sent. A
 * pin with a live position cannot be dragged. When the journey comes to
 * rest -- stopped, its ease run out, or arrived -- the GM's client saves the
 * pin's position once, and each client lets go of its live position once
 * the saved one has caught up, so nothing jumps.
 *
 * Without the live position (an older Blacksmith), the pin moves only when
 * the journey comes to rest.
 */
class TravelPinsManager {
    constructor() {
        this._hooks = [];
        /** Pins this client has given a live position, by pin id: the last point set. */
        this._live = new Map();
        /** Pending saves on the GM's client, by pin id. */
        this._saves = new Map();
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
        });
        on('canvasTearDown', () => this._stop());
        on(`${MODULE.ID}.pathTravelChanged`, ({ link, travel }) => this._onTravelChanged(link, travel));
        on(`${MODULE.ID}.pathRemoved`, link => this._onPathRemoved(link));
        // Scrubbing the world time moves a party that follows the clock, even
        // stopped; the GM saves where it lands once the scrubbing settles.
        on('updateWorldTime', () => this._onWorldTime());
        this._start();
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

    /** The pin id for a route or journey: one marker each, found again by its id. */
    static pinId(link) {
        return `${MODULE.ID}-travel-${link.journeyId ? `j-${link.journeyId}` : `r-${link.routeId}`}`;
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

    // ==================================================================
    // ===== WHERE THE PARTY IS =========================================
    // ==================================================================

    /** The routes and journeys on the map on the canvas that have set out, as links. */
    _travelling(scene = canvas.scene) {
        const links = [];
        for (const route of routesManager.routes(scene)) if (route.travel) links.push({ sceneId: scene.id, routeId: route.id });
        for (const journey of routesManager.journeys(scene)) if (journey.travel) links.push({ sceneId: scene.id, journeyId: journey.id });
        return links;
    }

    /** At rest: not playing, and any ease to a stop is over. */
    static atRest(travel, now) {
        const motion = travel?.motion ?? {};
        if (motion.playing) return false;
        return now >= (Number(motion.anchorAt) || 0) + Math.max(0, Number(motion.easeSeconds) || 0) * 1000;
    }

    /**
     * Each frame, on every client: put each marker on this map where the
     * party is. Wherever that differs from the saved position -- moving, or
     * moved by a scrub of the world time -- the marker takes a live position;
     * once the saved one has caught up, it lets go of it.
     */
    _tick() {
        const pins = TravelPinsManager.pins();
        if (!pins || !canvas?.ready || !canvas.scene || !TravelPinsManager.canMoveLive()) return;
        const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= MOVE_EPSILON;
        for (const link of this._travelling()) {
            const id = TravelPinsManager.pinId(link);
            if (!pins.exists?.(id, { sceneId: link.sceneId })) continue;
            const point = routesManager.progress(link)?.point;
            if (!point) continue;
            const live = this._live.get(id);
            const stored = pins.get?.(id, { sceneId: link.sceneId });
            if (stored && near(stored, point)) {
                if (live) {
                    pins.clearLivePosition(id);
                    this._live.delete(id);
                }
                continue;
            }
            if (live && near(live, point)) continue;
            pins.setLivePosition(id, { x: point.x, y: point.y });
            this._live.set(id, { x: point.x, y: point.y });
        }
    }

    /**
     * The world time changed: a stopped party that follows the clock may have
     * been moved by a scrub. The GM saves their markers once it settles.
     */
    _onWorldTime() {
        if (!game.user.isGM || !TravelPinsManager.pins()) return;
        clearTimeout(this._worldSave);
        this._worldSave = setTimeout(() => {
            for (const scene of game.scenes.contents) {
                for (const link of this._travelling(scene)) {
                    const travel = routesManager.progress(link)?.travel;
                    if (travel?.followClock && !travel.motion.playing) void this.savePosition(link);
                }
            }
        }, 600);
    }

    // ==================================================================
    // ===== THE GM'S SIDE: CREATING AND SAVING =========================
    // ==================================================================

    /**
     * A journey's travel changed (on the GM's client, which wrote it): give it
     * a marker if it has none, and when it is coming to rest, save the
     * marker where it will stop once the ease has run out.
     */
    async _onTravelChanged(link, travel) {
        if (!game.user.isGM || !TravelPinsManager.pins()) return;
        await this._ensurePin(link);
        const id = TravelPinsManager.pinId(link);
        clearTimeout(this._saves.get(id));
        this._saves.delete(id);
        if (travel?.motion?.playing) return;
        const wait = Math.max(0, (Number(travel.motion.anchorAt) || 0) + (Number(travel.motion.easeSeconds) || 0) * 1000 - game.time.serverTime);
        this._saves.set(id, setTimeout(() => {
            this._saves.delete(id);
            void this.savePosition(link);
        }, wait + 50));
    }

    /** Create the marker for a route or journey, where the party is, if it has none. GM only. */
    async _ensurePin(link) {
        const pins = TravelPinsManager.pins();
        const id = TravelPinsManager.pinId(link);
        if (!pins || pins.exists?.(id)) return;
        const progress = routesManager.progress(link);
        const scene = game.scenes.get(link.sceneId);
        if (!progress?.point || !scene) return;
        const size = Math.max(40, Math.round((Number(scene.grid?.size) || 100) * 0.6));
        await pins.create({
            id,
            moduleId: MODULE.ID,
            type: PIN_TYPE,
            text: progress.path.name,
            image: '<i class="fa-solid fa-person-hiking"></i>',
            size: { w: size, h: size },
            x: progress.point.x,
            y: progress.point.y,
            ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
            config: { blacksmithAccess: 'gm', blacksmithVisibility: 'visible' }
        }, { sceneId: link.sceneId });
    }

    /** Save the marker where the party is now. GM only; the pin moves for everyone through Blacksmith. */
    async savePosition(link) {
        const pins = TravelPinsManager.pins();
        if (!game.user.isGM || !pins) return;
        const id = TravelPinsManager.pinId(link);
        const point = routesManager.progress(link)?.point;
        if (!point || !pins.exists?.(id)) return;
        await pins.update(id, { x: point.x, y: point.y }, { sceneId: link.sceneId });
    }

    /** A deleted route or journey takes its marker with it. */
    async _onPathRemoved(link) {
        const pins = TravelPinsManager.pins();
        if (!game.user.isGM || !pins) return;
        const id = TravelPinsManager.pinId(link);
        clearTimeout(this._saves.get(id));
        this._saves.delete(id);
        if (pins.exists?.(id)) await pins.delete(id, { sceneId: link.sceneId });
    }

    // ==================================================================
    // ===== SHOWN OR HIDDEN ============================================
    // ==================================================================

    /** The marker for a route or journey, as Blacksmith holds it, or null. */
    pinFor(link) {
        const pins = TravelPinsManager.pins();
        const id = TravelPinsManager.pinId(link);
        return pins?.exists?.(id) ? pins.get(id, { sceneId: link.sceneId }) : null;
    }

    /** Whether players see the marker. Blacksmith's pin visibility; the GM always sees it. */
    isShown(link) {
        return this.pinFor(link)?.config?.blacksmithVisibility !== 'hidden';
    }

    /** Show the marker to players, or hide it from them. GM only. */
    async setShown(link, shown) {
        const pins = TravelPinsManager.pins();
        const pin = this.pinFor(link);
        if (!game.user.isGM || !pins || !pin) return;
        await pins.update(pin.id, { config: { ...(pin.config ?? {}), blacksmithVisibility: shown ? 'visible' : 'hidden' } }, { sceneId: link.sceneId });
        routesManager.window?.render();
    }
}

export const travelPinsManager = new TravelPinsManager();
export { TravelPinsManager };

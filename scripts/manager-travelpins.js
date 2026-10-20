// ==================================================================
// ===== THE PARTY'S MARKER =========================================
// ==================================================================

import { MODULE } from './const.js';
import { routesManager } from './manager-routes.js';

/** The pin type Cartographer's marker is, for Blacksmith's pins UI. */
const PIN_TYPE = 'journey';
/** A marker this far, in scene pixels, from where it should be is moved. */
const MOVE_EPSILON = 0.5;
/** How often the GM's client may save the marker where a party at rest is, in ms. */
const SAVE_EVERY_MS = 500;

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
        });
        on('canvasTearDown', () => this._stop());
        this._start();
        void this._removeOldPins();
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

    /** The route or journey a map's marker follows: the one its bar runs, once it has set out. */
    static followed(scene) {
        const active = scene ? routesManager.settings(scene).active : null;
        if (!active) return null;
        const link = { sceneId: scene.id, ...active };
        return routesManager._pathItem(link, scene)?.travel ? link : null;
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
        if (!link) return;
        const id = TravelPinsManager.pinId(scene.id);
        if (!pins.exists?.(id, { sceneId: scene.id })) {
            if (game.user.isGM) this._once(`create-${id}`, () => this._ensurePin(link));
            return;
        }
        const progress = routesManager.progress(link);
        const point = progress?.point;
        if (!point) return;
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
            if (live) {
                pins.clearLivePosition(id);
                this._live.delete(id);
            }
            return;
        }
        if (live && near(live, point)) return;
        pins.setLivePosition(id, { x: point.x, y: point.y });
        this._live.set(id, { x: point.x, y: point.y });
    }

    // ==================================================================
    // ===== THE GM'S SIDE ==============================================
    // ==================================================================

    /** Make the map's marker where the party is, if it has none. GM only. */
    async _ensurePin(link) {
        const pins = TravelPinsManager.pins();
        const id = TravelPinsManager.pinId(link.sceneId);
        if (!game.user.isGM || !pins || pins.exists?.(id)) return;
        const progress = routesManager.progress(link);
        const scene = game.scenes.get(link.sceneId);
        if (!progress?.point || !scene) return;
        const size = Math.max(40, Math.round((Number(scene.grid?.size) || 100) * 0.6));
        await pins.create({
            id,
            moduleId: MODULE.ID,
            type: PIN_TYPE,
            text: game.i18n.localize(`${MODULE.ID}.routes.partyMarker`),
            image: '<i class="fa-solid fa-person-hiking"></i>',
            size: { w: size, h: size },
            x: progress.point.x,
            y: progress.point.y,
            ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
            config: { blacksmithAccess: 'gm', blacksmithVisibility: 'visible' }
        }, { sceneId: link.sceneId });
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

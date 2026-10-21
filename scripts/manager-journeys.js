// ==================================================================
// ===== JOURNEYS: CONTROLS FROM THE MAP ============================
// ==================================================================

import { MODULE } from './const.js';
import { notify } from './utils-toast.js';
import { cartographerToolbar } from './manager-toolbar.js';
import { routesManager } from './manager-routes.js';
import { parallaxManager } from './manager-parallax.js';
import { travelManager } from './manager-travel.js';
import { DEFAULT_EASE_SECONDS } from './utils-motion.js';

/** The section of Cartographer's sub-menubar the Play button sits in; registered in manager-toolbar.js. */
const GROUP = 'Routes';
const PLAY_ID = `${MODULE.ID}-routes-play`;
/** How often the GM's client checks journeys for terrain and arrival, in ms. */
const WATCH_MS = 250;
/** How often the GM's client notes that a trip is under way, in ms. */
const SEEN_MS = 30000;
/** A reload shorter than this pauses a trip where it is now: the world was not closed. */
const RELOAD_MS = 120000;

/**
 * Running a journey from its map: Play and Stop, speed and pace, for the GM,
 * in the Routes window and the sub-menubar.
 *
 * A journey can be shown by animated scenes (their Travel section follows it)
 * or by none. Followed, the animated scenes drive it -- their pace, ease and
 * world clock are the journey's -- so the map's controls change those scenes,
 * through parallaxManager.commitScene, which writes a scene that need not be
 * the one on the canvas; each pushes the change on to the journey, as it does
 * for its own controls. Followed by none, the map's controls change the
 * journey itself.
 *
 * The GM's client also watches every journey that is moving, wherever the GM
 * is looking: animated scenes not on the canvas get their scenery slowed for
 * the terrain and their world-clock rate kept up, and a journey that reaches
 * its end with no animated scene on the canvas to notice is stopped there.
 * (manager-travel.js does both for the animated scene on the canvas.)
 */
class JourneysManager {
    constructor() {
        this._hooks = [];
        this._busy = new Set();
        this._lastWatch = 0;
        this._watch = this._watch.bind(this);
        this._watching = false;
    }

    initialize() {
        if (!game.user.isGM) return;
        this._registerButton();
        const on = (name, fn) => this._hooks.push({ name, id: Hooks.on(name, fn) });
        on('canvasReady', () => {
            this._startWatch();
            this._refreshButton();
            this._recordClockRate();
        });
        on('canvasTearDown', () => this._stopWatch());
        on(`${MODULE.ID}.routesChanged`, () => this._refreshButton());
        on('blacksmith.worldClockRateChanged', ({ rate } = {}) => this._recordClockRate(rate));
        this._startWatch();
        this._recordClockRate();
        // Closing the tab: note the time, so a trip pauses where it was left.
        globalThis.window?.addEventListener?.('pagehide', () => { if (this._moving().length) this._noteSeen(); });
        void this._pauseOnLoad();
    }

    // ==================================================================
    // ===== ON LOAD ====================================================
    // ==================================================================

    /** Note, for the next load, that a trip was under way now. */
    _noteSeen() {
        this._lastSeen = performance.now();
        try { void game.settings.set(MODULE.ID, 'routes.tripsSeenAt', game.time.serverTime); } catch (_) { /* not registered */ }
    }

    _seenAt() {
        try { return Number(game.settings.get(MODULE.ID, 'routes.tripsSeenAt')) || 0; } catch (_) { return 0; }
    }

    /**
     * The GM's client loading -- a new session, or a reload -- pauses every
     * trip still under way, so nothing sets off before the GM is ready. Off
     * the world clock, a trip is paused where the party was when the GM's
     * client last saw it, not where the hours the world sat closed would put
     * it; a quick reload pauses it where it is now. (On the clock, the clock
     * did not run while the world was closed.) With another GM already on,
     * the trips are theirs and go on.
     */
    async _pauseOnLoad() {
        if (!game.user.isGM || game.users?.some(user => user.isGM && user.active && user.id !== game.user.id)) return;
        const moving = this._moving();
        if (!moving.length) return;
        const now = game.time.serverTime;
        const seen = this._seenAt();
        const at = seen > 0 && seen < now - RELOAD_MS ? seen : now;
        const names = [];
        for (const link of moving) {
            const clock = !!routesManager.progress(link)?.travel.followClock;
            const was = routesManager.progress(link, clock ? now : at);
            if (!was) continue;
            const arrived = was.effort >= was.totalEffort - 1e-9;
            await routesManager.setPathTravel(link, { playing: false, halt: true, effort: was.effort, ...(arrived ? { arrived: true } : {}) });
            for (const scene of this.linkedScenes(link)) {
                await parallaxManager.commitScene(scene, state => {
                    state.playing = false;
                    if (arrived) state.travel.arrived = true;
                });
            }
            names.push(was.path.name);
        }
        this._refreshButton();
        if (names.length) notify(game.i18n.format(`${MODULE.ID}.routes.pausedOnLoad`, { name: names.join(', ') }));
    }

    // ==================================================================
    // ===== WHO SHOWS A JOURNEY ========================================
    // ==================================================================

    /** Whether a scene's parallax follows a route or journey. */
    static follows(scene, link) {
        const route = scene?.getFlag(MODULE.ID, 'parallax')?.travel?.route;
        if (!route || route.sceneId !== link.sceneId) return false;
        return link.journeyId ? route.journeyId === link.journeyId : (!route.journeyId && route.routeId === link.routeId);
    }

    /** The animated scenes following a route or journey. */
    linkedScenes(link) {
        return game.scenes.contents.filter(scene => JourneysManager.follows(scene, link));
    }

    // ==================================================================
    // ===== CONTROLS ===================================================
    // ==================================================================

    /**
     * Make a change to a journey: through the animated scenes that follow it,
     * or to the journey itself when none does. \`scene\` changes the scenes'
     * parallax state; \`path\` is the journey's travel change.
     */
    /**
     * Make a change to a trip: to the trip itself, and -- for what the
     * scenery shows (Play, Stop, which way) -- to the animated scenes
     * following it, which need not be on the canvas.
     */
    async _drive(link, { scene, path }) {
        if (!game.user.isGM) return;
        await routesManager.setPathTravel(link, path);
        if (scene) for (const each of this.linkedScenes(link)) await parallaxManager.commitScene(each, scene);
        this._refreshButton();
    }

    progress(link) {
        return routesManager.progress(link);
    }

    isPlaying(link) {
        return !!this.progress(link)?.travel.motion.playing;
    }

    /**
     * Set out, or carry on. A journey no animated scene follows needs a pace
     * of its own first; \`pace\` (map units an hour) gives it one if it has
     * none. Playing a journey makes it the one the map's Play button runs.
     */
    async play(link, pace = null) {
        const progress = this.progress(link);
        if (!progress) return;
        // Set down off every route, the party has nowhere to go until it is on one.
        if (routesManager.settings(game.scenes.get(link.sceneId)).offRoute) {
            notify(game.i18n.localize(`${MODULE.ID}.routes.partyOffRoute`), { type: 'warn' });
            return;
        }
        if (!this.linkedScenes(link).length && !(progress.travel.pace > 0) && !(pace > 0)) {
            notify(game.i18n.localize(`${MODULE.ID}.routes.needsPace`), { type: 'warn' });
            return;
        }
        // One party: setting out on one route or journey stops any other moving on this map.
        await this._stopOthers(link);
        const path = { playing: true, arrived: false };
        // At 0x the party would stand still while playing; Play means going, so it goes at 1x.
        // Onward only: a negative rate from an earlier version runs onward at its size.
        const rate = Math.abs(Number(progress.travel.motion.masterSpeed) || 0);
        if (!rate || rate !== Number(progress.travel.motion.masterSpeed)) path.masterSpeed = rate || 1;
        if (!(progress.travel.pace > 0) && pace > 0) path.pace = pace;
        if (!(progress.travel.motion.easeSeconds > 0)) path.easeSeconds = DEFAULT_EASE_SECONDS;
        // Setting out again from the end starts from the beginning.
        if (progress.travel.arrived && progress.effort >= progress.totalEffort - 1e-9) path.effort = 0;
        await this._drive(link, {
            scene: state => {
                state.playing = true;
                state.travel.arrived = false;
                if (!(Number(state.masterSpeed) || 0)) state.masterSpeed = 1;
            },
            path
        });
        await routesManager.setSettings({ active: link.journeyId ? { journeyId: link.journeyId } : { routeId: link.routeId } }, link.sceneId);
    }

    async _stopOthers(link) {
        const scene = game.scenes.get(link.sceneId);
        const same = other => (link.journeyId ? other.journeyId === link.journeyId : other.routeId === link.routeId);
        const others = [
            ...routesManager.journeys(scene).map(journey => ({ sceneId: link.sceneId, journeyId: journey.id })),
            ...routesManager.routes(scene).map(route => ({ sceneId: link.sceneId, routeId: route.id }))
        ].filter(other => !same(other) && routesManager.progress(other)?.travel.motion.playing);
        for (const other of others) await this.stop(other);
    }

    async stop(link) {
        await this._drive(link, { scene: state => { state.playing = false; }, path: { playing: false } });
    }

    toggle(link) {
        return this.isPlaying(link) ? this.stop(link) : this.play(link);
    }

    /** The master speed: a multiple of the pace; negative runs back along the way. */
    /** How fast travel time runs, always onward; which way is the trip's direction. */
    async setSpeed(link, speed) {
        const value = Math.abs(Number(speed));
        if (!Number.isFinite(value)) return;
        await this._drive(link, { path: { masterSpeed: value } });
    }

    /** The pace, in the map's units an hour: the trip's. Scenes following it keep their own scenery speeds. */
    async setPace(link, perHour) {
        await this._drive(link, { path: { pace: Math.max(0, Number(perHour) || 0) } });
    }

    /**
     * Follow the world clock, or real time. Following it, where the party is
     * goes with the date and time: scrubbing time moves them along the way,
     * forward or back. The trip's: scenes following it keep their scenery's own speeds.
     */
    async setFollowClock(link, follow) {
        await this._drive(link, { path: { followClock: !!follow } });
    }

    /**
     * Follow the world clock on a whole map, or not: every route and journey
     * on it that has set out, and the animated scenes following them. The
     * map's setting; a route or journey setting out later takes it up too.
     */
    async setMapClock(scene, follow) {
        if (!game.user.isGM || !scene) return;
        await routesManager.setSettings({ followClock: !!follow }, scene.id);
        const links = [
            ...routesManager.journeys(scene).filter(j => j.travel).map(j => ({ sceneId: scene.id, journeyId: j.id })),
            ...routesManager.routes(scene).filter(r => r.travel).map(r => ({ sceneId: scene.id, routeId: r.id }))
        ];
        for (const link of links) await this.setFollowClock(link, follow);
    }

    /** Travel a route or journey as drawn, or the other way: from its end back to its start. */
    async setDirection(link, reversed) {
        await this._drive(link, { path: { reversed: !!reversed } });
    }

    /**
     * End a trip: it halts and goes back to the start, the map has no trip
     * any more, and the party stays where it is, on no route -- as if set
     * down off every route. Play then asks for a route. Pause, by contrast,
     * keeps the trip; Back to the start keeps it, at its start.
     */
    async end(link) {
        if (!game.user.isGM || !link) return;
        await this.stop(link);
        await this.reset(link);
        await routesManager.setSettings({ active: null, offRoute: true }, link.sceneId);
        this._refreshButton();
    }

    /** Back to the start of the way. */
    async reset(link) {
        await routesManager.setPathTravel(link, { effort: 0, arrived: false });
        for (const scene of this.linkedScenes(link)) {
            await parallaxManager.commitScene(scene, state => {
                state.travel.distance = 0;
                state.travel.arrived = false;
            });
        }
    }

    // ==================================================================
    // ===== THE SUB-MENUBAR'S PLAY BUTTON ==============================
    // ==================================================================

    /** The route or journey the map on the canvas runs from its Play button: the last one played here. */
    activeLink(scene = canvas.scene) {
        const active = routesManager.settings(scene).active;
        return active && scene ? { sceneId: scene.id, ...active } : null;
    }

    _registerButton() {
        cartographerToolbar.registerTool(PLAY_ID, {
            icon: 'fa-solid fa-person-walking-arrow-right',
            tooltip: game.i18n.localize(`${MODULE.ID}.routes.barPlay`),
            group: GROUP,
            order: 4,
            toggleable: true,
            active: () => {
                const link = routesManager.shownPath(canvas?.scene) ?? this.activeLink();
                return !!link && this.isPlaying(link);
            },
            onClick: () => {
                const link = routesManager.shownPath(canvas?.scene) ?? this.activeLink();
                if (link) return this.toggle(link);
                notify(game.i18n.localize(`${MODULE.ID}.routes.noActiveJourney`));
                return routesManager.openWindow();
            }
        });
    }

    _refreshButton() {
        const api = game.modules.get('coffee-pub-blacksmith')?.api;
        const link = routesManager.shownPath(canvas?.scene) ?? this.activeLink();
        api?.updateSecondaryBarItemActive?.(MODULE.ID, PLAY_ID, !!link && this.isPlaying(link));
    }

    // ==================================================================
    // ===== WATCHING, ON THE GM'S CLIENT ===============================
    // ==================================================================

    _startWatch() {
        if (this._watching || !canvas?.app?.ticker) return;
        canvas.app.ticker.add(this._watch);
        this._watching = true;
    }

    _stopWatch() {
        if (this._watching) canvas?.app?.ticker?.remove(this._watch);
        this._watching = false;
    }

    /** Every route and journey, on every map, that is moving: as links. */
    _moving() {
        const links = [];
        for (const scene of game.scenes.contents) {
            for (const route of routesManager.routes(scene)) {
                if (route.travel?.motion?.playing) links.push({ sceneId: scene.id, routeId: route.id });
            }
            for (const journey of routesManager.journeys(scene)) {
                if (journey.travel?.motion?.playing) links.push({ sceneId: scene.id, journeyId: journey.id });
            }
        }
        return links;
    }

    _watch() {
        const now = performance.now();
        if (now - this._lastWatch < WATCH_MS) return;
        this._lastWatch = now;
        if (!game.user.isGM) return;
        const moving = this._moving();
        if (moving.length && !(now - (this._lastSeen ?? -Infinity) < SEEN_MS)) this._noteSeen();
        for (const link of moving) {
            const progress = routesManager.progress(link);
            if (!progress) continue;
            // A trip moving is the one its map shows, however it was set going --
            // so stopping it leaves the map on it, not on the last one played there.
            const active = routesManager.settings(game.scenes.get(link.sceneId)).active;
            const isActive = active && (link.journeyId ? active.journeyId === link.journeyId : (!active.journeyId && active.routeId === link.routeId));
            if (!isActive && progress.travel.motion.playing) this._once(`claim-${link.sceneId}`, () => routesManager.claimActive(link));
            const scenes = this.linkedScenes(link);
            const onCanvas = scenes.some(scene => scene.id === canvas.scene?.id);
            // The end of the way, when no animated scene on the canvas is watching for it.
            const forward = (progress.travel.motion.masterSpeed ?? 1) >= 0;
            if (!onCanvas && forward && !progress.travel.arrived && progress.effort >= progress.totalEffort - 1e-9) {
                this._once(`arrive-${link.journeyId ?? link.routeId}`, () => this._arrive(link, progress));
            }
        }
    }

    /** Run a change once at a time per key, so the watch does not repeat it while the write is under way. */
    _once(key, fn) {
        if (this._busy.has(key)) return;
        this._busy.add(key);
        Promise.resolve(fn()).finally(() => this._busy.delete(key));
    }

    async _arrive(link, progress) {
        notify(game.i18n.format(`${MODULE.ID}.routes.arrivedNotice`, { name: progress.path.name }));
        await this.stop(link);
        await routesManager.setPathTravel(link, { arrived: true });
        for (const scene of this.linkedScenes(link)) {
            await parallaxManager.commitScene(scene, state => { state.travel.arrived = true; });
        }
    }

    /**
     * Keep the world clock's rate in animated scenes that follow a journey and
     * the clock but are not on the canvas. (The one on the canvas is kept up
     * by manager-travel.js.)
     */
    _recordClockRate(rate = travelManager.constructor.clockApi()?.rate) {
        if (!game.user.isGM || rate === undefined) return;
        const value = Math.max(0, Number(rate) || 0);
        for (const scene of game.scenes.contents) {
            if (scene.id === canvas.scene?.id) continue;
            const travel = scene.getFlag(MODULE.ID, 'parallax')?.travel;
            if (!travel?.route || !travel.followClock || travel.clockRate === value) continue;
            this._once(`clock-${scene.id}`, () => parallaxManager.commitScene(scene, s => { s.travel.clockRate = value; }));
        }
    }
}

export const journeysManager = new JourneysManager();
export { JourneysManager };

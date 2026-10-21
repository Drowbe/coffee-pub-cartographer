// ==================================================================
// ===== TRAVEL DISPLAY =============================================
// ==================================================================

import { MODULE } from './const.js';
import { notify } from './utils-toast.js';
import { parallaxManager } from './manager-parallax.js';
import { routesManager } from './manager-routes.js';
import { journeysManager } from './manager-journeys.js';
import { formatDistance, formatSpan } from './utils-travel.js';

const HUD_ID = `${MODULE.ID}-travel-hud`;
/** Where this viewer has dragged the display, per browser: each player places their own. */
const POSITION_KEY = `${MODULE.ID}.travelHudPosition`;
/** Gap kept from the edge of whatever covers the top of the canvas, and from the screen edges. */
const HUD_MARGIN = 12;
/** How often the numbers are redrawn. Distance creeps; ten times a second reads as live. */
const REFRESH_MS = 100;

/**
 * The odometer, shown: a small panel at the top of the canvas for everyone,
 * and the live figures in the window's Movement tab. Also where arriving is
 * noticed -- on the GM's client only, since only the GM writes the scene.
 *
 * The distance itself is computed by the parallax manager from the shared
 * clock, so every client shows the same number without anything being sent.
 */
class TravelManager {
    constructor() {
        this._hooks = [];
        this._lastDraw = 0;
        this._tick = this._tick.bind(this);
        this._ticking = false;
    }

    initialize() {
        const on = (name, fn) => this._hooks.push({ name, id: Hooks.on(name, fn) });
        on('canvasReady', () => {
            this._start();
            this._recordClockRate();
            this._syncRoute();
        });
        // A route this journey follows was redrawn, on whatever scene.
        on(`${MODULE.ID}.routesChanged`, () => {
            this._syncRoute();
            parallaxManager.window?.render();
        });
        on('canvasTearDown', () => this._stop());
        // Blacksmith's world clock. Its rate is the same on every client, but
        // only the GM writes it into the scene, so the odometer and the scenery
        // change at one shared moment rather than whenever each client hears.
        on('blacksmith.worldClockRateChanged', ({ rate } = {}) => this._recordClockRate(rate));
        this._start();
        this._recordClockRate();
    }

    /** Blacksmith's world clock, if it offers a rate; null when it does not. */
    static clockApi() {
        const clock = game.modules.get('coffee-pub-blacksmith')?.api?.worldClock;
        return clock && 'rate' in clock ? clock : null;
    }

    /**
     * The GM records the clock's rate when it changes and when a scene loads --
     * the change hook does not fire for the state a session starts in. Only
     * for a scene whose odometer follows the clock.
     */
    _recordClockRate(rate = TravelManager.clockApi()?.rate) {
        if (!game.user.isGM || !canvas?.scene || rate === undefined) return;
        if (!parallaxManager.state.travel?.followClock) return;
        void parallaxManager.syncClockRate(rate);
    }

    /**
     * Keep a followed route's length as the destination, in this scene's
     * units. The GM writes it, when the scene loads and when a route changes;
     * a route that is gone, or in units that do not convert, leaves the
     * destination as it was.
     */
    _syncRoute() {
        if (!game.user.isGM || !canvas?.scene) return;
        const travel = parallaxManager.state.travel;
        if (!travel?.route) return;
        const linked = routesManager.linked(travel.route, canvas.scene.grid?.units);
        if (!linked || linked.converted === null) return;
        if (Math.abs(linked.converted - (Number(travel.destination) || 0)) > 1e-6) {
            void parallaxManager.setTravel({ destination: linked.converted });
        }
    }

    _start() {
        if (this._ticking || !canvas?.app?.ticker) return;
        canvas.app.ticker.add(this._tick);
        this._ticking = true;
    }

    _stop() {
        if (this._ticking) canvas?.app?.ticker?.remove(this._tick);
        this._ticking = false;
        document.getElementById(HUD_ID)?.remove();
    }

    /** What the display and the window show, worked out once per redraw. */
    summary(now = game.time.serverTime) {
        const state = parallaxManager.state;
        const travel = state.travel;
        const units = canvas.scene?.grid?.units ?? '';
        const distance = parallaxManager.travelDistance(now);
        const destination = Number.isFinite(Number(travel?.destination)) && travel.destination > 0 ? Number(travel.destination) : null;
        const remaining = destination === null ? null : Math.max(0, destination - distance);
        const progress = destination === null ? null : Math.min(1, Math.max(0, distance / destination));
        // The rest of the way at the party's pace -- the ground layer's speed
        // on the grid, times the master speed -- is an in-world time: an ETA.
        // Without the clock, in-world time is real time. Following a journey,
        // the rest of the way is counted in effort, so difficult terrain ahead
        // makes it longer.
        const speed = Math.abs(Number(state.masterSpeed) || 0);
        const journey = parallaxManager.journeyProgress(now);
        let etaSeconds = null;
        if (journey && journey.travel.pace > 0) {
            // Hours on the road at the party's pace, however fast travel time is run.
            etaSeconds = ((journey.totalEffort - journey.effort) / journey.travel.pace) * 3600;
        } else {
            const perHour = parallaxManager.groundPace() * speed;
            etaSeconds = remaining !== null && perHour > 0 ? (remaining / perHour) * 3600 : null;
        }
        return {
            configured: parallaxManager.isConfigured,
            // Playing: what the odometer's Play/Pause shows and toggles -- this scene.
            playing: !!state.playing,
            link: null,
            showHud: !!travel?.showHud,
            distance,
            destination,
            remaining,
            progress,
            // Within a hair of it: a converted journey length and a converted
            // distance can differ in the last decimal place.
            arrived: destination !== null && distance >= destination * (1 - 1e-9) - 1e-9,
            // The trip's name, when this scene follows a route or journey on a map.
            nameText: journey?.path.name ?? '',
            // Travelling now: the trip's own say when there is one, else this scene's.
            moving: journey ? !!journey.moving : !!state.playing && !!speed,
            traveledText: formatDistance(distance, units),
            remainingText: remaining === null ? '' : formatDistance(remaining, units),
            destinationText: destination === null ? '' : formatDistance(destination, units),
            etaText: etaSeconds === null || remaining === 0 ? '' : formatSpan(etaSeconds)
        };
    }

    _tick() {
        const now = performance.now();
        if (now - this._lastDraw < REFRESH_MS) return;
        this._lastDraw = now;
        if (!canvas?.ready) return;
        const summary = this.summary();
        // On a map, the display shows the route or journey under way there.
        this._drawHud(this.mapSummary() ?? summary);
        this._drawReadouts(summary);
        this._checkArrival(summary);
    }

    /**
     * The odometer for a map: the route or journey the map shows
     * (routesManager.shownPath -- the same one its bar and party marker
     * show), read from its progress, in the same shape as summary().
     *
     * In progress is having set out: moving, stopped along the way or
     * arrived, until it is reset to the start. The odometer stays up through
     * stops, rather than coming and going with Play; it goes only when
     * nothing on the map is in progress. Null then.
     */
    mapSummary(now = game.time.serverTime) {
        const scene = canvas?.scene;
        if (!scene) return null;
        const underWay = link => {
            const progress = routesManager.progress(link, now);
            return progress && (progress.moving || progress.effort > 0) ? progress : null;
        };
        // What is moving first, wherever it is driven from; then the last played here.
        // The same trip the bar and the party marker show (routesManager.shownPath), so the
        // odometer and the marker never disagree about where the party is.
        const shown = routesManager.shownPath(scene);
        const progress = shown ? underWay(shown) : null;
        if (!progress) return null;
        const units = scene.grid?.units ?? '';
        const remaining = Math.max(0, progress.length - progress.distance);
        const pace = Number(progress.travel.pace) || 0;
        // The rest of the way as hours on the road at the party's pace -- travel
        // time, however fast it is run -- counted in effort, so difficult
        // terrain ahead makes it longer.
        const etaSeconds = pace > 0 ? ((progress.totalEffort - progress.effort) / pace) * 3600 : null;
        const arrived = progress.travel.arrived || progress.distance >= progress.length * (1 - 1e-9) - 1e-9;
        return {
            configured: true,
            // Playing: the trip the map shows, which the odometer's Play/Pause toggles.
            playing: !!progress.travel.motion.playing,
            link: shown,
            showHud: true,
            distance: progress.distance,
            destination: progress.length,
            remaining,
            progress: progress.length > 0 ? Math.min(1, progress.distance / progress.length) : 0,
            arrived,
            nameText: progress.path.name ?? '',
            moving: !!progress.moving,
            traveledText: formatDistance(progress.distance, units),
            remainingText: formatDistance(remaining, units),
            destinationText: formatDistance(progress.length, units),
            etaText: etaSeconds === null || remaining === 0 ? '' : formatSpan(etaSeconds)
        };
    }

    _drawHud(summary) {
        let hud = document.getElementById(HUD_ID);
        if (!summary.configured || !summary.showHud) {
            hud?.remove();
            return;
        }
        if (!hud) {
            hud = document.createElement('div');
            hud.id = HUD_ID;
            hud.className = 'cartographer-travel-hud';
            hud.dataset.tooltip = game.i18n.localize(`${MODULE.ID}.parallax.travelHudDragHint`);
            hud.innerHTML = `
                <div class="cartographer-travel-hud-name" data-travel-hud="name"></div>
                <div class="cartographer-travel-hud-row">
                    <i class="fa-solid fa-route"></i>
                    <span data-travel-hud="traveled"></span>
                    <span class="cartographer-travel-hud-remaining" data-travel-hud="remaining"></span>
                    <span class="cartographer-travel-hud-controls" data-travel-hud="controls" hidden>
                        <span class="cartographer-travel-hud-control" data-travel-control="toggle"></span>
                        <span class="cartographer-travel-hud-control" data-travel-control="end"><i class="fa-solid fa-stop"></i></span>
                        <span class="cartographer-travel-hud-control" data-travel-control="reset"><i class="fa-solid fa-backward-fast"></i></span>
                    </span>
                </div>
                <div class="cartographer-travel-hud-bar"><div class="cartographer-travel-hud-fill" data-travel-hud="fill"></div></div>`;
            document.body.appendChild(hud);
            this._placeHud(hud);
            this._makeDraggable(hud);
        }
        const localize = key => game.i18n.localize(`${MODULE.ID}.parallax.${key}`);
        hud.querySelector('[data-travel-hud="traveled"]').textContent = summary.traveledText;
        this._drawControls(hud, summary);
        // The trip it is counting: a route or journey's name, when there is one.
        const name = hud.querySelector('[data-travel-hud="name"]');
        name.textContent = summary.nameText ?? '';
        name.hidden = !summary.nameText;
        const remaining = hud.querySelector('[data-travel-hud="remaining"]');
        const bar = hud.querySelector('.cartographer-travel-hud-bar');
        if (summary.destination === null) {
            remaining.textContent = '';
            bar.hidden = true;
        } else {
            remaining.textContent = summary.arrived
                ? localize('travelArrived')
                : game.i18n.format(`${MODULE.ID}.parallax.travelToGo`, { distance: summary.remainingText })
                    + (summary.etaText ? ` · ${game.i18n.format(`${MODULE.ID}.parallax.travelEta`, { time: summary.etaText })}` : '');
            bar.hidden = false;
            hud.querySelector('[data-travel-hud="fill"]').style.width = `${(summary.progress * 100).toFixed(1)}%`;
        }
        hud.classList.toggle('is-arrived', summary.arrived);
        // Miles tick over slowly; this says at a glance that the party is on the move.
        hud.classList.toggle('is-moving', !!summary.moving && !summary.arrived);
    }

    // ==================================================================
    // ===== PLACING AND MOVING THE DISPLAY =============================
    // ==================================================================

    _savedPosition() {
        try {
            return JSON.parse(localStorage.getItem(POSITION_KEY));
        } catch {
            return null;
        }
    }

    /**
     * Put the display where this viewer left it, or by default on the scene
     * itself: centred over the map, just inside its top edge as it sits on
     * screen. Never in the top 15% of the screen, which is where Foundry's
     * navigation and module menubars live -- a menubar can let clicks through,
     * so it cannot be found by asking what is under a point, and is kept clear
     * of instead.
     */
    _placeHud(hud) {
        const saved = this._savedPosition();
        if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) {
            this._moveHud(hud, saved.left, saved.top);
            return;
        }
        const width = hud.offsetWidth;
        const rect = canvas?.dimensions?.sceneRect;
        const sceneTop = rect && canvas.clientCoordinatesFromCanvas
            ? canvas.clientCoordinatesFromCanvas({ x: rect.x + rect.width / 2, y: rect.y })
            : null;
        const centre = sceneTop?.x ?? window.innerWidth / 2;
        const floor = window.innerHeight * 0.15;
        const top = Math.max(floor, (sceneTop?.y ?? floor) + HUD_MARGIN);
        this._moveHud(hud, centre - width / 2, top);
    }

    /** Move within the screen, so a display dragged off an edge, or left there by a smaller window, comes back. */
    _moveHud(hud, left, top) {
        const maxLeft = Math.max(0, window.innerWidth - hud.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - hud.offsetHeight);
        hud.style.left = `${Math.min(Math.max(0, left), maxLeft)}px`;
        hud.style.top = `${Math.min(Math.max(0, top), maxTop)}px`;
    }

    /**
     * The GM's controls, at the odometer's right: Play/Pause, saying what
     * pressing it will do, and Back to the start. Players have none; the
     * route icon at the left stays the odometer's own. Redrawn only when the
     * play state changes.
     */
    _drawControls(hud, summary) {
        const controls = hud.querySelector('[data-travel-hud="controls"]');
        if (!controls) return;
        this._hudSummary = summary;
        controls.hidden = !game.user.isGM;
        if (!game.user.isGM) return;
        const toggle = controls.querySelector('[data-travel-control="toggle"]');
        const state = summary.playing ? 'pause' : 'play';
        if (toggle.dataset.state !== state) {
            toggle.dataset.state = state;
            toggle.dataset.tooltip = game.i18n.localize(`${MODULE.ID}.routes.${summary.playing ? 'stop' : 'play'}`);
            toggle.innerHTML = `<i class="fa-solid ${summary.playing ? 'fa-pause' : 'fa-play'}"></i>`;
        }
        const reset = controls.querySelector('[data-travel-control="reset"]');
        reset.dataset.tooltip ??= game.i18n.localize(`${MODULE.ID}.routes.resetJourney`);
        const end = controls.querySelector('[data-travel-control="end"]');
        end.dataset.tooltip ??= game.i18n.localize(`${MODULE.ID}.routes.endTrip`);
    }

    /** A control on the odometer: Play/Pause or Back to the start, for the map's trip or this scene. */
    async _control(which) {
        const summary = this._hudSummary;
        if (!game.user.isGM || !summary) return;
        if (which === 'toggle') {
            if (summary.link) await journeysManager.toggle(summary.link);
            else await parallaxManager.togglePlaying();
            return;
        }
        // Stop and Back to the start both lose how far the party had come: ask first, as the bar does.
        const ending = which === 'end';
        const ok = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize(`${MODULE.ID}.routes.${ending ? 'endTrip' : 'resetJourney'}`) },
            content: `<p>${foundry.utils.escapeHTML(game.i18n.format(`${MODULE.ID}.routes.${ending ? 'endConfirm' : 'resetConfirm'}`, { name: summary.nameText || '' }))}</p>`,
            rejectClose: false
        });
        if (!ok) return;
        if (ending && summary.link) await journeysManager.end(summary.link);
        else if (ending) {
            // An animated scene: its trip, if it follows one, ends on its map; else its own odometer.
            const link = parallaxManager.state.travel?.route;
            await parallaxManager.stop();
            if (link) await journeysManager.end(link);
            else await parallaxManager.resetOdometer();
        } else if (summary.link) await journeysManager.reset(summary.link);
        else await parallaxManager.resetOdometer();
    }

    /** Drag anywhere on it but its controls; the spot is remembered for this viewer. */
    _makeDraggable(hud) {
        let drag = null;
        // The GM's controls: a click on one, never the start of a drag.
        hud.addEventListener('click', event => {
            const control = event.target.closest('[data-travel-control]');
            if (!control || !game.user.isGM) return;
            event.stopPropagation();
            void this._control(control.dataset.travelControl);
        });
        hud.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            if (game.user.isGM && event.target.closest('[data-travel-control]')) return;
            const rect = hud.getBoundingClientRect();
            drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
            hud.setPointerCapture(event.pointerId);
            hud.classList.add('is-dragging');
            event.preventDefault();
        });
        hud.addEventListener('pointermove', event => {
            if (!drag) return;
            this._moveHud(hud, event.clientX - drag.dx, event.clientY - drag.dy);
        });
        const end = event => {
            if (!drag) return;
            drag = null;
            hud.releasePointerCapture?.(event.pointerId);
            hud.classList.remove('is-dragging');
            try {
                localStorage.setItem(POSITION_KEY, JSON.stringify({ left: parseFloat(hud.style.left), top: parseFloat(hud.style.top) }));
            } catch {
                // Storage unavailable: the spot lasts until the page reloads.
            }
        };
        hud.addEventListener('pointerup', end);
        hud.addEventListener('pointercancel', end);
        // A double-click opens the window that runs what the odometer shows: the
        // Routes window on a map, the scene-motion window on an animated scene
        // (the GM's). A right-click puts the display back where it started.
        hud.addEventListener('dblclick', event => {
            if (event.target.closest('[data-travel-control]')) return;
            this.openTool();
        });
        hud.addEventListener('contextmenu', event => {
            event.preventDefault();
            try {
                localStorage.removeItem(POSITION_KEY);
            } catch {
                // Nothing saved to remove.
            }
            this._placeHud(hud);
        });
    }

    /** Open the tool window for what the odometer is showing. */
    openTool() {
        if (this.mapSummary()) return routesManager.openWindow();
        if (game.user.isGM) return parallaxManager.openWindow();
        return null;
    }

    /** The live figures in the window's Movement tab, if it is showing. */
    _drawReadouts(summary) {
        for (const el of document.querySelectorAll('[data-travel-readout]')) {
            const key = el.dataset.travelReadout;
            if (key === 'traveled') el.textContent = summary.traveledText;
            else if (key === 'remaining') el.textContent = summary.remainingText || '--';
            else if (key === 'eta') el.textContent = summary.etaText || '--';
            else if (key === 'progress') el.style.width = `${((summary.progress ?? 0) * 100).toFixed(1)}%`;
        }
    }

    /**
     * Reaching the destination happens once: the GM's client marks it, and
     * stops the scenery if asked to. A new destination, a new scale or a reset
     * odometer clears the mark, so the next arrival counts.
     */
    _checkArrival(summary) {
        if (!game.user.isGM || !summary.arrived || this._arriving) return;
        const travel = parallaxManager.state.travel;
        if (travel.arrived || !parallaxManager.state.playing) return;
        this._arriving = true;
        notify(game.i18n.format(`${MODULE.ID}.parallax.travelArrivedNotice`, { distance: summary.destinationText }));
        Promise.resolve(parallaxManager.arrive()).finally(() => { this._arriving = false; });
    }
}

export const travelManager = new TravelManager();

// ==================================================================
// ===== TRAVEL DISPLAY =============================================
// ==================================================================

import { MODULE } from './const.js';
import { parallaxManager } from './manager-parallax.js';
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
        // Without the clock, in-world time is real time.
        const perHour = parallaxManager.groundPace() * Math.abs(Number(state.masterSpeed) || 0);
        const etaSeconds = remaining !== null && perHour > 0 ? (remaining / perHour) * 3600 : null;
        return {
            configured: parallaxManager.isConfigured,
            showHud: !!travel?.showHud,
            distance,
            destination,
            remaining,
            progress,
            arrived: destination !== null && distance >= destination,
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
        this._drawHud(summary);
        this._drawReadouts(summary);
        this._checkArrival(summary);
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
                <div class="cartographer-travel-hud-row">
                    <i class="fa-solid fa-route"></i>
                    <span data-travel-hud="traveled"></span>
                    <span class="cartographer-travel-hud-remaining" data-travel-hud="remaining"></span>
                </div>
                <div class="cartographer-travel-hud-bar"><div class="cartographer-travel-hud-fill" data-travel-hud="fill"></div></div>`;
            document.body.appendChild(hud);
            this._placeHud(hud);
            this._makeDraggable(hud);
        }
        const localize = key => game.i18n.localize(`${MODULE.ID}.parallax.${key}`);
        hud.querySelector('[data-travel-hud="traveled"]').textContent = summary.traveledText;
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

    /** Drag anywhere on it; the spot is remembered for this viewer. A double-click puts it back. */
    _makeDraggable(hud) {
        let drag = null;
        hud.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
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
        hud.addEventListener('dblclick', () => {
            try {
                localStorage.removeItem(POSITION_KEY);
            } catch {
                // Nothing saved to remove.
            }
            this._placeHud(hud);
        });
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
        ui.notifications.info(game.i18n.format(`${MODULE.ID}.parallax.travelArrivedNotice`, { distance: summary.destinationText }));
        Promise.resolve(parallaxManager.arrive()).finally(() => { this._arriving = false; });
    }
}

export const travelManager = new TravelManager();

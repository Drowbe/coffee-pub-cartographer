// ==================================================================
// ===== TRAVEL DISPLAY =============================================
// ==================================================================

import { MODULE } from './const.js';
import { parallaxManager } from './manager-parallax.js';
import { formatDistance } from './utils-travel.js';

const HUD_ID = `${MODULE.ID}-travel-hud`;
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
        on('canvasReady', () => this._start());
        on('canvasTearDown', () => this._stop());
        this._start();
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
            destinationText: destination === null ? '' : formatDistance(destination, units)
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
            hud.innerHTML = `
                <div class="cartographer-travel-hud-row">
                    <i class="fa-solid fa-route"></i>
                    <span data-travel-hud="traveled"></span>
                    <span class="cartographer-travel-hud-remaining" data-travel-hud="remaining"></span>
                </div>
                <div class="cartographer-travel-hud-bar"><div class="cartographer-travel-hud-fill" data-travel-hud="fill"></div></div>`;
            document.body.appendChild(hud);
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
                : game.i18n.format(`${MODULE.ID}.parallax.travelToGo`, { distance: summary.remainingText });
            bar.hidden = false;
            hud.querySelector('[data-travel-hud="fill"]').style.width = `${(summary.progress * 100).toFixed(1)}%`;
        }
        hud.classList.toggle('is-arrived', summary.arrived);
    }

    /** The live figures in the window's Movement tab, if it is showing. */
    _drawReadouts(summary) {
        for (const el of document.querySelectorAll('[data-travel-readout]')) {
            const key = el.dataset.travelReadout;
            if (key === 'traveled') el.textContent = summary.traveledText;
            else if (key === 'remaining') el.textContent = summary.remainingText || '--';
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

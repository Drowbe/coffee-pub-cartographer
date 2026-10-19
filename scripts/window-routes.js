// ==================================================================
// ===== ROUTES WINDOW ==============================================
// ==================================================================

import { MODULE } from './const.js';
import { ROUTE_COLORS } from './manager-routes.js';
import { formatDistance, formatSpan, paceChoices, PACE_GROUPS } from './utils-travel.js';
// Imported from the bridge, not module.api: see the note in window-mapping.js.
import { BlacksmithToolWindowBaseV2 } from '/modules/coffee-pub-blacksmith/api/blacksmith-api.js';

const APP_ID = `${MODULE.ID}-routes`;
/** The window's choices, per browser: the pace times are shown at, and which routes show their legs. */
const PREFS_KEY = `${MODULE.ID}.routes.windowPrefs`;
/** Hours of travel in a day, for "travel days". */
const TRAVEL_HOURS_PER_DAY = 8;

function readPrefs() {
    try {
        return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') ?? {};
    } catch {
        return {};
    }
}

function writePrefs(prefs) {
    try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
        // Storage can be unavailable (private windows); the prefs just do not stick.
    }
}

/**
 * The scene's routes: each with its length, its legs, and how long it takes
 * at a chosen pace. Drawing a new one starts from the bar. The window shares
 * the scene-motion window's styles (`cartographer-parallax-window`).
 */
export class RoutesWindow extends BlacksmithToolWindowBaseV2 {
    // A plain object: see the note on ParallaxWindow.DEFAULT_OPTIONS.
    static DEFAULT_OPTIONS = {
        id: APP_ID,
        classes: ['cartographer-parallax-window', 'cartographer-routes-window'],
        // A number, not 'auto', for the reason given on ParallaxWindow.
        position: { width: 380, height: 420 },
        window: {
            title: `${MODULE.ID}.routes.windowTitle`,
            icon: 'fa-solid fa-route',
            resizable: true,
            minimizable: true
        },
        toolTheme: 'glass',
        windowSizeConstraints: { minWidth: 300 }
    };

    static ACTION_HANDLERS = {
        'route-draw': (_event, _target, app) => (app.manager.draft ? app.manager.finishDrawing() : app.manager.startDrawing()),
        'route-focus': (_event, target, app) => void app.manager.focus(target.dataset.routeId),
        'route-rename': (_event, target, app) => app.promptRename(target.dataset.routeId),
        'route-color': (_event, target, app) => app.cycleColor(target.dataset.routeId),
        'route-legs': (_event, target, app) => app.toggleLegs(target.dataset.routeId),
        'route-remove': (_event, target, app) => app.confirmRemove(target.dataset.routeId)
    };

    static async open(manager) {
        const existing = foundry.applications?.instances?.get(APP_ID);
        if (existing) {
            existing.manager = manager;
            existing.bringToFront?.();
            return existing;
        }
        const window = new RoutesWindow(manager);
        await window.render({ force: true });
        return window;
    }

    constructor(manager, options = {}) {
        super(options);
        this.manager = manager;
        const prefs = readPrefs();
        this.paceId = prefs.paceId ?? null;
        this.expanded = new Set(prefs.expanded ?? []);
        this._onChange = this._onChange.bind(this);
    }

    _savePrefs() {
        writePrefs({ paceId: this.paceId, expanded: [...this.expanded] });
    }

    _paces(units) {
        return paceChoices(game.system?.id, CONFIG, units,
            pace => game.i18n.localize(pace.label ?? `${MODULE.ID}.parallax.pace.${pace.id}`));
    }

    async getData() {
        const localize = key => game.i18n.localize(`${MODULE.ID}.routes.${key}`);
        const scene = canvas.scene;
        const grid = scene?.grid;
        const units = grid?.units ?? '';
        const paces = this._paces(units);
        // The pace times are shown at: the one chosen here, or the system's
        // normal pace (or plain walking) to start with.
        const pace = paces.find(p => p.id === this.paceId)
            ?? paces.find(p => p.id === 'dnd5e.normal') ?? paces.find(p => p.id === 'walking') ?? paces[0] ?? null;

        const routes = this.manager.routes(scene).map(route => {
            const { distance, legs } = this.manager.measure(route, scene);
            const hours = pace?.perHour ? distance / pace.perHour : null;
            return {
                id: route.id,
                name: route.name,
                color: route.color,
                length: formatDistance(distance, units),
                legCount: legs.length,
                legsText: game.i18n.format(`${MODULE.ID}.routes.${legs.length === 1 ? 'oneLeg' : 'legs'}`, { count: legs.length }),
                timeText: hours === null ? '' : game.i18n.format(`${MODULE.ID}.routes.time`, {
                    time: formatSpan(hours * 3600),
                    days: Math.round((hours / TRAVEL_HOURS_PER_DAY) * 10) / 10
                }),
                expanded: this.expanded.has(route.id),
                legs: legs.map((leg, index) => ({ number: index + 1, length: formatDistance(leg, units) }))
            };
        });

        const bodyContent = await foundry.applications.handlebars.renderTemplate(
            `modules/${MODULE.ID}/templates/window-routes.hbs`,
            {
                routes,
                hasGrid: !!grid?.size && !!grid?.distance,
                gridText: grid?.size ? game.i18n.format(`${MODULE.ID}.parallax.measureGridValue`, { size: grid.size, distance: grid.distance, units }) : '',
                pace: pace?.label ?? '',
                drawing: !!this.manager.draft
            }
        );

        const drawing = !!this.manager.draft;
        const drawLabel = localize(drawing ? 'finishDrawing' : 'draw');
        const draw = `<button type="button" class="cartographer-parallax-button is-labelled${drawing ? ' is-active' : ''}" data-action="route-draw" data-tooltip="${foundry.utils.escapeHTML(localize('drawHint'))}"><i class="fa-solid ${drawing ? 'fa-check' : 'fa-route'}"></i><span>${foundry.utils.escapeHTML(drawLabel)}</span></button>`;
        const paceSelect = paces.length
            ? `<select class="cartographer-routes-pace" data-field="routePace" data-tooltip="${foundry.utils.escapeHTML(localize('paceHint'))}">${PACE_GROUPS.map(group => {
                const options = paces.filter(p => p.group === group)
                    .map(p => `<option value="${p.id}"${p === pace ? ' selected' : ''}>${foundry.utils.escapeHTML(p.label)}</option>`).join('');
                return options ? `<optgroup label="${foundry.utils.escapeHTML(game.i18n.localize(`${MODULE.ID}.parallax.paceGroup.${group}`))}">${options}</optgroup>` : '';
            }).join('')}</select>`
            : '';
        return {
            appId: this.id,
            bodyContent,
            showToolBar: true,
            toolBarLeft: draw,
            toolBarRight: paceSelect
        };
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        if (this._inputsBound || !this.element) return;
        this.element.addEventListener('change', this._onChange);
        this._inputsBound = true;
    }

    _onChange(event) {
        if (event.target?.dataset?.field !== 'routePace') return;
        this.paceId = event.target.value;
        this._savePrefs();
        this.render();
    }

    toggleLegs(id) {
        if (this.expanded.has(id)) this.expanded.delete(id);
        else this.expanded.add(id);
        this._savePrefs();
        this.render();
    }

    async cycleColor(id) {
        const route = this.manager.get(id);
        if (!route) return;
        const next = ROUTE_COLORS[(ROUTE_COLORS.indexOf(route.color) + 1) % ROUTE_COLORS.length];
        await this.manager.update(id, { color: next });
    }

    async promptRename(id) {
        const route = this.manager.get(id);
        if (!route) return;
        const name = await foundry.applications.api.DialogV2.prompt({
            window: { title: game.i18n.localize(`${MODULE.ID}.routes.rename`), icon: 'fa-solid fa-pen' },
            content: `<input type="text" name="name" value="${foundry.utils.escapeHTML(route.name)}" autofocus>`,
            ok: { callback: (_event, button) => button.form.elements.name.value },
            rejectClose: false
        });
        const label = String(name ?? '').trim();
        if (label && label !== route.name) await this.manager.update(id, { name: label });
    }

    async confirmRemove(id) {
        const route = this.manager.get(id);
        if (!route) return;
        const ok = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize(`${MODULE.ID}.routes.remove`) },
            content: `<p>${foundry.utils.escapeHTML(game.i18n.format(`${MODULE.ID}.routes.removeConfirm`, { name: route.name }))}</p>`,
            rejectClose: false
        });
        if (ok) await this.manager.remove(id);
    }

    _onClose(options) {
        this.manager?.onWindowClosed(this);
        return super._onClose?.(options);
    }
}

// ==================================================================
// ===== ROUTES WINDOW ==============================================
// ==================================================================

import { MODULE } from './const.js';
import { ROUTE_COLORS } from './manager-routes.js';
import { formatDistance, formatSpan, paceChoices, PACE_GROUPS, gridStep } from './utils-travel.js';
import { legTerrains, travelHours, terrainFactor, TERRAINS } from './utils-routes.js';
// Imported from the bridge, not module.api: see the note in window-mapping.js.
import { BlacksmithToolWindowBaseV2 } from '/modules/coffee-pub-blacksmith/api/blacksmith-api.js';

const APP_ID = `${MODULE.ID}-routes`;
/** The window's choices, per browser: the tab, the pace times are shown at, and which routes show their legs. */
const PREFS_KEY = `${MODULE.ID}.routes.windowPrefs`;
/** Hours of travel in a day, for "travel days". */
const TRAVEL_HOURS_PER_DAY = 8;
const TABS = [
    { id: 'routes', icon: 'fa-solid fa-route', labelKey: 'tabRoutes' },
    { id: 'journeys', icon: 'fa-solid fa-map-signs', labelKey: 'tabJourneys' }
];

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
 * The map's routes and journeys: each with its length, its legs and their
 * terrain, and how long it takes at a chosen pace. Drawing a new route starts
 * from the bar. The window shares the scene-motion window's styles
 * (`cartographer-parallax-window`).
 */
export class RoutesWindow extends BlacksmithToolWindowBaseV2 {
    // A plain object: see the note on ParallaxWindow.DEFAULT_OPTIONS.
    static DEFAULT_OPTIONS = {
        id: APP_ID,
        classes: ['cartographer-parallax-window', 'cartographer-routes-window'],
        // A number, not 'auto', for the reason given on ParallaxWindow.
        position: { width: 400, height: 480 },
        window: {
            title: `${MODULE.ID}.routes.windowTitle`,
            icon: 'fa-solid fa-route',
            resizable: true,
            minimizable: true
        },
        toolTheme: 'glass',
        windowSizeConstraints: { minWidth: 320 }
    };

    static ACTION_HANDLERS = {
        'routes-tab': (_event, target, app) => app.setTab(target.dataset.tab),
        'route-draw': (_event, _target, app) => (app.manager.draft ? app.manager.finishDrawing() : app.manager.startDrawing()),
        'route-focus': (_event, target, app) => void app.manager.focus(target.dataset.routeId),
        'route-rename': (_event, target, app) => app.promptRename(target.dataset.routeId),
        'route-color': (_event, target, app) => app.cycleColor(target.dataset.routeId),
        'route-hide': (_event, target, app) => app.toggleHidden(target.dataset.routeId),
        'route-edit': (_event, target, app) => app.manager.toggleEditing(target.dataset.routeId),
        'route-legs': (_event, target, app) => app.toggleLegs(target.dataset.routeId),
        'route-remove': (_event, target, app) => app.confirmRemove(target.dataset.routeId),
        'journey-new': (_event, _target, app) => app.promptNewJourney(),
        'journey-focus': (_event, target, app) => void app.manager.focus({ journeyId: target.dataset.journeyId }),
        'journey-rename': (_event, target, app) => app.promptRenameJourney(target.dataset.journeyId),
        'journey-remove': (_event, target, app) => app.confirmRemoveJourney(target.dataset.journeyId),
        'journey-move': (_event, target, app) => app.moveJourneyRoute(target.dataset.journeyId, Number(target.dataset.index), Number(target.dataset.by)),
        'journey-drop': (_event, target, app) => app.dropJourneyRoute(target.dataset.journeyId, Number(target.dataset.index))
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
        this.tab = TABS.some(tab => tab.id === prefs.tab) ? prefs.tab : 'routes';
        this.paceId = prefs.paceId ?? null;
        this.expanded = new Set(prefs.expanded ?? []);
        this._onChange = this._onChange.bind(this);
    }

    _savePrefs() {
        writePrefs({ tab: this.tab, paceId: this.paceId, expanded: [...this.expanded] });
    }

    _paces(units) {
        return paceChoices(game.system?.id, CONFIG, units,
            pace => game.i18n.localize(pace.label ?? `${MODULE.ID}.parallax.pace.${pace.id}`));
    }

    /** "20.7 h of travel (~2.6 days at 8 h)", or nothing without a pace. */
    _timeText(hours) {
        if (hours === null || hours === undefined) return '';
        return game.i18n.format(`${MODULE.ID}.routes.time`, {
            time: formatSpan(hours * 3600),
            days: Math.round((hours / TRAVEL_HOURS_PER_DAY) * 10) / 10
        });
    }

    _terrainOptions(selected) {
        return TERRAINS.map(terrain => ({
            id: terrain.id,
            label: game.i18n.format(`${MODULE.ID}.routes.terrainOption`, {
                name: game.i18n.localize(`${MODULE.ID}.routes.terrain.${terrain.id}`),
                speed: terrain.factor === 1 ? game.i18n.localize(`${MODULE.ID}.routes.terrainNormal`) : game.i18n.localize(`${MODULE.ID}.routes.terrainHalf`)
            }),
            selected: terrain.id === selected
        }));
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

        const visible = this.manager.visibleRoutes(scene);
        const routes = visible.map(route => {
            const { distance, legs } = this.manager.measure(route, scene);
            const terrain = this.manager.editing?.id === route.id ? this.manager.editing.terrain : legTerrains(route.points, route.terrain);
            const maker = route.userId && route.userId !== game.user.id ? game.users.get(route.userId)?.name : null;
            const canEdit = this.manager.canEdit(route);
            const allSame = terrain.every(t => t === terrain[0]);
            return {
                id: route.id,
                name: route.name,
                color: route.color,
                canEdit,
                hidden: !!route.hidden,
                editing: this.manager.editing?.id === route.id,
                maker,
                length: formatDistance(distance, units),
                legsText: game.i18n.format(`${MODULE.ID}.routes.${legs.length === 1 ? 'oneLeg' : 'legs'}`, { count: legs.length }),
                difficult: terrain.some(t => terrainFactor(t) < 1),
                timeText: this._timeText(travelHours(legs, terrain, pace?.perHour)),
                expanded: this.expanded.has(route.id),
                // One choice for every leg; "mixed" when the legs differ.
                allTerrain: allSame ? this._terrainOptions(terrain[0]) : [
                    { id: '', label: localize('terrainMixed'), selected: true },
                    ...this._terrainOptions(null)
                ],
                legs: legs.map((leg, index) => ({
                    index,
                    number: index + 1,
                    length: formatDistance(leg, units),
                    terrainName: localize(`terrain.${terrain[index]}`),
                    terrain: this._terrainOptions(terrain[index])
                }))
            };
        });

        const journeys = this.manager.journeys(scene).map(journey => {
            const path = this.manager.path({ journeyId: journey.id }, scene);
            const { distance, legs } = this.manager.measure(path, scene);
            const canEdit = this.manager.canEdit(journey);
            const members = journey.routeIds.map(id => visible.find(route => route.id === id)).filter(Boolean);
            return {
                id: journey.id,
                name: journey.name,
                canEdit,
                length: formatDistance(distance, units),
                timeText: this._timeText(travelHours(legs, path.terrain, pace?.perHour)),
                gapText: path.gaps.length
                    ? game.i18n.format(`${MODULE.ID}.routes.${path.gaps.length === 1 ? 'oneGap' : 'gaps'}`, { count: path.gaps.length })
                    : '',
                routes: members.map((route, index) => ({
                    index,
                    number: index + 1,
                    name: route.name,
                    color: route.color,
                    length: formatDistance(this.manager.measure(route, scene).distance, units),
                    // A gap after this route, before the next.
                    gapAfter: path.gaps.some(gap => gap.after === index),
                    isFirst: index === 0,
                    isLast: index === members.length - 1
                })),
                addable: visible.map(route => ({ id: route.id, name: route.name }))
            };
        });

        const bodyContent = await foundry.applications.handlebars.renderTemplate(
            `modules/${MODULE.ID}/templates/window-routes.hbs`,
            {
                tabs: TABS.map(tab => ({
                    id: tab.id,
                    icon: tab.icon,
                    label: localize(tab.labelKey),
                    active: tab.id === this.tab,
                    count: tab.id === 'routes' ? routes.length : journeys.length
                })),
                isRoutes: this.tab === 'routes',
                routes,
                journeys,
                hasGrid: !!grid?.size && !!grid?.distance,
                gridText: grid?.size ? game.i18n.format(`${MODULE.ID}.parallax.${grid.isHexagonal ? 'measureHexValue' : 'measureGridValue'}`,
                    { size: Math.round(gridStep(grid) * 10) / 10, distance: grid.distance, units }) : '',
                pace: pace?.label ?? '',
                drawing: !!this.manager.draft,
                showing: this.manager.show
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
        const target = event.target;
        const field = target?.dataset?.field;
        if (field === 'routePace') {
            this.paceId = target.value;
            this._savePrefs();
            this.render();
        } else if (field === 'legTerrain') {
            void this.manager.setTerrain(target.dataset.routeId, Number(target.dataset.leg), target.value);
        } else if (field === 'routeTerrain' && target.value) {
            void this.manager.setTerrain(target.dataset.routeId, null, target.value);
        } else if (field === 'journeyAdd' && target.value) {
            const journey = this.manager.getJourney(target.dataset.journeyId);
            if (journey) void this.manager.updateJourney(journey.id, { routeIds: [...journey.routeIds, target.value] });
        }
    }

    setTab(tab) {
        if (!TABS.some(entry => entry.id === tab)) return;
        this.tab = tab;
        this._savePrefs();
        this.render();
    }

    toggleLegs(id) {
        if (this.expanded.has(id)) this.expanded.delete(id);
        else this.expanded.add(id);
        this._savePrefs();
        this.render();
    }

    async toggleHidden(id) {
        const route = this.manager.get(id);
        if (route) await this.manager.update(id, { hidden: !route.hidden });
    }

    async cycleColor(id) {
        const route = this.manager.get(id);
        if (!route) return;
        const next = ROUTE_COLORS[(ROUTE_COLORS.indexOf(route.color) + 1) % ROUTE_COLORS.length];
        await this.manager.update(id, { color: next });
    }

    async _promptName(titleKey, current) {
        const name = await foundry.applications.api.DialogV2.prompt({
            window: { title: game.i18n.localize(`${MODULE.ID}.routes.${titleKey}`), icon: 'fa-solid fa-pen' },
            content: `<input type="text" name="name" value="${foundry.utils.escapeHTML(current ?? '')}" autofocus>`,
            ok: { callback: (_event, button) => button.form.elements.name.value },
            rejectClose: false
        });
        return String(name ?? '').trim();
    }

    async _confirm(titleKey, bodyKey, name) {
        return foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize(`${MODULE.ID}.routes.${titleKey}`) },
            content: `<p>${foundry.utils.escapeHTML(game.i18n.format(`${MODULE.ID}.routes.${bodyKey}`, { name }))}</p>`,
            rejectClose: false
        });
    }

    async promptRename(id) {
        const route = this.manager.get(id);
        if (!route) return;
        const label = await this._promptName('rename', route.name);
        if (label && label !== route.name) await this.manager.update(id, { name: label });
    }

    async confirmRemove(id) {
        const route = this.manager.get(id);
        if (route && await this._confirm('remove', 'removeConfirm', route.name)) await this.manager.remove(id);
    }

    async promptNewJourney() {
        const label = await this._promptName('newJourney', this.manager._nextName(this.manager.journeys(), 'defaultJourney'));
        if (label) await this.manager.addJourney({ name: label });
    }

    async promptRenameJourney(id) {
        const journey = this.manager.getJourney(id);
        if (!journey) return;
        const label = await this._promptName('renameJourney', journey.name);
        if (label && label !== journey.name) await this.manager.updateJourney(id, { name: label });
    }

    async confirmRemoveJourney(id) {
        const journey = this.manager.getJourney(id);
        if (journey && await this._confirm('removeJourney', 'removeJourneyConfirm', journey.name)) await this.manager.removeJourney(id);
    }

    /**
     * Move a route within its journey. The index is among the routes this user
     * can see; it is mapped back onto the journey's full list, so a route
     * hidden from them keeps its place.
     */
    async moveJourneyRoute(id, index, by) {
        const journey = this.manager.getJourney(id);
        if (!journey) return;
        const ids = this._shownIds(journey);
        const from = journey.routeIds.indexOf(ids[index]);
        const to = journey.routeIds.indexOf(ids[index + by]);
        if (from < 0 || to < 0) return;
        const routeIds = [...journey.routeIds];
        [routeIds[from], routeIds[to]] = [routeIds[to], routeIds[from]];
        await this.manager.updateJourney(id, { routeIds });
    }

    async dropJourneyRoute(id, index) {
        const journey = this.manager.getJourney(id);
        if (!journey) return;
        const target = this._shownIds(journey)[index];
        const at = journey.routeIds.indexOf(target);
        if (at < 0) return;
        await this.manager.updateJourney(id, { routeIds: journey.routeIds.filter((_, i) => i !== at) });
    }

    _shownIds(journey) {
        const visible = new Set(this.manager.visibleRoutes().map(route => route.id));
        return journey.routeIds.filter(routeId => visible.has(routeId));
    }

    _onClose(options) {
        this.manager?.onWindowClosed(this);
        return super._onClose?.(options);
    }
}

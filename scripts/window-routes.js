// ==================================================================
// ===== ROUTES WINDOW ==============================================
// ==================================================================

import { MODULE } from './const.js';
import { travelPinsManager } from './manager-travelpins.js';
import { journeysManager } from './manager-journeys.js';
import { formatDistance, formatSpan, paceChoices, PACE_GROUPS, gridStep } from './utils-travel.js';
import {
    legTerrains, travelHours, terrainFactor, TERRAINS, travelPlan, MOUNT_HOURS_PER_DAY, FORCED_MARCH_HOURS,
    TIME_RATES, timeRateIndex
} from './utils-routes.js';
// Imported from the bridge, not module.api: see the note in window-mapping.js.
import { BlacksmithToolWindowBaseV2 } from '/modules/coffee-pub-blacksmith/api/blacksmith-api.js';

const APP_ID = `${MODULE.ID}-routes`;
/**
 * A time rate as the bar shows it: how much travel time passes in a real
 * second. "1×" is real time, "10×", then "1 m/s", "10 m/s", "1 h/s"; a minus
 * runs back along the way.
 */
function formatRate(value) {
    const n = Number(value) || 0;
    const sign = n < 0 ? '−' : '';
    const abs = Math.abs(n);
    if (abs < 60) return `${sign}${abs}×`;
    // "min" and "h", never "m": "4 m/s" reads as metres a second.
    const per = abs < 3600 ? `${Math.round(abs / 60)} min/s` : `${Math.round((abs / 3600) * 10) / 10} h/s`;
    return `${sign}×${abs} (${per})`;
}
/** The window's choices, per browser: the tab, the pace times are shown at, and which routes show their legs. */
const PREFS_KEY = `${MODULE.ID}.routes.windowPrefs`;
const TABS = [
    { id: 'routes', icon: 'fa-solid fa-route', labelKey: 'tabRoutes' },
    { id: 'journeys', icon: 'fa-solid fa-map-signs', labelKey: 'tabJourneys' },
    // The map's own setup: what every route and journey on it share.
    { id: 'setup', icon: 'fa-solid fa-sliders', labelKey: 'tabSetup' }
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
        'routes-play': (_event, _target, app) => app.togglePlay(app._barPath()),
        'routes-reset': (_event, _target, app) => app.confirmReset(app._barPath()),
        'routes-end': (_event, _target, app) => app.confirmEnd(app.manager.shownPath()),
        // Onward or back along the way, when the world clock is the time.
        // Turn round: head for the other end, the party staying where it stands.
        'routes-direction': (_event, _target, app) => {
            const link = app._barPath();
            if (link) return journeysManager.setDirection(link, !app.manager.progress(link)?.path.reversed);
        },
        'toggle-settings': (_event, _target, app) => app.toggleSettings(),
        'route-draw': (_event, _target, app) => (app.manager.draft ? app.manager.finishDrawing() : app.manager.startDrawing()),
        // A new route starting where the party has been set down.
        'route-draw-from-party': (_event, _target, app) => {
            const pin = travelPinsManager.pinFor(canvas.scene?.id);
            if (pin) app.manager.startDrawing({ x: pin.x, y: pin.y });
        },
        'route-focus': (_event, target, app) => void app.manager.focus(target.dataset.routeId),
        'route-rename': (_event, target, app) => app.promptRename(target.dataset.routeId),
        'route-hide': (_event, target, app) => app.toggleHidden(target.dataset.routeId),
        'route-edit': (_event, target, app) => app.manager.toggleEditing(target.dataset.routeId),
        'path-expand': (_event, target, app) => app.toggleExpanded(target.dataset),
        'route-remove': (_event, target, app) => app.confirmRemove(target.dataset.routeId),
        'journey-new': (_event, _target, app) => app.promptNewJourney(),
        'journey-focus': (_event, target, app) => void app.manager.focus({ journeyId: target.dataset.journeyId }),
        'journey-rename': (_event, target, app) => app.promptRenameJourney(target.dataset.journeyId),
        'journey-remove': (_event, target, app) => app.confirmRemoveJourney(target.dataset.journeyId),
        'journey-move': (_event, target, app) => app.moveJourneyRoute(target.dataset.journeyId, Number(target.dataset.index), Number(target.dataset.by)),
        'journey-drop': (_event, target, app) => app.dropJourneyRoute(target.dataset.journeyId, Number(target.dataset.index)),
        'marker-shown': (_event, _target, app) => app.toggleMarker(),
        'marker-configure': (_event, _target, _app) => travelPinsManager.configure(canvas.scene?.id),
        'marker-add': (_event, _target, _app) => travelPinsManager.addMarker(canvas.scene?.id),
        'path-reset': (_event, target, app) => void journeysManager.reset(app._linkFrom(target.dataset)),
        'map-clock': (_event, _target, app) => journeysManager.setMapClock(canvas.scene, !app.manager.settings().followClock)
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
        /** Whether the settings are showing. Hidden, the window is just its bar, as the scene-motion window's. */
        this.settingsOpen = prefs.settingsOpen ?? true;
        this._settingsHeight = prefs.settingsHeight ?? null;
        this._onChange = this._onChange.bind(this);
    }

    _savePrefs() {
        writePrefs({
            tab: this.tab,
            paceId: this.paceId,
            expanded: [...this.expanded],
            settingsOpen: this.settingsOpen,
            settingsHeight: this._settingsHeight
        });
    }

    // ==================================================================
    // ===== THE BAR ====================================================
    // ==================================================================

    /**
     * The route or journey the bar runs: the one chosen on the map, or none.
     * Nothing is chosen for the GM; with none, the bar's controls wait for one.
     */
    _barPath(scene = canvas.scene) {
        return scene ? this.manager.shownPath(scene) : null;
    }

    /** A route or journey named by an element's data-route-id or data-journey-id. */
    _linkFrom({ routeId, journeyId }) {
        return { sceneId: canvas.scene?.id, ...(journeyId ? { journeyId } : { routeId }) };
    }

    _button({ action, icon, label, text = '', className = '', dataset = {}, disabled = false }) {
        const safe = foundry.utils.escapeHTML(label ?? '');
        const caption = text ? `<span>${foundry.utils.escapeHTML(text)}</span>` : '';
        const data = Object.entries(dataset).map(([name, value]) => ` data-${name}="${foundry.utils.escapeHTML(String(value))}"`).join('');
        return `<button type="button" class="cartographer-parallax-button ${className}${text ? ' is-labelled' : ''}" data-action="${action}" data-tooltip="${safe}" aria-label="${safe}"${data}${disabled ? ' disabled' : ''}><i class="${icon}"></i>${caption}</button>`;
    }

    _buildBar(localize) {
        const esc = value => foundry.utils.escapeHTML(String(value));
        const gear = this._button({
            action: 'toggle-settings',
            icon: 'fa-solid fa-gear',
            label: localize(this.settingsOpen ? 'hideSettings' : 'showSettings'),
            className: this.settingsOpen ? 'is-active' : ''
        });
        if (!game.user.isGM) return { left: '', right: gear };
        const link = this._barPath();
        const travel = link ? this.manager.progress(link)?.travel : null;
        const progress = link ? this.manager.progress(link) : null;
        const playing = !!travel?.motion?.playing;
        const speed = Number(travel?.motion?.masterSpeed ?? 1) || 1;
        const disabled = !link;
        const followClock = this.manager.settings().followClock;
        const play = this._button({
            action: 'routes-play',
            icon: playing ? 'fa-solid fa-pause' : 'fa-solid fa-play',
            label: disabled ? localize('noJourneyToPlay') : localize(playing ? 'stop' : 'play'),
            text: localize(playing ? 'stop' : 'play'),
            className: playing ? 'is-active' : '',
            disabled
        });
        const off = disabled ? ' disabled' : '';
        // The party always goes at its pace. What the bar sets is time: with
        // the world clock, the clock is the time, so only the direction is
        // chosen here; without it, how fast travel time runs.
        let slider;
        if (followClock) {
            const clock = game.modules.get('coffee-pub-blacksmith')?.api?.worldClock;
            const rate = Number(clock?.rate) || 0;
            const clockText = clock?.running && rate > 0
                ? game.i18n.format(`${MODULE.ID}.routes.clockRate`, { rate: formatRate(rate) })
                : localize('clockStopped');
            slider = `<span class="cartographer-parallax-value cartographer-routes-clock" data-tooltip="${esc(localize('clockRateHint'))}">${esc(clockText)}</span>`;
        } else {
            const label = esc(localize('timeRateHint'));
            slider = `<div class="cartographer-parallax-field cartographer-parallax-bar-speed${disabled ? ' is-disabled' : ''}">
                <i class="fa-solid fa-clock cartographer-parallax-arrow" data-tooltip="${esc(localize('timeRateSlow'))}"></i>
                <input type="range" data-field="journeyRate" value="${timeRateIndex(speed)}" min="0" max="${TIME_RATES.length - 1}" step="1"
                    aria-label="${label}" data-tooltip="${label}"${off}>
                <i class="fa-solid fa-forward-fast cartographer-parallax-arrow" data-tooltip="${esc(localize('timeRateFast'))}"></i>
                <span class="cartographer-parallax-value">${esc(formatRate(Math.abs(speed)))}</span>
            </div>`;
        }
        // Which end the party is heading for: one toggle, for the trip in progress.
        const reversed = !!progress?.path.reversed;
        const turn = this._button({
            action: 'routes-direction',
            icon: 'fa-solid fa-right-left',
            label: disabled ? localize('noJourneyToPlay') : localize(reversed ? 'headingReversed' : 'headingAsDrawn'),
            className: reversed ? 'is-active' : '',
            disabled
        });
        // A route, a journey (a run of routes), or none: chosen on purpose, never assumed.
        const journeys = this.manager.journeys();
        const routes = this.manager.visibleRoutes();
        const group = (labelKey, items, prefix, selectedId) => items.length
            ? `<optgroup label="${esc(localize(labelKey))}">${items.map(item =>
                `<option value="${prefix}:${esc(item.id)}"${item.id === selectedId ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}</optgroup>`
            : '';
        const pick = journeys.length || routes.length
            ? `<select class="cartographer-parallax-set-select" data-field="barPath" aria-label="${esc(localize('whichJourney'))}" data-tooltip="${esc(localize('whichJourney'))}">`
                + `<option value=""${link ? '' : ' selected'}>${esc(localize('noRoute'))}</option>`
                + group('tabJourneys', journeys, 'j', link?.journeyId) + group('tabRoutes', routes, 'r', link?.journeyId ? null : link?.routeId) + '</select>'
            : '';
        // Stop, beside Play: the trip ended, the party left where it is. Only with a trip on.
        const onTrip = !!this.manager.shownPath();
        const stop = this._button({
            action: 'routes-end',
            icon: 'fa-solid fa-stop',
            label: onTrip ? localize('endTrip') : localize('noTrip'),
            disabled: !onTrip
        });
        // Back to the start: what the bar runs, started over.
        const reset = this._button({
            action: 'routes-reset',
            icon: 'fa-solid fa-backward-fast',
            label: disabled ? localize('noJourneyToPlay') : localize('resetJourney'),
            disabled
        });
        return { left: play + stop + reset + turn + slider, right: pick + gear };
    }

    /**
     * Show or hide the settings. Hidden, the window shrinks to its bar;
     * shown, it returns to the height it last had open.
     */
    async toggleSettings() {
        const rect = this.element?.getBoundingClientRect();
        if (this.settingsOpen && rect?.height) this._settingsHeight = rect.height;
        this.settingsOpen = !this.settingsOpen;
        this._savePrefs();
        await this.render();
        if (this.minimized) return;
        this.setPosition({ height: this.settingsOpen ? (this._settingsHeight ?? this.options.position.height) : 'auto' });
    }

    /** With settings hidden the window is only its bar: any height asked for fits the bar. */
    setPosition(position = {}) {
        if (this.settingsOpen || !this.element || this.minimized) return super.setPosition(position);
        return super.setPosition({ ...position, height: 'auto' });
    }

    _paces(units) {
        return paceChoices(game.system?.id, CONFIG, units,
            pace => game.i18n.localize(pace.label ?? `${MODULE.ID}.parallax.pace.${pace.id}`));
    }

    /**
     * A trip's time: the hours of travel it takes, and -- when that is more
     * than a travel day -- the days of the map's planned length it fills,
     * "30 h of travel: 3 days of 8 h + 6 h". Nothing without a pace.
     */
    _timeText(hours, perDay) {
        if (hours === null || hours === undefined) return '';
        const format = (key, data) => game.i18n.format(`${MODULE.ID}.routes.${key}`, data);
        const plan = travelPlan(hours, perDay);
        const total = plan.hours < 1 ? formatSpan(plan.hours * 3600) : `${Math.round(plan.hours * 10) / 10} h`;
        if (plan.hours <= plan.perDay) return format('time', { hours: total });
        const days = format(plan.days === 1 ? 'oneDay' : 'days', { days: plan.days, perDay: plan.perDay });
        return format(plan.rest ? 'timeDaysRest' : 'timeDays', { hours: total, days, rest: `${Math.round(plan.rest * 10) / 10} h` });
    }

    /**
     * The party's marker on this map, for the GM: whether there is one yet,
     * whether players see it, and whether there is a route or journey for
     * it to stand on (the one the bar runs), which its look can be set for.
     */
    _markerContext(scene) {
        if (!game.user.isGM || !scene) return null;
        const exists = !!travelPinsManager.pinFor(scene.id);
        return {
            exists,
            // Deleted by the GM: offered back, as it was.
            removed: !exists && !!this.manager.settings(scene).marker?.removed,
            shown: exists && travelPinsManager.isShown(scene.id),
            canConfigure: !!journeysManager.activeLink(scene),
            canAdd: !!this.manager.shownPath(scene)
        };
    }

    /** Choose what the bar runs: a route, a journey, or none (an empty value). See JourneysManager.choose. */
    async choosePath(value) {
        const [kind, id] = String(value ?? '').split(':');
        const sceneId = canvas.scene?.id;
        const chosen = !id ? null : kind === 'j' ? { sceneId, journeyId: id } : { sceneId, routeId: id };
        await journeysManager.choose(chosen, canvas.scene);
    }

    /** Take the route or journey the bar runs back to the start, after asking: its progress goes. */
    /** End the trip the map shows, after asking: it goes back to the start, and the party is on no route. */
    async confirmEnd(link) {
        if (!link) return;
        const name = this.manager.progress(link)?.path.name ?? '';
        if (await this._confirm('endTrip', 'endConfirm', name)) await journeysManager.end(link);
    }

    async confirmReset(link) {
        if (!link) return;
        const name = this.manager.progress(link)?.path.name ?? '';
        if (await this._confirm('resetJourney', 'resetConfirm', name)) await journeysManager.reset(link);
    }

    /** Play or stop a route or journey from the map. One that no animated scene drives sets out at the pace chosen for the times. */
    async togglePlay(link) {
        if (!link) return;
        if (journeysManager.isPlaying(link)) await journeysManager.stop(link);
        else await journeysManager.play(link, this._barPace?.perHour ?? null);
    }

    /**
     * A route's or journey's travel settings, for the GM: its pace and which
     * animated scenes drive it. A pace that matches none of the presets shows
     * as itself. Running it is the bar's job.
     */
    _pathControls(link, paces, units) {
        if (!game.user.isGM) return null;
        const progress = this.manager.progress(link);
        const travel = progress?.travel;
        const pace = Number(travel?.pace) || 0;
        const chosen = paces.find(p => pace > 0 && Math.abs(p.perHour - pace) <= p.perHour * 0.005);
        const scenes = journeysManager.linkedScenes(link).map(scene => scene.name);
        return {
            playing: !!travel?.motion?.playing,
            followClock: !!travel?.followClock,
            paces: [
                ...(pace > 0 && !chosen ? [{ id: '', label: game.i18n.format(`${MODULE.ID}.routes.customPace`, { pace: formatDistance(pace, units) }), selected: true }] : []),
                ...(!(pace > 0) ? [{ id: '', label: game.i18n.localize(`${MODULE.ID}.routes.noPace`), selected: true }] : []),
                ...paces.map(p => ({ id: p.id, label: p.label, selected: p === chosen }))
            ],
            drivenBy: scenes.length ? game.i18n.format(`${MODULE.ID}.routes.drivenBy`, { scenes: scenes.join(', ') }) : ''
        };
    }

    async toggleMarker() {
        const sceneId = canvas.scene?.id;
        await travelPinsManager.setShown(sceneId, !travelPinsManager.isShown(sceneId));
    }

    /** How far along a route or journey the party is, once it has set out; empty before, and for a journey not being followed. */
    _progressText(link, units) {
        const progress = this.manager.progress(link);
        if (!progress || (progress.effort <= 0 && !progress.travel.motion.playing)) return '';
        if (link.journeyId && !this.manager.journeyView(link)?.followed) return '';
        return game.i18n.format(`${MODULE.ID}.routes.${progress.travel.arrived ? 'progressArrived' : 'progress'}`, {
            traveled: formatDistance(progress.distance, units),
            length: formatDistance(progress.length, units),
            terrain: game.i18n.localize(`${MODULE.ID}.routes.terrain.${progress.terrain ?? 'open'}`)
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

        const { hoursPerDay, followClock } = this.manager.settings(scene);
        this._barPace = pace;
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
                progressText: this._progressText({ sceneId: scene.id, routeId: route.id }, units),
                controls: this._pathControls({ sceneId: scene.id, routeId: route.id }, paces, units),
                length: formatDistance(distance, units),
                legsText: game.i18n.format(`${MODULE.ID}.routes.${legs.length === 1 ? 'oneLeg' : 'legs'}`, { count: legs.length }),
                difficult: terrain.some(t => terrainFactor(t) < 1),
                timeText: this._timeText(travelHours(legs, terrain, pace?.perHour), hoursPerDay),
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
                progressText: this._progressText({ sceneId: scene.id, journeyId: journey.id }, units),
                controls: this._pathControls({ sceneId: scene.id, journeyId: journey.id }, paces, units),
                timeText: this._timeText(travelHours(legs, path.terrain, pace?.perHour), hoursPerDay),
                expanded: this.expanded.has(`j:${journey.id}`),
                routeCountText: game.i18n.format(`${MODULE.ID}.routes.${journey.routeIds.length === 1 ? 'oneRoute' : 'routesCount'}`, { count: journey.routeIds.length }),
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
                    count: tab.id === 'routes' ? routes.length : tab.id === 'journeys' ? journeys.length : 0
                })),
                isRoutes: this.tab === 'routes',
                isJourneys: this.tab === 'journeys',
                isSetup: this.tab === 'setup',
                partyOffRoute: game.user.isGM && this.manager.settings(scene).offRoute && !!travelPinsManager.pinFor(scene.id),
                followClock,
                routes,
                journeys,
                hasGrid: !!grid?.size && !!grid?.distance,
                gridText: grid?.size ? game.i18n.format(`${MODULE.ID}.parallax.${grid.isHexagonal ? 'measureHexValue' : 'measureGridValue'}`,
                    { size: Math.round(gridStep(grid) * 10) / 10, distance: grid.distance, units }) : '',
                pace: pace?.label ?? '',
                hoursPerDay,
                canPlan: game.user.isGM,
                marker: this._markerContext(scene),
                // Too long a day: hard on mounts past 6 h at a mounted pace, a forced march past 8 h.
                dayWarning: hoursPerDay > FORCED_MARCH_HOURS ? localize('warnForcedMarch')
                    : pace?.group === 'mount' && hoursPerDay > MOUNT_HOURS_PER_DAY ? localize('warnMounts') : '',
                drawing: !!this.manager.draft,
                showing: this.manager.show,
                barJourneyId: this._barPath(scene)?.journeyId ?? null,
                barRouteId: this._barPath(scene)?.routeId ?? null,
                paceGroups: PACE_GROUPS.map(group => ({
                    label: game.i18n.localize(`${MODULE.ID}.parallax.paceGroup.${group}`),
                    paces: paces.filter(p => p.group === group).map(p => ({ id: p.id, label: p.label, selected: p === pace }))
                })).filter(group => group.paces.length)
            }
        );

        const bar = this._buildBar(localize);
        return {
            appId: this.id,
            bodyContent: this.settingsOpen ? bodyContent : '',
            showToolBar: true,
            toolBarLeft: bar.left,
            toolBarRight: bar.right
        };
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        // The bar shows the world clock's rate when the map follows it; keep it current.
        this._clockHook ??= Hooks.on('blacksmith.worldClockRateChanged', () => this.render());
        this.element?.classList.toggle('is-settings-closed', !this.settingsOpen);
        this._startLiveProgress();
        if (this._inputsBound || !this.element) return;
        this.element.addEventListener('change', this._onChange);
        this.element.addEventListener('input', event => {
            // The time rate's readout follows the slider while it moves; the change is made on release.
            if (event.target?.dataset?.field !== 'journeyRate') return;
            const readout = event.target.parentElement?.querySelector('.cartographer-parallax-value');
            if (readout) readout.textContent = formatRate(TIME_RATES[Number(event.target.value)]);
        });
        this._inputsBound = true;
    }

    /**
     * While anything on this map is moving, its progress lines are rewritten
     * a few times a second, without re-rendering the window -- which would
     * drop a slider mid-drag.
     */
    _startLiveProgress() {
        if (this._liveTimer) return;
        this._liveTimer = setInterval(() => {
            if (!this.rendered || !canvas?.scene) return;
            const units = canvas.scene.grid?.units ?? '';
            for (const element of this.element?.querySelectorAll('[data-progress-route], [data-progress-journey]') ?? []) {
                const link = element.dataset.progressJourney
                    ? { sceneId: canvas.scene.id, journeyId: element.dataset.progressJourney }
                    : { sceneId: canvas.scene.id, routeId: element.dataset.progressRoute };
                const text = this._progressText(link, units);
                if (text && element.textContent !== text) element.textContent = text;
            }
        }, 250);
    }

    _onChange(event) {
        const target = event.target;
        const field = target?.dataset?.field;
        if (field === 'routePace') {
            this.paceId = target.value;
            this._savePrefs();
            this.render();
        } else if (field === 'routeColor' && /^#[0-9a-f]{6}$/i.test(target.value)) {
            void this.manager.update(target.dataset.routeId, { color: target.value });
        } else if (field === 'hoursPerDay') {
            const hours = Number(target.value);
            if (hours > 0 && hours <= 24) void this.manager.setSettings({ hoursPerDay: hours });
        } else if (field === 'legTerrain') {
            void this.manager.setTerrain(target.dataset.routeId, Number(target.dataset.leg), target.value);
        } else if (field === 'routeTerrain' && target.value) {
            void this.manager.setTerrain(target.dataset.routeId, null, target.value);
        } else if (field === 'journeyRate') {
            const link = this._barPath();
            const rate = TIME_RATES[Number(target.value)];
            if (link && rate) void journeysManager.setSpeed(link, rate);
        } else if (field === 'barPath') {
            void this.choosePath(target.value);
        } else if (field === 'pathPace' && target.value) {
            const pace = this._paces(canvas.scene?.grid?.units).find(p => p.id === target.value);
            if (pace) void journeysManager.setPace(this._linkFrom(target.dataset), pace.perHour);
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

    /** Open or close a route's or journey's card. Journeys are kept as "j:<id>", so ids cannot collide. */
    toggleExpanded({ routeId, journeyId }) {
        const key = journeyId ? `j:${journeyId}` : routeId;
        if (!key) return;
        if (this.expanded.has(key)) this.expanded.delete(key);
        else this.expanded.add(key);
        this._savePrefs();
        this.render();
    }

    async toggleHidden(id) {
        const route = this.manager.get(id);
        if (route) await this.manager.update(id, { hidden: !route.hidden });
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
        clearInterval(this._liveTimer);
        this._liveTimer = null;
        if (this._clockHook) Hooks.off('blacksmith.worldClockRateChanged', this._clockHook);
        this._clockHook = null;
        this.manager?.onWindowClosed(this);
        return super._onClose?.(options);
    }
}

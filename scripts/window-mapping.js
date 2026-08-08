// ==================================================================
// ===== MAPPING TOOL WINDOW ========================================
// ==================================================================

import { MODULE } from './const.js';
import { clipSegmentToCell } from './utils-mapping.js';
import {
    getMappingSymbol,
    MAPPING_FLOOR_TYPES,
    MAPPING_MARKERS,
    MAPPING_SYMBOL_CATEGORIES
} from './symbols-mapping.js';

const ToolWindowBase = game.modules.get('coffee-pub-blacksmith')?.api?.BlacksmithToolWindowBaseV2 ?? class {
    static DEFAULT_OPTIONS = {};
    constructor() { throw new Error('Coffee Pub Blacksmith Tool Window API is unavailable'); }
};
const APP_ID = `${MODULE.ID}-mapper`;
/** Fallback cell edge in pixels, used until --cartographer-map-cell-size is read. */
const MAP_CELL_SIZE = 36;
/** Fraction of the remaining distance the camera covers each frame. */
const CAMERA_EASING = 0.28;
/** Blank cells drawn beyond the explored bounds on the endless canvas. */
const MAP_MARGIN_CELLS = 3;
/** Features drawn with the doorway glyph rather than as a boundary stroke. */
const DOOR_GLYPH_FEATURES = ['door', 'locked-door'];
/** Openings drawn as wide as the run of squares they occupy. */
const SPANNING_GLYPH_FEATURES = [...DOOR_GLYPH_FEATURES, 'window'];
/** Wall stub left at each end of an opening, in local glyph units. */
const GLYPH_STUB = 38;
/**
 * How much further than the nearest one a wall face may sit, in squares, and
 * still be seen from where the party stood. Anything past that is behind it.
 */
const WALL_FACE_DEPTH = 0.7;
/** How near two wall pieces must lie, in squares, to be one wall. */
const PIECE_JOIN = 0.01;
/**
 * Each glyph is authored facing north and rotated into place. Note where local
 * +x ends up: north and east run with increasing column/row, south and west
 * run against them. That is why a run anchors at its far end for those two.
 */
const GLYPH_TRANSFORMS = {
    north: 'translate(0 0)',
    south: 'translate(100 100) rotate(180)',
    west: 'translate(0 100) rotate(-90)',
    east: 'translate(100 0) rotate(90)'
};
/** Edge of the square map silhouette drawn for the list view, in pixels. */
const THUMBNAIL_SIZE = 96;
/** How many generated thumbnails to retain before evicting the oldest. */
const THUMBNAIL_CACHE_LIMIT = 40;
/** Silhouette ink per theme, so a thumbnail reads on light and dark alike. */
const THUMBNAIL_INK = {
    light: 'rgba(23, 19, 16, 0.72)',
    dark: 'rgba(236, 227, 208, 0.78)',
    glass: 'rgba(242, 234, 217, 0.72)'
};
/** How far a press may drift, in pixels, and still count as a click. */
const PRESS_SLOP = 4;
/** Window width below which chrome buttons drop their captions. */
/**
 * The three ways to read the Recorded Maps list, one in effect at a time.
 *
 * The first two decide what the headings are keyed on. The third is not a
 * filter laid over them -- it narrows to the reader's own maps and keys those
 * on the scene, because a list of one character's maps has nothing to say by
 * naming that character over and over.
 */
const LIST_GROUPINGS = [
    { id: 'scene', icon: 'fa-solid fa-map-location-dot', textKey: 'mapping.groupBySceneShort', labelKey: 'mapping.groupByScene' },
    { id: 'actor', icon: 'fa-solid fa-user', textKey: 'mapping.groupByActorShort', labelKey: 'mapping.groupByActor' },
    { id: 'mine', icon: 'fa-solid fa-user-check', textKey: 'mapping.justMine', labelKey: 'mapping.justMineHint' }
];

const COMPACT_CHROME_WIDTH = 460;
/** Rings of hatching drawn outward from the explored edge. Must fit the margin. */
const HATCH_RINGS = MAP_MARGIN_CELLS;
/** Neighbour offsets used to grow the hatch band outward. */
/** The three mutually exclusive modes, in the order they are offered. */
const MAPPING_MODE_BUTTONS = [
    { id: 'view', key: 'View', icon: 'fa-solid fa-eye' },
    { id: 'follow', key: 'Follow', icon: 'fa-solid fa-location-arrow' },
    { id: 'record', key: 'Record', icon: 'fa-solid fa-circle' }
];
/** Neighbour offsets used to grow the hatch band outward. */
const HATCH_NEIGHBOURS = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1]
];

export class MappingWindow extends ToolWindowBase {
    static DEFAULT_OPTIONS = foundry.utils.mergeObject(
        foundry.utils.mergeObject({}, super.DEFAULT_OPTIONS ?? {}),
        {
            id: APP_ID,
            classes: ['blacksmith-window-tool', 'cartographer-mapping-window'],
            position: { width: 560, height: 560 },
            window: {
                title: `${MODULE.ID}.mapping.windowTitle`,
                icon: 'fa-solid fa-street-view',
                resizable: true,
                minimizable: true
            },
            toolTheme: 'glass',
            toolTitlebar: 'micro',
            windowSizeConstraints: { minWidth: 320, minHeight: 320 }
        }
    );

    static ACTION_HANDLERS = {
        'set-mode': (_event, target, app) => void app.manager.setMode(target.dataset.mode),
        'toggle-list': (_event, _target, app) => void app.toggleList(),
        'add-map': (_event, _target, app) => void app.manager.createMapForSelection(),
        'set-grouping': (_event, target, app) => void app.setListGrouping(target.dataset.grouping),
        'select-map': (_event, target, app) => void app.selectMap(target.dataset.mapId),
        'rename-map': (event, target, app) => {
            event.stopPropagation();
            void app.manager.renameMap(target.dataset.mapId);
        },
        'delete-map': (event, target, app) => {
            event.stopPropagation();
            void app.manager.deleteMap(target.dataset.mapId);
        },
        'zoom-in': (_event, _target, app) => app.setZoom((app._targetZoom ?? app.zoom) + 0.15),
        'zoom-out': (_event, _target, app) => app.setZoom((app._targetZoom ?? app.zoom) - 0.15),
        'center-view': (_event, _target, app) => app.centerView(),
        'fit-map': (_event, _target, app) => app.fitMap()
    };

    constructor(manager, options = {}) {
        super(options);
        this.manager = manager;
        this.zoom = 1;
        this.viewMode = 'map';
        this._hasBuiltMap = false;
        this._renderedExplored = new Set();
        this._listScrollTop = 0;
        this._pan = null;
        this._press = null;
        // Camera state lives here, not in the DOM. See the camera section below.
        this.camera = { x: 0, y: 0 };
        this._cameraTarget = { x: 0, y: 0 };
        this._cameraFrame = null;
        this._followArmed = true;
        this._hasPaintedMap = false;
        this._cellSize = MAP_CELL_SIZE;
        this._thumbnailCache = new Map();
        this._handlePanStart = this._handlePanStart.bind(this);
        this._handlePanMove = this._handlePanMove.bind(this);
        this._handlePanEnd = this._handlePanEnd.bind(this);
        this._handleMapContextMenu = this._handleMapContextMenu.bind(this);
    }

    static async open(manager, { viewMode = 'map' } = {}) {
        const existing = foundry.applications?.instances?.get(APP_ID);
        if (existing) {
            existing.manager = manager;
            existing.bringToFront?.();
            return existing;
        }
        const window = new MappingWindow(manager);
        window.viewMode = viewMode;
        await window.render({ force: true });
        return window;
    }

    async getData() {
        const model = this._buildModel();
        const bodyContent = await foundry.applications.handlebars.renderTemplate(
            `modules/${MODULE.ID}/templates/window-mapping.hbs`, model
        );
        const statusKey = this.viewMode === 'list'
            ? 'mapping.statusMaps'
            : (this.manager.paused
                ? 'mapping.statusPaused'
                : (this.manager.active
                    ? 'mapping.statusActive'
                    : (this.manager.following ? 'mapping.statusFollowing' : 'mapping.statusViewing')));
        const statusClass = this.manager.paused
            ? ' is-paused'
            : (this.manager.active ? ' is-recording' : (this.manager.following ? ' is-following' : ''));
        this._statusMarkup = `<span class="cartographer-mapping-status${statusClass}"><i class="fa-solid fa-circle"></i> ${foundry.utils.escapeHTML(game.i18n.localize(`${MODULE.ID}.${statusKey}`))}</span>`;
        return {
            appId: this.id,
            bodyContent,
            showToolBar: true,
            toolBarLeft: this._buildTopActions(model),
            toolBarRight: this._buildViewControls(model),
            showToolFooter: true,
            toolFooterLeft: this._buildStatusIdentity(model),
            toolFooterRight: this._buildStatusMeasure(model)
        };
    }

    /** Who is being mapped, at the left of the status bar. */
    _buildStatusIdentity() {
        if (this.viewMode === 'list') {
            return `<span class="cartographer-mapping-status-text">${foundry.utils.escapeHTML(
                game.i18n.localize(`${MODULE.ID}.mapping.recordedMaps`)
            )}</span>`;
        }
        const name = foundry.utils.escapeHTML(this.manager.getTrackedTokenName());
        const portrait = this.manager.getTrackedTokenPortrait();
        const image = portrait
            ? `<img class="cartographer-mapping-portrait" src="${foundry.utils.escapeHTML(portrait)}" alt="">`
            : '<i class="fa-solid fa-street-view cartographer-mapping-portrait is-placeholder"></i>';
        // The mode reads as a property of who is being mapped, so it sits with
        // them in the status bar rather than among the actions up top.
        return `<span class="cartographer-mapping-token">${image}<span>${name}</span></span>${this._statusMarkup ?? ''}`;
    }

    /** How much has been mapped, at the right of the status bar. */
    _buildStatusMeasure(model) {
        const text = this.viewMode === 'list'
            ? game.i18n.format(`${MODULE.ID}.mapping.mapCount`, { count: model.maps.length })
            : `${model.feetMapped} ${game.i18n.localize(`${MODULE.ID}.mapping.feetMapped`)}`;
        const icon = this.viewMode === 'list' ? 'fa-solid fa-layer-group' : 'fa-solid fa-ruler';
        return `<span class="cartographer-mapping-measure"><i class="${icon}"></i><span>${foundry.utils.escapeHTML(text)}</span></span>`;
    }

    _buildTopActions(model) {
        if (this.viewMode === 'list') {
            // The same shape as the map view: the view switch alone, then a
            // divider, then the controls for what is being looked at. Making a
            // map is not among them -- that is what the card at the head of the
            // list is for, and it is the one that names the scene.
            const view = this._chromeButton({
                action: 'toggle-list',
                icon: 'fa-solid fa-map',
                label: model.viewMapLabel
            });
            // All three shown at once, the way the modes are: one is in effect
            // at a time, and which one has to be readable at a glance rather
            // than inferred from a button naming the others.
            const groupings = model.groupings.map(option => this._chromeButton({
                action: 'set-grouping',
                icon: option.icon,
                label: option.label,
                text: option.text,
                dataset: { grouping: option.id },
                className: `cartographer-mapping-toggle${option.isCurrent ? ' is-current' : ''}`
            }));
            return `<span class="cartographer-mapping-chrome-actions">${view}</span>`
                + `<span class="cartographer-mapping-chrome-actions is-modes">${groupings.join('')}</span>`;
        }

        const list = this._chromeButton({
            action: 'toggle-list',
            icon: 'fa-solid fa-list',
            label: model.listLabel
        });
        // One mode is in effect at a time, so these read as a segmented choice
        // rather than as three independent toggles.
        const modes = model.modes.map(mode => this._chromeButton({
            action: 'set-mode',
            icon: mode.icon,
            label: mode.label,
            text: mode.text,
            dataset: { mode: mode.id },
            className: `cartographer-mapping-mode${mode.isCurrent ? ' is-current' : ''}`,
            disabled: mode.disabled
        }));
        return `<span class="cartographer-mapping-chrome-actions">${list}</span>`
            + `<span class="cartographer-mapping-chrome-actions is-modes">${modes.join('')}</span>`;
    }

    /** Zoom and centring, right-aligned in the top bar. */
    _buildViewControls(model) {
        if (this.viewMode !== 'map') return '';
        const buttons = [
            this._chromeButton({ action: 'zoom-out', icon: 'fa-solid fa-minus', label: model.zoomOutLabel }),
            this.manager.mode === 'view'
                ? this._chromeButton({
                    action: 'fit-map',
                    icon: 'fa-solid fa-maximize',
                    label: game.i18n.localize(`${MODULE.ID}.mapping.fitMap`)
                })
                : this._chromeButton({
                    action: 'center-view',
                    icon: 'fa-solid fa-crosshairs',
                    label: model.centerPartyLabel
                }),
            this._chromeButton({ action: 'zoom-in', icon: 'fa-solid fa-plus', label: model.zoomInLabel })
        ];
        return `<span class="cartographer-mapping-zoom-readout">${Math.round(this.zoom * 100)}%</span>`
            + `<span class="cartographer-mapping-chrome-actions is-navigation">${buttons.join('')}</span>`;
    }

    _chromeButton({ action, icon, label, text = '', className = '', disabled = false, dataset = {} }) {
        const safeAction = foundry.utils.escapeHTML(action);
        const safeLabel = foundry.utils.escapeHTML(label ?? '');
        const allClasses = [className, text ? 'is-labelled' : ''].filter(Boolean).join(' ');
        const classes = allClasses ? ` class="${foundry.utils.escapeHTML(allClasses)}"` : '';
        const caption = text ? `<span>${foundry.utils.escapeHTML(text)}</span>` : '';
        const data = Object.entries(dataset)
            .map(([name, value]) => ` data-${name}="${foundry.utils.escapeHTML(String(value))}"`)
            .join('');
        return `<button type="button"${classes} data-action="${safeAction}" data-tooltip="${safeLabel}" aria-label="${safeLabel}"${data}${disabled ? ' disabled' : ''}><i class="${icon}"></i>${caption}</button>`;
    }

    /**
     * A silhouette of a map's explored squares, for the list view.
     *
     * Drawn to a small canvas rather than as DOM: a few thousand fillRect calls
     * cost far less than a few thousand elements, and the result is cached
     * against the record's updatedAt so it is redrawn only when the map itself
     * changes. Nothing is generated unless the list is actually on screen.
     */
    _mapThumbnail(record) {
        const explored = record.explored ?? [];
        if (!explored.length) return null;
        const cacheKey = `${record.id}:${record.updatedAt}:${this.toolTheme}`;
        const cached = this._thumbnailCache.get(cacheKey);
        if (cached) return cached;

        let minColumn = Infinity;
        let minRow = Infinity;
        let maxColumn = -Infinity;
        let maxRow = -Infinity;
        const cells = [];
        for (const key of explored) {
            const [column, row] = key.split(',').map(Number);
            if (!Number.isInteger(column) || !Number.isInteger(row)) continue;
            minColumn = Math.min(minColumn, column);
            minRow = Math.min(minRow, row);
            maxColumn = Math.max(maxColumn, column);
            maxRow = Math.max(maxRow, row);
            cells.push([column, row]);
        }
        if (!cells.length) return null;

        const canvasElement = document.createElement('canvas');
        canvasElement.width = THUMBNAIL_SIZE;
        canvasElement.height = THUMBNAIL_SIZE;
        const context = canvasElement.getContext('2d');
        if (!context) return null;
        const columns = maxColumn - minColumn + 1;
        const rows = maxRow - minRow + 1;
        const scale = Math.min(THUMBNAIL_SIZE / columns, THUMBNAIL_SIZE / rows);
        const offsetX = (THUMBNAIL_SIZE - (columns * scale)) / 2;
        const offsetY = (THUMBNAIL_SIZE - (rows * scale)) / 2;
        // Themed here rather than read from CSS, so a thumbnail generated
        // before the window has been laid out is still the right colour.
        context.fillStyle = THUMBNAIL_INK[this.toolTheme] ?? THUMBNAIL_INK.light;
        const side = Math.max(1, scale);
        for (const [column, row] of cells) {
            context.fillRect(
                offsetX + ((column - minColumn) * scale),
                offsetY + ((row - minRow) * scale),
                side,
                side
            );
        }

        const url = canvasElement.toDataURL('image/png');
        this._thumbnailCache.set(cacheKey, url);
        // Bounded so a long session of edits cannot grow this without limit.
        if (this._thumbnailCache.size > THUMBNAIL_CACHE_LIMIT) {
            this._thumbnailCache.delete(this._thumbnailCache.keys().next().value);
        }
        return url;
    }

    _buildModel() {
        const isList = this.viewMode === 'list';
        const maps = this.manager.getMapList().map(record => ({
            id: record.id,
            name: record.name,
            actorId: record.actorId,
            actorName: record.actorName,
            sceneName: record.sceneName,
            updated: record.updatedAt ? new Date(record.updatedAt).toLocaleString() : '',
            updatedAt: record.updatedAt ?? 0,
            feetMapped: record.explored.length * (record.gridDistance || 5),
            isCurrent: record.id === this.manager.currentMapId,
            canManage: this.manager.canManageRecord(record),
            canRecord: record.sceneId === canvas?.scene?.id && this.manager.canManageRecord(record),
            thumbnail: isList ? this._mapThumbnail(record) : null
        }));
        if (this.viewMode === 'list') {
            const grouping = this.listGrouping;
            const mine = grouping === 'mine';
            const own = mine ? this._ownActorIds() : null;
            const visible = mine ? maps.filter(map => own.has(map.actorId)) : maps;
            // An empty list has to say why, since the reader has just pressed
            // the thing that emptied it. A GM's own maps are whichever token is
            // selected, so for them it is usually that nothing is.
            const emptyKey = !mine ? 'mapping.noMaps'
                : (game.user?.isGM && !own.size) ? 'mapping.noMapsMineToken'
                : 'mapping.noMapsMine';
            return {
                isListView: true,
                maps: visible,
                groups: this._groupMaps(visible, mine ? 'scene' : grouping),
                groupings: LIST_GROUPINGS.map(option => ({
                    id: option.id,
                    icon: option.icon,
                    text: game.i18n.localize(`${MODULE.ID}.${option.textKey}`),
                    label: game.i18n.localize(`${MODULE.ID}.${option.labelKey}`),
                    isCurrent: option.id === grouping
                })),
                listEmpty: visible.length === 0,
                listEmptyMessage: game.i18n.localize(`${MODULE.ID}.${emptyKey}`),
                // Always offered. It used to appear only when this scene had
                // no map the reader could record into, which meant a GM -- who
                // can record into anyone's -- never saw it once one map
                // existed, and had no way to start a second.
                showCreateCard: true,
                createTitle: game.i18n.localize(`${MODULE.ID}.mapping.createForScene`),
                createHint: game.i18n.format(`${MODULE.ID}.mapping.createForSceneHint`, {
                    scene: canvas?.scene?.name ?? game.i18n.localize(`${MODULE.ID}.mapping.thisScene`)
                }),
                viewMapLabel: game.i18n.localize(`${MODULE.ID}.mapping.viewMap`),
                renameLabel: game.i18n.localize(`${MODULE.ID}.mapping.rename`),
                deleteLabel: game.i18n.localize(`${MODULE.ID}.mapping.deleteMap`),
                feetMappedLabel: game.i18n.localize(`${MODULE.ID}.mapping.feetMapped`),
                feetMapped: this.manager.state.explored.length * (this.manager.state.gridDistance || 5)
            };
        }
        return { ...this._buildMapModel(), isListView: false, maps };
    }

    /**
     * Which way the reader last chose to sort the list. Kept per user, since it
     * is a reading preference rather than anything about the maps.
     */
    get listGrouping() {
        let stored;
        try {
            stored = game.settings.get(MODULE.ID, 'mapping.listGrouping');
        } catch {
            stored = null;
        }
        return LIST_GROUPINGS.some(option => option.id === stored) ? stored : 'scene';
    }

    async setListGrouping(grouping) {
        if (!LIST_GROUPINGS.some(option => option.id === grouping)) return;
        if (grouping === this.listGrouping) return;
        try {
            await game.settings.set(MODULE.ID, 'mapping.listGrouping', grouping);
        } catch {
            return;
        }
        await this.manager.renderWindow();
    }

    /**
     * Whose maps count as the reader's own.
     *
     * Ownership alone cannot answer this, because a GM owns every actor as far
     * as Foundry is concerned -- so for them "mine" is whichever token they
     * have selected, which is the character they are speaking for. A player's
     * own maps are all of their characters', however many they have, which is
     * why this narrows the list rather than picking a single map out of it.
     */
    _ownActorIds() {
        const ids = new Set();
        if (game.user?.isGM) {
            const actorId = this.manager._getSingleControlledToken()?.actor?.id;
            if (actorId) ids.add(actorId);
            return ids;
        }
        if (game.user?.character?.id) ids.add(game.user.character.id);
        for (const actor of game.actors ?? []) {
            if (actor.testUserPermission?.(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) ids.add(actor.id);
        }
        return ids;
    }

    /**
     * Gather the maps under headings, by scene or by character.
     *
     * The list grows one entry per character per scene, so a campaign of any
     * length turns it into a wall of near-identical rows -- every one of them
     * reading "someone at somewhere", with no way to find the map wanted. The
     * heading carries whichever of the two the group is keyed on, and each row
     * then only has to say the other: under a scene a row names its character,
     * under a character it names its scene.
     *
     * Whatever is in front of the reader comes first -- the scene they are
     * standing in, or the character they have selected -- because that is the
     * map they are nearly always after. The rest follow by how recently they
     * were written to.
     */
    _groupMaps(maps, grouping) {
        const byScene = grouping === 'scene';
        const here = byScene
            ? canvas?.scene?.name
            : this.manager._getSingleControlledToken()?.actor?.name;

        const groups = new Map();
        for (const map of maps) {
            const key = byScene ? map.sceneName : map.actorName;
            if (!groups.has(key)) {
                groups.set(key, { key, name: key, isHere: key === here, maps: [], updated: 0 });
            }
            const group = groups.get(key);
            group.maps.push({ ...map, subtitle: byScene ? map.actorName : map.sceneName });
            group.updated = Math.max(group.updated, map.updatedAt ?? 0);
        }

        return [...groups.values()].sort((left, right) => {
            if (left.isHere !== right.isHere) return left.isHere ? -1 : 1;
            if (left.updated !== right.updated) return right.updated - left.updated;
            return left.name.localeCompare(right.name);
        }).map(group => ({ ...group, count: group.maps.length }));
    }

    _buildMapModel() {
        const explored = new Set(this.manager.state.explored);
        const placedSymbols = new Map(
            (this.manager.state.symbols ?? []).map(symbol => [`${symbol.column},${symbol.row}`, symbol])
        );
        const animateNewTiles = this._hasBuiltMap;
        const newTiles = animateNewTiles
            ? new Set([...explored].filter(key => !this._renderedExplored.has(key)))
            : new Set();
        const trackedPosition = this.manager.getTrackedPositionForCurrentMap();
        const mappedGeometry = this._getMappedTileGeometry(
            explored,
            // The map's own scene, which is not always the one in play.
            this.manager.atlasFor(this.manager.state.sceneId),
            this.manager.state.secrets,
            this.manager.state.sides
        );
        // What the drawing made of the record. A square showing as bare rock is
        // either not in `floor` at all -- nothing revealed it -- or it is, and
        // was clipped away to nothing, and `thinnest` says which.
        this.manager._debug?.('Mapping | Drawn', [
            `floor=${explored.size}`,
            `walls=${mappedGeometry.segmentsByCell.size}`,
            `clipped=${mappedGeometry.floorClipByCell.size}`,
            `thinnest=${this._thinnestFloor(mappedGeometry.floorClipByCell)}%`
        ].join('  '));
        const canRecord = this.manager.canRecordCurrentMap();
        const common = {
            canRecord,
            isRecording: this.manager.active,
            isPaused: this.manager.paused,
            drawingLabel: game.i18n.localize(`${MODULE.ID}.mapping.drawing`),
            zoom: this.zoom,
            // Following and recording both track a token on this scene, so a
            // map belonging to another scene can only be viewed.
            modes: MAPPING_MODE_BUTTONS.filter(mode => mode.id === 'view'
                || this.manager.state.sceneId === canvas?.scene?.id).map(mode => {
                // Recording doubles as its own off switch: pressing it while
                // recording stops, so it says so rather than sitting there
                // named after a mode you are already in.
                const isStop = mode.id === 'record' && this.manager.active;
                return {
                    id: isStop ? 'view' : mode.id,
                    icon: isStop ? 'fa-solid fa-stop' : mode.icon,
                    label: isStop
                        ? game.i18n.localize(`${MODULE.ID}.mapping.stopRecording`)
                        : game.i18n.localize(`${MODULE.ID}.mapping.mode${mode.key}Hint`),
                    text: isStop
                        ? game.i18n.localize(`${MODULE.ID}.mapping.stopRecording`)
                        : game.i18n.localize(`${MODULE.ID}.mapping.mode${mode.key}`),
                    isCurrent: this.manager.mode === mode.id,
                    // Recording is the only mode with entry requirements, so it
                    // is the only one that can be unavailable.
                    disabled: mode.id === 'record' && !canRecord && this.manager.mode !== 'record'
                };
            }),
            listLabel: game.i18n.localize(`${MODULE.ID}.mapping.showMaps`),
            zoomInLabel: game.i18n.localize(`${MODULE.ID}.mapping.zoomIn`),
            zoomOutLabel: game.i18n.localize(`${MODULE.ID}.mapping.zoomOut`),
            centerPartyLabel: game.i18n.localize(
                `${MODULE.ID}.mapping.${trackedPosition ? 'centerParty' : 'centerMap'}`
            )
        };
        if (!explored.size) {
            this._hasBuiltMap = true;
            this._renderedExplored = explored;
            return {
                ...common,
                empty: true,
                emptyMessage: game.i18n.localize(`${MODULE.ID}.mapping.emptyMap`),
                feetMapped: 0
            };
        }

        // Endless canvas: the grid spans only the drawn bounds plus a margin,
        // wherever those bounds happen to sit, rather than the whole scene. It
        // grows on its own as exploration reaches an edge. Cells are placed
        // relative to the origin, while the camera stays in absolute map space.
        const coordinates = [...explored].map(key => key.split(',').map(Number));
        // Single pass rather than Math.min(...spread), which overflows the
        // stack once a map grows past roughly a hundred thousand cells.
        const bounds = coordinates.reduce((result, [column, row]) => ({
            minColumn: Math.min(result.minColumn, column),
            minRow: Math.min(result.minRow, row),
            maxColumn: Math.max(result.maxColumn, column),
            maxRow: Math.max(result.maxRow, row)
        }), { minColumn: Infinity, minRow: Infinity, maxColumn: -Infinity, maxRow: -Infinity });
        const originColumn = bounds.minColumn - MAP_MARGIN_CELLS;
        const originRow = bounds.minRow - MAP_MARGIN_CELLS;
        const columnCount = (bounds.maxColumn + MAP_MARGIN_CELLS) - originColumn + 1;
        const rowCount = (bounds.maxRow + MAP_MARGIN_CELLS) - originRow + 1;
        const cells = coordinates.map(([column, row]) => {
            const key = `${column},${row}`;
            const isParty = trackedPosition?.column === column && trackedPosition?.row === row;
            const floor = this.manager.state.floors?.[key];
            const isNew = newTiles.has(key);
            const symbol = placedSymbols.get(key);
            const symbolDefinition = symbol ? getMappingSymbol(symbol.type) : null;
            return {
                key,
                gridColumn: column - originColumn + 1,
                gridRow: row - originRow + 1,
                // Absolute coordinates, so a floor surface can phase its
                // pattern to a single lattice across the whole room.
                patternX: column,
                patternY: row,
                floorClip: mappedGeometry.floorClipByCell.get(key) ?? null,
                className: `is-explored${isNew ? ' is-new' : ''}${isParty ? ' is-party' : ''}${floor ? ` is-floor-${floor}` : ''}${mappedGeometry.floorClipByCell.has(key) ? ' is-clipped' : ''}`,
                segments: mappedGeometry.segmentsByCell.get(key) ?? [],
                doorSymbols: mappedGeometry.doorSymbolsByCell.get(key) ?? [],
                secretDoorSymbols: mappedGeometry.secretDoorSymbolsByCell.get(key) ?? [],
                windowSymbols: mappedGeometry.windowSymbolsByCell.get(key) ?? [],
                hasLinework: mappedGeometry.segmentsByCell.has(key)
                    || mappedGeometry.doorSymbolsByCell.has(key)
                    || mappedGeometry.secretDoorSymbolsByCell.has(key)
                    || mappedGeometry.windowSymbolsByCell.has(key),
                symbol: symbolDefinition ? {
                    className: `is-${symbol.type}`,
                    markup: symbolDefinition.markup,
                    // A note's own text is more use than its type name.
                    label: symbol.text || game.i18n.localize(`${MODULE.ID}.${symbolDefinition.labelKey}`)
                } : null,
                isParty
            };
        });
        this._hasBuiltMap = true;
        this._renderedExplored = explored;
        return {
            ...common,
            empty: false,
            cells,
            columnCount,
            rowCount,
            originColumn,
            originRow,
            hatchCells: this._buildHatchCells(
                explored, originColumn, originRow, mappedGeometry.floorClipByCell
            ),
            showParty: Boolean(trackedPosition),
            feetMapped: explored.size * (this.manager.state.gridDistance || 5)
        };
    }

    /**
     * The band of solid rock drawn around the mapped area, in the old-school
     * style where the space outside the rooms is hatched rather than left
     * blank. Grown outward from the explored edge one ring at a time, so the
     * work tracks the perimeter rather than the whole map.
     *
     * This is purely presentational: it is derived from the explored set at
     * render time and never persisted, and it says nothing about what is
     * actually out there. Hatching a genuinely sealed vault would mean reading
     * undiscovered geometry, which the party could not know either.
     */
    _buildHatchCells(explored, originColumn, originRow, clipped) {
        const cells = [];
        const seen = new Set(explored);
        // A square whose floor stops at a wall running through it needs rock
        // behind the part that was cut away, or the cut shows bare paper --
        // which reads as floor carrying on past the wall rather than as the
        // wall being the end of it. Laid down first so the floor covers the
        // side of it the party actually stands on.
        for (const key of clipped?.keys() ?? []) {
            const [column, row] = key.split(',').map(Number);
            cells.push({
                ring: 1,
                key,
                gridColumn: column - originColumn + 1,
                gridRow: row - originRow + 1,
                patternX: column,
                patternY: row
            });
        }
        let frontier = explored;
        for (let ring = 1; ring <= HATCH_RINGS; ring++) {
            const next = new Set();
            for (const key of frontier) {
                const [column, row] = key.split(',').map(Number);
                for (const [columnOffset, rowOffset] of HATCH_NEIGHBOURS) {
                    const neighbour = `${column + columnOffset},${row + rowOffset}`;
                    if (seen.has(neighbour)) continue;
                    seen.add(neighbour);
                    next.add(neighbour);
                }
            }
            for (const key of next) {
                const [column, row] = key.split(',').map(Number);
                cells.push({
                    ring,
                    key,
                    gridColumn: column - originColumn + 1,
                    gridRow: row - originRow + 1,
                    // Absolute cell coordinates. CSS shifts each tile's pattern
                    // by its own position so the hatching is phased to one
                    // continuous lattice instead of restarting per square.
                    patternX: column,
                    patternY: row
                });
            }
            frontier = next;
        }
        return cells;
    }

    /**
     * Pick which of the two squares flanking a boundary draws it, preferring
     * the canonical side and falling back to its neighbour. Returns null when
     * neither has been explored, which is what keeps a stored edge from
     * showing up beyond the mapped area.
     */
    /** Human-readable name for a mapped opening, used for its tooltip. */
    _featureLabel(feature) {
        const key = {
            door: 'featureDoor',
            'locked-door': 'featureLockedDoor',
            window: 'featureWindow',
            'secret-door': 'featureSecretDoor'
        }[feature];
        return key ? game.i18n.localize(`${MODULE.ID}.mapping.${key}`) : '';
    }

    _drawableSide(edgeKey, explored) {
        const [orientation, first, second] = edgeKey.split(':');
        const a = Number(first);
        const b = Number(second);
        const sides = orientation === 'h'
            ? [{ column: a, row: b, direction: 'north' }, { column: a, row: b - 1, direction: 'south' }]
            : [{ column: a, row: b, direction: 'west' }, { column: a - 1, row: b, direction: 'east' }];
        return sides.find(side => explored.has(`${side.column},${side.row}`)) ?? null;
    }

    /**
     * Turn the scene's atlas into what this party may see of it.
     *
     * The atlas already settled every wall, doorway and corner with the whole
     * scene in hand, so nothing here decides architecture -- it decides
     * visibility. A boundary is drawn when either square it separates has been
     * explored, which is why a room you have stood in comes out with its
     * complete outline rather than the fragments your sightlines happened to
     * touch.
     */
    _getMappedTileGeometry(explored, atlas, discoveredSecrets, sides) {
        const segmentsByCell = new Map();
        const features = atlas?.features ?? {};
        // A secret door reads as ordinary wall until this party has walked it.
        const revealedSecretEdges = new Map();
        const found = discoveredSecrets instanceof Set
            ? discoveredSecrets
            : new Set(discoveredSecrets ?? []);
        for (const secret of atlas?.secrets ?? []) {
            if (!found.has(secret.id)) continue;
            for (const edge of secret.edges) {
                const edgeKey = this._latticeEdgeKey(edge.key, `wall:${edge.direction}`);
                if (edgeKey) revealedSecretEdges.set(edgeKey, true);
            }
        }
        const doorSymbolsByCell = new Map();
        const secretDoorSymbolsByCell = new Map();
        const windowSymbolsByCell = new Map();
        // A doorway outranks the wall it sits in, and a discovered secret
        // outranks every ordinary opening on the same edge.
        const priorities = {
            wall: 1,
            window: 2,
            door: 3,
            'locked-door': 4,
            'secret-door': 5
        };
        // Collapse to lattice edges first. A boundary is one line regardless of
        // which square it was written against, so the winner is decided per
        // line rather than per square -- and the explored check waits until the
        // drawing square is resolved, because a canonically stored edge can sit
        // on the unexplored side of a frontier.
        const latticeEdges = new Map();
        for (const [key, codes] of Object.entries(features ?? {})) {
            const [column, row] = key.split(',').map(Number);
            if (!Number.isInteger(column) || !Number.isInteger(row)) continue;
            for (const code of codes) {
                const [feature, direction] = code.split(':');
                const edgeKey = {
                    north: `h:${column}:${row}`,
                    south: `h:${column}:${row + 1}`,
                    west: `v:${column}:${row}`,
                    east: `v:${column + 1}:${row}`
                }[direction];
                if (!edgeKey || !priorities[feature]) continue;
                // Finding a secret door promotes the wall the atlas drew in its
                // place. Permanent knowledge: it is the party's record that
                // says so, not the scene.
                const shown = revealedSecretEdges.has(edgeKey) && feature === 'wall'
                    ? 'secret-door'
                    : feature;
                const existing = latticeEdges.get(edgeKey);
                if (!existing || priorities[shown] > priorities[existing.feature]) {
                    latticeEdges.set(edgeKey, { feature: shown });
                }
            }
        }

        // A boundary is drawn as soon as either square it separates has been
        // explored. That is the whole reveal rule, and it is why standing in a
        // room gives you the room rather than the parts you looked hardest at.
        const edges = new Map();
        for (const [edgeKey, edge] of latticeEdges) {
            const side = this._drawableSide(edgeKey, explored);
            if (!side) continue;
            edges.set(edgeKey, {
                key: `${side.column},${side.row}`,
                feature: edge.feature,
                direction: side.direction
            });
        }

        // Runs with real shape in them kept their own line rather than being
        // snapped, so they are drawn from that line. No boundary is suppressed
        // for them: the atlas gave each run one representation or the other,
        // never both, so there is nothing here that could disagree with itself.
        // Where a wall cuts across a square, the floor of that square stops at
        // it. Kept only for pieces lying in their own square, since a piece
        // lent to a neighbour is not crossing that neighbour's floor.
        const wallShapesByCell = new Map();
        for (const [key, segment, shape] of this._trueWallSegments(atlas?.lines, explored)) {
            segmentsByCell.set(key, [...(segmentsByCell.get(key) ?? []), segment]);
            if (shape) wallShapesByCell.set(key, [...(wallShapesByCell.get(key) ?? []), shape]);
        }

        // Wide openings mark every square they cross, so join those marks back
        // into one run and draw a single symbol across it.
        for (const run of this._coalesceGlyphRuns(edges)) {
            const target = DOOR_GLYPH_FEATURES.includes(run.feature)
                ? doorSymbolsByCell
                : windowSymbolsByCell;
            const symbol = DOOR_GLYPH_FEATURES.includes(run.feature)
                ? this._doorSymbol(run.direction, run.feature, run.span)
                : this._windowSymbol(run.direction, run.span);
            symbol.label = this._featureLabel(run.feature);
            target.set(run.key, [...(target.get(run.key) ?? []), symbol]);
        }

        for (const edge of edges.values()) {
            if (SPANNING_GLYPH_FEATURES.includes(edge.feature)) continue;
            if (edge.feature === 'secret-door') {
                secretDoorSymbolsByCell.set(edge.key, [
                    ...(secretDoorSymbolsByCell.get(edge.key) ?? []),
                    { ...this._secretDoorSymbol(edge.direction), label: this._featureLabel('secret-door') }
                ]);
                continue;
            }
            const segment = this._tileSegment(edge.feature, edge.direction, priorities[edge.feature]);
            if (segment) {
                segmentsByCell.set(edge.key, [...(segmentsByCell.get(edge.key) ?? []), segment]);
            }
        }
        const floorClipByCell = new Map();
        for (const [key, shapes] of wallShapesByCell) {
            const [column, row] = key.split(',').map(Number);
            const clip = this._floorClip(shapes, { column, row }, sides);
            if (clip) floorClipByCell.set(key, clip);
        }
        return {
            segmentsByCell, doorSymbolsByCell, secretDoorSymbolsByCell, windowSymbolsByCell,
            floorClipByCell
        };
    }

    /** The lattice edge a stored "feature:direction" code names. */
    _latticeEdgeKey(key, code) {
        const [column, row] = key.split(',').map(Number);
        const [, direction] = code.split(':');
        if (!Number.isInteger(column) || !Number.isInteger(row)) return null;
        return {
            north: `h:${column}:${row}`,
            south: `h:${column}:${row + 1}`,
            west: `v:${column}:${row}`,
            east: `v:${column + 1}:${row}`
        }[direction] ?? null;
    }

    /**
     * The least floor any cut square was left with, as a percentage of a whole
     * square. A square cut down to almost nothing reads as solid rock, which
     * looks exactly like a square that was never revealed -- so this is what
     * tells the two apart when a floor has a hole in it.
     */
    _thinnestFloor(clips) {
        let thinnest = 100;
        for (const polygon of clips.values()) {
            const points = polygon.split(', ').map(pair => pair.split(' ').map(parseFloat));
            let twiceArea = 0;
            for (let index = 0; index < points.length; index++) {
                const [x0, y0] = points[index];
                const [x1, y1] = points[(index + 1) % points.length];
                twiceArea += (x0 * y1) - (x1 * y0);
            }
            thinnest = Math.min(thinnest, Math.round(Math.abs(twiceArea) / 200));
        }
        return clips.size ? thinnest : 100;
    }

    /**
     * The part of a square that is floor, as a CSS polygon, or null when the
     * whole square is.
     *
     * A map drawn on squares fills each explored square edge to edge, which
     * turns a curved corridor into a staircase of blocks -- the walls sweep
     * round while the floor beneath them steps. So where a wall crosses a
     * square, the floor is cut back to it: the square starts whole and each
     * wall shaves off whatever lies beyond.
     *
     * Which side is floor is not worked out here. It was settled when the
     * square was first seen, and is simply read back. Working it out at drawing
     * time meant reading the squares around it, and those change as the party
     * walks -- so the answer changed too, and a square would swap its floor for
     * rock, or spill floor out past a wall, long after anyone had been near it.
     * Recorded once, it cannot drift.
     */
    _floorClip(shapes, cell, sides) {
        const stood = sides?.[`${cell.column},${cell.row}`];
        const from = Array.isArray(stood) ? { x: stood[0], y: stood[1] } : { x: 50, y: 50 };

        let polygon = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
        let cut = false;
        for (const shape of shapes) {
            const dx = shape.end.x - shape.start.x;
            const dy = shape.end.y - shape.start.y;
            if (!dx && !dy) continue;
            const side = point => ((point.x - shape.start.x) * dy) - ((point.y - shape.start.y) * dx);
            // A wall running exactly through the point the floor was seen from
            // says nothing about which way it lies, so it cuts nothing.
            const seen = side(from);
            if (Math.abs(seen) < 0.5) continue;
            const facing = Math.sign(seen);
            const clipped = [];
            for (let index = 0; index < polygon.length; index++) {
                const from = polygon[index];
                const to = polygon[(index + 1) % polygon.length];
                const here = side(from) * facing;
                const there = side(to) * facing;
                if (here >= 0) clipped.push(from);
                if ((here >= 0) !== (there >= 0)) {
                    const along = here / (here - there);
                    clipped.push({
                        x: from.x + ((to.x - from.x) * along),
                        y: from.y + ((to.y - from.y) * along)
                    });
                }
            }
            if (clipped.length < 3) return null;
            polygon = clipped;
            cut = true;
        }
        if (!cut || polygon.length < 3) return null;
        const round = value => Math.round(value * 100) / 100;
        return polygon.map(point => `${round(point.x)}% ${round(point.y)}%`).join(', ');
    }

    /**
     * Which of a square's wall pieces the party can see, and which square draws
     * them -- or null when they have not been anywhere it could be seen from.
     *
     * Asked of the square rather than of each piece. Smoothing cuts a curve
     * into pieces a fraction of a square long, and a piece that small can sit
     * in the middle of a square without touching any of its sides, so asking
     * each one on its own hid entire curves.
     *
     * Seeing a wall does not mean standing against it. A wall running through
     * the rock beside a corridor meets the walked floor at a corner as often as
     * along a side -- especially a curved one, which crosses squares
     * diagonally -- so every square around is considered, not just the four
     * square on. Checking only those left a curve drawn in pieces wherever it
     * happened to round a bend.
     *
     * What the party cannot see is what lies behind something else. So when
     * they are looking in from outside, only the near face of the square shows:
     * whatever sits deeper is behind it. Standing in the square, they see all
     * of it.
     */
    _visibleWall(cell, explored) {
        const { column, row } = cell;
        if (explored.has(`${column},${row}`)) return { host: { column, row }, pieces: cell.pieces };
        // Square neighbours before corner ones: a wall is more likely to be
        // seen across a side than across a point.
        const around = [
            [-1, 0], [1, 0], [0, -1], [0, 1],
            [-1, -1], [1, -1], [-1, 1], [1, 1]
        ];
        for (const [columnOffset, rowOffset] of around) {
            const host = { column: column + columnOffset, row: row + rowOffset };
            if (!explored.has(`${host.column},${host.row}`)) continue;
            // Whole walls are near or far, never pieces of one. A wall crossing
            // a square runs from one side of it to the other, so its pieces sit
            // at every depth there is -- judging them one by one cut the middle
            // out of every crossing and left curves in tatters. Pieces that
            // join up are one wall and stand or fall together.
            const walls = this._joinPieces(cell.pieces);
            const from = { x: host.column + 0.5, y: host.row + 0.5 };
            const reach = wall => Math.min(...wall.map(piece => Math.hypot(
                piece.middle.x - from.x, piece.middle.y - from.y
            )));
            const depths = walls.map(reach);
            const nearest = Math.min(...depths);
            return {
                host,
                pieces: walls
                    .filter((wall, index) => depths[index] <= nearest + WALL_FACE_DEPTH)
                    .flat()
            };
        }
        return null;
    }

    /**
     * Gather a square's wall pieces into the walls they belong to.
     *
     * Smoothing leaves a curve as a chain of short pieces laid end to end, so
     * pieces that touch came from the same wall. A second wall crossing the
     * same square is a separate chain, and it is the chains that are near or
     * far from the party, not the pieces within them.
     */
    _joinPieces(pieces) {
        const walls = [];
        for (const piece of pieces) {
            const touching = walls.filter(wall => wall.some(other => (
                Math.hypot(other.to.x - piece.from.x, other.to.y - piece.from.y) < PIECE_JOIN
                || Math.hypot(other.from.x - piece.to.x, other.from.y - piece.to.y) < PIECE_JOIN
                || Math.hypot(other.from.x - piece.from.x, other.from.y - piece.from.y) < PIECE_JOIN
                || Math.hypot(other.to.x - piece.to.x, other.to.y - piece.to.y) < PIECE_JOIN
            )));
            if (!touching.length) {
                walls.push([piece]);
                continue;
            }
            // Joining two chains at once means they were one wall all along.
            const [first, ...rest] = touching;
            first.push(piece);
            for (const other of rest) {
                first.push(...other);
                walls.splice(walls.indexOf(other), 1);
            }
        }
        return walls;
    }

    /**
     * Cut the atlas's true wall lines into the squares they pass through, as
     * polylines in each square's own coordinates.
     *
     * The map is a grid of cells that each own a small SVG, so a wall crossing
     * five squares is drawn as five pieces. They meet exactly, because every
     * piece is measured from the same line -- the seam is invisible, and in
     * return this needs no overlay, no separate zoom handling and no change to
     * the template.
     *
     * The bow through the middle is the same hand-drawn wobble the boundary
     * strokes use, turned to run across whatever angle the wall sits at.
     */
    * _trueWallSegments(lines, explored) {
        // Everything the walls do in each square, gathered before anything is
        // drawn, so visibility can be decided once per square.
        const squares = new Map();
        for (const line of lines ?? []) {
            const [[x0, y0], [x1, y1]] = line;
            if (![x0, y0, x1, y1].every(Number.isFinite)) continue;
            const dx = x1 - x0;
            const dy = y1 - y0;
            const length = Math.hypot(dx, dy);
            if (!length) continue;
            // Perpendicular to the wall, in the cell's 0-100 coordinates.
            const bowX = (-dy / length) * 1.6;
            const bowY = (dx / length) * 1.6;

            // A line lying along a square's edge belongs to the squares on both
            // sides of it, and only one of those is Math.floor of its position.
            // Reach one square back so the other is considered too. Squares the
            // line genuinely misses are rejected by the clip.
            const firstColumn = Math.floor(Math.min(x0, x1)) - 1;
            const lastColumn = Math.floor(Math.max(x0, x1));
            const firstRow = Math.floor(Math.min(y0, y1)) - 1;
            const lastRow = Math.floor(Math.max(y0, y1));

            for (let row = firstRow; row <= lastRow; row++) {
                for (let column = firstColumn; column <= lastColumn; column++) {
                    const span = clipSegmentToCell(x0, y0, x1, y1, column, row);
                    if (!span) continue;
                    const [enter, exit] = span;
                    const at = amount => ({ x: x0 + (dx * amount), y: y0 + (dy * amount) });
                    const from = at(enter);
                    const to = at(exit);
                    // A line down this square's east or south side is the same
                    // line as one down the next square's west or north side,
                    // and the loop reaches both. Draw it once.
                    if (from.x === column + 1 && to.x === column + 1) continue;
                    if (from.y === row + 1 && to.y === row + 1) continue;
                    const key = `${column},${row}`;
                    if (!squares.has(key)) squares.set(key, { column, row, pieces: [] });
                    squares.get(key).pieces.push({ from, to, middle: at((enter + exit) / 2), bowX, bowY });
                }
            }
        }

        for (const cell of squares.values()) {
            const visible = this._visibleWall(cell, explored);
            if (!visible) continue;
            const { host } = visible;
            // Rounded because these go straight into markup, and a clip lands
            // on values like 30.00000000000007.
            const local = point => ({
                x: Math.round((point.x - host.column) * 10000) / 100,
                y: Math.round((point.y - host.row) * 10000) / 100
            });
            for (const piece of visible.pieces) {
                const start = local(piece.from);
                const end = local(piece.to);
                const middle = local(piece.middle);
                yield [`${host.column},${host.row}`, {
                    className: 'is-wall',
                    priority: 1,
                    points: `${start.x},${start.y} ${middle.x + piece.bowX},${middle.y + piece.bowY} ${end.x},${end.y}`,
                    echoPoints: `${start.x},${start.y} ${middle.x - (piece.bowX * 0.7)},${middle.y - (piece.bowY * 0.7)} ${end.x},${end.y}`
                }, host.column === cell.column && host.row === cell.row ? { start, end } : null];
            }
        }
    }

    /**
     * Join adjacent, collinear marks of the same opening into runs, so a wide
     * door recorded across several squares becomes one wide symbol instead of
     * a row of identical small ones.
     */
    _coalesceGlyphRuns(edges) {
        const groups = new Map();
        for (const edge of edges.values()) {
            if (!SPANNING_GLYPH_FEATURES.includes(edge.feature)) continue;
            const [column, row] = edge.key.split(',').map(Number);
            const horizontal = edge.direction === 'north' || edge.direction === 'south';
            const groupKey = `${edge.feature}:${edge.direction}:${horizontal ? row : column}`;
            if (!groups.has(groupKey)) groups.set(groupKey, { edge, horizontal, column, row, values: [] });
            groups.get(groupKey).values.push(horizontal ? column : row);
        }

        const runs = [];
        for (const group of groups.values()) {
            const { edge, horizontal, column, row } = group;
            const values = [...new Set(group.values)].sort((left, right) => left - right);
            // Anchor where the glyph's local +x runs along the run: forward for
            // north and east, back from the far end for south and west.
            const forward = edge.direction === 'north' || edge.direction === 'east';
            const flush = (start, end) => {
                const anchor = forward ? start : end;
                runs.push({
                    key: horizontal ? `${anchor},${row}` : `${column},${anchor}`,
                    feature: edge.feature,
                    direction: edge.direction,
                    span: end - start + 1
                });
            };
            let start = values[0];
            let previous = values[0];
            for (let index = 1; index < values.length; index++) {
                if (values[index] === previous + 1) {
                    previous = values[index];
                    continue;
                }
                flush(start, previous);
                start = values[index];
                previous = values[index];
            }
            flush(start, previous);
        }
        return runs;
    }

    /**
     * A window: the wall opens and the gap is bridged by a shallow slot. Kept
     * deliberately thinner than the doorway box so the two read apart at a
     * glance, and drawn in ink like everything else -- the map is pen and ink,
     * so a colour was the one thing on it that could not have been drawn.
     */
    _windowSymbol(direction, span = 1) {
        const width = 100 * span;
        const stub = 30;
        const inner = width - stub;
        return {
            transform: GLYPH_TRANSFORMS[direction] ?? GLYPH_TRANSFORMS.north,
            lines: [
                { points: `0,0 ${stub},0`, echoPoints: `0,-1.1 ${stub},0.8` },
                { points: `${inner},0 ${width},0`, echoPoints: `${inner},-0.9 ${width},1` }
            ],
            slotPoints: `${stub},-5 ${inner},-4 ${inner},5 ${stub},4 ${stub},-5`,
            echoSlotPoints: `${stub + 1},-4 ${inner - 1},-5.5 ${inner},4 ${stub},5 ${stub + 1},-4`
        };
    }

    _secretDoorSymbol(direction) {
        const transforms = {
            north: 'translate(0 0)',
            south: 'translate(100 100) rotate(180)',
            west: 'translate(0 100) rotate(-90)',
            east: 'translate(100 0) rotate(90)'
        };
        return {
            transform: transforms[direction] ?? transforms.north,
            // The wall stays unbroken. A secret door reads as solid wall on an
            // old-school map -- it is annotated, not opened -- and the previous
            // glyph left a gap in the stroke, which drew it as an ordinary
            // doorway. The S sits just inside the room instead, which lands
            // correctly for all four edges under these transforms.
            lines: [
                { points: '0,0 100,0', echoPoints: '0,-1.1 100,0.9' }
            ]
        };
    }

    /**
     * The extra marking that distinguishes a door variant, authored facing
     * north and rotated into place like the secret-door glyph.
     */
    _doorMark(feature, width) {
        if (feature !== 'locked-door') return null;
        const centre = width / 2;
        // A short bolt across the doorway, per the official locked-door glyph.
        // Deliberately well clear of the box edges: a bar that reaches them
        // reads as a wall dividing the opening, which makes one wide locked
        // door look like two ordinary ones. Round caps add half the stroke
        // width at each end, so the drawn length is shorter than it looks.
        return {
            lines: [{
                points: `${centre},-4 ${centre},6`,
                echoPoints: `${centre - 0.6},-4 ${centre + 0.6},6`
            }]
        };
    }

    /**
     * A doorway, as wide as the opening it represents. Authored facing north
     * and rotated into place, which is what lets one set of coordinates serve
     * all four edges at any width; the four hardcoded direction variants this
     * replaced could only ever be one square wide.
     */
    _doorSymbol(direction, feature = 'door', span = 1) {
        const width = 100 * span;
        const inner = width - GLYPH_STUB;
        return {
            transform: GLYPH_TRANSFORMS[direction] ?? GLYPH_TRANSFORMS.north,
            lines: [
                { points: `0,0 ${GLYPH_STUB},0`, echoPoints: `0,-1.2 ${GLYPH_STUB},0.8` },
                { points: `${inner},0 ${width},0`, echoPoints: `${inner},-0.9 ${width},1` }
            ],
            boxPoints: `${GLYPH_STUB},-12 ${inner},-10.5 ${inner - 1},14 ${GLYPH_STUB + 1},13 ${GLYPH_STUB},-12`,
            echoBoxPoints: `${GLYPH_STUB + 1},-11 ${inner - 1},-11.5 ${inner},13 ${GLYPH_STUB},14 ${GLYPH_STUB + 1},-11`,
            mark: this._doorMark(feature, width)
        };
    }

    _tileSegment(feature, direction, priority) {
        const endpoints = {
            north: { x1: 0, y1: 0, x2: 100, y2: 0 },
            east: { x1: 100, y1: 0, x2: 100, y2: 100 },
            south: { x1: 0, y1: 100, x2: 100, y2: 100 },
            west: { x1: 0, y1: 0, x2: 0, y2: 100 }
        }[direction];
        if (!endpoints || !priority) return null;
        const horizontal = endpoints.y1 === endpoints.y2;
        const bend = { north: -1.8, east: 1.4, south: 1.8, west: -1.4 }[direction];
        const midpoint = { x: (endpoints.x1 + endpoints.x2) / 2, y: (endpoints.y1 + endpoints.y2) / 2 };
        const mainMidpoint = {
            x: midpoint.x + (horizontal ? 0 : bend),
            y: midpoint.y + (horizontal ? bend : 0)
        };
        const echoMidpoint = {
            x: midpoint.x - (horizontal ? 0 : bend * 0.7),
            y: midpoint.y - (horizontal ? bend * 0.7 : 0)
        };
        return {
            className: `is-${feature}`,
            priority,
            points: `${endpoints.x1},${endpoints.y1} ${mainMidpoint.x},${mainMidpoint.y} ${endpoints.x2},${endpoints.y2}`,
            echoPoints: `${endpoints.x1},${endpoints.y1} ${echoMidpoint.x},${echoMidpoint.y} ${endpoints.x2},${endpoints.y2}`
        };
    }

    async toggleList() {
        this.viewMode = this.viewMode === 'list' ? 'map' : 'list';
        await this.manager.renderWindow();
    }

    async showMap() {
        if (this.viewMode === 'map') return;
        this.viewMode = 'map';
        await this.manager.renderWindow();
    }

    async selectMap(mapId) {
        if (!this.manager.selectMap(mapId, { render: false })) return;
        this.viewMode = 'map';
        this._hasBuiltMap = false;
        this._hasPaintedMap = false;
        this._renderedExplored = new Set();
        await this.manager.renderWindow();
        this.centerOnMap();
    }

    /**
     * Zoom about the viewport centre. The camera is the centre point, so
     * changing only the scale cannot move the map -- zoom never recentres.
     */
    setZoom(value) {
        const zoom = Math.max(0.4, Math.min(2.5, Number(value) || 1));
        this._targetZoom = zoom;
        this.zoom = zoom;
        this._applyCamera();
        this._zoomQueue = (this._zoomQueue ?? Promise.resolve())
            .catch(error => console.error(`${MODULE.NAME}: Failed to zoom mapping window`, error))
            .then(() => this.manager.renderWindow());
        return this._zoomQueue.then(() => this);
    }

    _onRender(context, options) {
        super._onRender?.(context, options);
        const viewport = this.element?.querySelector('.cartographer-mapping-viewport');
        if (!viewport) return;
        viewport.addEventListener('pointerdown', this._handlePanStart);
        viewport.addEventListener('pointermove', this._handlePanMove);
        viewport.addEventListener('pointerup', this._handlePanEnd);
        viewport.addEventListener('pointercancel', this._handlePanEnd);
        viewport.addEventListener('contextmenu', this._handleMapContextMenu);

        // The camera offset is measured from the viewport's own size, so a
        // resize has to re-apply it or the map drifts off centre. While
        // following or recording this also re-centres on the party, so the
        // token stays put under the resized window.
        this._resizeObserver?.disconnect();
        this._resizeObserver = new ResizeObserver(() => {
            this._applyCompactChrome();
            if (this._followArmed && this.manager.getTrackedPositionForCurrentMap()) this.centerOnParty();
            else this._applyCamera();
        });
        this._resizeObserver.observe(viewport);
        this._applyCompactChrome();
        this.refreshMarkerState();

        // The grid element is brand new on every render. Re-establish the view
        // before the browser paints, otherwise the map flashes at the origin.
        const grid = viewport.querySelector('.cartographer-mapping-grid');
        if (!grid) return;
        // CSS owns the cell size, so read it rather than duplicating the value.
        const cellSize = Number.parseFloat(
            getComputedStyle(grid).getPropertyValue('--cartographer-map-cell-size')
        );
        if (cellSize > 0) this._cellSize = cellSize;
        // Whatever is being tracked, recorded or merely followed. Asking for
        // the recording position only meant following never moved the view
        // after the first frame: every step re-drew the map around a camera
        // that had been left where the party started.
        const tracked = this._followArmed ? this.manager.getTrackedPositionForCurrentMap() : null;
        if (tracked) {
            const { x, y } = this._cellCenter(tracked);
            // Snap the first time the map is drawn, glide once it is on screen.
            this._setCamera(x, y, { animate: this._hasPaintedMap });
        } else {
            this._applyCamera();
        }
        // The window can be measured as zero-width before it has been laid out,
        // which would place the map by half a viewport it does not have yet.
        if (viewport.clientWidth > 0) this._hasPaintedMap = true;
        else requestAnimationFrame(() => this._applyCamera());
    }

    /**
     * Reflect where the token is in relation to where the ink has got.
     *
     * Deliberately a class toggle rather than a re-render: it is called as a
     * move starts and as it settles, and re-rendering the whole map to fade an
     * icon would rebuild every cell twice per step.
     */
    refreshMarkerState() {
        const viewport = this.element?.querySelector('.cartographer-mapping-viewport');
        if (!viewport) return;
        // In transit the stop square is genuinely unknown, so the marker fades
        // out rather than sliding to a square the token is only passing through.
        viewport.classList.toggle('is-transit', this.manager.tokenInTransit);
        viewport.classList.toggle('is-mapping', this.manager.mappingPending);
    }

    _handlePanStart(event) {
        // A left press opens the menu on release, so long as it was a click
        // rather than the start of a drag.
        if (event.button === 0) {
            this._press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
            return;
        }
        if (event.button !== 2) return;
        const viewport = event.currentTarget;
        event.preventDefault();
        viewport.setPointerCapture?.(event.pointerId);
        viewport.classList.add('is-panning');
        // A manual pan takes over the view until the party moves again.
        this._stopCameraAnimation();
        this._followArmed = false;
        this._applyCamera();
        this._pan = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            cameraX: this.camera.x,
            cameraY: this.camera.y,
            moved: false
        };
    }

    _handlePanMove(event) {
        if (this._press && event.pointerId === this._press.pointerId) {
            const moved = Math.hypot(event.clientX - this._press.x, event.clientY - this._press.y);
            if (moved > PRESS_SLOP) this._press = null;
        }
        if (!this._pan || event.pointerId !== this._pan.pointerId) return;
        event.preventDefault();
        const deltaX = event.clientX - this._pan.x;
        const deltaY = event.clientY - this._pan.y;
        if (Math.hypot(deltaX, deltaY) > 4) this._pan.moved = true;
        // Dragging right moves the map right, so the camera moves left.
        this._setCamera(
            this._pan.cameraX - (deltaX / this.zoom),
            this._pan.cameraY - (deltaY / this.zoom)
        );
    }

    _handlePanEnd(event) {
        if (this._press && event.pointerId === this._press.pointerId) {
            const press = this._press;
            this._press = null;
            if (Math.hypot(event.clientX - press.x, event.clientY - press.y) <= PRESS_SLOP) {
                this._openCellMenu(event);
            }
        }
        if (!this._pan || event.pointerId !== this._pan.pointerId) return;
        const viewport = event.currentTarget;
        viewport.releasePointerCapture?.(event.pointerId);
        viewport.classList.remove('is-panning');
        this._pan = null;
    }

    /**
     * The map's own menu opens on a left click, not a right one.
     *
     * Panning is a right-drag, and a right-drag ends in a right-click as far as
     * the browser is concerned -- so the menu and the pan were the same gesture,
     * separated only by watching how far the pointer had moved and then
     * ignoring the menu for a moment afterwards. That is a race, and it was
     * lost often enough to be worth removing rather than tuning. Left to open,
     * right to pan: the two can no longer be confused.
     */
    _handleMapContextMenu(event) {
        // Only to keep the browser's own menu from appearing during a pan.
        event.preventDefault();
    }

    _openCellMenu(event) {
        if (this.viewMode !== 'map') return;
        if (!this.manager.canAnnotateRecord()) return;
        const spot = this._squareAt(event);
        if (!spot) return;
        const { column, row, at } = spot;

        // Rock carries none of the annotations, which all belong to floor -- but
        // it still has to answer, because telling the map that somewhere is
        // floor is only ever useful where it currently is not.
        if (!this.manager.isFloor(column, row)) {
            if (!this.manager.canManageRecord()) return;
            this._showCellMenu(event, [this._fixMenu(column, row, at)]);
            return;
        }

        // Whether a menu can be shown at all is settled once, where it is
        // shown; asking again here only made floor and rock disagree about it.
        const localize = key => game.i18n.localize(`${MODULE.ID}.${key}`);
        const place = type => () => this.manager.placeMapSymbol(type, column, row);
        // Sorted on the localized name rather than the catalogue order, so the
        // menu stays alphabetical in whatever language it is read in.
        const byName = (left, right) => left.name.localeCompare(right.name);
        const categories = MAPPING_SYMBOL_CATEGORIES.map(category => ({
            name: localize(category.labelKey),
            icon: category.icon,
            submenu: category.types
                .map(type => ({ name: localize(getMappingSymbol(type).labelKey), callback: place(type) }))
                .sort(byName)
        })).sort(byName);

        const items = [];
        // Delete leads, so the action that undoes a mistake is always in the
        // same place rather than moving with the rest of the menu.
        if (this.manager.hasMapSymbol(column, row)) {
            items.push({
                name: localize('mapping.removeSymbol'),
                icon: 'fa-solid fa-trash-can',
                callback: () => this.manager.removeMapSymbol(column, row)
            });
            items.push({ separator: true });
        }
        // A note is its own action rather than one placeable among many,
        // because it carries the player's words rather than a map convention.
        items.push({
            name: localize(this.manager.getMapNote(column, row) ? 'mapping.editNote' : 'mapping.addNote'),
            icon: 'fa-solid fa-pen-to-square',
            callback: place('note')
        });
        items.push({ separator: true });
        // Markers annotate rather than describe anything built, so they sit
        // alongside the placeables rather than inside them.
        items.push({
            name: localize(MAPPING_MARKERS.labelKey),
            icon: MAPPING_MARKERS.icon,
            submenu: MAPPING_MARKERS.types
                .map(type => ({ name: localize(getMappingSymbol(type).labelKey), callback: place(type) }))
                .sort(byName)
        });
        items.push({
            name: localize('mapping.placeables'),
            icon: 'fa-solid fa-shapes',
            submenu: categories
        });

        // Floor surfaces restyle a whole area, so unlike the markings above
        // they stay with the Actor's owner.
        if (!this.manager.canManageRecord()) {
            this._showCellMenu(event, items);
            return;
        }
        const currentFloor = this.manager.getFloorType(column, row);
        items.push({ separator: true });
        items.push({
            name: localize('mapping.floorType'),
            icon: 'fa-solid fa-fill-drip',
            submenu: MAPPING_FLOOR_TYPES.map(floor => ({
                name: `${localize(floor.labelKey)}${floor.type === currentFloor ? ' ✓' : ''}`,
                icon: floor.icon,
                callback: () => this.manager.setFloorType(floor.type, column, row)
            }))
        });
        items.push({ separator: true });
        items.push(this._fixMenu(column, row, at));
        this._showCellMenu(event, items);
    }

    /**
     * Which square a click landed in, and whereabouts in it.
     *
     * Worked out from the grid's own geometry rather than from whatever element
     * happens to be under the pointer. Only explored squares have an element of
     * their own; rock has a hatch tile at best, which is drawn straight through
     * by pointer events, and past the hatched band there is nothing there at
     * all. Asking the grid means every square can be clicked, which is what
     * telling the map about the ones it got wrong requires.
     *
     * Where in the square matters and is kept: a square a wall cuts through is
     * part floor and part rock, and the point clicked is known to be on the
     * floor side of it -- the one thing about such a square that nothing else
     * can establish.
     */
    _squareAt(event) {
        const grid = this.element?.querySelector('.cartographer-mapping-grid');
        if (!grid) return null;
        const box = grid.getBoundingClientRect();
        const columns = Number(grid.style.getPropertyValue('--cartographer-map-columns'));
        const rows = Number(grid.style.getPropertyValue('--cartographer-map-rows'));
        if (!box.width || !box.height || !columns || !rows) return null;
        const across = (event.clientX - box.left) / (box.width / columns);
        const down = (event.clientY - box.top) / (box.height / rows);
        if (across < 0 || down < 0 || across >= columns || down >= rows) return null;
        const originColumn = Number(grid.dataset.originColumn);
        const originRow = Number(grid.dataset.originRow);
        if (!Number.isInteger(originColumn) || !Number.isInteger(originRow)) return null;
        return {
            column: originColumn + Math.floor(across),
            row: originRow + Math.floor(down),
            at: [
                Math.round((across - Math.floor(across)) * 100),
                Math.round((down - Math.floor(down)) * 100)
            ]
        };
    }

    /** Telling the map what it got wrong, rather than having it guess again. */
    _fixMenu(column, row, at) {
        const localize = key => game.i18n.localize(`${MODULE.ID}.${key}`);
        const isFloor = this.manager.isFloor(column, row);
        return {
            name: localize('mapping.fixThings'),
            icon: 'fa-solid fa-wand-magic-sparkles',
            submenu: [{
                name: localize('mapping.markFloor'),
                icon: 'fa-solid fa-square',
                callback: () => this.manager.markFloor(column, row, at)
            }, {
                name: `${localize('mapping.markRock')}${isFloor ? '' : ' ✓'}`,
                icon: 'fa-solid fa-mountain',
                callback: () => this.manager.markRock(column, row)
            }]
        };
    }

    _showCellMenu(event, items) {
        const contextMenu = game.modules.get('coffee-pub-blacksmith')?.api?.uiContextMenu;
        if (typeof contextMenu?.show !== 'function') return;
        contextMenu.show({
            id: `${MODULE.ID}-mapping-cell-context`,
            x: event.clientX,
            y: event.clientY,
            root: this.element?.ownerDocument?.body ?? document.body,
            zones: { module: items },
            className: 'cartographer-mapping-cell-context'
        });
    }

    // ==============================================================
    // ===== CAMERA =================================================
    // ==============================================================
    //
    // The map is positioned by a transform computed from `this.camera`,
    // which is plain JavaScript state on this window instance.
    //
    // This is deliberate. The Blacksmith tool window renders a single
    // ApplicationV2 part whose template inlines the whole map body, so every
    // render(false) replaces the viewport and grid elements. Any view state
    // stored in the DOM -- a scroll offset, an inline margin, an in-flight
    // CSS transition -- is destroyed on each reveal. ApplicationV2 has no
    // _saveScrollPositions equivalent (that is ApplicationV1 only), so there
    // is nothing to restore it. Keeping the camera outside the DOM and
    // re-applying it after each render is what makes the view survive.

    /**
     * Drop button captions once the window is too narrow to carry them, so the
     * top bar degrades to icons rather than overflowing.
     */
    _applyCompactChrome() {
        const root = this.element;
        if (!root) return;
        root.classList.toggle('is-compact', root.clientWidth < COMPACT_CHROME_WIDTH);
    }

    /** Map-space centre of a grid cell, in unzoomed pixels. */
    _cellCenter(position) {
        return {
            x: (position.column + 0.5) * this._cellSize,
            y: (position.row + 0.5) * this._cellSize
        };
    }

    /**
     * Write the current camera to the DOM. Safe to call at any time: it
     * re-queries the elements, so a grid replaced by a render simply picks up
     * the transform on the next call.
     */
    _applyCamera() {
        const viewport = this.element?.querySelector('.cartographer-mapping-viewport');
        const grid = this.element?.querySelector('.cartographer-mapping-grid');
        if (!viewport || !grid) return false;
        // The camera is in absolute map space, but the endless-canvas grid
        // starts at its own origin, so convert into the grid's local space.
        const originX = (Number(grid.dataset.originColumn) || 0) * this._cellSize;
        const originY = (Number(grid.dataset.originRow) || 0) * this._cellSize;
        const offsetX = (viewport.clientWidth / 2) - ((this.camera.x - originX) * this.zoom);
        const offsetY = (viewport.clientHeight / 2) - ((this.camera.y - originY) * this.zoom);
        grid.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${this.zoom})`;
        // While following, the pinned marker is shown and the in-grid one is
        // hidden, so the party never drifts off centre during a camera glide.
        viewport.classList.toggle(
            'is-following',
            this._followArmed && Boolean(this.manager.active || this.manager.following)
        );
        viewport.style.setProperty('--cartographer-map-zoom', this.zoom);
        return true;
    }

    /**
     * Move the camera so that map point (x, y) sits at the viewport centre.
     * Animated moves are driven by requestAnimationFrame rather than a CSS
     * transition, because a transition dies with the element it is running on
     * and the grid element is replaced on every reveal.
     */
    _setCamera(x, y, { animate = false } = {}) {
        this._cameraTarget = { x, y };
        if (!animate) {
            this._stopCameraAnimation();
            this.camera = { x, y };
            this._applyCamera();
            return;
        }
        // A running loop picks up the new target on its next frame, but the
        // grid may have just been replaced, so paint the current camera now to
        // avoid a one-frame flash at the origin.
        this._applyCamera();
        if (this._cameraFrame) return;
        const step = () => {
            const target = this._cameraTarget;
            const deltaX = target.x - this.camera.x;
            const deltaY = target.y - this.camera.y;
            if (Math.hypot(deltaX, deltaY) * this.zoom < 0.5) {
                this._cameraFrame = null;
                this.camera = { ...target };
                this._applyCamera();
                return;
            }
            this.camera = {
                x: this.camera.x + (deltaX * CAMERA_EASING),
                y: this.camera.y + (deltaY * CAMERA_EASING)
            };
            this._applyCamera();
            this._cameraFrame = requestAnimationFrame(step);
        };
        this._cameraFrame = requestAnimationFrame(step);
    }

    _stopCameraAnimation() {
        if (this._cameraFrame) cancelAnimationFrame(this._cameraFrame);
        this._cameraFrame = null;
    }

    /**
     * Re-arm centred following. Called when the tracked token completes a
     * step, so that a manual pan is honoured until the party moves again.
     */
    armFollow() {
        if (this._followArmed) return;
        this._followArmed = true;
        this._applyCamera();
    }

    /** Centre on the party marker, which renders at the last mapped step. */
    centerOnParty({ animate = false } = {}) {
        const position = this.manager.getTrackedPositionForCurrentMap();
        if (!position) return false;
        this._followArmed = true;
        const { x, y } = this._cellCenter(position);
        this._setCamera(x, y, { animate });
        return true;
    }

    /**
     * Frame the whole map in the window. This is what the view-mode button
     * does, since with no tracked token there is nothing to centre on.
     */
    fitMap() {
        const explored = this.manager.state.explored ?? [];
        if (!explored.length) return false;
        const viewport = this.element?.querySelector('.cartographer-mapping-viewport');
        if (!viewport?.clientWidth) return false;
        let minColumn = Infinity;
        let minRow = Infinity;
        let maxColumn = -Infinity;
        let maxRow = -Infinity;
        for (const key of explored) {
            const [column, row] = key.split(',').map(Number);
            if (!Number.isInteger(column) || !Number.isInteger(row)) continue;
            minColumn = Math.min(minColumn, column);
            minRow = Math.min(minRow, row);
            maxColumn = Math.max(maxColumn, column);
            maxRow = Math.max(maxRow, row);
        }
        if (!Number.isFinite(minColumn)) return false;
        const width = (maxColumn - minColumn + 1) * this._cellSize;
        const height = (maxRow - minRow + 1) * this._cellSize;
        const margin = MAP_MARGIN_CELLS * this._cellSize;
        this.zoom = Math.max(0.4, Math.min(2.5, Math.min(
            viewport.clientWidth / (width + margin),
            viewport.clientHeight / (height + margin)
        )));
        this._targetZoom = this.zoom;
        this.centerOnMap();
        void this.manager.renderWindow();
        return true;
    }

    centerView() {
        if (!this.centerOnParty()) this.centerOnMap();
    }

    /**
     * Centre on the explored bounds. Computed from the record rather than
     * from element rectangles, so it does not depend on layout having settled.
     */
    centerOnMap() {
        const explored = this.manager.state.explored ?? [];
        if (!explored.length) return false;
        let minColumn = Infinity;
        let minRow = Infinity;
        let maxColumn = -Infinity;
        let maxRow = -Infinity;
        for (const key of explored) {
            const [column, row] = key.split(',').map(Number);
            if (!Number.isInteger(column) || !Number.isInteger(row)) continue;
            minColumn = Math.min(minColumn, column);
            minRow = Math.min(minRow, row);
            maxColumn = Math.max(maxColumn, column);
            maxRow = Math.max(maxRow, row);
        }
        if (!Number.isFinite(minColumn)) return false;
        this._followArmed = false;
        this._setCamera(
            ((minColumn + maxColumn + 1) / 2) * this._cellSize,
            ((minRow + maxRow + 1) / 2) * this._cellSize
        );
        return true;
    }

    /**
     * Without the menubar button the window is the only way to stop recording,
     * so closing it ends the session -- and that is worth confirming rather
     * than doing silently.
     */
    async close(options = {}) {
        if (this.manager?.active && !this.manager.menubarEnabled && !options.force) {
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: game.i18n.localize(`${MODULE.ID}.mapping.closeStopsTitle`) },
                content: `<p>${foundry.utils.escapeHTML(game.i18n.localize(`${MODULE.ID}.mapping.closeStopsHint`))}</p>`,
                rejectClose: false,
                modal: true
            });
            if (!confirmed) return this;
        }
        return super.close(options);
    }

    _onClose(options) {
        this._pan = null;
        this._targetZoom = null;
        this._resizeObserver?.disconnect();
        this._resizeObserver = null;
        this._stopCameraAnimation();
        void this.manager?.onWindowClosed(this);
        return super._onClose?.(options);
    }
}

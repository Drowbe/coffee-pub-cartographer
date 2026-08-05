// ==================================================================
// ===== MAPPING TOOL WINDOW ========================================
// ==================================================================

import { MODULE } from './const.js';
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
/** Window width below which chrome buttons drop their captions. */
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
            const buttons = [this._chromeButton({
                action: 'toggle-list',
                icon: 'fa-solid fa-map',
                label: model.viewMapLabel
            })];
            if (model.canAdd) {
                buttons.push(this._chromeButton({
                    action: 'add-map',
                    icon: 'fa-solid fa-plus',
                    label: model.addMapLabel
                }));
            }
            return `<span class="cartographer-mapping-chrome-actions is-primary">${buttons.join('')}</span>`;
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
            actorName: record.actorName,
            sceneName: record.sceneName,
            updated: record.updatedAt ? new Date(record.updatedAt).toLocaleString() : '',
            feetMapped: record.explored.length * (record.gridDistance || 5),
            isCurrent: record.id === this.manager.currentMapId,
            canManage: this.manager.canManageRecord(record),
            canRecord: record.sceneId === canvas?.scene?.id && this.manager.canManageRecord(record),
            thumbnail: isList ? this._mapThumbnail(record) : null
        }));
        if (this.viewMode === 'list') {
            return {
                isListView: true,
                maps,
                canAdd: this.manager.canRecordCurrentMap(),
                listEmpty: maps.length === 0,
                listEmptyMessage: game.i18n.localize(`${MODULE.ID}.mapping.noMaps`),
                // Offered whenever this scene has no map they could record
                // into. Shown even without a token selected, because the
                // create action explains what is missing better than a hidden
                // card does.
                showCreateCard: !this.manager.hasManageableMapForCurrentScene(),
                createTitle: game.i18n.localize(`${MODULE.ID}.mapping.createForScene`),
                createHint: game.i18n.localize(`${MODULE.ID}.mapping.createForSceneHint`),
                addMapLabel: game.i18n.localize(`${MODULE.ID}.mapping.addMap`),
                viewMapLabel: game.i18n.localize(`${MODULE.ID}.mapping.viewMap`),
                renameLabel: game.i18n.localize(`${MODULE.ID}.mapping.rename`),
                deleteLabel: game.i18n.localize(`${MODULE.ID}.mapping.deleteMap`),
                feetMappedLabel: game.i18n.localize(`${MODULE.ID}.mapping.feetMapped`),
                feetMapped: this.manager.state.explored.length * (this.manager.state.gridDistance || 5)
            };
        }
        return { ...this._buildMapModel(), isListView: false, maps };
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
        const mappedGeometry = this._getMappedTileGeometry(explored, this.manager.state.features);
        const canRecord = this.manager.canRecordCurrentMap();
        const common = {
            canRecord,
            isRecording: this.manager.active,
            isPaused: this.manager.paused,
            zoom: this.zoom,
            // Following and recording both track a token on this scene, so a
            // map belonging to another scene can only be viewed.
            modes: MAPPING_MODE_BUTTONS.filter(mode => mode.id === 'view'
                || this.manager.state.sceneId === canvas?.scene?.id).map(mode => ({
                id: mode.id,
                icon: mode.icon,
                label: game.i18n.localize(`${MODULE.ID}.mapping.mode${mode.key}Hint`),
                text: game.i18n.localize(`${MODULE.ID}.mapping.mode${mode.key}`),
                isCurrent: this.manager.mode === mode.id,
                // Recording is the only mode with entry requirements, so it is
                // the only one that can be unavailable.
                disabled: mode.id === 'record' && !canRecord && this.manager.mode !== 'record'
            })),
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
                className: `is-explored${isNew ? ' is-new' : ''}${isParty ? ' is-party' : ''}${floor ? ` is-floor-${floor}` : ''}`,
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
            hatchCells: this._buildHatchCells(explored, originColumn, originRow),
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
    _buildHatchCells(explored, originColumn, originRow) {
        const cells = [];
        const seen = new Set(explored);
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

    _getMappedTileGeometry(explored, features) {
        const segmentsByCell = new Map();
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
                const existing = latticeEdges.get(edgeKey);
                if (!existing || priorities[feature] > priorities[existing.feature]) {
                    latticeEdges.set(edgeKey, { feature });
                }
            }
        }

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
        return { segmentsByCell, doorSymbolsByCell, secretDoorSymbolsByCell, windowSymbolsByCell };
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

        // The grid element is brand new on every render. Re-establish the view
        // before the browser paints, otherwise the map flashes at the origin.
        const grid = viewport.querySelector('.cartographer-mapping-grid');
        if (!grid) return;
        // CSS owns the cell size, so read it rather than duplicating the value.
        const cellSize = Number.parseFloat(
            getComputedStyle(grid).getPropertyValue('--cartographer-map-cell-size')
        );
        if (cellSize > 0) this._cellSize = cellSize;
        const tracked = this.manager.active ? this.manager.getTrackedPositionForCurrentMap() : null;
        if (tracked && this._followArmed) {
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

    _handlePanStart(event) {
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
        if (!this._pan || event.pointerId !== this._pan.pointerId) return;
        const viewport = event.currentTarget;
        viewport.releasePointerCapture?.(event.pointerId);
        viewport.classList.remove('is-panning');
        this._suppressContextMenu = this._pan.moved;
        this._pan = null;
        if (this._suppressContextMenu) {
            setTimeout(() => { this._suppressContextMenu = false; }, 100);
        }
    }

    _handleMapContextMenu(event) {
        event.preventDefault();
        if (this._suppressContextMenu || this.viewMode !== 'map') return;
        const cell = event.target.closest('.cartographer-mapping-cell.is-explored');
        if (!cell || !this.manager.canAnnotateRecord()) return;
        const [column, row] = String(cell.dataset.cell ?? '').split(',').map(Number);
        if (!Number.isInteger(column) || !Number.isInteger(row)) return;

        const contextMenu = game.modules.get('coffee-pub-blacksmith')?.api?.uiContextMenu;
        if (typeof contextMenu?.show !== 'function') return;
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
        this._showCellMenu(event, items);
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
        viewport.classList.toggle('is-following', this._followArmed && Boolean(this.manager.active));
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

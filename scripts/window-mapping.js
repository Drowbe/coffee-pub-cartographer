// ==================================================================
// ===== MAPPING TOOL WINDOW ========================================
// ==================================================================

import { MODULE } from './const.js';
import { getMappingSymbol, MAPPING_FLOOR_TYPES, MAPPING_SYMBOL_CATEGORIES } from './symbols-mapping.js';

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
/** Rings of hatching drawn outward from the explored edge. Must fit the margin. */
const HATCH_RINGS = MAP_MARGIN_CELLS;
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
        'toggle-recording': (_event, _target, app) => void app.manager.toggleRecording(),
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
        'center-view': (_event, _target, app) => app.centerView()
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
        this._handlePanStart = this._handlePanStart.bind(this);
        this._handlePanMove = this._handlePanMove.bind(this);
        this._handlePanEnd = this._handlePanEnd.bind(this);
        this._handleMapContextMenu = this._handleMapContextMenu.bind(this);
    }

    static async open(manager) {
        const existing = foundry.applications?.instances?.get(APP_ID);
        if (existing) {
            existing.manager = manager;
            existing.bringToFront?.();
            return existing;
        }
        const window = new MappingWindow(manager);
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
                : (this.manager.active ? 'mapping.statusActive' : 'mapping.statusViewing'));
        const footerLeft = this.viewMode === 'list'
            ? game.i18n.format(`${MODULE.ID}.mapping.mapCount`, { count: model.maps.length })
            : `${model.feetMapped} ${game.i18n.localize(`${MODULE.ID}.mapping.feetMapped`)}`;
        const statusClass = this.manager.paused
            ? ' is-paused'
            : (this.manager.active ? ' is-recording' : '');
        const status = `<span class="cartographer-mapping-status${statusClass}"><i class="fa-solid fa-circle"></i> ${foundry.utils.escapeHTML(game.i18n.localize(`${MODULE.ID}.${statusKey}`))}</span>`;
        return {
            appId: this.id,
            bodyContent,
            showToolBar: true,
            toolBarLeft: `${status}${this._buildTopActions(model)}`,
            toolBarRight: `<span class="cartographer-mapping-token">${foundry.utils.escapeHTML(this.manager.getTrackedTokenName())}</span>`,
            showToolFooter: true,
            toolFooterLeft: `<span>${foundry.utils.escapeHTML(footerLeft)}</span>`,
            toolFooterRight: this._buildFooterActions(model)
        };
    }

    _buildTopActions(model) {
        const buttons = [];
        if (this.viewMode === 'list') {
            buttons.push(this._chromeButton({
                action: 'toggle-list',
                icon: 'fa-solid fa-map',
                label: model.viewMapLabel
            }));
            if (model.canAdd) {
                buttons.push(this._chromeButton({
                    action: 'add-map',
                    icon: 'fa-solid fa-plus',
                    label: model.addMapLabel
                }));
            }
        } else {
            buttons.push(this._chromeButton({
                action: 'toggle-list',
                icon: 'fa-solid fa-list',
                label: model.listLabel
            }));
            buttons.push(this._chromeButton({
                action: 'toggle-recording',
                icon: this.manager.active ? 'fa-solid fa-stop' : 'fa-solid fa-circle',
                label: model.recordLabel,
                className: `cartographer-mapping-record${this.manager.paused ? ' is-paused' : (this.manager.active ? ' is-recording' : '')}`,
                disabled: !model.canRecord && !this.manager.active
            }));
        }
        return `<span class="cartographer-mapping-chrome-actions is-primary">${buttons.join('')}</span>`;
    }

    _buildFooterActions(model) {
        if (this.viewMode !== 'map') return '';
        const buttons = [
            this._chromeButton({ action: 'zoom-out', icon: 'fa-solid fa-minus', label: model.zoomOutLabel }),
            this._chromeButton({ action: 'center-view', icon: 'fa-solid fa-crosshairs', label: model.centerPartyLabel }),
            this._chromeButton({ action: 'zoom-in', icon: 'fa-solid fa-plus', label: model.zoomInLabel })
        ];
        return `<span class="cartographer-mapping-chrome-actions is-navigation">${buttons.join('')}</span><span class="cartographer-mapping-zoom-readout">${Math.round(this.zoom * 100)}%</span>`;
    }

    _chromeButton({ action, icon, label, className = '', disabled = false }) {
        const safeAction = foundry.utils.escapeHTML(action);
        const safeLabel = foundry.utils.escapeHTML(label ?? '');
        const classes = className ? ` class="${foundry.utils.escapeHTML(className)}"` : '';
        return `<button type="button"${classes} data-action="${safeAction}" data-tooltip="${safeLabel}" aria-label="${safeLabel}"${disabled ? ' disabled' : ''}><i class="${icon}"></i></button>`;
    }

    _buildModel() {
        const maps = this.manager.getMapList().map(record => ({
            id: record.id,
            name: record.name,
            actorName: record.actorName,
            sceneName: record.sceneName,
            updated: record.updatedAt ? new Date(record.updatedAt).toLocaleString() : '',
            feetMapped: record.explored.length * (record.gridDistance || 5),
            isCurrent: record.id === this.manager.currentMapId,
            canManage: this.manager.canManageRecord(record),
            canRecord: record.sceneId === canvas?.scene?.id && this.manager.canManageRecord(record)
        }));
        if (this.viewMode === 'list') {
            return {
                isListView: true,
                maps,
                canAdd: this.manager.canRecordCurrentMap(),
                listEmpty: maps.length === 0,
                listEmptyMessage: game.i18n.localize(`${MODULE.ID}.mapping.noMaps`),
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
            zoom: this.zoom,
            recordLabel: game.i18n.localize(`${MODULE.ID}.mapping.${this.manager.active ? 'stopRecording' : 'startRecording'}`),
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
                    label: game.i18n.localize(`${MODULE.ID}.${symbolDefinition.labelKey}`)
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
        const edges = new Map();
        for (const [key, codes] of Object.entries(features ?? {})) {
            if (!explored.has(key)) continue;
            const [column, row] = key.split(',').map(Number);
            for (const code of codes) {
                const [feature, direction] = code.split(':');
                const edgeKey = {
                    north: `h:${column}:${row}`,
                    south: `h:${column}:${row + 1}`,
                    west: `v:${column}:${row}`,
                    east: `v:${column + 1}:${row}`
                }[direction];
                if (!edgeKey || !priorities[feature]) continue;
                const existing = edges.get(edgeKey);
                if (!existing || priorities[feature] > priorities[existing.feature]) {
                    edges.set(edgeKey, { key, feature, direction });
                }
            }
        }

        for (const edge of edges.values()) {
            if (DOOR_GLYPH_FEATURES.includes(edge.feature)) {
                doorSymbolsByCell.set(edge.key, [
                    ...(doorSymbolsByCell.get(edge.key) ?? []),
                    this._doorSymbol(edge.direction, edge.feature)
                ]);
                continue;
            }
            if (edge.feature === 'secret-door') {
                secretDoorSymbolsByCell.set(edge.key, [
                    ...(secretDoorSymbolsByCell.get(edge.key) ?? []),
                    this._secretDoorSymbol(edge.direction)
                ]);
                continue;
            }
            if (edge.feature === 'window') {
                windowSymbolsByCell.set(edge.key, [
                    ...(windowSymbolsByCell.get(edge.key) ?? []),
                    this._windowSymbol(edge.direction)
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
     * A window: the wall opens and the gap is bridged by a shallow slot. Kept
     * deliberately thinner than the doorway box so the two read apart at a
     * glance, and drawn in ink like everything else -- the map is pen and ink,
     * so a colour was the one thing on it that could not have been drawn.
     */
    _windowSymbol(direction) {
        const transforms = {
            north: 'translate(0 0)',
            south: 'translate(100 100) rotate(180)',
            west: 'translate(0 100) rotate(-90)',
            east: 'translate(100 0) rotate(90)'
        };
        return {
            transform: transforms[direction] ?? transforms.north,
            lines: [
                { points: '0,0 30,0', echoPoints: '0,-1.1 30,0.8' },
                { points: '70,0 100,0', echoPoints: '70,-0.9 100,1' }
            ],
            slotPoints: '30,-5 70,-4 70,5 30,4 30,-5',
            echoSlotPoints: '31,-4 69,-5.5 70.5,4 30,5 31,-4'
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
    _doorMark(direction, feature) {
        if (feature !== 'locked-door') return null;
        const transforms = {
            north: 'translate(0 0)',
            south: 'translate(100 100) rotate(180)',
            west: 'translate(0 100) rotate(-90)',
            east: 'translate(100 0) rotate(90)'
        };
        return {
            transform: transforms[direction] ?? transforms.north,
            // A bar across the doorway, per the official locked-door glyph.
            lines: [{ points: '50,-9 50,11', echoPoints: '49.2,-9 50.8,11' }]
        };
    }

    _doorSymbol(direction, feature = 'door') {
        const symbols = {
            north: {
                lines: [
                    { points: '0,0 38,0', echoPoints: '0,-1.2 38,0.8' },
                    { points: '62,0 100,0', echoPoints: '62,-0.9 100,1' }
                ],
                boxPoints: '38,-12 62,-10.5 61,14 39,13 38,-12',
                echoBoxPoints: '39,-11 61,-11.5 62,13 38,14 39,-11'
            },
            south: {
                lines: [
                    { points: '0,100 38,100', echoPoints: '0,98.8 38,100.8' },
                    { points: '62,100 100,100', echoPoints: '62,99.1 100,101' }
                ],
                boxPoints: '38,88 62,89.5 61,114 39,113 38,88',
                echoBoxPoints: '39,89 61,88.5 62,113 38,114 39,89'
            },
            west: {
                lines: [
                    { points: '0,0 0,38', echoPoints: '-1.2,0 0.8,38' },
                    { points: '0,62 0,100', echoPoints: '-0.9,62 1,100' }
                ],
                boxPoints: '-12,38 -10.5,62 14,61 13,39 -12,38',
                echoBoxPoints: '-11,39 -11.5,61 13,62 14,38 -11,39'
            },
            east: {
                lines: [
                    { points: '100,0 100,38', echoPoints: '98.8,0 100.8,38' },
                    { points: '100,62 100,100', echoPoints: '99.1,62 101,100' }
                ],
                boxPoints: '88,38 89.5,62 114,61 113,39 88,38',
                echoBoxPoints: '89,39 88.5,61 113,62 114,38 89,39'
            }
        };
        const symbol = symbols[direction];
        return symbol ? { ...symbol, mark: this._doorMark(direction, feature) } : symbol;
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
        if (!cell || !this.manager.canManageRecord()) return;
        const [column, row] = String(cell.dataset.cell ?? '').split(',').map(Number);
        if (!Number.isInteger(column) || !Number.isInteger(row)) return;

        const contextMenu = game.modules.get('coffee-pub-blacksmith')?.api?.uiContextMenu;
        if (typeof contextMenu?.show !== 'function') return;
        const localize = key => game.i18n.localize(`${MODULE.ID}.${key}`);
        const place = type => () => this.manager.placeMapSymbol(type, column, row);
        const items = MAPPING_SYMBOL_CATEGORIES.map(category => ({
            name: localize(category.labelKey),
            icon: category.icon,
            submenu: category.types.map(type => {
                const definition = getMappingSymbol(type);
                return {
                    name: localize(definition.labelKey),
                    callback: place(type)
                };
            })
        }));
        // Floor surfaces apply to the whole room, so they sit apart from the
        // per-square symbols above.
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
        if (this.manager.hasMapSymbol(column, row)) {
            items.push({ separator: true });
            items.push({
                name: localize('mapping.removeSymbol'),
                icon: 'fa-solid fa-trash-can',
                callback: () => this.manager.removeMapSymbol(column, row)
            });
        }
        const root = this.element?.ownerDocument?.body ?? document.body;
        contextMenu.show({
            id: `${MODULE.ID}-mapping-cell-context`,
            x: event.clientX,
            y: event.clientY,
            root,
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

    _onClose(options) {
        this._pan = null;
        this._targetZoom = null;
        this._stopCameraAnimation();
        void this.manager?.onWindowClosed(this);
        return super._onClose?.(options);
    }
}

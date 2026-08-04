// ==================================================================
// ===== MAPPING TOOL WINDOW ========================================
// ==================================================================

import { MODULE } from './const.js';

const ToolWindowBase = game.modules.get('coffee-pub-blacksmith')?.api?.BlacksmithToolWindowBaseV2 ?? class {
    static DEFAULT_OPTIONS = {};
    constructor() { throw new Error('Coffee Pub Blacksmith Tool Window API is unavailable'); }
};
const APP_ID = `${MODULE.ID}-mapper`;

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
        'zoom-in': (_event, _target, app) => app.setZoom(app.zoom + 0.15),
        'zoom-out': (_event, _target, app) => app.setZoom(app.zoom - 0.15),
        'center-view': (_event, _target, app) => app.centerView(),
        'reset-map': (_event, _target, app) => void app.manager.resetMap()
    };

    constructor(manager, options = {}) {
        super(options);
        this.manager = manager;
        this.zoom = 1;
        this.viewMode = 'map';
        this._hasBuiltMap = false;
        this._renderedExplored = new Set();
        this._mapScroll = { left: 0, top: 0, gridMargin: '' };
        this._listScrollTop = 0;
        this._pan = null;
        this._handlePanStart = this._handlePanStart.bind(this);
        this._handlePanMove = this._handlePanMove.bind(this);
        this._handlePanEnd = this._handlePanEnd.bind(this);
        this._handleWheelZoom = this._handleWheelZoom.bind(this);
        this._preventPanMenu = event => event.preventDefault();
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
            : (this.manager.active ? 'mapping.statusActive' : 'mapping.statusViewing');
        const footerLeft = this.viewMode === 'list'
            ? game.i18n.format(`${MODULE.ID}.mapping.mapCount`, { count: model.maps.length })
            : `${model.feetMapped} ${game.i18n.localize(`${MODULE.ID}.mapping.feetMapped`)}`;
        const status = `<span class="cartographer-mapping-status${this.manager.active ? ' is-recording' : ''}"><i class="fa-solid fa-circle"></i> ${foundry.utils.escapeHTML(game.i18n.localize(`${MODULE.ID}.${statusKey}`))}</span>`;
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
                className: `cartographer-mapping-record${this.manager.active ? ' is-recording' : ''}`,
                disabled: !model.canRecord && !this.manager.active
            }));
            if (model.canReset) {
                buttons.push(this._chromeButton({
                    action: 'reset-map',
                    icon: 'fa-solid fa-trash-can',
                    label: model.resetLabel,
                    className: 'is-critical'
                }));
            }
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
        const animateNewTiles = this._hasBuiltMap;
        const newTiles = animateNewTiles
            ? new Set([...explored].filter(key => !this._renderedExplored.has(key)))
            : new Set();
        const trackedPosition = this.manager.getTrackedPositionForCurrentMap();
        const mappedGeometry = this._getMappedTileGeometry(explored, this.manager.state.features);
        const canRecord = this.manager.canRecordCurrentMap();
        const common = {
            canReset: this.manager.canManageRecord() && Boolean(this.manager.currentMapId),
            canRecord,
            isRecording: this.manager.active,
            zoom: this.zoom,
            recordLabel: game.i18n.localize(`${MODULE.ID}.mapping.${this.manager.active ? 'stopRecording' : 'startRecording'}`),
            listLabel: game.i18n.localize(`${MODULE.ID}.mapping.showMaps`),
            resetLabel: game.i18n.localize(`${MODULE.ID}.mapping.resetMap`),
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

        const coordinates = [...explored].map(key => key.split(',').map(Number));
        const maxExploredColumn = Math.max(...coordinates.map(([column]) => column));
        const maxExploredRow = Math.max(...coordinates.map(([, row]) => row));
        const columnCount = Math.max(this.manager.state.columns || 0, maxExploredColumn + 1);
        const rowCount = Math.max(this.manager.state.rows || 0, maxExploredRow + 1);
        const cells = coordinates.map(([column, row]) => {
            const key = `${column},${row}`;
            const isParty = trackedPosition?.column === column && trackedPosition?.row === row;
            const isNew = newTiles.has(key);
            return {
                key,
                gridColumn: column + 1,
                gridRow: row + 1,
                className: `is-explored${isNew ? ' is-new' : ''}${isParty ? ' is-party' : ''}`,
                segments: mappedGeometry.segmentsByCell.get(key) ?? [],
                doorSymbols: mappedGeometry.doorSymbolsByCell.get(key) ?? [],
                hasLinework: mappedGeometry.segmentsByCell.has(key) || mappedGeometry.doorSymbolsByCell.has(key),
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
            feetMapped: explored.size * (this.manager.state.gridDistance || 5)
        };
    }

    _getMappedTileGeometry(explored, features) {
        const segmentsByCell = new Map();
        const doorSymbolsByCell = new Map();
        const priorities = { wall: 1, window: 2 };
        const doorDirections = new Map();
        const consumedDoorLegs = new Set();

        for (const [key, codes] of Object.entries(features ?? {})) {
            if (!explored.has(key)) continue;
            const directions = new Set(codes
                .filter(code => code.startsWith('door:'))
                .map(code => code.split(':')[1]));
            if (directions.size) doorDirections.set(key, directions);
        }

        const neighborFor = (key, direction) => {
            const [column, row] = key.split(',').map(Number);
            const offsets = { east: [1, 0], south: [0, 1] }[direction];
            return offsets ? `${column + offsets[0]},${row + offsets[1]}` : null;
        };
        const opposite = { east: 'west', south: 'north' };

        // A normal Foundry door is represented by two matching half-legs in
        // neighboring map cells. Replace the pair with one guide-style symbol
        // centered on their shared edge.
        for (const [key, directions] of doorDirections) {
            for (const direction of ['east', 'south']) {
                if (!directions.has(direction)) continue;
                const neighborKey = neighborFor(key, direction);
                if (!neighborKey || !doorDirections.get(neighborKey)?.has(opposite[direction])) continue;
                doorSymbolsByCell.set(key, [
                    ...(doorSymbolsByCell.get(key) ?? []),
                    this._doorSymbol(direction === 'east' ? 'horizontal-edge' : 'vertical-edge')
                ]);
                consumedDoorLegs.add(`${key}:door:${direction}`);
                consumedDoorLegs.add(`${neighborKey}:door:${opposite[direction]}`);
            }
        }

        // Very short doors can resolve wholly inside one abstract cell.
        for (const [key, directions] of doorDirections) {
            if (directions.has('east') && directions.has('west')
                && !consumedDoorLegs.has(`${key}:door:east`)
                && !consumedDoorLegs.has(`${key}:door:west`)) {
                doorSymbolsByCell.set(key, [
                    ...(doorSymbolsByCell.get(key) ?? []),
                    this._doorSymbol('horizontal-center')
                ]);
                consumedDoorLegs.add(`${key}:door:east`);
                consumedDoorLegs.add(`${key}:door:west`);
            }
            if (directions.has('north') && directions.has('south')
                && !consumedDoorLegs.has(`${key}:door:north`)
                && !consumedDoorLegs.has(`${key}:door:south`)) {
                doorSymbolsByCell.set(key, [
                    ...(doorSymbolsByCell.get(key) ?? []),
                    this._doorSymbol('vertical-center')
                ]);
                consumedDoorLegs.add(`${key}:door:north`);
                consumedDoorLegs.add(`${key}:door:south`);
            }
        }

        for (const [key, codes] of Object.entries(features ?? {})) {
            if (!explored.has(key)) continue;
            const cellSegments = new Map();
            for (const code of codes) {
                const [feature, direction] = code.split(':');
                if (feature === 'door' && consumedDoorLegs.has(`${key}:${code}`)) continue;
                const renderedFeature = feature === 'door' ? 'wall' : feature;
                const segment = this._tileSegment(renderedFeature, direction, priorities[renderedFeature]);
                if (segment) cellSegments.set(`${renderedFeature}:${direction}`, segment);
            }
            const segments = [...cellSegments.values()].sort((left, right) => left.priority - right.priority);
            if (segments.length) segmentsByCell.set(key, segments);
        }
        return { segmentsByCell, doorSymbolsByCell };
    }

    _doorSymbol(type) {
        const symbols = {
            'horizontal-edge': {
                lines: [
                    { points: '50,50 88,50', echoPoints: '50,48.8 88,50.8' },
                    { points: '112,50 150,50', echoPoints: '112,49.1 150,51' }
                ],
                boxPoints: '88,36 112,37.5 111,64 89,63 88,36',
                echoBoxPoints: '89,37 111,36.5 112,63 88,64 89,37'
            },
            'vertical-edge': {
                lines: [
                    { points: '50,50 50,88', echoPoints: '48.8,50 50.8,88' },
                    { points: '50,112 50,150', echoPoints: '49.1,112 51,150' }
                ],
                boxPoints: '36,88 63,89 64,111 37.5,112 36,88',
                echoBoxPoints: '37,89 64,88 63,112 36.5,111 37,89'
            },
            'horizontal-center': {
                lines: [
                    { points: '0,50 38,50', echoPoints: '0,48.8 38,50.8' },
                    { points: '62,50 100,50', echoPoints: '62,49.1 100,51' }
                ],
                boxPoints: '38,36 62,37.5 61,64 39,63 38,36',
                echoBoxPoints: '39,37 61,36.5 62,63 38,64 39,37'
            },
            'vertical-center': {
                lines: [
                    { points: '50,0 50,38', echoPoints: '48.8,0 50.8,38' },
                    { points: '50,62 50,100', echoPoints: '49.1,62 51,100' }
                ],
                boxPoints: '36,38 63,39 64,61 37.5,62 36,38',
                echoBoxPoints: '37,39 64,38 63,62 36.5,61 37,39'
            }
        };
        return symbols[type];
    }

    _tileSegment(feature, direction, priority) {
        const endpoints = {
            north: { x1: 50, y1: 50, x2: 50, y2: 0 },
            east: { x1: 50, y1: 50, x2: 100, y2: 50 },
            south: { x1: 50, y1: 50, x2: 50, y2: 100 },
            west: { x1: 50, y1: 50, x2: 0, y2: 50 }
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
        this._renderedExplored = new Set();
        this._mapScroll = { left: 0, top: 0, gridMargin: '' };
        const hasParty = Boolean(this.manager.getTrackedPositionForCurrentMap());
        await this.manager.renderWindow({ centerOnParty: hasParty });
        if (!hasParty) {
            await new Promise(resolve => requestAnimationFrame(resolve));
            this.centerOnMap();
        }
    }

    setZoom(value, { anchor = null } = {}) {
        const zoom = Math.max(0.4, Math.min(2.5, Number(value) || 1));
        this._targetZoom = zoom;
        this._zoomQueue = (this._zoomQueue ?? Promise.resolve())
            .catch(error => console.error(`${MODULE.NAME}: Failed to zoom mapping window`, error))
            .then(async () => {
                this.zoom = zoom;
                await this.manager.renderWindow({
                    centerOnParty: !anchor && Boolean(this.manager.getTrackedPositionForCurrentMap())
                });
                if (!anchor) return;
                this._ensureScrollMargin();
                await new Promise(resolve => requestAnimationFrame(resolve));
                this._restoreZoomAnchor(anchor);
            });
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
        viewport.addEventListener('wheel', this._handleWheelZoom, { passive: false });
        viewport.addEventListener('contextmenu', this._preventPanMenu);
    }

    _handlePanStart(event) {
        if (event.button !== 2) return;
        const viewport = event.currentTarget;
        event.preventDefault();
        viewport.setPointerCapture?.(event.pointerId);
        viewport.classList.add('is-panning');
        this._pan = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: viewport.scrollLeft,
            top: viewport.scrollTop
        };
    }

    _handlePanMove(event) {
        if (!this._pan || event.pointerId !== this._pan.pointerId) return;
        event.preventDefault();
        const viewport = event.currentTarget;
        viewport.scrollLeft = this._pan.left - (event.clientX - this._pan.x);
        viewport.scrollTop = this._pan.top - (event.clientY - this._pan.y);
    }

    _handlePanEnd(event) {
        if (!this._pan || event.pointerId !== this._pan.pointerId) return;
        const viewport = event.currentTarget;
        viewport.releasePointerCapture?.(event.pointerId);
        viewport.classList.remove('is-panning');
        this._pan = null;
    }

    _handleWheelZoom(event) {
        event.preventDefault();
        const direction = event.deltaY < 0 ? 1 : -1;
        this._pendingWheelZoom = Math.max(0.4, Math.min(2.5,
            (this._pendingWheelZoom ?? this._targetZoom ?? this.zoom) + (direction * 0.1)
        ));
        this._pendingWheelAnchor = this._captureZoomAnchor(event);
        if (this._wheelZoomTimer) clearTimeout(this._wheelZoomTimer);
        this._wheelZoomTimer = setTimeout(() => {
            const zoom = this._pendingWheelZoom;
            const anchor = this._pendingWheelAnchor;
            this._pendingWheelZoom = null;
            this._pendingWheelAnchor = null;
            this._wheelZoomTimer = null;
            void this.setZoom(zoom, { anchor });
        }, 45);
    }

    _captureZoomAnchor(event) {
        const grid = this.element?.querySelector('.cartographer-mapping-grid');
        if (!grid) return null;
        const gridRect = grid.getBoundingClientRect();
        const renderedZoom = Number.parseFloat(grid.style.getPropertyValue('--cartographer-map-zoom')) || this.zoom;
        return {
            clientX: event.clientX,
            clientY: event.clientY,
            mapX: (event.clientX - gridRect.left) / renderedZoom,
            mapY: (event.clientY - gridRect.top) / renderedZoom
        };
    }

    _restoreZoomAnchor(anchor) {
        const viewport = this.element?.querySelector('.cartographer-mapping-viewport');
        const grid = this.element?.querySelector('.cartographer-mapping-grid');
        if (!viewport || !grid || !anchor) return;
        const gridRect = grid.getBoundingClientRect();
        viewport.scrollLeft += gridRect.left + (anchor.mapX * this.zoom) - anchor.clientX;
        viewport.scrollTop += gridRect.top + (anchor.mapY * this.zoom) - anchor.clientY;
    }

    _ensureScrollMargin() {
        const viewport = this.element?.querySelector('.cartographer-mapping-viewport');
        const grid = this.element?.querySelector('.cartographer-mapping-grid');
        if (!viewport || !grid) return null;
        grid.style.margin = `${viewport.clientHeight / 2}px ${viewport.clientWidth / 2}px`;
        return { viewport, grid };
    }

    centerOnParty({ behavior = 'auto' } = {}) {
        const elements = this._ensureScrollMargin();
        const partyCell = this.element?.querySelector('.cartographer-mapping-cell.is-party');
        if (!elements || !partyCell) return;
        const { viewport } = elements;
        const viewportRect = viewport.getBoundingClientRect();
        const partyRect = partyCell.getBoundingClientRect();
        viewport.scrollTo({
            left: viewport.scrollLeft + partyRect.left - viewportRect.left
                + (partyRect.width / 2) - (viewport.clientWidth / 2),
            top: viewport.scrollTop + partyRect.top - viewportRect.top
                + (partyRect.height / 2) - (viewport.clientHeight / 2),
            behavior
        });
    }

    centerView() {
        if (this.manager.getTrackedPositionForCurrentMap()) this.centerOnParty();
        else this.centerOnMap();
    }

    centerOnMap({ behavior = 'auto' } = {}) {
        const elements = this._ensureScrollMargin();
        const cells = [...(this.element?.querySelectorAll('.cartographer-mapping-cell.is-explored') ?? [])];
        if (!elements || !cells.length) return;
        const { viewport } = elements;
        const viewportRect = viewport.getBoundingClientRect();
        const bounds = cells.reduce((result, cell) => {
            const rect = cell.getBoundingClientRect();
            result.left = Math.min(result.left, rect.left);
            result.top = Math.min(result.top, rect.top);
            result.right = Math.max(result.right, rect.right);
            result.bottom = Math.max(result.bottom, rect.bottom);
            return result;
        }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
        viewport.scrollTo({
            left: viewport.scrollLeft + ((bounds.left + bounds.right) / 2)
                - viewportRect.left - (viewport.clientWidth / 2),
            top: viewport.scrollTop + ((bounds.top + bounds.bottom) / 2)
                - viewportRect.top - (viewport.clientHeight / 2),
            behavior
        });
    }

    followParty(position) {
        if (!this.rendered || !position || this.viewMode !== 'map') return;
        const key = `${position.column},${position.row}`;
        const selector = `.cartographer-mapping-cell[data-cell="${CSS.escape(key)}"]`;
        const partyCell = this.element?.querySelector(selector);
        if (!partyCell) return;
        const previousCell = this.element?.querySelector('.cartographer-mapping-cell.is-party');
        if (previousCell !== partyCell) {
            previousCell?.classList.remove('is-party');
            previousCell?.querySelector('.cartographer-mapping-party')?.remove();
            partyCell.classList.add('is-party');
            const marker = document.createElement('i');
            marker.className = 'fa-solid fa-street-view cartographer-mapping-party';
            marker.setAttribute('aria-hidden', 'true');
            partyCell.append(marker);
        }
        if (this._followFrame) cancelAnimationFrame(this._followFrame);
        this._followFrame = requestAnimationFrame(() => {
            this._followFrame = null;
            this.centerOnParty({ behavior: 'smooth' });
        });
    }

    _saveScrollPositions() {
        const viewport = this.element?.querySelector('.cartographer-mapping-viewport');
        const grid = this.element?.querySelector('.cartographer-mapping-grid');
        const list = this.element?.querySelector('.cartographer-mapping-list');
        if (viewport) {
            this._mapScroll = {
                left: viewport.scrollLeft,
                top: viewport.scrollTop,
                gridMargin: grid?.style.margin ?? ''
            };
        }
        if (list) this._listScrollTop = list.scrollTop;
        return {
            ...this._mapScroll,
            listTop: this._listScrollTop
        };
    }

    _restoreScrollPositions(saved) {
        const viewport = this.element?.querySelector('.cartographer-mapping-viewport');
        if (!saved) return;
        const grid = this.element?.querySelector('.cartographer-mapping-grid');
        if (grid) grid.style.margin = saved.gridMargin ?? '';
        if (viewport) {
            viewport.scrollLeft = saved.left ?? 0;
            viewport.scrollTop = saved.top ?? 0;
        }
        const list = this.element?.querySelector('.cartographer-mapping-list');
        if (list) list.scrollTop = saved.listTop ?? 0;
    }

    _onClose(options) {
        this._pan = null;
        if (this._wheelZoomTimer) clearTimeout(this._wheelZoomTimer);
        this._wheelZoomTimer = null;
        this._pendingWheelZoom = null;
        this._pendingWheelAnchor = null;
        this._targetZoom = null;
        if (this._followFrame) cancelAnimationFrame(this._followFrame);
        this._followFrame = null;
        void this.manager?.onWindowClosed(this);
        return super._onClose?.(options);
    }
}

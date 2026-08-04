// ==================================================================
// ===== MAPPING TOOL WINDOW ========================================
// ==================================================================

import { MODULE } from './const.js';

const ToolWindowBase = game.modules.get('coffee-pub-blacksmith')?.api?.BlacksmithToolWindowBaseV2 ?? class {
    static DEFAULT_OPTIONS = {};
    constructor() {
        throw new Error('Coffee Pub Blacksmith Tool Window API is unavailable');
    }
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
        'zoom-in': (_event, _target, app) => app.setZoom(app.zoom + 0.15),
        'zoom-out': (_event, _target, app) => app.setZoom(app.zoom - 0.15),
        'center-party': (_event, _target, app) => app.centerOnParty(),
        'reset-map': (_event, _target, app) => void app.manager.resetMap()
    };

    constructor(manager, options = {}) {
        super(options);
        this.manager = manager;
        this.zoom = 1;
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
        const model = this._buildMapModel();
        const bodyContent = await foundry.applications.handlebars.renderTemplate(
            `modules/${MODULE.ID}/templates/window-mapping.hbs`,
            model
        );
        const statusKey = this.manager.active ? 'mapping.statusActive' : 'mapping.statusViewing';
        return {
            appId: this.id,
            bodyContent,
            showToolBar: true,
            toolBarLeft: `<span class="cartographer-mapping-status"><i class="fa-solid fa-circle"></i> ${foundry.utils.escapeHTML(game.i18n.localize(`${MODULE.ID}.${statusKey}`))}</span>`,
            toolBarRight: `<span class="cartographer-mapping-token">${foundry.utils.escapeHTML(this.manager.getTrackedTokenName())}</span>`,
            showToolFooter: true,
            toolFooterLeft: `<span>${model.exploredCount} ${foundry.utils.escapeHTML(game.i18n.localize(`${MODULE.ID}.mapping.cellsMapped`))}</span>`,
            toolFooterRight: `<span>${Math.round(this.zoom * 100)}%</span>`
        };
    }

    _buildMapModel() {
        const explored = new Set(this.manager.state.explored);
        const tracked = this.manager._getTrackedToken();
        const trackedPosition = tracked ? this.manager._gridPosition(tracked.document) : null;
        const mappedSegments = this._getMappedTileSegments(explored);
        const common = {
            canReset: game.user.isGM,
            isRecording: this.manager.active,
            zoom: this.zoom,
            recordLabel: game.i18n.localize(
                `${MODULE.ID}.mapping.${this.manager.active ? 'stopRecording' : 'startRecording'}`
            ),
            resetLabel: game.i18n.localize(`${MODULE.ID}.mapping.resetMap`),
            zoomInLabel: game.i18n.localize(`${MODULE.ID}.mapping.zoomIn`),
            zoomOutLabel: game.i18n.localize(`${MODULE.ID}.mapping.zoomOut`),
            centerPartyLabel: game.i18n.localize(`${MODULE.ID}.mapping.centerParty`)
        };
        if (!explored.size) {
            return {
                ...common,
                empty: true,
                emptyMessage: game.i18n.localize(`${MODULE.ID}.mapping.emptyMap`),
                exploredCount: 0
            };
        }

        const coordinates = [...explored].map(key => key.split(',').map(Number));
        const maxExploredColumn = Math.max(...coordinates.map(([column]) => column));
        const maxExploredRow = Math.max(...coordinates.map(([, row]) => row));
        const sizeX = canvas.grid.sizeX ?? canvas.grid.size;
        const sizeY = canvas.grid.sizeY ?? canvas.grid.size;
        const columnCount = Math.max(Math.ceil(canvas.dimensions.width / sizeX), maxExploredColumn + 1);
        const rowCount = Math.max(Math.ceil(canvas.dimensions.height / sizeY), maxExploredRow + 1);
        const cells = coordinates.map(([column, row]) => {
            const isParty = trackedPosition?.column === column && trackedPosition?.row === row;
            const segments = mappedSegments.get(`${column},${row}`) ?? [];
            return {
                key: `${column},${row}`,
                gridColumn: column + 1,
                gridRow: row + 1,
                className: `is-explored${isParty ? ' is-party' : ''}`,
                segments,
                isParty
            };
        });

        return {
            ...common,
            empty: false,
            cells,
            columnCount,
            rowCount,
            exploredCount: explored.size
        };
    }

    _getMappedTileSegments(explored) {
        const legsByCell = new Map();
        const sizeX = canvas.grid.sizeX ?? canvas.grid.size;
        const sizeY = canvas.grid.sizeY ?? canvas.grid.size;
        const priorities = { wall: 1, window: 2, door: 3 };

        for (const wall of canvas.walls?.placeables ?? []) {
            const feature = this._classifyWall(wall.document);
            if (!feature) continue;
            const coordinates = wall.document?.c ?? wall.document?._source?.c;
            if (!Array.isArray(coordinates) || coordinates.length < 4) continue;
            const [x1, y1, x2, y2] = coordinates.map(Number);
            if (![x1, y1, x2, y2].every(Number.isFinite)) continue;

            const startOffset = canvas.grid.getOffset({ x: x1, y: y1 });
            const endOffset = canvas.grid.getOffset({ x: x2, y: y2 });
            const start = {
                column: Number(startOffset.j ?? startOffset.x),
                row: Number(startOffset.i ?? startOffset.y)
            };
            const end = {
                column: Number(endOffset.j ?? endOffset.x),
                row: Number(endOffset.i ?? endOffset.y)
            };
            if (![start.column, start.row, end.column, end.row].every(Number.isInteger)) continue;

            const path = this._orthogonalPath(start, end);
            if (path.length === 1) {
                const horizontal = Math.abs(x2 - x1) >= Math.abs(y2 - y1);
                const directions = horizontal ? ['west', 'east'] : ['north', 'south'];
                for (const direction of directions) {
                    this._addTileLeg(legsByCell, explored, path[0], direction, feature, priorities[feature]);
                }
                continue;
            }

            for (let index = 1; index < path.length; index++) {
                const previous = path[index - 1];
                const current = path[index];
                const direction = this._directionBetween(previous, current);
                if (!direction) continue;
                this._addTileLeg(legsByCell, explored, previous, direction, feature, priorities[feature]);
                this._addTileLeg(
                    legsByCell,
                    explored,
                    current,
                    this._oppositeDirection(direction),
                    feature,
                    priorities[feature]
                );
            }
        }

        const segmentsByCell = new Map();
        for (const [key, legs] of legsByCell) {
            const segments = [...legs.values()];
            segments.sort((a, b) => a.priority - b.priority);
            segmentsByCell.set(key, segments);
        }
        return segmentsByCell;
    }

    _addTileLeg(legsByCell, explored, cell, direction, feature, priority) {
        const key = `${cell.column},${cell.row}`;
        if (!explored.has(key)) return;
        const cellLegs = legsByCell.get(key) ?? new Map();
        const legKey = `${feature}:${direction}`;
        if (!cellLegs.has(legKey)) {
            const endpoints = {
                north: { x1: 50, y1: 50, x2: 50, y2: 0 },
                east: { x1: 50, y1: 50, x2: 100, y2: 50 },
                south: { x1: 50, y1: 50, x2: 50, y2: 100 },
                west: { x1: 50, y1: 50, x2: 0, y2: 50 }
            }[direction];
            if (!endpoints) return;
            const horizontal = endpoints.y1 === endpoints.y2;
            const bend = {
                north: -1.8,
                east: 1.4,
                south: 1.8,
                west: -1.4
            }[direction];
            const midpoint = {
                x: (endpoints.x1 + endpoints.x2) / 2,
                y: (endpoints.y1 + endpoints.y2) / 2
            };
            const mainMidpoint = {
                x: midpoint.x + (horizontal ? 0 : bend),
                y: midpoint.y + (horizontal ? bend : 0)
            };
            const echoMidpoint = {
                x: midpoint.x - (horizontal ? 0 : bend * 0.7),
                y: midpoint.y - (horizontal ? bend * 0.7 : 0)
            };
            cellLegs.set(legKey, {
                className: `is-${feature}`,
                priority,
                points: `${endpoints.x1},${endpoints.y1} ${mainMidpoint.x},${mainMidpoint.y} ${endpoints.x2},${endpoints.y2}`,
                echoPoints: `${endpoints.x1},${endpoints.y1} ${echoMidpoint.x},${echoMidpoint.y} ${endpoints.x2},${endpoints.y2}`
            });
            legsByCell.set(key, cellLegs);
        }
    }

    _orthogonalPath(start, end) {
        const path = [{ ...start }];
        let current = { ...start };
        const lineDx = end.column - start.column;
        const lineDy = end.row - start.row;
        let preferHorizontal = Math.abs(lineDx) >= Math.abs(lineDy);

        while (current.column !== end.column || current.row !== end.row) {
            const candidates = [];
            if (current.column !== end.column) {
                candidates.push({
                    column: current.column + Math.sign(end.column - current.column),
                    row: current.row,
                    horizontal: true
                });
            }
            if (current.row !== end.row) {
                candidates.push({
                    column: current.column,
                    row: current.row + Math.sign(end.row - current.row),
                    horizontal: false
                });
            }

            if (candidates.length === 1) current = candidates[0];
            else {
                const scored = candidates.map(candidate => ({
                    candidate,
                    score: Math.abs(
                        (lineDy * (candidate.column - start.column))
                        - (lineDx * (candidate.row - start.row))
                    )
                }));
                scored.sort((a, b) => {
                    if (a.score !== b.score) return a.score - b.score;
                    return a.candidate.horizontal === preferHorizontal ? -1 : 1;
                });
                current = scored[0].candidate;
                preferHorizontal = !preferHorizontal;
            }
            path.push({ column: current.column, row: current.row });
        }
        return path;
    }

    _directionBetween(from, to) {
        if (to.column === from.column + 1 && to.row === from.row) return 'east';
        if (to.column === from.column - 1 && to.row === from.row) return 'west';
        if (to.row === from.row + 1 && to.column === from.column) return 'south';
        if (to.row === from.row - 1 && to.column === from.column) return 'north';
        return null;
    }

    _oppositeDirection(direction) {
        return {
            north: 'south',
            east: 'west',
            south: 'north',
            west: 'east'
        }[direction] ?? null;
    }

    _classifyWall(document) {
        const source = document?._source ?? document;
        if (!source) return null;

        const doorTypes = CONST.WALL_DOOR_TYPES ?? {};
        const senseTypes = CONST.WALL_SENSE_TYPES ?? {};
        const movementTypes = CONST.WALL_MOVEMENT_TYPES ?? {};
        const door = Number(source.door ?? doorTypes.NONE ?? 0);
        const move = Number(source.move);
        const sight = Number(source.sight);
        const light = Number(source.light);

        if (door === doorTypes.DOOR) return 'door';
        if (door === doorTypes.SECRET) return 'wall';

        const isTerrain = sight === senseTypes.LIMITED
            && light === senseTypes.LIMITED;
        if (isTerrain) return null;

        const isWindow = move === movementTypes.NORMAL
            && sight === senseTypes.PROXIMITY
            && light === senseTypes.PROXIMITY;
        if (isWindow) return 'window';

        const isPhysicalWall = move === movementTypes.NORMAL
            && (sight === senseTypes.NORMAL || light === senseTypes.NORMAL);
        return isPhysicalWall ? 'wall' : null;
    }

    async setZoom(value) {
        this.zoom = Math.max(0.4, Math.min(2.5, Number(value) || 1));
        await this.manager.renderWindow({ centerOnParty: Boolean(this.manager._getTrackedToken()) });
        return this;
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
        this._pendingWheelZoom = Math.max(
            0.4,
            Math.min(2.5, (this._pendingWheelZoom ?? this.zoom) + (direction * 0.1))
        );
        if (this._wheelZoomTimer) clearTimeout(this._wheelZoomTimer);
        this._wheelZoomTimer = setTimeout(() => {
            const zoom = this._pendingWheelZoom;
            this._pendingWheelZoom = null;
            this._wheelZoomTimer = null;
            void this.setZoom(zoom);
        }, 45);
    }

    centerOnParty() {
        const viewport = this.element?.querySelector('.cartographer-mapping-viewport');
        const grid = this.element?.querySelector('.cartographer-mapping-grid');
        const partyCell = this.element?.querySelector('.cartographer-mapping-cell.is-party');
        if (!viewport || !grid || !partyCell) return;

        // The extra margin is scrollable breathing room. Without it a cell near
        // a scene edge cannot physically reach the middle of the viewport.
        grid.style.margin = `${viewport.clientHeight / 2}px ${viewport.clientWidth / 2}px`;
        const viewportRect = viewport.getBoundingClientRect();
        const partyRect = partyCell.getBoundingClientRect();
        viewport.scrollTo({
            left: viewport.scrollLeft
                + partyRect.left - viewportRect.left
                + (partyRect.width / 2) - (viewport.clientWidth / 2),
            top: viewport.scrollTop
                + partyRect.top - viewportRect.top
                + (partyRect.height / 2) - (viewport.clientHeight / 2),
            behavior: 'auto'
        });
    }

    followParty(position) {
        if (!this.rendered || !position) return;
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
            this.centerOnParty();
        });
    }

    _saveScrollPositions() {
        const viewport = this.element?.querySelector('.cartographer-mapping-viewport');
        return {
            left: viewport?.scrollLeft ?? 0,
            top: viewport?.scrollTop ?? 0
        };
    }

    _restoreScrollPositions(saved) {
        const viewport = this.element?.querySelector('.cartographer-mapping-viewport');
        if (!viewport || !saved) return;
        viewport.scrollLeft = saved.left ?? 0;
        viewport.scrollTop = saved.top ?? 0;
    }

    _onClose(options) {
        this._pan = null;
        if (this._wheelZoomTimer) clearTimeout(this._wheelZoomTimer);
        this._wheelZoomTimer = null;
        this._pendingWheelZoom = null;
        if (this._followFrame) cancelAnimationFrame(this._followFrame);
        this._followFrame = null;
        void this.manager?.onWindowClosed(this);
        return super._onClose?.(options);
    }
}

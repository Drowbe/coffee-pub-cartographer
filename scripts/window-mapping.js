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
                icon: 'fa-solid fa-map-location-dot',
                resizable: true,
                minimizable: true
            },
            toolTheme: 'glass',
            toolTitlebar: 'micro',
            windowSizeConstraints: { minWidth: 320, minHeight: 320 }
        }
    );

    static ACTION_HANDLERS = {
        'zoom-in': (_event, _target, app) => app.setZoom(app.zoom + 0.15),
        'zoom-out': (_event, _target, app) => app.setZoom(app.zoom - 0.15),
        'center-party': (_event, _target, app) => app.centerOnParty(),
        'reset-map': (_event, _target, app) => void app.manager.resetMap()
    };

    constructor(manager, options = {}) {
        super(options);
        this.manager = manager;
        this.zoom = 1;
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
        const mappedFeatures = this._getMappedFeatures();
        const common = {
            canReset: game.user.isGM,
            zoom: this.zoom,
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
            const feature = mappedFeatures.get(`${column},${row}`) ?? null;
            return {
                key: `${column},${row}`,
                gridColumn: column + 1,
                gridRow: row + 1,
                className: `is-explored${feature ? ` is-${feature}` : ''}${isParty ? ' is-party' : ''}`,
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

    _getMappedFeatures() {
        const features = new Map();
        const sizeX = canvas.grid.sizeX ?? canvas.grid.size;
        const sizeY = canvas.grid.sizeY ?? canvas.grid.size;
        const sampleSize = Math.max(1, Math.min(sizeX, sizeY) / 3);
        // Structural walls win shared endpoint/corner cells so a nearby window
        // does not turn the whole corner into a window tile.
        const priorities = { window: 1, door: 2, wall: 3 };

        for (const wall of canvas.walls?.placeables ?? []) {
            const feature = this._classifyWall(wall.document);
            if (!feature) continue;
            const coordinates = wall.document?.c ?? wall.document?._source?.c;
            if (!Array.isArray(coordinates) || coordinates.length < 4) continue;
            const [x1, y1, x2, y2] = coordinates.map(Number);
            const distance = Math.hypot(x2 - x1, y2 - y1);
            const steps = Math.max(1, Math.ceil(distance / sampleSize));

            for (let step = 0; step <= steps; step++) {
                const ratio = step / steps;
                const offset = canvas.grid.getOffset({
                    x: x1 + ((x2 - x1) * ratio),
                    y: y1 + ((y2 - y1) * ratio)
                });
                const column = Number(offset.j ?? offset.x);
                const row = Number(offset.i ?? offset.y);
                if (!Number.isInteger(column) || !Number.isInteger(row)) continue;
                const key = `${column},${row}`;
                const existing = features.get(key);
                if (!existing || priorities[feature] > priorities[existing]) features.set(key, feature);
            }
        }
        return features;
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
        await this.render(false);
        if (this.manager.active) requestAnimationFrame(() => this.centerOnParty());
        return this;
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
        void this.manager?.onWindowClosed(this);
        return super._onClose?.(options);
    }
}

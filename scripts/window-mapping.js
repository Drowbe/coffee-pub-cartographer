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
        if (trackedPosition) coordinates.push([trackedPosition.column, trackedPosition.row]);
        const columns = coordinates.map(([column]) => column);
        const rows = coordinates.map(([, row]) => row);
        const minColumn = Math.min(...columns) - 1;
        const maxColumn = Math.max(...columns) + 1;
        const minRow = Math.min(...rows) - 1;
        const maxRow = Math.max(...rows) + 1;
        const mapRows = [];

        for (let row = minRow; row <= maxRow; row++) {
            const cells = [];
            for (let column = minColumn; column <= maxColumn; column++) {
                const key = `${column},${row}`;
                const isExplored = explored.has(key);
                const isParty = trackedPosition?.column === column && trackedPosition?.row === row;
                cells.push({
                    key,
                    className: `${isExplored ? 'is-explored' : 'is-unexplored'}${isParty ? ' is-party' : ''}`,
                    isParty
                });
            }
            mapRows.push({ cells });
        }

        return {
            ...common,
            empty: false,
            rows: mapRows,
            columnCount: maxColumn - minColumn + 1,
            exploredCount: explored.size
        };
    }

    setZoom(value) {
        this.zoom = Math.max(0.4, Math.min(2.5, Number(value) || 1));
        return this.render(false);
    }

    centerOnParty() {
        this.element?.querySelector('.cartographer-mapping-cell.is-party')?.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center'
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

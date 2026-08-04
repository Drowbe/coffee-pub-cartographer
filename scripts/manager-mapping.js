// ==================================================================
// ===== MAPPING TOOL MANAGER =======================================
// ==================================================================

import { MODULE } from './const.js';
import { cartographerToolbar } from './manager-toolbar.js';
import { socketManager } from './manager-sockets.js';
import { notify } from './utils-toast.js';

const FLAG_KEY = 'mapping';
const TOOL_ID = `${MODULE.ID}-mapping`;
const WINDOW_ID = `${MODULE.ID}-mapper`;
const STATE_VERSION = 1;

class MappingManager {
    constructor() {
        this.services = null;
        this.active = false;
        this.trackedTokenId = null;
        this.lastGridKey = null;
        this.state = this._emptyState();
        this.window = null;
        this._hooks = [];
        this._saveQueue = Promise.resolve();
        this._closingWindow = false;
    }

    _emptyState() {
        return {
            version: STATE_VERSION,
            gridType: 'square',
            explored: [],
            updatedAt: 0,
            updatedBy: null
        };
    }

    async initialize(services) {
        this.services = services;
        if (!this._registerWindow()) return;
        this._registerToolbarTool();
        this._registerHooks();
        this._registerSocketHandlers();
        this.loadSceneState();
        console.log(`${MODULE.NAME}: Mapping tool initialized`);
    }

    cleanup() {
        for (const hook of this._hooks) Hooks.off(hook.name, hook.id);
        this._hooks = [];
        this.active = false;
        this.trackedTokenId = null;
        this.lastGridKey = null;
        this.window = null;
    }

    _registerWindow() {
        const api = game.modules.get('coffee-pub-blacksmith')?.api;
        if (!api?.registerWindow || !api?.BlacksmithToolWindowBaseV2) {
            console.warn(`${MODULE.NAME}: Blacksmith Window API unavailable; Mapper window not registered`);
            return false;
        }

        api.registerWindow(WINDOW_ID, {
            moduleId: MODULE.ID,
            title: game.i18n.localize(`${MODULE.ID}.mapping.windowTitle`),
            open: async () => this.openWindow()
        });
        return true;
    }

    _registerToolbarTool() {
        cartographerToolbar.registerTool(TOOL_ID, {
            icon: 'fa-solid fa-map-location-dot',
            tooltip: game.i18n.localize(`${MODULE.ID}.mapping.toggleHint`),
            group: 'Mapping',
            order: 1,
            toggleable: true,
            active: () => this.active,
            onClick: () => this.toggle()
        });
        this._updateToolbarButton();
    }

    _registerHooks() {
        const updateToken = Hooks.on('updateToken', (tokenDocument, changes) => {
            if (!this.active || tokenDocument.id !== this.trackedTokenId) return;
            if (!('x' in changes) && !('y' in changes)) return;
            void this._requestReveal(tokenDocument).catch(error => {
                console.error(`${MODULE.NAME}: Failed to map token movement`, error);
            });
        });
        this._hooks.push({ name: 'updateToken', id: updateToken });

        const updateScene = Hooks.on('updateScene', (scene, changes) => {
            if (scene.id !== canvas?.scene?.id || !changes?.flags?.[MODULE.ID]?.[FLAG_KEY]) return;
            this.loadSceneState();
            this.renderWindow();
        });
        this._hooks.push({ name: 'updateScene', id: updateScene });

        const controlToken = Hooks.on('controlToken', () => {
            if (this.active && !this._getTrackedToken()) void this.stopMapping();
        });
        this._hooks.push({ name: 'controlToken', id: controlToken });

        const deleteToken = Hooks.on('deleteToken', tokenDocument => {
            if (this.active && tokenDocument.id === this.trackedTokenId) void this.stopMapping();
        });
        this._hooks.push({ name: 'deleteToken', id: deleteToken });

        const canvasReady = Hooks.on('canvasReady', () => {
            if (this.active) void this.stopMapping();
            this.loadSceneState();
            this.renderWindow();
        });
        this._hooks.push({ name: 'canvasReady', id: canvasReady });
    }

    _registerSocketHandlers() {
        socketManager.registerToolHandlers('mapping', {
            'reveal-request': (data) => this._handleRevealRequest(data),
            'state-updated': (data) => this._handleStateUpdated(data),
            'reset': (data) => this._handleStateUpdated(data)
        });
    }

    async toggle() {
        if (this.active) return this.stopMapping();
        return this.startMapping();
    }

    async startMapping() {
        if (!game.settings.get(MODULE.ID, 'mapping.enabled')) {
            notify(game.i18n.localize(`${MODULE.ID}.mapping.disabledTitle`), {
                subtitle: game.i18n.localize(`${MODULE.ID}.mapping.disabledHint`),
                type: 'warn'
            });
            this._updateToolbarButton();
            return false;
        }

        if (!game.user.isGM && !game.settings.get(MODULE.ID, 'mapping.allowPlayers')) {
            notify(game.i18n.localize(`${MODULE.ID}.mapping.notAllowedTitle`), { type: 'warn' });
            this._updateToolbarButton();
            return false;
        }

        if (!game.user.isGM && !game.users.activeGM) {
            notify(game.i18n.localize(`${MODULE.ID}.mapping.noGmTitle`), {
                subtitle: game.i18n.localize(`${MODULE.ID}.mapping.noGmHint`),
                type: 'warn'
            });
            this._updateToolbarButton();
            return false;
        }

        if (!this._isSquareGrid()) {
            notify(game.i18n.localize(`${MODULE.ID}.mapping.unsupportedGridTitle`), {
                subtitle: game.i18n.localize(`${MODULE.ID}.mapping.unsupportedGridHint`),
                type: 'warn'
            });
            this._updateToolbarButton();
            return false;
        }

        const controlled = canvas?.tokens?.controlled ?? [];
        if (controlled.length !== 1) {
            notify(game.i18n.localize(`${MODULE.ID}.mapping.selectTokenTitle`), {
                subtitle: game.i18n.localize(`${MODULE.ID}.mapping.selectTokenHint`),
                type: 'warn'
            });
            this._updateToolbarButton();
            return false;
        }

        const token = controlled[0];
        if (!game.user.isGM && !token.document.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) {
            notify(game.i18n.localize(`${MODULE.ID}.mapping.notOwnerTitle`), { type: 'warn' });
            this._updateToolbarButton();
            return false;
        }

        this.active = true;
        this.trackedTokenId = token.id;
        this.lastGridKey = null;
        this._updateToolbarButton();
        await this.openWindow();
        await this._requestReveal(token.document);
        this.renderWindow();
        return true;
    }

    async stopMapping({ closeWindow = true } = {}) {
        this.active = false;
        this.trackedTokenId = null;
        this.lastGridKey = null;
        this._updateToolbarButton();

        if (closeWindow && this.window?.rendered) {
            this._closingWindow = true;
            try {
                await this.window.close();
            } finally {
                this._closingWindow = false;
                this.window = null;
            }
        }
        return true;
    }

    async onWindowClosed(window) {
        if (this.window === window) this.window = null;
        if (!this._closingWindow && this.active) await this.stopMapping({ closeWindow: false });
    }

    async openWindow() {
        if (this.window?.rendered) {
            this.window.bringToFront?.();
            return this.window;
        }
        const { MappingWindow } = await import('./window-mapping.js');
        this.window = await MappingWindow.open(this);
        return this.window;
    }

    renderWindow() {
        if (this.window?.rendered) void this.window.render(false);
    }

    loadSceneState() {
        const raw = canvas?.scene?.getFlag(MODULE.ID, FLAG_KEY);
        this.state = this._normalizeState(raw);
        return this.state;
    }

    _normalizeState(raw) {
        if (!raw || typeof raw !== 'object') return this._emptyState();
        const explored = Array.isArray(raw.explored)
            ? [...new Set(raw.explored.filter(key => /^-?\d+,-?\d+$/.test(key)))]
            : [];
        return {
            version: STATE_VERSION,
            gridType: 'square',
            explored,
            updatedAt: Number(raw.updatedAt) || 0,
            updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : null
        };
    }

    _isSquareGrid() {
        if (!canvas?.ready || !canvas.grid) return false;
        const type = canvas.grid.type ?? canvas.scene?.grid?.type;
        const gridTypes = CONST.GRID_TYPES ?? {};
        const squareTypes = [gridTypes.SQUARE, gridTypes.SQUARE_DIAGONAL_1, gridTypes.SQUARE_DIAGONAL_2]
            .filter(value => value !== undefined);
        return squareTypes.includes(type);
    }

    _getTrackedToken() {
        return this.trackedTokenId ? canvas?.tokens?.get(this.trackedTokenId) ?? null : null;
    }

    getTrackedTokenName() {
        return this._getTrackedToken()?.name ?? game.i18n.localize(`${MODULE.ID}.mapping.noToken`);
    }

    _gridPosition(tokenDocument) {
        const sizeX = canvas.grid.sizeX ?? canvas.grid.size;
        const sizeY = canvas.grid.sizeY ?? canvas.grid.size;
        const center = {
            x: tokenDocument.x + ((tokenDocument.width ?? 1) * sizeX) / 2,
            y: tokenDocument.y + ((tokenDocument.height ?? 1) * sizeY) / 2
        };
        const offset = canvas.grid.getOffset(center.x, center.y);
        return { column: Number(offset.x), row: Number(offset.y) };
    }

    _revealKeys(position) {
        const keys = [];
        for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
            for (let columnOffset = -1; columnOffset <= 1; columnOffset++) {
                const column = position.column + columnOffset;
                const row = position.row + rowOffset;
                if (column < 0 || row < 0) continue;
                keys.push(`${column},${row}`);
            }
        }
        return keys;
    }

    async _requestReveal(tokenDocument) {
        const position = this._gridPosition(tokenDocument);
        const gridKey = `${position.column},${position.row}`;
        if (gridKey === this.lastGridKey) return;
        this.lastGridKey = gridKey;

        const request = {
            userId: game.user.id,
            sceneId: canvas.scene.id,
            tokenId: tokenDocument.id
        };

        if (game.user.isGM) await this._handleRevealRequest(request, { allowLocalGM: true });
        else await socketManager.broadcast('mapping', 'reveal-request', request);
    }

    async _handleRevealRequest(data, { allowLocalGM = false } = {}) {
        if (!game.user.isGM) return;
        if (!allowLocalGM && !game.users.activeGM?.isSelf) return;
        if (!data || data.sceneId !== canvas?.scene?.id) return;

        const user = game.users.get(data.userId);
        const tokenDocument = canvas.scene.tokens.get(data.tokenId);
        if (!user?.active || !tokenDocument) return;
        if (!user.isGM && !game.settings.get(MODULE.ID, 'mapping.allowPlayers')) return;
        if (!user.isGM && !tokenDocument.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER)) return;

        const position = this._gridPosition(tokenDocument);
        const explored = new Set(this.state.explored);
        const before = explored.size;
        for (const key of this._revealKeys(position)) explored.add(key);
        if (explored.size === before) return;

        this.state = {
            version: STATE_VERSION,
            gridType: 'square',
            explored: [...explored],
            updatedAt: Date.now(),
            updatedBy: data.userId
        };
        this.renderWindow();
        await this._persistState('state-updated');
    }

    async _persistState(eventName) {
        const scene = canvas?.scene;
        if (!scene || !game.user.isGM) return;
        const snapshot = foundry.utils.deepClone(this.state);
        this._saveQueue = this._saveQueue
            .then(() => scene.setFlag(MODULE.ID, FLAG_KEY, snapshot))
            .then(() => socketManager.broadcast('mapping', eventName, {
                userId: game.user.id,
                sceneId: scene.id,
                state: snapshot
            }))
            .catch(error => console.error(`${MODULE.NAME}: Failed to persist mapping state`, error));
        return this._saveQueue;
    }

    _handleStateUpdated(data) {
        if (!data || data.sceneId !== canvas?.scene?.id) return;
        this.state = this._normalizeState(data.state);
        this.renderWindow();
    }

    async resetMap() {
        if (!game.user.isGM) return false;
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize(`${MODULE.ID}.mapping.resetTitle`) },
            content: `<p>${foundry.utils.escapeHTML(game.i18n.localize(`${MODULE.ID}.mapping.resetConfirm`))}</p>`,
            rejectClose: false,
            modal: true
        });
        if (!confirmed) return false;
        this.state = this._emptyState();
        this.renderWindow();
        await this._persistState('reset');
        notify(game.i18n.localize(`${MODULE.ID}.mapping.resetDone`), { type: 'info' });
        return true;
    }

    _updateToolbarButton() {
        game.modules.get('coffee-pub-blacksmith')?.api?.updateSecondaryBarItemActive?.(
            MODULE.ID,
            TOOL_ID,
            this.active
        );
    }
}

const mappingManager = new MappingManager();
export { mappingManager, WINDOW_ID };

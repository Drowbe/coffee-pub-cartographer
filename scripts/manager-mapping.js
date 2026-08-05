// ==================================================================
// ===== MAPPING TOOL MANAGER =======================================
// ==================================================================

import { MODULE } from './const.js';
import { cartographerToolbar } from './manager-toolbar.js';
import { socketManager } from './manager-sockets.js';
import {
    flattenFeatureSources,
    gridTravelPath,
    mergeFeatureSources,
    mergeFeatures,
    mergeSourceFeatures,
    normalizeFeatureSources,
    normalizeFeatures,
    contiguousFloorRegion,
    observeCrossedSecretDoors,
    observeVisibleFeatures,
    subtractFeatureSources,
    visibleRevealKeys
} from './utils-mapping.js';
import { notify } from './utils-toast.js';
import { MAPPING_FLOOR_TYPE_IDS, MAPPING_SYMBOL_TYPES } from './symbols-mapping.js';

const FLAG_KEY = 'mapping';
const TOOL_ID = `${MODULE.ID}-mapping`;
const WINDOW_ID = `${MODULE.ID}-mapper`;
const STATE_VERSION = 2;
/** How long an optimistic local deletion suppresses a map before it is reconciled. */
const DELETE_TOMBSTONE_MS = 15000;
/** Passes allowed to drive the mapped position onto the token's settled cell. */
const SETTLE_ATTEMPTS = 4;

class MappingManager {
    constructor() {
        this.services = null;
        this.active = false;
        this.paused = false;
        // Following is a third state: the camera and marker track the token
        // without recording anything, so it can safely be pointed at a map
        // this user does not own.
        this.following = false;
        this._unexploredPromptSuppressed = false;
        this._unexploredPromptOpen = false;
        this.trackedTokenId = null;
        this.currentMapId = null;
        this.lastGridKey = null;
        this.state = this._emptyRecord();
        this.records = new Map();
        this.legacyByScene = new Map();
        this.window = null;
        this._hooks = [];
        this._saveQueue = Promise.resolve();
        this._renderQueue = Promise.resolve();
        this._outgoingRevealQueue = Promise.resolve();
        this._revealProcessingQueue = Promise.resolve();
        this._authoritativePositions = new Map();
        this._recentTokenPositions = new Map();
        // Map id -> expiry timestamp. A tombstone only has to outlive a
        // registry broadcast that was already in flight when the delete
        // happened; it is cleared as soon as an authoritative container
        // confirms the removal, and expires if the delete never took effect.
        this._deletedMapIds = new Map();
        this._selectionFrame = null;
        this._closingWindow = false;
        this._catchUpTimer = null;
    }

    _recordId(actorId, sceneId) {
        return `${actorId}::${sceneId}`;
    }

    _emptyRecord({ actor = null, scene = null } = {}) {
        const actorId = actor?.id ?? null;
        const sceneId = scene?.id ?? null;
        return {
            version: STATE_VERSION,
            id: actorId && sceneId ? this._recordId(actorId, sceneId) : null,
            actorId,
            actorName: actor?.name ?? '',
            sceneId,
            sceneName: scene?.name ?? '',
            name: actor && scene ? `${actor.name} — ${scene.name}` : '',
            gridType: 'square',
            columns: 0,
            rows: 0,
            gridDistance: 5,
            explored: [],
            features: {},
            featureSources: {},
            symbols: [],
            floors: {},
            lastPosition: null,
            createdAt: 0,
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
        this.loadMapRecords();
        this._seedRecentTokenPositions();
        console.log(`${MODULE.NAME}: Mapping tool initialized`);
    }

    cleanup() {
        for (const hook of this._hooks) Hooks.off(hook.name, hook.id);
        this._hooks = [];
        this.active = false;
        this.paused = false;
        this.following = false;
        this.trackedTokenId = null;
        this.currentMapId = null;
        this.lastGridKey = null;
        this._authoritativePositions.clear();
        this._recentTokenPositions.clear();
        this._deletedMapIds.clear();
        if (this._selectionFrame) cancelAnimationFrame(this._selectionFrame);
        this._selectionFrame = null;
        if (this._catchUpTimer) clearTimeout(this._catchUpTimer);
        this._catchUpTimer = null;
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
            icon: 'fa-solid fa-street-view',
            tooltip: game.i18n.localize(`${MODULE.ID}.mapping.openHint`),
            group: 'Mapping',
            order: 1,
            toggleable: false,
            onClick: () => this.openWindow()
        });
    }

    _registerHooks() {
        const updateToken = Hooks.on('updateToken', (tokenDocument, changes, operation) => {
            const moved = ('x' in changes) || ('y' in changes);
            const movementDocument = moved
                ? {
                    id: tokenDocument.id,
                    x: 'x' in changes ? Number(changes.x) : tokenDocument.x,
                    y: 'y' in changes ? Number(changes.y) : tokenDocument.y,
                    width: tokenDocument.width,
                    height: tokenDocument.height,
                    actor: tokenDocument.actor,
                    actorId: tokenDocument.actorId
                }
                : tokenDocument;
            const position = this._gridPosition(movementDocument);
            if (game.user.isGM && this._isSquareGrid()) {
                this._rememberTokenPosition(
                    tokenDocument.id,
                    position,
                    this._tokenCoordinates(movementDocument)
                );
            }
            if (tokenDocument.id !== this.trackedTokenId) return;
            const visionChanged = ('rotation' in changes) || ('sight' in changes);
            if (!moved && !visionChanged) return;

            // Following moves the view and nothing else. It deliberately runs
            // before the recording gate, so a user can follow along on a map
            // they have no permission to write to.
            if (this.following && !this.active) {
                if (moved) {
                    this.window?.armFollow();
                    void this.renderWindow();
                    void this._considerUnexplored(position);
                }
                return;
            }
            if (!this.active || this.paused) return;
            // Recording and viewport following must originate from updateToken,
            // which is emitted on the controlling player's client. Movement
            // metadata is used only to suppress interpolation for teleports.
            const movement = operation?._movement?.[tokenDocument.id] ?? operation?.movement;
            const teleported = this._isTeleportMovement(movement);
            if (teleported && this._catchUpTimer) {
                clearTimeout(this._catchUpTimer);
                this._catchUpTimer = null;
            }

            // A completed step re-arms centred following, so a manual pan is
            // respected only until the party moves again.
            if (moved) this.window?.armFollow();
            void this._requestReveal(movementDocument, position, {
                // Foundry turns tokens to face their movement, so a move
                // almost always reports a rotation change too. Only a
                // vision-only change is worth forcing a re-sample; forcing on
                // every move would defeat the same-cell guard in
                // _requestReveal and re-walk the path on every nudge.
                force: (visionChanged && !moved) || teleported,
                resetPath: teleported
            }).catch(error => {
                console.error(`${MODULE.NAME}: Failed to update the map for token movement or vision`, error);
            });
            if (moved && !teleported) this._scheduleCatchUp(tokenDocument.id);
        });
        this._hooks.push({ name: 'updateToken', id: updateToken });

        const updateScene = Hooks.on('updateScene', (scene, changes) => {
            if (!changes?.flags?.[MODULE.ID]?.[FLAG_KEY]) return;
            this._replaceSceneRecords(scene, scene.getFlag(MODULE.ID, FLAG_KEY));
            void this.renderWindow();
        });
        this._hooks.push({ name: 'updateScene', id: updateScene });

        const controlToken = Hooks.on('controlToken', () => {
            if (this._selectionFrame) cancelAnimationFrame(this._selectionFrame);
            this._selectionFrame = requestAnimationFrame(() => {
                this._selectionFrame = null;
                void this._handleTokenSelectionChanged();
            });
        });
        this._hooks.push({ name: 'controlToken', id: controlToken });

        const deleteToken = Hooks.on('deleteToken', tokenDocument => {
            if (tokenDocument.id !== this.trackedTokenId) return;
            if (this.active) void this.stopMapping();
            else {
                this.trackedTokenId = null;
                void this.renderWindow();
            }
        });
        this._hooks.push({ name: 'deleteToken', id: deleteToken });

        const canvasReady = Hooks.on('canvasReady', () => {
            if (this.active) void this.stopMapping();
            this.trackedTokenId = null;
            this._recentTokenPositions.clear();
            this._seedRecentTokenPositions();
            this.loadMapRecords();
            const selected = this._getSingleControlledToken();
            if (selected) this._selectMapForToken(selected);
            void this.renderWindow();
        });
        this._hooks.push({ name: 'canvasReady', id: canvasReady });

        for (const hookName of ['createWall', 'updateWall']) {
            const hookId = Hooks.on(hookName, () => {
                const token = this._getTrackedToken();
                if (!this.active || this.paused || !token) return;
                void this._requestReveal(token.document, this._gridPosition(token.document), { force: true });
            });
            this._hooks.push({ name: hookName, id: hookId });
        }
    }

    _registerSocketHandlers() {
        socketManager.registerToolHandlers('mapping', {
            'reveal-request': data => this._handleRevealRequest(data),
            'mutation-request': data => this._handleMutationRequest(data),
            'registry-updated': data => this._handleRegistryUpdated(data)
        });
    }

    loadMapRecords() {
        const selectedId = this.currentMapId;
        this.records.clear();
        this.legacyByScene.clear();
        for (const scene of game.scenes ?? []) this._replaceSceneRecords(scene, scene.getFlag(MODULE.ID, FLAG_KEY));

        if (selectedId && this.records.has(selectedId)) this.selectMap(selectedId, { render: false });
        else {
            const selected = this._getSingleControlledToken();
            if (selected) this._selectMapForToken(selected);
            else {
                const latest = this.getMapList()[0];
                if (latest) this.selectMap(latest.id, { render: false });
                else {
                    this.currentMapId = null;
                    this.state = this._emptyRecord();
                }
            }
        }
        return this.records;
    }

    _replaceSceneRecords(scene, raw) {
        for (const [id, record] of this.records) {
            if (record.sceneId === scene.id) this.records.delete(id);
        }
        this.legacyByScene.delete(scene.id);

        const incoming = new Map();
        if (Number(raw?.version) >= STATE_VERSION && raw.maps && typeof raw.maps === 'object') {
            for (const value of Object.values(raw.maps)) {
                const record = this._normalizeRecord(value, scene);
                if (record.id) incoming.set(record.id, record);
            }
        } else if (Array.isArray(raw?.explored)) {
            this.legacyByScene.set(scene.id, raw);
        }

        // Reconcile pending deletions against this authoritative container.
        // An id the container no longer carries is confirmed deleted, so the
        // tombstone has done its job and must be dropped -- otherwise the map
        // could never be recorded again on this client. An id that is still
        // present after the tombstone expired means the delete did not take,
        // and the honest thing is to show the map again.
        for (const [id, expiry] of this._deletedMapIds) {
            if (!id.endsWith(`::${scene.id}`)) continue;
            if (!incoming.has(id) || expiry <= Date.now()) this._deletedMapIds.delete(id);
        }
        for (const [id, record] of incoming) {
            if (!this._deletedMapIds.has(id)) this.records.set(id, record);
        }

        if (this.currentMapId) {
            const current = this.records.get(this.currentMapId);
            if (current) this.state = current;
            else if (this.state.sceneId === scene.id && this.state.updatedAt) {
                this.currentMapId = null;
                this.state = this._emptyRecord();
            }
        }
    }

    _normalizeRecord(raw, scene = game.scenes?.get(raw?.sceneId)) {
        if (!raw || typeof raw !== 'object') return this._emptyRecord();
        const actorId = typeof raw.actorId === 'string' ? raw.actorId : null;
        const sceneId = scene?.id ?? (typeof raw.sceneId === 'string' ? raw.sceneId : null);
        if (!actorId || !sceneId) return this._emptyRecord();
        const actor = game.actors?.get(actorId);
        const explored = Array.isArray(raw.explored)
            ? [...new Set(raw.explored.filter(key => /^-?\d+,-?\d+$/.test(key)))]
            : [];
        return {
            version: STATE_VERSION,
            id: this._recordId(actorId, sceneId),
            actorId,
            actorName: String(raw.actorName || actor?.name || ''),
            sceneId,
            sceneName: String(raw.sceneName || scene?.name || ''),
            name: String(raw.name || `${raw.actorName || actor?.name || 'Map'} — ${raw.sceneName || scene?.name || ''}`),
            gridType: 'square',
            columns: Math.max(0, Number(raw.columns) || 0),
            rows: Math.max(0, Number(raw.rows) || 0),
            gridDistance: 5,
            explored,
            features: normalizeFeatures(raw.features),
            featureSources: normalizeFeatureSources(raw.featureSources),
            symbols: this._normalizeSymbols(raw.symbols),
            floors: this._normalizeFloors(raw.floors),
            lastPosition: this._normalizePosition(raw.lastPosition),
            createdAt: Number(raw.createdAt) || Number(raw.updatedAt) || 0,
            updatedAt: Number(raw.updatedAt) || 0,
            updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : null
        };
    }

    _newRecord(actor, scene) {
        const record = this._emptyRecord({ actor, scene });
        const legacy = this.legacyByScene.get(scene.id);
        if (legacy) {
            record.explored = [...new Set((legacy.explored ?? []).filter(key => /^-?\d+,-?\d+$/.test(key)))];
            record.createdAt = Number(legacy.updatedAt) || Date.now();
            record.updatedAt = Number(legacy.updatedAt) || 0;
            record.updatedBy = typeof legacy.updatedBy === 'string' ? legacy.updatedBy : null;
        }
        const dimensions = this._sceneGridDimensions(scene);
        record.columns = dimensions.columns;
        record.rows = dimensions.rows;
        return record;
    }

    _sceneGridDimensions(scene) {
        const size = Number(scene?.grid?.size) || Number(canvas?.grid?.size) || 100;
        const width = scene?.id === canvas?.scene?.id ? canvas.dimensions?.width : scene?.width;
        const height = scene?.id === canvas?.scene?.id ? canvas.dimensions?.height : scene?.height;
        return {
            columns: Math.max(1, Math.ceil((Number(width) || size) / size)),
            rows: Math.max(1, Math.ceil((Number(height) || size) / size))
        };
    }

    getMapList() {
        return [...this.records.values()].sort((left, right) => {
            if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt;
            return left.name.localeCompare(right.name);
        });
    }

    selectMap(mapId, { render = true } = {}) {
        const record = this.records.get(mapId);
        if (!record) return false;
        this.currentMapId = record.id;
        this.state = record;
        if (this.active && record.id !== this._mapIdForToken(this._getTrackedToken())) void this.stopMapping();
        if (render) void this.renderWindow();
        return true;
    }

    _mapIdForToken(token) {
        const actorId = token?.actor?.id ?? token?.document?.actorId;
        return actorId && canvas?.scene?.id ? this._recordId(actorId, canvas.scene.id) : null;
    }

    _selectMapForToken(token) {
        const actor = token?.actor;
        if (!actor || !canvas?.scene) return false;
        const id = this._recordId(actor.id, canvas.scene.id);
        this.currentMapId = id;
        this.state = this.records.get(id) ?? this._newRecord(actor, canvas.scene);
        return true;
    }

    async toggleRecording() {
        if (this.active) return this.stopMapping({ closeWindow: false });
        return this.startMapping();
    }

    async startMapping() {
        if (!game.settings.get(MODULE.ID, 'mapping.enabled')) {
            notify(game.i18n.localize(`${MODULE.ID}.mapping.disabledTitle`), {
                subtitle: game.i18n.localize(`${MODULE.ID}.mapping.disabledHint`), type: 'warn'
            });
            return false;
        }
        if (!game.user.isGM && !game.settings.get(MODULE.ID, 'mapping.allowPlayers')) {
            notify(game.i18n.localize(`${MODULE.ID}.mapping.notAllowedTitle`), { type: 'warn' });
            return false;
        }
        if (!game.user.isGM && !game.users.activeGM) {
            notify(game.i18n.localize(`${MODULE.ID}.mapping.noGmTitle`), {
                subtitle: game.i18n.localize(`${MODULE.ID}.mapping.noGmHint`), type: 'warn'
            });
            return false;
        }
        if (!this._isSquareGrid()) {
            notify(game.i18n.localize(`${MODULE.ID}.mapping.unsupportedGridTitle`), {
                subtitle: game.i18n.localize(`${MODULE.ID}.mapping.unsupportedGridHint`), type: 'warn'
            });
            return false;
        }

        const token = this._getSingleControlledToken();
        if (!token) {
            notify(game.i18n.localize(`${MODULE.ID}.mapping.selectTokenTitle`), {
                subtitle: game.i18n.localize(`${MODULE.ID}.mapping.selectTokenHint`), type: 'warn'
            });
            return false;
        }
        if (!this._canManageActor(token.actor, game.user)) {
            notify(game.i18n.localize(`${MODULE.ID}.mapping.notOwnerTitle`), { type: 'warn' });
            return false;
        }

        this.active = true;
        this.paused = false;
        this.trackedTokenId = token.id;
        this.lastGridKey = null;
        this._selectMapForToken(token);
        await this._requestMutation({
            action: 'create',
            actorId: token.actor.id,
            sceneId: canvas.scene.id
        });
        const startPosition = this._gridPosition(token.document);
        this.state = { ...this.state, lastPosition: startPosition };
        await this.openWindow();
        this.window?.showMap?.();
        this.window?.armFollow();
        await this._requestReveal(token.document, startPosition, {
            force: true,
            resetPath: true
        });
        await this.renderWindow({ centerOnParty: true });
        return true;
    }

    async stopMapping({ closeWindow = false } = {}) {
        // Finish every queued path before dropping the recording session. This
        // keeps Stop (and window close) from jumping the marker ahead of map
        // linework which is still catching up.
        if (this.active) {
            if (!this.paused) await this._flushCatchUp();
            await this._outgoingRevealQueue.catch(error => {
                console.error(`${MODULE.NAME}: Failed while finishing the recorded map path`, error);
            });
        }
        this.active = false;
        this.paused = false;
        this.lastGridKey = null;
        this.trackedTokenId = this._getSingleControlledToken()?.id ?? null;
        if (closeWindow && this.window?.rendered) {
            this._closingWindow = true;
            try {
                await this.window.close();
            } finally {
                this._closingWindow = false;
                this.window = null;
            }
        } else if (this.window?.rendered) await this.renderWindow();
        return true;
    }

    async onWindowClosed(window) {
        if (this.window === window) this.window = null;
        if (!this._closingWindow && this.active) await this.stopMapping({ closeWindow: false });
    }

    async openWindow() {
        if (!this.active) {
            this.trackedTokenId = this._getSingleControlledToken()?.id ?? null;
            this.loadMapRecords();
        }
        if (this.window?.rendered) {
            this.window.bringToFront?.();
            await this.renderWindow();
            return this.window;
        }
        const { MappingWindow } = await import('./window-mapping.js');
        // With nothing recorded here yet there is no map worth showing, so open
        // on the list, where the create card offers the obvious next step.
        const viewMode = !this.active && !this.hasManageableMapForCurrentScene() ? 'list' : 'map';
        this.window = await MappingWindow.open(this, { viewMode });
        // centerOnMap works from the record rather than element rectangles, so
        // it can run immediately and the map never paints at the origin first.
        if (!this.active && viewMode === 'map') this.window?.centerOnMap?.();
        return this.window;
    }

    async _handleTokenSelectionChanged() {
        const selected = this._getSingleControlledToken();
        if (this.active) {
            if (selected?.id === this.trackedTokenId) {
                if (this.paused) await this.resumeMapping();
            } else if (!this.paused) await this.pauseMapping();
            return;
        }
        const nextTokenId = selected?.id ?? null;
        if (nextTokenId === this.trackedTokenId) return;
        this.trackedTokenId = nextTokenId;
        if (selected) {
            this._selectMapForToken(selected);
            await this.window?.showMap?.();
        }
        await this.renderWindow();
        if (selected && this.window?.rendered) this.window.centerOnMap?.();
    }

    async pauseMapping() {
        if (!this.active || this.paused) return false;
        this.paused = true;
        this.lastGridKey = null;
        if (this._catchUpTimer) {
            clearTimeout(this._catchUpTimer);
            this._catchUpTimer = null;
        }
        await this.renderWindow();
        return true;
    }

    async resumeMapping() {
        if (!this.active || !this.paused) return false;
        const token = this._getSingleControlledToken();
        if (!token || token.id !== this.trackedTokenId) return false;
        if (!this._canManageActor(token.actor, game.user)) return false;

        this.paused = false;
        this.lastGridKey = null;
        this.window?.armFollow();
        const position = this._gridPosition(token.document);
        await this._requestReveal(token.document, position, {
            force: true,
            resetPath: true
        });
        await this.renderWindow({ centerOnParty: true });
        return true;
    }

    // The window re-establishes its own camera in _onRender, including centred
    // following, so rendering no longer has to chase the view afterwards.
    async renderWindow({ centerOnParty = false } = {}) {
        this._renderQueue = this._renderQueue
            .catch(error => console.error(`${MODULE.NAME}: Failed to render mapping window`, error))
            .then(async () => {
                const window = this.window;
                if (!window?.rendered) return;
                await window.render(false);
                if (centerOnParty && this.window === window && window.rendered) window.centerOnParty();
            });
        return this._renderQueue;
    }

    _isSquareGrid() {
        if (!canvas?.ready || !canvas.grid) return false;
        const type = canvas.grid.type ?? canvas.scene?.grid?.type;
        const gridTypes = CONST.GRID_TYPES ?? {};
        return [gridTypes.SQUARE, gridTypes.SQUARE_DIAGONAL_1, gridTypes.SQUARE_DIAGONAL_2]
            .filter(value => value !== undefined).includes(type);
    }

    _getTrackedToken() {
        return this.trackedTokenId ? canvas?.tokens?.get(this.trackedTokenId) ?? null : null;
    }

    _getSingleControlledToken() {
        const controlled = canvas?.tokens?.controlled ?? [];
        return controlled.length === 1 ? controlled[0] : null;
    }

    getTrackedPositionForCurrentMap() {
        const token = this._getTrackedToken();
        if (!token || !this._isSquareGrid()) return null;
        if (this.active) {
            // While recording the marker sits on the last mapped step, so it
            // never runs ahead of the linework still being drawn.
            if (this._mapIdForToken(token) !== this.currentMapId) return null;
            return this._normalizePosition(this.state.lastPosition) ?? this._gridPosition(token.document);
        }
        // Following shows the live position on whichever map is open, including
        // another character's, because following never writes to it.
        return this.following ? this._gridPosition(token.document) : null;
    }

    async toggleFollow() {
        // Recording already follows, so the toggle is meaningless during it.
        if (this.active) return this.following;
        this.following = !this.following;
        this._unexploredPromptSuppressed = false;
        if (this.following) {
            this.trackedTokenId = this._getSingleControlledToken()?.id ?? this.trackedTokenId;
        }
        await this.renderWindow({ centerOnParty: this.following });
        return this.following;
    }

    /**
     * Offer to start mapping when a followed token walks off the edge of what
     * this map covers. Asked at most once per follow session: declining
     * suppresses it until following is toggled again, so walking a long
     * unmapped corridor cannot turn into a stream of dialogs.
     */
    async _considerUnexplored(position) {
        if (!this.following || this.active || this.paused) return;
        if (this._unexploredPromptSuppressed || this._unexploredPromptOpen) return;
        if (!this.currentMapId || !this._normalizePosition(position)) return;
        if (this.state.explored?.includes(`${position.column},${position.row}`)) return;
        if (!this.canRecordCurrentMap()) return;

        this._unexploredPromptOpen = true;
        try {
            const confirmed = await foundry.applications.api.DialogV2.confirm({
                window: { title: game.i18n.localize(`${MODULE.ID}.mapping.unexploredTitle`) },
                content: `<p>${foundry.utils.escapeHTML(game.i18n.localize(`${MODULE.ID}.mapping.unexploredHint`))}</p>`,
                rejectClose: false,
                modal: false
            });
            if (confirmed) await this.startMapping();
            else this._unexploredPromptSuppressed = true;
        } finally {
            this._unexploredPromptOpen = false;
        }
    }

    /** Portrait for the status bar. Falls back to the token art, then nothing. */
    getTrackedTokenPortrait() {
        const token = this._getTrackedToken();
        const actor = token?.actor ?? (this.state.actorId ? game.actors?.get(this.state.actorId) : null);
        return actor?.img || token?.document?.texture?.src || null;
    }

    getTrackedTokenName() {
        return this.state.actorName || this._getTrackedToken()?.name || game.i18n.localize(`${MODULE.ID}.mapping.noToken`);
    }

    _gridPosition(tokenDocument) {
        const sizeX = canvas.grid.sizeX ?? canvas.grid.size;
        const sizeY = canvas.grid.sizeY ?? canvas.grid.size;
        const center = {
            x: tokenDocument.x + (((tokenDocument.width ?? 1) * sizeX) / 2),
            y: tokenDocument.y + (((tokenDocument.height ?? 1) * sizeY) / 2)
        };
        const offset = canvas.grid.getOffset(center);
        const column = Number(offset.j ?? offset.x);
        const row = Number(offset.i ?? offset.y);
        if (!Number.isInteger(column) || !Number.isInteger(row)) {
            throw new Error(`Invalid grid offset for token ${tokenDocument.id}: ${JSON.stringify(offset)}`);
        }
        return { column, row };
    }

    _normalizePosition(position) {
        const column = Number(position?.column);
        const row = Number(position?.row);
        return Number.isInteger(column) && Number.isInteger(row) ? { column, row } : null;
    }

    _normalizeSymbols(symbols) {
        if (!Array.isArray(symbols)) return [];
        const normalized = [];
        const occupied = new Set();
        for (const symbol of symbols) {
            const type = String(symbol?.type ?? '');
            const column = Number(symbol?.column);
            const row = Number(symbol?.row);
            if (!MAPPING_SYMBOL_TYPES.has(type) || !Number.isInteger(column) || !Number.isInteger(row)) continue;
            const key = `${column},${row}`;
            if (occupied.has(key)) continue;
            occupied.add(key);
            normalized.push({
                id: typeof symbol.id === 'string' && symbol.id ? symbol.id : foundry.utils.randomID(),
                type,
                column,
                row,
                createdAt: Number(symbol.createdAt) || 0,
                createdBy: typeof symbol.createdBy === 'string' ? symbol.createdBy : null
            });
        }
        return normalized;
    }

    /**
     * Floors are additive to the record rather than a new schema version: an
     * older client simply ignores the key, and a record written before floors
     * existed normalizes to none.
     */
    _normalizeFloors(floors) {
        if (!floors || typeof floors !== 'object') return {};
        const normalized = {};
        for (const [key, type] of Object.entries(floors)) {
            if (!/^-?\d+,-?\d+$/.test(key)) continue;
            const value = String(type ?? '');
            // "default" is the absence of a floor, so it is never stored.
            if (value === 'default' || !MAPPING_FLOOR_TYPE_IDS.has(value)) continue;
            normalized[key] = value;
        }
        return normalized;
    }

    _tokenCoordinates(tokenDocument) {
        const x = Number(tokenDocument?.x);
        const y = Number(tokenDocument?.y);
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    }

    _normalizeCoordinates(coordinates) {
        const x = Number(coordinates?.x);
        const y = Number(coordinates?.y);
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    }

    _seedRecentTokenPositions() {
        if (!game.user?.isGM || !this._isSquareGrid()) return;
        for (const token of canvas.tokens?.placeables ?? []) {
            this._rememberTokenPosition(
                token.id,
                this._gridPosition(token.document),
                this._tokenCoordinates(token.document)
            );
        }
    }

    _rememberTokenPosition(tokenId, position, coordinates) {
        if (!tokenId || !position || !canvas?.scene?.id) return;
        const key = `${canvas.scene.id}:${tokenId}`;
        const history = this._recentTokenPositions.get(key) ?? [];
        const gridKey = `${position.column},${position.row}`;
        const normalizedCoordinates = this._normalizeCoordinates(coordinates);
        const previous = history.at(-1);
        if (
            previous?.gridKey !== gridKey
            || previous?.coordinates?.x !== normalizedCoordinates?.x
            || previous?.coordinates?.y !== normalizedCoordinates?.y
        ) {
            history.push({ gridKey, coordinates: normalizedCoordinates });
        }
        if (history.length > 100) history.splice(0, history.length - 100);
        this._recentTokenPositions.set(key, history);
    }

    _trustedReportedState(sceneId, tokenId, position, coordinates, currentPosition, currentCoordinates) {
        if (!position) return null;
        const gridKey = `${position.column},${position.row}`;
        if (gridKey === `${currentPosition.column},${currentPosition.row}`) {
            return { position, coordinates: currentCoordinates };
        }

        const reportedCoordinates = this._normalizeCoordinates(coordinates);
        const history = this._recentTokenPositions.get(`${sceneId}:${tokenId}`) ?? [];
        const match = history.findLast(entry => {
            if (entry.gridKey !== gridKey) return false;
            if (!reportedCoordinates || !entry.coordinates) return true;
            return Math.abs(entry.coordinates.x - reportedCoordinates.x) < 1
                && Math.abs(entry.coordinates.y - reportedCoordinates.y) < 1;
        });
        return match ? { position, coordinates: match.coordinates ?? reportedCoordinates } : null;
    }

    _tokenAtCoordinates(tokenDocument, coordinates) {
        const width = Number(tokenDocument.width) || 1;
        const height = Number(tokenDocument.height) || 1;
        return {
            id: tokenDocument.id,
            x: coordinates.x,
            y: coordinates.y,
            width,
            height
        };
    }

    _interpolateCoordinates(start, end, amount) {
        return {
            x: start.x + ((end.x - start.x) * amount),
            y: start.y + ((end.y - start.y) * amount)
        };
    }

    _isTeleportMovement(movement) {
        const waypoints = movement?.passed?.waypoints;
        if (!Array.isArray(waypoints) || waypoints.length === 0) return false;
        const action = waypoints.at(-1)?.action;
        return CONFIG.Token.movement.actions[action]?.teleport === true;
    }

    _scheduleCatchUp(tokenId) {
        if (this._catchUpTimer) clearTimeout(this._catchUpTimer);
        this._catchUpTimer = setTimeout(() => {
            this._catchUpTimer = null;
            void this._settleToToken(tokenId).catch(error => {
                console.error(`${MODULE.NAME}: Failed to catch the map up to the token`, error);
            });
        }, 180);
    }

    /**
     * Drive the mapped position onto the token's real cell.
     *
     * A single catch-up pass is not enough for a drag. The reveal pipeline is
     * asynchronous and a long drag can still be drawing when the pass runs, so
     * one shot can report progress that is already stale and leave the party
     * marker short of where the token actually stopped. This waits for the
     * queue to drain and then re-checks, repeating until the mapped cell and
     * the token cell agree.
     */
    async _settleToToken(tokenId, attempt = 0) {
        if (!this._isSettleable(tokenId)) return;
        // Let everything already queued finish before judging progress.
        await this._outgoingRevealQueue.catch(() => {});
        if (!this._isSettleable(tokenId)) return;
        const token = this._getTrackedToken();
        if (!token) return;
        const live = this._gridPosition(token.document);
        const mapped = this._normalizePosition(this.state.lastPosition);
        if (mapped && mapped.column === live.column && mapped.row === live.row) return;
        if (attempt >= SETTLE_ATTEMPTS) {
            console.warn(
                `${MODULE.NAME}: Mapping stopped short of the token after ${SETTLE_ATTEMPTS} settle passes`,
                { mapped, live, tokenId }
            );
            return;
        }
        await this._requestReveal(token.document, live, { force: true });
        return this._settleToToken(tokenId, attempt + 1);
    }

    _isSettleable(tokenId) {
        return this.active && !this.paused && tokenId === this.trackedTokenId;
    }

    async _flushCatchUp() {
        if (this._catchUpTimer) {
            clearTimeout(this._catchUpTimer);
            this._catchUpTimer = null;
        }
        const token = this._getTrackedToken();
        if (!token) return;
        await this._requestReveal(token.document, this._gridPosition(token.document), { force: true });
        await this._settleToToken(this.trackedTokenId);
    }

    _revealKeys(position) {
        const keys = [];
        const dimensions = this._sceneGridDimensions(canvas?.scene);
        for (let rowOffset = -2; rowOffset <= 2; rowOffset++) {
            for (let columnOffset = -2; columnOffset <= 2; columnOffset++) {
                const column = position.column + columnOffset;
                const row = position.row + rowOffset;
                if (column >= 0 && row >= 0 && column < dimensions.columns && row < dimensions.rows) {
                    keys.push(`${column},${row}`);
                }
            }
        }
        return keys;
    }

    async _requestReveal(
        tokenDocument,
        position = this._gridPosition(tokenDocument),
        { force = false, resetPath = false } = {}
    ) {
        const gridKey = `${position.column},${position.row}`;
        if (!force && gridKey === this.lastGridKey) return;
        this.lastGridKey = gridKey;
        const request = {
            userId: game.user.id,
            sceneId: canvas.scene.id,
            tokenId: tokenDocument.id,
            actorId: tokenDocument.actor?.id ?? tokenDocument.actorId,
            position: { column: position.column, row: position.row },
            coordinates: this._tokenCoordinates(tokenDocument),
            resetPath
        };
        this._outgoingRevealQueue = this._outgoingRevealQueue
            .catch(error => console.error(`${MODULE.NAME}: Failed to send an earlier map step`, error))
            .then(() => game.user.isGM
                ? this._handleRevealRequest(request, { allowLocalGM: true })
                : socketManager.broadcast('mapping', 'reveal-request', request));
        return this._outgoingRevealQueue;
    }

    _handleRevealRequest(data, { allowLocalGM = false } = {}) {
        this._revealProcessingQueue = this._revealProcessingQueue
            .catch(error => console.error(`${MODULE.NAME}: Failed to process an earlier map path`, error))
            .then(() => this._processRevealRequest(data, { allowLocalGM }));
        return this._revealProcessingQueue;
    }

    async _processRevealRequest(data, { allowLocalGM = false } = {}) {
        if (!game.user.isGM || (!allowLocalGM && !game.users.activeGM?.isSelf)) return;
        if (!data || data.sceneId !== canvas?.scene?.id) return;
        const user = game.users.get(data.userId);
        const tokenDocument = canvas.scene.tokens.get(data.tokenId);
        const actor = tokenDocument?.actor;
        if (!user?.active || !tokenDocument || !actor || actor.id !== data.actorId) return;
        if (!user.isGM && !game.settings.get(MODULE.ID, 'mapping.allowPlayers')) return;
        if (!this._canManageActor(actor, user)) return;

        const currentPosition = this._gridPosition(tokenDocument);
        const currentCoordinates = this._tokenCoordinates(tokenDocument);
        // Retain the endpoint captured by its update hook even if a later move
        // happens while an earlier path is still being drawn. A local GM is
        // authoritative. A remote endpoint is accepted only when the GM saw
        // that token at the same pixel coordinates in its bounded movement
        // history; grid identity alone is insufficient when a wall crosses a
        // token's square.
        const reportedPosition = this._normalizePosition(data.position);
        const reportedCoordinates = this._normalizeCoordinates(data.coordinates);
        const trustedState = allowLocalGM
            ? {
                position: reportedPosition ?? currentPosition,
                coordinates: reportedCoordinates ?? currentCoordinates
            }
            : this._trustedReportedState(
                data.sceneId,
                data.tokenId,
                reportedPosition,
                reportedCoordinates,
                currentPosition,
                currentCoordinates
            );
        const position = trustedState?.position ?? currentPosition;
        const coordinates = trustedState?.coordinates ?? currentCoordinates;
        if (!coordinates) return;
        const id = this._recordId(actor.id, canvas.scene.id);
        if (this._isTombstoned(id)) return;
        const existing = this.records.get(id) ?? this._newRecord(actor, canvas.scene);
        const sessionKey = `${data.userId}:${data.sceneId}:${data.tokenId}`;
        const authoritative = this._authoritativePositions.get(sessionKey);
        const previous = data.resetPath
            ? position
            : (authoritative?.mapId === id ? authoritative.position : existing.lastPosition) ?? position;
        const previousCoordinates = data.resetPath
            ? coordinates
            : (authoritative?.mapId === id ? authoritative.coordinates : null) ?? coordinates;
        const path = gridTravelPath(previous, position);
        this._authoritativePositions.set(sessionKey, { mapId: id, position, coordinates });
        const explored = new Set(existing.explored);
        let observedSourcesAlongPath = {};

        for (let index = 0; index < path.length; index++) {
            const step = path[index];
            const amount = path.length > 1 ? index / (path.length - 1) : 1;
            const sampleCoordinates = this._interpolateCoordinates(previousCoordinates, coordinates, amount);
            const sampleToken = this._tokenAtCoordinates(tokenDocument, sampleCoordinates);
            const revealKeys = visibleRevealKeys(sampleToken, this._revealKeys(step));
            // A wall can cross the same Foundry grid square as the token. The
            // cell-center ray may therefore hit that wall even though the token
            // is standing in the square, so the occupied square is always known.
            revealKeys.add(`${step.column},${step.row}`);
            for (const key of revealKeys) explored.add(key);
            const observed = observeVisibleFeatures(sampleToken, revealKeys);
            observedSourcesAlongPath = mergeFeatureSources(
                observedSourcesAlongPath,
                observed.sources
            );

            // Very long drags are intentionally allowed to lag like a person
            // catching up on a paper map, but yield periodically so Foundry's
            // UI and socket processing remain responsive.
            if (index > 0 && index % 8 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        const crossedSecretDoors = observeCrossedSecretDoors(
            tokenDocument,
            previousCoordinates,
            coordinates,
            explored
        );
        observedSourcesAlongPath = mergeFeatureSources(
            observedSourcesAlongPath,
            crossedSecretDoors.sources
        );

        // A map annotation can be placed while a long movement path is still
        // catching up. Rebase the completed reveal onto the latest record so
        // that delayed linework cannot overwrite a newly placed symbol or a
        // concurrent rename.
        const latest = this.records.get(id) ?? existing;
        const combinedExplored = new Set([...(latest.explored ?? []), ...explored]);
        const featureSources = mergeFeatureSources(latest.featureSources, observedSourcesAlongPath);
        const incomingFeatures = flattenFeatureSources(observedSourcesAlongPath);
        let features = subtractFeatureSources(latest.features, latest.featureSources);
        // Records from builds before source tracking contain unattributed
        // geometry. Re-observing the area lets the current source-aware set
        // replace an opposing provisional edge and progressively repairs the
        // old map without requiring a reset.
        features = mergeSourceFeatures(features, incomingFeatures);
        features = mergeFeatures(features, flattenFeatureSources(featureSources));
        const dimensions = this._sceneGridDimensions(canvas.scene);
        const next = {
            ...latest,
            columns: dimensions.columns,
            rows: dimensions.rows,
            explored: [...combinedExplored],
            features,
            featureSources,
            lastPosition: position,
            createdAt: latest.createdAt || Date.now(),
            updatedAt: Date.now(),
            updatedBy: data.userId
        };
        this.records.set(id, next);
        this.currentMapId = id;
        this.state = next;
        void this.renderWindow();
        await this._persistSceneRecords(canvas.scene.id);
    }

    _canManageActor(actor, user = game.user) {
        if (!user) return false;
        if (user.isGM) return true;
        if (!actor) return false;
        return actor.testUserPermission(user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
    }

    canManageRecord(record = this.state, user = game.user) {
        if (!record?.actorId) return false;
        return this._canManageActor(game.actors?.get(record.actorId), user);
    }

    /** Whether a map this user could record into already exists on this scene. */
    hasManageableMapForCurrentScene() {
        const sceneId = canvas?.scene?.id;
        if (!sceneId) return false;
        for (const record of this.records.values()) {
            if (record.sceneId === sceneId && this.canManageRecord(record)) return true;
        }
        return false;
    }

    canRecordCurrentMap() {
        const token = this._getSingleControlledToken();
        return Boolean(token && this._isSquareGrid() && this._canManageActor(token.actor));
    }

    async createMapForSelection() {
        const token = this._getSingleControlledToken();
        if (!token || !this._isSquareGrid()) {
            notify(game.i18n.localize(`${MODULE.ID}.mapping.selectTokenTitle`), {
                subtitle: game.i18n.localize(`${MODULE.ID}.mapping.selectTokenHint`), type: 'warn'
            });
            return false;
        }
        if (!this._canManageActor(token.actor)) {
            notify(game.i18n.localize(`${MODULE.ID}.mapping.notOwnerTitle`), { type: 'warn' });
            return false;
        }
        this.trackedTokenId = token.id;
        this._selectMapForToken(token);
        if (!this.records.has(this.currentMapId)) {
            await this._requestMutation({ action: 'create', actorId: token.actor.id, sceneId: canvas.scene.id });
        }
        this.window?.showMap?.();
        await this.renderWindow();
        await new Promise(resolve => requestAnimationFrame(resolve));
        this.window?.centerOnMap?.();
        return true;
    }

    async renameMap(mapId) {
        const record = this.records.get(mapId);
        if (!record || !this.canManageRecord(record)) return false;
        const result = await foundry.applications.api.DialogV2.input({
            window: { title: game.i18n.localize(`${MODULE.ID}.mapping.renameTitle`) },
            content: `<div class="form-group"><label>${foundry.utils.escapeHTML(game.i18n.localize(`${MODULE.ID}.mapping.mapName`))}</label><div class="form-fields"><input type="text" name="name" value="${foundry.utils.escapeHTML(record.name)}" required></div></div>`,
            ok: { label: game.i18n.localize(`${MODULE.ID}.mapping.rename`) },
            rejectClose: false,
            modal: true
        });
        const name = String(result?.name ?? '').trim();
        if (!name || name === record.name) return false;
        await this._requestMutation({ action: 'rename', mapId, name });
        return true;
    }

    async deleteMap(mapId) {
        const record = this.records.get(mapId);
        if (!record || !this.canManageRecord(record)) return false;
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize(`${MODULE.ID}.mapping.deleteTitle`) },
            content: `<p>${foundry.utils.escapeHTML(game.i18n.format(`${MODULE.ID}.mapping.deleteConfirm`, { name: record.name }))}</p>`,
            rejectClose: false,
            modal: true
        });
        if (!confirmed) return false;
        if (this.active && mapId === this.currentMapId) await this.stopMapping();
        await this._requestMutation({
            action: 'delete',
            mapId,
            actorId: record.actorId,
            sceneId: record.sceneId
        });
        if (!game.user.isGM) {
            this._removeMapRecordLocally(record);
            await this.renderWindow();
        }
        return true;
    }

    async resetMap() {
        const record = this.records.get(this.currentMapId);
        if (!record || !this.canManageRecord(record)) return false;
        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize(`${MODULE.ID}.mapping.resetTitle`) },
            content: `<p>${foundry.utils.escapeHTML(game.i18n.localize(`${MODULE.ID}.mapping.resetConfirm`))}</p>`,
            rejectClose: false,
            modal: true
        });
        if (!confirmed) return false;
        await this._requestMutation({ action: 'reset', mapId: record.id });
        return true;
    }

    async placeMapSymbol(type, column, row) {
        if (!MAPPING_SYMBOL_TYPES.has(type)) return false;
        const record = this.records.get(this.currentMapId);
        const cellKey = `${Number(column)},${Number(row)}`;
        if (!record || !record.explored.includes(cellKey) || !this.canManageRecord(record)) return false;
        await this._requestMutation({
            action: 'place-symbol',
            mapId: record.id,
            type,
            column: Number(column),
            row: Number(row)
        });
        return true;
    }

    async removeMapSymbol(column, row) {
        const record = this.records.get(this.currentMapId);
        if (!record || !this.canManageRecord(record)) return false;
        await this._requestMutation({
            action: 'remove-symbol',
            mapId: record.id,
            column: Number(column),
            row: Number(row)
        });
        return true;
    }

    async setFloorType(type, column, row) {
        if (!MAPPING_FLOOR_TYPE_IDS.has(type)) return false;
        const record = this.records.get(this.currentMapId);
        const cellKey = `${Number(column)},${Number(row)}`;
        if (!record || !record.explored.includes(cellKey) || !this.canManageRecord(record)) return false;
        await this._requestMutation({
            action: 'set-floor',
            mapId: record.id,
            type,
            column: Number(column),
            row: Number(row)
        });
        return true;
    }

    getFloorType(column, row) {
        return this.state.floors?.[`${Number(column)},${Number(row)}`] ?? 'default';
    }

    hasMapSymbol(column, row) {
        return this.state.symbols.some(symbol => symbol.column === Number(column) && symbol.row === Number(row));
    }

    async _requestMutation(mutation) {
        const data = { ...mutation, userId: game.user.id };
        if (data.action === 'create' && data.actorId && data.sceneId) {
            this._deletedMapIds.delete(this._recordId(data.actorId, data.sceneId));
        }
        if (game.user.isGM) await this._handleMutationRequest(data, { allowLocalGM: true });
        else await socketManager.broadcast('mapping', 'mutation-request', data);
    }

    _handleMutationRequest(data, { allowLocalGM = false } = {}) {
        this._revealProcessingQueue = this._revealProcessingQueue
            .catch(error => console.error(`${MODULE.NAME}: Failed to process an earlier map operation`, error))
            .then(() => this._processMutationRequest(data, { allowLocalGM }));
        return this._revealProcessingQueue;
    }

    async _processMutationRequest(data, { allowLocalGM = false } = {}) {
        if (!game.user.isGM || (!allowLocalGM && !game.users.activeGM?.isSelf) || !data) return;
        const user = game.users.get(data.userId);
        if (!user?.active) return;

        let record = data.mapId ? this.records.get(data.mapId) : null;
        if (data.action === 'delete') {
            const actorId = String(data.actorId ?? record?.actorId ?? '');
            const sceneId = String(data.sceneId ?? record?.sceneId ?? '');
            const actor = game.actors?.get(actorId);
            if (!actorId || !sceneId || data.mapId !== this._recordId(actorId, sceneId)) return;
            if (!this._canManageActor(actor, user)) return;
            record ??= this._normalizeRecord(
                game.scenes?.get(sceneId)?.getFlag(MODULE.ID, FLAG_KEY)?.maps?.[actorId],
                game.scenes?.get(sceneId)
            );
            this._removeMapRecordLocally(record.id ? record : {
                id: data.mapId,
                actorId,
                sceneId
            });
            void this.renderWindow();
            await this._persistMapDeletion(sceneId, actorId);
            return;
        }

        if (data.action === 'create') {
            if (data.sceneId !== canvas?.scene?.id) return;
            const actor = game.actors?.get(data.actorId) ?? canvas.tokens?.placeables
                ?.find(token => token.actor?.id === data.actorId)?.actor;
            if (!this._canManageActor(actor, user)) return;
            const id = this._recordId(actor.id, data.sceneId);
            this._deletedMapIds.delete(id);
            record = this.records.get(id) ?? this._newRecord(actor, canvas.scene);
            const now = Date.now();
            record = { ...record, createdAt: record.createdAt || now, updatedAt: now, updatedBy: user.id };
            this.records.set(id, record);
            if (this.currentMapId === id) this.state = record;
            void this.renderWindow();
            await this._persistSceneRecords(data.sceneId);
            return;
        }

        if (!record || !this._canManageActor(game.actors?.get(record.actorId), user)) return;
        if (data.action === 'rename') {
            const name = String(data.name ?? '').trim().slice(0, 100);
            if (!name) return;
            record = { ...record, name, updatedAt: Date.now(), updatedBy: user.id };
            this.records.set(record.id, record);
        } else if (data.action === 'place-symbol') {
            const type = String(data.type ?? '');
            const column = Number(data.column);
            const row = Number(data.row);
            const cellKey = `${column},${row}`;
            if (!MAPPING_SYMBOL_TYPES.has(type)
                || !Number.isInteger(column)
                || !Number.isInteger(row)
                || !record.explored.includes(cellKey)) return;
            const symbols = this._normalizeSymbols(record.symbols)
                .filter(symbol => symbol.column !== column || symbol.row !== row);
            symbols.push({
                id: foundry.utils.randomID(),
                type,
                column,
                row,
                createdAt: Date.now(),
                createdBy: user.id
            });
            record = { ...record, symbols, updatedAt: Date.now(), updatedBy: user.id };
            this.records.set(record.id, record);
        } else if (data.action === 'remove-symbol') {
            const column = Number(data.column);
            const row = Number(data.row);
            if (!Number.isInteger(column) || !Number.isInteger(row)) return;
            const symbols = this._normalizeSymbols(record.symbols)
                .filter(symbol => symbol.column !== column || symbol.row !== row);
            record = { ...record, symbols, updatedAt: Date.now(), updatedBy: user.id };
            this.records.set(record.id, record);
        } else if (data.action === 'set-floor') {
            const type = String(data.type ?? '');
            const column = Number(data.column);
            const row = Number(data.row);
            const cellKey = `${column},${row}`;
            if (!MAPPING_FLOOR_TYPE_IDS.has(type)
                || !Number.isInteger(column)
                || !Number.isInteger(row)
                || !record.explored.includes(cellKey)) return;
            // One click surfaces the whole room. The region comes from the
            // party's own record, so it can never spread past a boundary they
            // have not discovered.
            const region = contiguousFloorRegion(
                new Set(record.explored),
                record.features,
                { column, row }
            );
            const floors = { ...this._normalizeFloors(record.floors) };
            for (const key of region) {
                if (type === 'default') delete floors[key];
                else floors[key] = type;
            }
            record = { ...record, floors, updatedAt: Date.now(), updatedBy: user.id };
            this.records.set(record.id, record);
        } else if (data.action === 'reset') {
            record = {
                ...record,
                explored: [],
                features: {},
                featureSources: {},
                symbols: [],
                floors: {},
                lastPosition: null,
                updatedAt: Date.now(),
                updatedBy: user.id
            };
            this.records.set(record.id, record);
        } else return;

        if (this.currentMapId === record.id) {
            this.state = record;
        }
        if (data.action === 'reset') {
            for (const [key, value] of this._authoritativePositions) {
                if (value.mapId === record.id) this._authoritativePositions.delete(key);
            }
        }
        void this.renderWindow();
        await this._persistSceneRecords(record.sceneId);
        if (data.action === 'reset') notify(game.i18n.localize(`${MODULE.ID}.mapping.resetDone`), { type: 'info' });
    }

    _isTombstoned(id) {
        const expiry = this._deletedMapIds.get(id);
        if (expiry === undefined) return false;
        if (expiry > Date.now()) return true;
        this._deletedMapIds.delete(id);
        return false;
    }

    _removeMapRecordLocally(record) {
        if (!record?.id) return;
        this._deletedMapIds.set(record.id, Date.now() + DELETE_TOMBSTONE_MS);
        this.records.delete(record.id);
        for (const [key, value] of this._authoritativePositions) {
            if (value.mapId === record.id) this._authoritativePositions.delete(key);
        }
        if (this.currentMapId !== record.id) return;
        this.currentMapId = null;
        this.state = this._emptyRecord();
    }

    /**
     * Write the map container to a Scene flag.
     *
     * Document#setFlag is update({flags: {scope: {key: value}}}), and document
     * updates merge recursively. A container whose `maps` object is simply
     * missing an Actor key therefore reads as "no change to that key", not as
     * a deletion, so a removed map survives in the database and returns on
     * reload. The "==" prefix forces replacement of the whole flag instead of
     * merging into it, which is the only way a removal actually persists.
     */
    async _writeSceneContainer(scene, container) {
        await scene.update({
            [`flags.${MODULE.ID}.==${FLAG_KEY}`]: container
        });
    }

    async _persistMapDeletion(sceneId, actorId) {
        const scene = game.scenes?.get(sceneId);
        if (!scene || !game.user.isGM) return;
        this._saveQueue = this._saveQueue
            .then(async () => {
                const stored = scene.getFlag(MODULE.ID, FLAG_KEY);
                const maps = Number(stored?.version) >= STATE_VERSION && stored?.maps
                    ? foundry.utils.deepClone(stored.maps)
                    : {};
                delete maps[actorId];
                const container = { version: STATE_VERSION, maps };
                await this._writeSceneContainer(scene, container);
                await socketManager.broadcast('mapping', 'registry-updated', {
                    userId: game.user.id,
                    sceneId,
                    container
                });
            })
            .catch(error => console.error(`${MODULE.NAME}: Failed to delete the stored map`, error));
        return this._saveQueue;
    }

    async _persistSceneRecords(sceneId) {
        const scene = game.scenes?.get(sceneId);
        if (!scene || !game.user.isGM) return;
        const maps = {};
        for (const record of this.records.values()) {
            if (record.sceneId === sceneId) maps[record.actorId] = foundry.utils.deepClone(record);
        }
        const container = { version: STATE_VERSION, maps };
        this._saveQueue = this._saveQueue
            .then(() => this._writeSceneContainer(scene, container))
            .then(() => socketManager.broadcast('mapping', 'registry-updated', {
                userId: game.user.id,
                sceneId,
                container
            }))
            .catch(error => console.error(`${MODULE.NAME}: Failed to persist mapping records`, error));
        return this._saveQueue;
    }

    _handleRegistryUpdated(data) {
        const scene = game.scenes?.get(data?.sceneId);
        if (!scene || !data.container) return;
        this._replaceSceneRecords(scene, data.container);
        if (!this.currentMapId) {
            const latest = this.getMapList()[0];
            if (latest) this.selectMap(latest.id, { render: false });
        }
        void this.renderWindow();
    }
}

const mappingManager = new MappingManager();
export { mappingManager, WINDOW_ID };

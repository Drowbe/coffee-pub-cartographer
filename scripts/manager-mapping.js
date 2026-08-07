// ==================================================================
// ===== MAPPING TOOL MANAGER =======================================
// ==================================================================

import { MODULE } from './const.js';
import { cartographerToolbar } from './manager-toolbar.js';
import { socketManager } from './manager-sockets.js';
import {
    contiguousFloorRegion,
    gridTravelPath,
    propagateFloors,
    visibleRevealKeys
} from './utils-mapping.js';
import { buildSceneAtlas, EMPTY_ATLAS, secretsCrossedBy } from './atlas-mapping.js';
import { notify } from './utils-toast.js';
import {
    MAPPING_ANNOTATED_SYMBOLS,
    MAPPING_FLOOR_TYPE_IDS,
    MAPPING_SYMBOL_TEXT_LIMIT,
    MAPPING_SYMBOL_TYPES
} from './symbols-mapping.js';

const FLAG_KEY = 'mapping';
const TOOL_ID = `${MODULE.ID}-mapping`;
const WINDOW_ID = `${MODULE.ID}-mapper`;
/**
 * A record holds only what is genuinely the party's: where they have been, what
 * they found, and what they wrote on it. The scene's architecture is settled
 * from the walls themselves and never stored.
 */
const STATE_VERSION = 3;
/** How long an optimistic local deletion suppresses a map before it is reconciled. */
const DELETE_TOMBSTONE_MS = 15000;
/** The mutually exclusive states the mapper can be in. */
const MAPPING_MODES = ['view', 'follow', 'record'];
/** Mutations any party member may make, rather than only the Actor's owner. */
const ANNOTATION_ACTIONS = ['place-symbol', 'remove-symbol'];
const MENUBAR_TOOL_ID = `${MODULE.ID}-mapping-menubar`;
/** How still a token must be before its move is reported, in milliseconds. */
const MOVE_SETTLE_MS = 220;
// How long the marker will wait for the map to confirm a move before giving up
// and showing itself at whatever the map does know.
const PENDING_REVEAL_TIMEOUT_MS = 8000;

/** Compact "column,row" for diagnostic output. */
function formatCell(position) {
    return position ? `${position.column},${position.row}` : '-';
}

class MappingManager {
    constructor() {
        this.services = null;
        // Exactly one mode is in effect at a time: 'view', 'follow' or
        // 'record'. `active` and `following` read from it so the rest of the
        // manager can keep asking the question it cares about.
        this.mode = 'view';
        this.paused = false;
        this._unexploredPromptSuppressed = false;
        this._unexploredPromptOpen = false;
        this.trackedTokenId = null;
        this.currentMapId = null;
        this.lastGridKey = null;
        this.state = this._emptyRecord();
        this.records = new Map();
        this.window = null;
        this._hooks = [];
        this._saveQueue = Promise.resolve();
        this._renderQueue = Promise.resolve();
        this._outgoingRevealQueue = Promise.resolve();
        this._revealProcessingQueue = Promise.resolve();
        // Squares the tracked token has crossed since the last report, in the
        // order it crossed them. Emptied each time a path is sent.
        this._movementPath = [];
        // The Foundry movement currently being collected, and how much of the
        // path belongs to movements before it. See _collectMovement.
        this._movementId = null;
        this._movementCommitted = 0;
        // The square of the route most recently sent. The map has caught up
        // once the record's lastPosition reaches it.
        this._pendingDestination = null;
        this._pendingTimer = null;
        // Map id -> expiry timestamp. A tombstone only has to outlive a
        // registry broadcast that was already in flight when the delete
        // happened; it is cleared as soon as an authoritative container
        // confirms the removal, and expires if the delete never took effect.
        this._deletedMapIds = new Map();
        this._selectionFrame = null;
        this._closingWindow = false;
        this._settleTimer = null;
        // The canonical architecture of the current scene. Derived, never
        // saved, and rebuilt whenever the scene's walls change.
        this.atlas = EMPTY_ATLAS;
        this._atlasFrame = null;
    }

    /**
     * Settle the scene's architecture.
     *
     * Cheap enough to do outright -- one pass over the walls Foundry already
     * holds -- and everything downstream reads it, so it must be current before
     * any reveal is processed or any map is drawn.
     */
    rebuildAtlas() {
        try {
            this.atlas = buildSceneAtlas(canvas?.scene) ?? EMPTY_ATLAS;
        } catch (error) {
            console.error(`${MODULE.NAME}: Failed to read the scene's walls`, error);
            this.atlas = EMPTY_ATLAS;
        }
        this._debug('Mapping | Atlas', [
            `scene=${canvas?.scene?.name ?? '-'}`,
            `edges=${Object.keys(this.atlas.features).length}`,
            `lines=${this.atlas.lines.length}`,
            `secrets=${this.atlas.secrets.length}`
        ].join('  '));
        return this.atlas;
    }

    /**
     * Rebuild once after a burst of wall edits rather than once per wall. A GM
     * dragging a wall emits a great many updates.
     */
    _scheduleAtlasRebuild() {
        if (this._atlasFrame) return;
        this._atlasFrame = requestAnimationFrame(() => {
            this._atlasFrame = null;
            this.rebuildAtlas();
            void this.renderWindow();
        });
    }

    /** True only while recording. */
    get active() {
        return this.mode === 'record';
    }

    /** True only while following without recording. */
    get following() {
        return this.mode === 'follow';
    }

    /**
     * Diagnostic output, gated by Blacksmith's global debug mode rather than a
     * setting of our own. Nothing prints unless that is on.
     */
    _debug(message, result = '') {
        const utils = game.modules.get('coffee-pub-blacksmith')?.api?.utils;
        utils?.postConsoleAndNotification?.(MODULE.NAME, message, result, true, false);
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
            symbols: [],
            floors: {},
            // Secret doors this party has walked through. The atlas draws every
            // secret as ordinary wall until its id appears here.
            secrets: [],
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
        this.rebuildAtlas();
        this.loadMapRecords();
        this.refreshMenubarTool();
        console.log(`${MODULE.NAME}: Mapping tool initialized`);
    }

    cleanup() {
        if (this._settleTimer) clearTimeout(this._settleTimer);
        this._settleTimer = null;
        for (const hook of this._hooks) Hooks.off(hook.name, hook.id);
        this._hooks = [];
        this.mode = 'view';
        this.paused = false;
        this.trackedTokenId = null;
        this.currentMapId = null;
        this.lastGridKey = null;
        this._resetMovementPath();
        this._deletedMapIds.clear();
        if (this._selectionFrame) cancelAnimationFrame(this._selectionFrame);
        this._selectionFrame = null;
        if (this._atlasFrame) cancelAnimationFrame(this._atlasFrame);
        this._atlasFrame = null;
        this.atlas = EMPTY_ATLAS;
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

    /**
     * A left-zone menubar button for the mapper.
     *
     * Its purpose is to make recording independent of the window: left-click
     * opens the map, right-click starts or stops recording, and the icon
     * reports which mode is running. That is what lets a user close the map and
     * keep mapping, so it is also what decides whether closing the window has
     * to stop recording.
     */
    get menubarEnabled() {
        try {
            return game.settings.get(MODULE.ID, 'mapping.menubarButton') === true;
        } catch {
            return false;
        }
    }

    _menubarAppearance() {
        if (this.paused) {
            return { icon: 'fa-solid fa-circle-pause', color: '#e8a34a' };
        }
        if (this.active) {
            return { icon: 'fa-solid fa-circle-dot', color: '#c9412d' };
        }
        return { icon: 'fa-solid fa-map', color: null };
    }

    refreshMenubarTool() {
        const api = game.modules.get('coffee-pub-blacksmith')?.api;
        if (typeof api?.registerMenubarTool !== 'function') return;
        // There is no update-in-place for a tool's icon, so the button is
        // replaced. Mode changes are user-driven and rare, so this is cheap.
        api.unregisterMenubarTool?.(MENUBAR_TOOL_ID);
        if (!this.menubarEnabled || !game.settings.get(MODULE.ID, 'mapping.enabled')) return;

        const appearance = this._menubarAppearance();
        api.registerMenubarTool(MENUBAR_TOOL_ID, {
            icon: appearance.icon,
            iconColor: appearance.color,
            name: 'cartographer-mapping',
            // Icon only. Omitting the title is not enough: it falls back to the
            // tool name, which is what put "cartographer-mapping" on the bar.
            title: '',
            tooltip: game.i18n.localize(`${MODULE.ID}.mapping.menubarTooltip`),
            zone: 'left',
            // "general" is forced to the last group slot, so the button sits at
            // the end of the zone rather than ahead of the existing tools.
            group: 'general',
            order: 999,
            moduleId: MODULE.ID,
            gmOnly: false,
            visible: true,
            onClick: () => void this.openWindow(),
            contextMenuItems: () => this._menubarMenuItems()
        });
    }

    _menubarMenuItems() {
        const localize = key => game.i18n.localize(`${MODULE.ID}.mapping.${key}`);
        const items = [{
            name: localize('openMap'),
            icon: 'fa-solid fa-map',
            callback: () => void this.openWindow()
        }, { separator: true }];
        if (this.active) {
            items.push({
                name: localize('stopRecording'),
                icon: 'fa-solid fa-stop',
                callback: () => void this.setMode('view')
            });
        } else {
            items.push({
                name: localize('startRecording'),
                icon: 'fa-solid fa-circle',
                callback: () => void this.setMode('record')
            });
        }
        return items;
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
            if (tokenDocument.id !== this.trackedTokenId) return;
            const moved = ('x' in changes) || ('y' in changes);
            const visionChanged = ('rotation' in changes) || ('sight' in changes);
            if (!moved && !visionChanged) return;
            // Read the move from the change set rather than the document, which
            // need not have settled to the new coordinates yet.
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
            const movement = operation?._movement?.[tokenDocument.id] ?? operation?.movement;

            if (moved) {
                // A completed step re-arms centred following, so a manual pan
                // is respected only until the party moves again.
                this.window?.armFollow();
                // Foundry reports the real route it took. Collect it rather
                // than letting the far end guess a straight line between where
                // the token was and where it ended up -- that guess cut corners
                // and walked through walls.
                this._collectMovement(movementDocument, movement);
                this._scheduleSettledReveal(tokenDocument.id);
                return;
            }
            // Vision changed without moving: re-sample where the token stands.
            void this._requestReveal(tokenDocument, [position], {
                force: visionChanged
            }).catch(error => {
                console.error(`${MODULE.NAME}: Failed to update the map for token vision`, error);
            });
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
            this._resetMovementPath();
            this.rebuildAtlas();
            this.loadMapRecords();
            const selected = this._getSingleControlledToken();
            if (selected) this._selectMapForToken(selected);
            void this.renderWindow();
        });
        this._hooks.push({ name: 'canvasReady', id: canvasReady });

        // The architecture is read from the walls, so editing one simply
        // changes the map. There is nothing to retract and nothing to
        // reconcile: the next atlas is the truth.
        for (const hookName of ['createWall', 'updateWall', 'deleteWall']) {
            const hookId = Hooks.on(hookName, () => this._scheduleAtlasRebuild());
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
        const incoming = new Map();
        if (Number(raw?.version) >= STATE_VERSION && raw.maps && typeof raw.maps === 'object') {
            for (const value of Object.values(raw.maps)) {
                const record = this._normalizeRecord(value, scene);
                if (record.id) incoming.set(record.id, record);
            }
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
            if (current) {
                // How far the drawing has got, which is what clears the
                // mapping spinner. Logging every change shows the map falling
                // behind the marker, and by how much.
                const before = this._normalizePosition(this.state.lastPosition);
                const after = this._normalizePosition(current.lastPosition);
                if (formatCell(before) !== formatCell(after)) {
                    this._debug(
                        'Mapping | Mapped',
                        `${formatCell(before)} -> ${formatCell(after)}  updatedBy=${current.updatedBy ?? '-'}`
                    );
                }
                this.state = current;
            }
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
            symbols: this._normalizeSymbols(raw.symbols),
            floors: this._normalizeFloors(raw.floors),
            secrets: Array.isArray(raw.secrets)
                ? [...new Set(raw.secrets.filter(id => typeof id === 'string' && id))]
                : [],
            lastPosition: this._normalizePosition(raw.lastPosition),
            createdAt: Number(raw.createdAt) || Number(raw.updatedAt) || 0,
            updatedAt: Number(raw.updatedAt) || 0,
            updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : null
        };
    }

    _newRecord(actor, scene) {
        const record = this._emptyRecord({ actor, scene });
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

    /**
     * Switch between the three mutually exclusive modes. Recording is the only
     * one that has to be entered through its own checks, so it delegates and
     * leaves the mode alone if those refuse.
     */
    async setMode(next) {
        if (!MAPPING_MODES.includes(next) || next === this.mode) return this.mode;
        if (this.mode === 'record') await this.stopMapping({ closeWindow: false });
        if (next === 'record') {
            // startMapping explains its own refusals, so stay put on failure
            // rather than reporting a switch that did not happen.
            if (await this.startMapping()) this._announceMode();
            return this.mode;
        }

        this.mode = next;
        this._unexploredPromptSuppressed = false;
        if (next === 'follow') {
            this.trackedTokenId = this._getSingleControlledToken()?.id ?? this.trackedTokenId;
        }
        await this.renderWindow({ centerOnParty: next === 'follow' });
        this._announceMode();
        return this.mode;
    }

    _announceMode() {
        this.refreshMenubarTool();
        const key = { view: 'statusViewing', follow: 'statusFollowing', record: 'statusActive' }[this.mode];
        if (key) notify(game.i18n.localize(`${MODULE.ID}.mapping.${key}`), { type: 'info' });
    }

    async toggleRecording() {
        return this.setMode(this.active ? 'view' : 'record');
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

        this.mode = 'record';
        this.paused = false;
        this.trackedTokenId = token.id;
        this.lastGridKey = null;
        // Recording starts from where the token stands, not from whatever
        // route it walked before anyone was recording it.
        this._resetMovementPath();
        this._selectMapForToken(token);
        const startPosition = this._gridPosition(token.document);
        await this._requestMutation({
            action: 'create',
            actorId: token.actor.id,
            sceneId: canvas.scene.id,
            // Carry the starting square. Without it the create broadcasts the
            // record's stored lastPosition -- wherever recording last stopped,
            // possibly in another session -- and the marker appears there until
            // the first reveal corrects it.
            position: startPosition,
            // Distinguishes starting a recording from merely adding a map, so
            // the GM can be told about the former.
            recording: true
        });
        this.state = { ...this.state, lastPosition: startPosition };
        await this.openWindow();
        this.window?.showMap?.();
        this.window?.armFollow();
        await this._requestReveal(token.document, [startPosition], { force: true });
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
        this.mode = 'view';
        this.paused = false;
        this.lastGridKey = null;
        this.trackedTokenId = this._getSingleControlledToken()?.id ?? null;
        this.refreshMenubarTool();
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
        if (this._closingWindow || !this.active) return;
        // With the menubar button available there is still a way to stop, so
        // closing the map leaves recording running rather than ending the
        // session. Without it, the window is the only control and closing it
        // has to stop.
        if (!this.menubarEnabled) {
            await this.stopMapping({ closeWindow: false });
            return;
        }
        this.refreshMenubarTool();
        notify(game.i18n.localize(`${MODULE.ID}.mapping.recordingContinues`), {
            subtitle: game.i18n.localize(`${MODULE.ID}.mapping.recordingContinuesHint`),
            type: 'info'
        });
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
        // A move can still be settling when the token is deselected. Report the
        // route collected so far rather than discarding it on the way out.
        await this._flushCatchUp().catch(error => {
            console.error(`${MODULE.NAME}: Failed to finish the map path before pausing`, error);
        });
        this.paused = true;
        this.lastGridKey = null;
        this.refreshMenubarTool();
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
        // Movement while paused was deliberately not recorded, so the route
        // resumes from here rather than bridging across the gap.
        this._resetMovementPath();
        this.refreshMenubarTool();
        this.window?.armFollow();
        await this._requestReveal(token.document, [this._gridPosition(token.document)], { force: true });
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

    /**
     * Where to draw the party marker.
     *
     * While recording it is the square the map has been confirmed to reach --
     * and the marker is *hidden* until that confirmation arrives, rather than
     * shown somewhere provisional. A marker that guesses can guess wrong, and
     * a wrong square is worse than no square: it is the one thing on the map
     * that has to be right. Hidden-then-correct never lies, and never appears
     * to jump, because nothing was on screen to jump from.
     *
     * Following has no record to be faithful to, so it tracks the token
     * directly and stays smooth.
     */
    getTrackedPositionForCurrentMap() {
        const token = this._getTrackedToken();
        if (!token || !this._isSquareGrid()) return null;
        if (this.active) {
            if (this._mapIdForToken(token) !== this.currentMapId) return null;
            return this._normalizePosition(this.state.lastPosition) ?? this._gridPosition(token.document);
        }
        return this.following ? this._gridPosition(token.document) : null;
    }

    /**
     * True from the first sign of movement until the map confirms where it
     * ended. The marker is hidden for this whole interval, so it is never
     * drawn on a square the map has not agreed to.
     */
    get tokenInTransit() {
        return this.active && !this.paused && (Boolean(this._settleTimer) || this.mappingPending);
    }

    /**
     * True from the moment a route is sent until the map comes back with it.
     *
     * Measured against the record rather than a callback, so it clears however
     * the answer arrives -- locally on a GM, or over the scene flag on a
     * player -- and cannot get stuck if a reply is lost.
     */
    get mappingPending() {
        if (!this.active || !this._pendingDestination) return false;
        const mapped = this._normalizePosition(this.state.lastPosition);
        return mapped?.column !== this._pendingDestination.column
            || mapped?.row !== this._pendingDestination.row;
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
                // Additive: symbols written before notes existed simply have none.
                text: String(symbol.text ?? '').trim().slice(0, MAPPING_SYMBOL_TEXT_LIMIT),
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

    _normalizeCoordinates(coordinates) {
        const x = Number(coordinates?.x);
        const y = Number(coordinates?.y);
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
    }

    /**
     * Where a token of this size sits when it occupies a given square.
     *
     * Sampling always happens from the middle of an occupied square rather
     * than from wherever the token happens to be standing. The map is a grid
     * of squares, so this is the honest reading, and it keeps a token that
     * stopped half in a doorway from producing a sightline no square on the
     * map corresponds to.
     */
    _squareCoordinates(square, tokenDocument) {
        const sizeX = canvas.grid.sizeX ?? canvas.grid.size;
        const sizeY = canvas.grid.sizeY ?? canvas.grid.size;
        const center = canvas.grid.getCenterPoint({ i: square.row, j: square.column });
        return {
            x: center.x - (((tokenDocument.width ?? 1) * sizeX) / 2),
            y: center.y - (((tokenDocument.height ?? 1) * sizeY) / 2)
        };
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

    /** Forget the route collected so far and start a fresh one. */
    _resetMovementPath() {
        this._movementPath = [];
        this._movementId = null;
        this._movementCommitted = 0;
        this._pendingDestination = null;
        if (this._pendingTimer) clearTimeout(this._pendingTimer);
        this._pendingTimer = null;
    }

    /** A movement action that crosses nothing between its endpoints. */
    _isTeleportAction(action) {
        return CONFIG.Token.movement.actions[action]?.teleport === true;
    }

    /**
     * Collect the squares a token actually travelled through.
     *
     * Foundry reports the waypoints of the route it took. Each leg between two
     * consecutive waypoints is a straight line, so filling in the squares of a
     * leg is exact -- it is only applying that fill to a whole cornered move at
     * once that invents a diagonal through the walls, which is what the far end
     * used to have to do with nothing but a destination to go on.
     *
     * `passed.waypoints` is cumulative: every update during one movement
     * restates the route so far. So the current movement's squares are
     * *replaced* each time rather than appended, and only a change of movement
     * id commits them. Appending would read as the token doubling back over
     * ground it had already covered.
     */
    _collectMovement(tokenDocument, movement) {
        if (!this._isSquareGrid()) return;
        const movementId = movement?.id ?? null;
        if (movementId !== this._movementId) {
            // A new movement starts where the last one ended, so everything
            // collected up to now is final.
            this._movementId = movementId;
            this._movementCommitted = this._movementPath.length;
        }
        this._movementPath.length = Math.min(this._movementCommitted, this._movementPath.length);

        const squares = [];
        const push = square => {
            const previous = squares.at(-1) ?? this._movementPath.at(-1);
            if (previous && previous.column === square.column && previous.row === square.row) return;
            squares.push(square);
        };
        const bridge = (from, to) => {
            if (from) for (const step of gridTravelPath(from, to)) push(step);
            else push(to);
        };

        const destination = this._gridPosition(tokenDocument);
        const waypoints = Array.isArray(movement?.passed?.waypoints) ? movement.passed.waypoints : [];
        let previous = this._movementPath.at(-1) ?? null;
        for (const waypoint of waypoints) {
            const point = this._normalizeCoordinates(waypoint);
            if (!point) continue;
            const square = this._gridPositionAt(point, tokenDocument);
            // A waypoint's action describes how the token got there from the
            // one before it. A teleport crossed nothing, so nothing is filled
            // in behind it.
            if (this._isTeleportAction(waypoint.action)) push(square);
            else bridge(previous, square);
            previous = square;
        }
        // Where this update says the token is outranks whatever the waypoints
        // last claimed: an update can land before the route catches up to it.
        bridge(previous, destination);
        this._movementPath.push(...squares);
    }

    /** Grid square containing a point, for a token of this size. */
    _gridPositionAt(point, tokenDocument) {
        return this._gridPosition({
            x: point.x,
            y: point.y,
            width: tokenDocument.width,
            height: tokenDocument.height,
            id: tokenDocument.id
        });
    }

    /**
     * Report a move once, after the token has stopped moving.
     *
     * Foundry emits updateToken repeatedly while a move plays out -- once per
     * waypoint of a routed path, and again as animation progresses -- and
     * those intermediate squares do not arrive in a tidy forward order.
     * Reporting each one recorded the token going forwards, then back, then
     * forwards again: wrong squares in the map, and a marker that visibly
     * jumped.
     *
     * So each update adds to the collected route and restarts a short timer,
     * and only when the token has been still for that long is the whole route
     * sent as one path. One move, one report, always forwards -- and now with
     * every square the token really crossed, rather than a destination the far
     * end has to guess a route to.
     */
    _scheduleSettledReveal(tokenId) {
        const wasSettled = !this._settleTimer;
        if (this._settleTimer) clearTimeout(this._settleTimer);
        this._settleTimer = setTimeout(() => {
            this._settleTimer = null;
            if (!this.active || this.paused || tokenId !== this.trackedTokenId) return;
            // The token has stopped, so the marker can appear where it stopped.
            this.window?.refreshMarkerState();
            void this._flushMovementPath()
                .then(() => this.renderWindow())
                .catch(error => {
                    console.error(`${MODULE.NAME}: Failed to map token movement`, error);
                });
        }, MOVE_SETTLE_MS);
        // Fade the marker out once, as the move begins, rather than on every
        // update Foundry emits while it plays out.
        if (wasSettled) this.window?.refreshMarkerState();
    }

    /**
     * Send the route collected so far, and start collecting a fresh one.
     *
     * The route is sent exactly as collected. This used to append a fresh read
     * of the token document on the grounds that a move might still be in
     * flight -- and that read could be a square behind, which then landed at
     * the *end* of the route and became the reported destination. A correct
     * route walking down a corridor was being finished off with a step back to
     * where it started.
     *
     * That was the same mistake as the one this whole design removed, left in
     * one place: a separately-read position second-guessing a route Foundry
     * had already reported. The route is built from the change sets of the
     * moves themselves, so it is already current. Only an empty route falls
     * back to reading the token, which is the stop-recording case.
     */
    async _flushMovementPath({ force = true } = {}) {
        const token = this._getTrackedToken();
        if (!token || !this._isSquareGrid()) return;
        const path = this._movementPath;
        this._resetMovementPath();
        if (!path.length) path.push(this._gridPosition(token.document));
        // Watched by mappingPending, so the window can say the map is still
        // being drawn even though the token has already arrived.
        this._pendingDestination = path.at(-1);
        // The marker is hidden while this is outstanding, so it must not be
        // able to stay outstanding. If an answer never comes -- a dropped
        // packet, a GM who dropped out -- give up waiting and show the marker
        // wherever the map did get to, rather than showing nothing all session.
        if (this._pendingTimer) clearTimeout(this._pendingTimer);
        this._pendingTimer = setTimeout(() => {
            this._pendingTimer = null;
            if (!this._pendingDestination) return;
            this._debug('Mapping | Pending timed out', formatCell(this._pendingDestination));
            this._pendingDestination = null;
            void this.renderWindow();
        }, PENDING_REVEAL_TIMEOUT_MS);
        this.window?.refreshMarkerState();
        await this._requestReveal(token.document, path, { force });
    }

    /**
     * Report the token's settled square once, when recording ends.
     *
     * There used to be a timed catch-up after every move as well, re-reading
     * the token a moment later to make sure the map had reached it. That did
     * the opposite: Foundry animates a move, so a sample taken shortly after
     * it starts lands on a square the token is still travelling *through*, and
     * reporting it after the destination is exactly the jump that was being
     * chased.
     *
     * Stopping is different. Movement has finished by then, so the token can
     * be read safely, and it guarantees the final square is recorded even if
     * the last move was still in flight when Stop was pressed.
     */
    async _flushCatchUp() {
        if (this._settleTimer) {
            clearTimeout(this._settleTimer);
            this._settleTimer = null;
        }
        await this._flushMovementPath();
    }

    /**
     * How far from the token the mapper looks, as a radius in squares.
     *
     * Configured as the width of the square window it produces -- 11 reads as
     * "11x11" -- because that is the shape a user sees on the map. A wider
     * window is not only more of the room per step: every boundary it covers is
     * re-examined, so it is also what lets a mistaken reading be corrected from
     * further away.
     */
    _detectionRadius() {
        let size = 11;
        try {
            size = Number(game.settings.get(MODULE.ID, 'mapping.detectionSize'));
        } catch {
            size = 11;
        }
        if (!Number.isFinite(size)) size = 11;
        size = Math.min(15, Math.max(3, Math.round(size)));
        // Only odd sizes centre on the token's own square.
        if (size % 2 === 0) size -= 1;
        return (size - 1) / 2;
    }

    _revealKeys(position) {
        const keys = [];
        const radius = this._detectionRadius();
        const dimensions = this._sceneGridDimensions(canvas?.scene);
        for (let rowOffset = -radius; rowOffset <= radius; rowOffset++) {
            for (let columnOffset = -radius; columnOffset <= radius; columnOffset++) {
                const column = position.column + columnOffset;
                const row = position.row + rowOffset;
                if (column >= 0 && row >= 0 && column < dimensions.columns && row < dimensions.rows) {
                    keys.push(`${column},${row}`);
                }
            }
        }
        return keys;
    }

    /**
     * Send the squares the token crossed, in order, with the coordinates to
     * sample each one from. The receiver walks exactly this and nothing else.
     */
    async _requestReveal(
        tokenDocument,
        path = [this._gridPosition(tokenDocument)],
        { force = false } = {}
    ) {
        const steps = [];
        for (const entry of Array.isArray(path) ? path : [path]) {
            const square = this._normalizePosition(entry);
            if (!square) continue;
            const previous = steps.at(-1);
            if (previous && previous.column === square.column && previous.row === square.row) continue;
            steps.push({ ...square, ...this._squareCoordinates(square, tokenDocument) });
        }
        if (!steps.length) return;
        const destination = steps.at(-1);
        const gridKey = `${destination.column},${destination.row}`;
        // A single-square report of the square already mapped is nothing new.
        // A longer path always is, whatever square it ends on.
        if (!force && steps.length === 1 && gridKey === this.lastGridKey) return;
        this.lastGridKey = gridKey;
        const request = {
            userId: game.user.id,
            sceneId: canvas.scene.id,
            tokenId: tokenDocument.id,
            actorId: tokenDocument.actor?.id ?? tokenDocument.actorId,
            path: steps
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

    /**
     * Validate a reported route.
     *
     * Steps arrive over a socket, so each is checked rather than trusted to be
     * well formed, and a step missing usable coordinates is re-derived from its
     * square. An empty or unusable path falls back to wherever this client sees
     * the token, which is the same single square the old protocol sent.
     */
    _normalizeRevealPath(path, tokenDocument) {
        const steps = [];
        for (const entry of Array.isArray(path) ? path : []) {
            const square = this._normalizePosition(entry);
            if (!square) continue;
            const previous = steps.at(-1);
            if (previous && previous.column === square.column && previous.row === square.row) continue;
            const coordinates = this._normalizeCoordinates(entry)
                ?? this._squareCoordinates(square, tokenDocument);
            steps.push({ ...square, ...coordinates });
        }
        if (steps.length) return steps;
        const square = this._gridPosition(tokenDocument);
        return [{ ...square, ...this._squareCoordinates(square, tokenDocument) }];
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

        // The reporting client is believed about where its own token went and
        // the route it took. Foundry reports that route, so there is nothing to
        // reconstruct; the ownership check above is the guard that matters, and
        // the layout was never secret anyway -- Foundry ships every wall to
        // every client, which is how client-side vision works.
        const path = this._normalizeRevealPath(data.path, tokenDocument);
        if (!path.length) return;
        const position = { column: path.at(-1).column, row: path.at(-1).row };
        const id = this._recordId(actor.id, canvas.scene.id);
        if (this._isTombstoned(id)) return;
        const existing = this.records.get(id) ?? this._newRecord(actor, canvas.scene);
        const explored = new Set(existing.explored);
        const secrets = new Set(existing.secrets ?? []);
        let candidateSquares = 0;
        let visibleSquares = 0;

        for (let index = 0; index < path.length; index++) {
            const step = path[index];
            const sampleToken = this._tokenAtCoordinates(tokenDocument, step);
            const candidates = this._revealKeys(step);
            const revealKeys = visibleRevealKeys(sampleToken, candidates);
            candidateSquares += candidates.length;
            visibleSquares += revealKeys.size;
            // A wall can cross the same square as the token, so the cell-centre
            // ray may hit it even though the token is standing there. The
            // occupied square is therefore always known.
            revealKeys.add(`${step.column},${step.row}`);
            for (const key of revealKeys) explored.add(key);

            // Walking a secret door is how it is found. Tested per leg against
            // the atlas, which already knows where every secret is.
            if (index > 0) {
                for (const secretId of secretsCrossedBy(this.atlas, path[index - 1], path[index])) {
                    secrets.add(secretId);
                }
            }

            // Very long drags are allowed to lag like a person catching up on a
            // paper map, but yield periodically so Foundry stays responsive.
            if (index > 0 && index % 8 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
        }

        // Written as one flat string rather than an object: a console object has
        // to be expanded before any of it can be read, which is useless when the
        // interesting line is one of a dozen.
        const cell = formatCell;
        this._debug('Mapping | Reveal', [
            `by=${game.users.get(data.userId)?.name ?? data.userId}`,
            `from=${cell(path[0])}`,
            `to=${cell(position)}`,
            // Where this client sees the token. It should agree with `to` once
            // the move has landed; a disagreement says one read is stale.
            `here=${cell(this._gridPosition(tokenDocument))}`,
            `route=${path.map(step => cell(step)).join('>')}`,
            `window=${(this._detectionRadius() * 2) + 1}`,
            // blocked=0 across a route that crosses walls means the visibility
            // filter is passing everything and the window is bleeding through.
            `seen=${visibleSquares}/${candidateSquares}`,
            `blocked=${candidateSquares - visibleSquares}`
        ].join('  '));

        // An annotation can be placed while a long route is still catching up,
        // so rebase onto the latest record rather than the one read at the top.
        const latest = this.records.get(id) ?? existing;
        const combinedExplored = new Set([...(latest.explored ?? []), ...explored]);
        for (const secretId of latest.secrets ?? []) secrets.add(secretId);
        // Squares that have just joined an area adopt the surface already chosen
        // for it, so revealing the rest of a room does not leave it half
        // surfaced. New areas stay default until they are named.
        const previouslyExplored = new Set(latest.explored ?? []);
        const floors = propagateFloors(
            combinedExplored,
            this.atlas.features,
            latest.floors,
            [...combinedExplored].filter(key => !previouslyExplored.has(key))
        );
        const dimensions = this._sceneGridDimensions(canvas.scene);
        const next = {
            ...latest,
            columns: dimensions.columns,
            rows: dimensions.rows,
            explored: [...combinedExplored],
            floors,
            secrets: [...secrets],
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

    /**
     * Whether a user may annotate a map with symbols and notes.
     *
     * Deliberately looser than management. Recording is what must stay tied to
     * a token the user owns, because it decides what the party is held to have
     * experienced. Marking up the result is a shared activity: any party member
     * can add or clear a symbol on any map they can see, while renaming,
     * resetting, deleting and surfacing floors stay with the Actor's owner.
     */
    canAnnotateRecord(record = this.state, user = game.user) {
        return Boolean(record?.actorId && user);
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

    /**
     * Map this scene with the selected token.
     *
     * Starts recording rather than only creating the record. Nobody adds a map
     * for a token in order to leave it empty -- it is the first step of mapping
     * with that token, so pressing Record afterwards was a step that only ever
     * had one sensible answer. Recording an already-recorded map moves the
     * session onto the newly chosen token.
     */
    async createMapForSelection() {
        if (this.active) await this.stopMapping({ closeWindow: false });
        // startMapping explains its own refusals, so there is nothing to add.
        if (!await this.startMapping()) return false;
        this._announceMode();
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
        if (!record || !record.explored.includes(cellKey) || !this.canAnnotateRecord(record)) return false;

        let text = '';
        if (MAPPING_ANNOTATED_SYMBOLS.has(type)) {
            const existing = this.state.symbols
                ?.find(symbol => symbol.column === Number(column) && symbol.row === Number(row));
            const result = await foundry.applications.api.DialogV2.input({
                window: { title: game.i18n.localize(`${MODULE.ID}.mapping.noteTitle`) },
                content: `<div class="form-group"><label>${foundry.utils.escapeHTML(game.i18n.localize(`${MODULE.ID}.mapping.noteText`))}</label><div class="form-fields"><input type="text" name="text" maxlength="${MAPPING_SYMBOL_TEXT_LIMIT}" value="${foundry.utils.escapeHTML(existing?.text ?? '')}"></div></div>`,
                ok: { label: game.i18n.localize(`${MODULE.ID}.mapping.noteSave`) },
                rejectClose: false,
                modal: true
            });
            if (result === null || result === undefined) return false;
            text = String(result.text ?? '').trim().slice(0, MAPPING_SYMBOL_TEXT_LIMIT);
        }

        await this._requestMutation({
            action: 'place-symbol',
            mapId: record.id,
            type,
            text,
            column: Number(column),
            row: Number(row)
        });
        return true;
    }

    getMapNote(column, row) {
        return this.state.symbols
            ?.find(symbol => symbol.column === Number(column)
                && symbol.row === Number(row)
                && symbol.type === 'note') ?? null;
    }

    async removeMapSymbol(column, row) {
        const record = this.records.get(this.currentMapId);
        if (!record || !this.canAnnotateRecord(record)) return false;
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
        // A surface restyles a whole area, so it stays with the Actor's owner.
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
            record = {
                ...record,
                // Where this recording begins, so the marker does not first
                // appear wherever the previous one ended.
                lastPosition: this._normalizePosition(data.position) ?? record.lastPosition,
                createdAt: record.createdAt || now,
                updatedAt: now,
                updatedBy: user.id
            };
            this.records.set(id, record);
            if (this.currentMapId === id) this.state = record;
            // Let the GM know someone has started mapping. Only for other
            // users -- a GM who pressed Record does not need telling.
            if (data.recording && user.id !== game.user.id) {
                notify(game.i18n.format(`${MODULE.ID}.mapping.recordingStarted`, { user: user.name }), {
                    subtitle: game.i18n.format(`${MODULE.ID}.mapping.recordingStartedHint`, {
                        actor: actor.name,
                        scene: canvas.scene.name
                    }),
                    type: 'info'
                });
            }
            void this.renderWindow();
            await this._persistSceneRecords(data.sceneId);
            return;
        }

        if (!record) return;
        // Marking a map up is open to the whole party; changing what it is, or
        // what it says was explored, stays with the Actor's owner.
        if (!ANNOTATION_ACTIONS.includes(data.action)
            && !this._canManageActor(game.actors?.get(record.actorId), user)) return;
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
                text: String(data.text ?? '').trim().slice(0, MAPPING_SYMBOL_TEXT_LIMIT),
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
                this.atlas.features,
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
                symbols: [],
                floors: {},
                secrets: [],
                lastPosition: null,
                updatedAt: Date.now(),
                updatedBy: user.id
            };
            this.records.set(record.id, record);
        } else return;

        if (this.currentMapId === record.id) {
            this.state = record;
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

// ================================================================== 
// ===== MODULE IMPORTS =============================================
// ================================================================== 

import { MODULE } from './const.js';
import { BlacksmithAPI } from '/modules/coffee-pub-blacksmith/api/blacksmith-api.js';

// ================================================================== 
// ===== SOCKET MANAGER CLASS =======================================
// ================================================================== 

/**
 * Centralized Socket Manager for Cartographer
 * Handles all socket registration and routing for all tools
 * Prevents "god mode" files by centralizing socket logic
 */
class SocketManager {
    constructor() {
        this.handlers = new Map(); // toolId -> { eventName -> handler }
        this.initialized = false;
        this.socketReady = false;
        this.socketAPI = null; // Store reference to socket API
    }
    
    /**
     * Get Blacksmith socket API using the recommended pattern
     * Uses BlacksmithAPI.getSockets() which handles timing and initialization
     * @returns {Promise<Object|null>} Socket API object or null if not available
     */
    async _getSocketAPI() {
        try {
            // Use BlacksmithAPI.getSockets() which handles timing and async initialization
            const sockets = await BlacksmithAPI.getSockets();
            if (sockets) {
                return sockets;
            }
        } catch (error) {
            console.warn(`${MODULE.NAME}: Error getting socket API via BlacksmithAPI.getSockets():`, error);
        }
        
        // Fallback: Try global Blacksmith.socket (now available after Blacksmith fix)
        if (typeof Blacksmith !== 'undefined' && Blacksmith.socket) {
            return Blacksmith.socket;
        }
        
        // Fallback: Try accessing via module API
        const blacksmithModule = game.modules.get('coffee-pub-blacksmith');
        if (blacksmithModule?.api?.sockets) {
            return blacksmithModule.api.sockets;
        }
        
        return null;
    }
    
    /**
     * Initialize socket manager and register all handlers
     * Called from cartographer.js during canvasReady hook
     * Uses BlacksmithAPI.getSockets() which handles timing and async initialization
     */
    async initialize() {
        try {
            console.log(`${MODULE.NAME}: Initializing socket manager...`);
            
            // Use BlacksmithAPI.getSockets() which handles timing and async initialization
            const socketAPI = await this._getSocketAPI();
            if (!socketAPI) {
                console.warn(`${MODULE.NAME}: Blacksmith socket API not available, socket manager not initialized`);
                return;
            }
            
            // Debug: Log socket API structure
            console.log(`${MODULE.NAME}: Socket API obtained:`, {
                hasWaitForReady: typeof socketAPI.waitForReady === 'function',
                hasEmit: typeof socketAPI.emit === 'function',
                hasRegister: typeof socketAPI.register === 'function',
                methods: Object.keys(socketAPI)
            });
            
            this.socketAPI = socketAPI; // Store for later use
            
            // Wait for socket system to be ready (if method exists)
            if (typeof socketAPI.waitForReady === 'function') {
                console.log(`${MODULE.NAME}: Waiting for socket to be ready...`);
                await socketAPI.waitForReady();
                console.log(`${MODULE.NAME}: Socket waitForReady() completed`);
            } else {
                console.warn(`${MODULE.NAME}: Socket API does not have waitForReady method`);
            }
            this.socketReady = true;
            
            this.initialized = true;
            console.log(`${MODULE.NAME}: ✅ Socket manager initialized (ready: ${this.socketReady}, handlers pending: ${this.handlers.size})`);
            
            // Register any handlers that were registered before initialization
            this._registerPendingHandlers();
        } catch (error) {
            console.error(`${MODULE.NAME}: Error initializing socket manager:`, error);
        }
    }
    
    /**
     * Register socket handlers for a specific tool
     * Called by tool managers during their initialization
     * @param {string} toolId - Tool identifier (e.g., 'drawing', 'notes')
     * @param {Object} handlers - Object mapping event names to handler functions
     */
    registerToolHandlers(toolId, handlers) {
        console.log(`${MODULE.NAME}: registerToolHandlers called for ${toolId} (initialized: ${this.initialized}, socketReady: ${this.socketReady})`);
        
        if (!this.initialized) {
            console.log(`${MODULE.NAME}: Socket manager not initialized yet, storing handlers for ${toolId} to register later`);
            // Store handlers to register later
            if (!this.handlers.has(toolId)) {
                this.handlers.set(toolId, {});
            }
            const toolHandlers = this.handlers.get(toolId);
            Object.entries(handlers).forEach(([eventName, handler]) => {
                toolHandlers[eventName] = handler;
            });
            console.log(`${MODULE.NAME}: Stored ${Object.keys(handlers).length} handler(s) for ${toolId} (will register when socket ready)`);
            return;
        }
        
        if (!this.handlers.has(toolId)) {
            this.handlers.set(toolId, {});
        }
        
        const toolHandlers = this.handlers.get(toolId);
        Object.entries(handlers).forEach(([eventName, handler]) => {
            toolHandlers[eventName] = handler;
            
            // Register with Blacksmith socket API if initialized
            if (this.initialized && this.socketReady && this.socketAPI) {
                // Event name format: 'toolId-eventName' (e.g., 'drawing-created')
                const fullEventName = `${toolId}-${eventName}`;
                const registeredEventName = `${MODULE.ID}.${fullEventName}`;
                if (typeof this.socketAPI.register === 'function') {
                    this.socketAPI.register(registeredEventName, (data) => {
                        console.debug(`${MODULE.NAME}: Socket event received: ${registeredEventName}`, data);
                        // Skip if this is our own event (already handled locally)
                        if (data && data.userId === game.user.id) {
                            console.debug(`${MODULE.NAME}: Skipping own event from user ${data.userId}`);
                            return;
                        }
                        console.debug(`${MODULE.NAME}: Calling handler for ${registeredEventName}`);
                        handler(data);
                    });
                    console.log(`${MODULE.NAME}: Registered socket handler: ${registeredEventName}`);
                } else {
                    console.warn(`${MODULE.NAME}: Socket API register method not available`);
                }
            }
        });
        
        if (this.initialized && this.socketReady) {
            console.log(`${MODULE.NAME}: Registered ${Object.keys(handlers).length} socket handler(s) for tool: ${toolId}`);
        } else {
            console.log(`${MODULE.NAME}: Stored ${Object.keys(handlers).length} socket handler(s) for tool: ${toolId} (will register when socket ready)`);
        }
    }
    
    /**
     * Register all pending handlers after initialization
     * Called internally after socket manager is initialized
     */
    _registerPendingHandlers() {
        if (!this.initialized || !this.socketReady) {
            return;
        }
        
        // Register all stored handlers
        if (!this.socketAPI) {
            return;
        }
        
        this.handlers.forEach((toolHandlers, toolId) => {
            Object.entries(toolHandlers).forEach(([eventName, handler]) => {
                const fullEventName = `${toolId}-${eventName}`;
                const registeredEventName = `${MODULE.ID}.${fullEventName}`;
                if (typeof this.socketAPI.register === 'function') {
                    this.socketAPI.register(registeredEventName, (data) => {
                        console.debug(`${MODULE.NAME}: Socket event received: ${registeredEventName}`, data);
                        // Skip if this is our own event (already handled locally)
                        if (data && data.userId === game.user.id) {
                            console.debug(`${MODULE.NAME}: Skipping own event from user ${data.userId}`);
                            return;
                        }
                        console.debug(`${MODULE.NAME}: Calling handler for ${registeredEventName}`);
                        handler(data);
                    });
                    console.log(`${MODULE.NAME}: Registered pending socket handler: ${registeredEventName}`);
                }
            });
            console.log(`${MODULE.NAME}: Registered ${Object.keys(toolHandlers).length} pending socket handler(s) for tool: ${toolId}`);
        });
    }
    
    /**
     * Broadcast a socket event
     * Called by tool managers to send events to other clients
     * @param {string} toolId - Tool identifier
     * @param {string} eventName - Event name (e.g., 'drawing-created')
     * @param {Object} data - Event data to broadcast
     */
    async broadcast(toolId, eventName, data) {
        // Use stored socket API if available, otherwise get it
        let socketAPI = this.socketAPI;
        if (!socketAPI) {
            socketAPI = await this._getSocketAPI();
            if (!socketAPI) {
                console.warn(`${MODULE.NAME}: Blacksmith socket API not available`);
                return;
            }
            // Store for future use
            this.socketAPI = socketAPI;
        }
        
        try {
            // Ensure socket is ready
            if (typeof socketAPI.waitForReady === 'function') {
                await socketAPI.waitForReady();
            }
            
            // Verify emit method exists before calling
            if (typeof socketAPI.emit !== 'function') {
                console.error(`${MODULE.NAME}: Socket API emit method not found. Available methods:`, Object.keys(socketAPI));
                return;
            }
            
            // Event name format: 'toolId-eventName' (e.g., 'drawing-created')
            const fullEventName = `${toolId}-${eventName}`;
            // Full registered event name format: 'moduleId.toolId-eventName'
            const registeredEventName = `${MODULE.ID}.${fullEventName}`;
            
            // Debug: Log what we're about to emit (debug mode only)
            if (typeof BlacksmithUtils !== 'undefined') {
                BlacksmithUtils.postConsoleAndNotification(
                    MODULE.NAME,
                    `CARTOGRAPHER | Socket | Broadcasting: ${registeredEventName}`,
                    `Data keys: ${data ? Object.keys(data).join(', ') : 'none'}`,
                    true, // debug = true
                    false
                );
            }
            
            // Emit event using Blacksmith socket API
            // Based on Blacksmith API, emit takes the full event name (moduleId.eventName)
            // Signature: emit(eventName, data) where eventName is the full registered name
            socketAPI.emit(registeredEventName, data);
        } catch (error) {
            console.error(`${MODULE.NAME}: Error broadcasting ${eventName} for ${toolId}:`, error);
            console.error(`${MODULE.NAME}: Socket API state:`, {
                hasSocketAPI: !!this.socketAPI,
                socketReady: this.socketReady,
                initialized: this.initialized,
                socketAPIType: typeof this.socketAPI,
                socketAPIMethods: this.socketAPI ? Object.keys(this.socketAPI) : 'N/A'
            });
        }
    }
    
    /**
     * Check if socket manager is ready
     * @returns {boolean} True if initialized and socket is ready
     */
    isReady() {
        return this.initialized && this.socketReady;
    }
}

// ================================================================== 
// ===== EXPORT SINGLETON ===========================================
// ================================================================== 

// Create and export singleton instance
const socketManager = new SocketManager();
export { socketManager };


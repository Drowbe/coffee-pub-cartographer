// ================================================================== 
// ===== MODULE IMPORTS =============================================
// ================================================================== 

import { MODULE } from './const.js';

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
     * Get Blacksmith socket API
     * Tries multiple access patterns to find the socket API
     * @returns {Object|null} Socket API object or null if not available
     */
    _getSocketAPI() {
        // Try global Blacksmith object first
        if (typeof Blacksmith !== 'undefined' && Blacksmith.socket) {
            return Blacksmith.socket;
        }
        
        // Try accessing via module API
        const blacksmithModule = game.modules.get('coffee-pub-blacksmith');
        if (blacksmithModule?.api?.socket) {
            return blacksmithModule.api.socket;
        }
        
        // Try accessing via BlacksmithAPI bridge (if available)
        if (typeof BlacksmithAPI !== 'undefined' && BlacksmithAPI.socket) {
            return BlacksmithAPI.socket;
        }
        
        // Try global BlacksmithSocketManager (legacy)
        if (typeof BlacksmithSocketManager !== 'undefined') {
            return BlacksmithSocketManager;
        }
        
        // Debug: Log what's available
        console.debug(`${MODULE.NAME}: Socket API check - Blacksmith:`, typeof Blacksmith, 
                     'blacksmithModule:', blacksmithModule?.api ? 'has api' : 'no api',
                     'BlacksmithAPI:', typeof BlacksmithAPI,
                     'BlacksmithSocketManager:', typeof BlacksmithSocketManager);
        
        return null;
    }
    
    /**
     * Initialize socket manager and register all handlers
     * Called from cartographer.js during canvasReady hook
     */
    async initialize() {
        const socketAPI = this._getSocketAPI();
        if (!socketAPI) {
            console.warn(`${MODULE.NAME}: Blacksmith socket API not available, socket manager not initialized`);
            return;
        }
        
        this.socketAPI = socketAPI; // Store for later use
        
        try {
            // Wait for socket system to be ready (if method exists)
            if (typeof socketAPI.waitForReady === 'function') {
                await socketAPI.waitForReady();
            }
            this.socketReady = true;
            
            this.initialized = true;
            console.log(`${MODULE.NAME}: Socket manager initialized`);
            
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
        if (!this.initialized) {
            console.warn(`${MODULE.NAME}: Socket manager not initialized, cannot register handlers for ${toolId}`);
            // Store handlers to register later
            if (!this.handlers.has(toolId)) {
                this.handlers.set(toolId, {});
            }
            const toolHandlers = this.handlers.get(toolId);
            Object.entries(handlers).forEach(([eventName, handler]) => {
                toolHandlers[eventName] = handler;
            });
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
                if (typeof this.socketAPI.register === 'function') {
                    this.socketAPI.register(`${MODULE.ID}.${fullEventName}`, (data) => {
                        // Skip if this is our own event (already handled locally)
                        if (data && data.userId === game.user.id) {
                            return;
                        }
                        handler(data);
                    });
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
                if (typeof this.socketAPI.register === 'function') {
                    this.socketAPI.register(`${MODULE.ID}.${fullEventName}`, (data) => {
                        // Skip if this is our own event (already handled locally)
                        if (data && data.userId === game.user.id) {
                            return;
                        }
                        handler(data);
                    });
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
    broadcast(toolId, eventName, data) {
        // Get socket API (will try multiple access patterns)
        const socketAPI = this.socketAPI || this._getSocketAPI();
        if (!socketAPI) {
            console.warn(`${MODULE.NAME}: Blacksmith socket API not available`);
            return;
        }
        
        // Wait for socket system to be ready, then emit event
        const waitForReady = socketAPI.waitForReady || (() => Promise.resolve());
        waitForReady.call(socketAPI).then(() => {
            try {
                // Event name format: 'toolId-eventName' (e.g., 'drawing-created')
                const fullEventName = `${toolId}-${eventName}`;
                
                // Try new API format first
                if (typeof socketAPI.emit === 'function') {
                    socketAPI.emit(MODULE.ID, fullEventName, data);
                } else if (typeof socketAPI.emit === 'function' && socketAPI.emit.length === 3) {
                    // Legacy format: emit(moduleId, eventName, data)
                    socketAPI.emit(MODULE.ID, fullEventName, data);
                }
            } catch (error) {
                console.error(`${MODULE.NAME}: Error broadcasting ${eventName} for ${toolId}:`, error);
            }
        }).catch(error => {
            console.error(`${MODULE.NAME}: Error waiting for socket ready:`, error);
        });
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


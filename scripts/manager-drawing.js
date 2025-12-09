// ================================================================== 
// ===== MODULE IMPORTS =============================================
// ================================================================== 

import { MODULE } from './const.js';

// ================================================================== 
// ===== DRAWING TOOL CLASS ========================================
// ================================================================== 

/**
 * Drawing Tool Manager
 * Handles temporary player drawings on the canvas for planning purposes
 * This is the first tool in the Cartographer multi-tool module
 */
class DrawingTool {
    constructor() {
        this.name = 'drawing';
        this.displayName = 'Drawing Tool';
        this.version = '1.0.0';
        this.active = false;
        this.services = null;
        
        // Drawing state
        this.state = {
            active: false,
            brushSettings: {
                size: 2,
                color: '#000000',
                type: 'pen' // pen, marker, highlighter
            },
            currentDrawing: null
        };
    }
    
    /**
     * Initialize the drawing tool
     * Called by cartographer.js after Canvas Layer is ready
     * @param {Object} services - Shared services from cartographer.js
     */
    async initialize(services) {
        this.services = services;
        
        // Register settings
        this.registerSettings();
        
        // Register hooks
        this.registerHooks();
        
        // Register toolbar tools (will be done in Phase 4)
        // this.registerToolbarTools();
        
        console.log(`✅ ${MODULE.NAME}: ${this.displayName} initialized`);
    }
    
    /**
     * Cleanup when module unloads
     */
    cleanup() {
        // Cleanup will be implemented in Phase 3
        console.log(`${MODULE.NAME}: ${this.displayName} cleanup`);
    }
    
    /**
     * Register drawing tool settings
     */
    registerSettings() {
        // Settings will be registered in settings.js
        // This is a placeholder for tool-specific settings if needed
    }
    
    /**
     * Register FoundryVTT hooks via Blacksmith HookManager
     */
    registerHooks() {
        // Hooks will be registered in Phase 2
        // Placeholder for now
    }
    
    /**
     * Check if tool is currently active
     * @returns {boolean}
     */
    isActive() {
        return this.state.active;
    }
    
    /**
     * Activate the drawing tool
     */
    activate() {
        this.state.active = true;
        console.log(`${MODULE.NAME}: ${this.displayName} activated`);
    }
    
    /**
     * Deactivate the drawing tool
     */
    deactivate() {
        this.state.active = false;
        console.log(`${MODULE.NAME}: ${this.displayName} deactivated`);
    }
}

// ================================================================== 
// ===== EXPORTS ====================================================
// ================================================================== 

// Create and export singleton instance
const drawingTool = new DrawingTool();
export { drawingTool };


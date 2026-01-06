// ================================================================== 
// ===== MODULE IMPORTS =============================================
// ================================================================== 

import { MODULE } from './const.js';
import { registerSettings } from './settings.js';
import { drawingTool } from './manager-drawing.js';
import { cartographerToolbar } from './manager-toolbar.js';
import { socketManager } from './manager-sockets.js';

// ================================================================== 
// ===== BLACKSMITH API INTEGRATION =================================
// ================================================================== 

// Import Blacksmith API bridge
import { BlacksmithAPI } from '/modules/coffee-pub-blacksmith/api/blacksmith-api.js';

// ================================================================== 
// ===== KEYBINDING REGISTRATION ====================================
// ================================================================== 

/**
 * Register Foundry keybinding for hold-to-draw functionality
 * This must happen during 'init' hook, not 'ready'
 */
Hooks.once('init', () => {
    game.keybindings.register(MODULE.ID, 'holdToDraw', {
        name: 'Hold to Draw',
        hint: 'Hold this key to temporarily enable the Drawing Tool and draw/stamp on the canvas.',
        editable: [
            { key: 'Backslash' } // default, user can change in Settings → Controls
        ],
        onDown: () => {
            // Don't fire while typing in inputs, chat, sheets, etc.
            if (game.keyboard.hasFocus) return false;

            // Canvas must exist
            if (!canvas?.ready) return false;

            drawingTool.onHoldKeyDown?.();
            return true;
        },
        onUp: () => {
            drawingTool.onHoldKeyUp?.();
            return true;
        }
    });
});

// ================================================================== 
// ===== MODULE INITIALIZATION ======================================
// ================================================================== 

Hooks.once('ready', async () => {
    try {
        // Register settings FIRST during the ready phase
        registerSettings();
        
        // Register module with Blacksmith
        if (typeof BlacksmithModuleManager !== 'undefined') {
            BlacksmithModuleManager.registerModule(MODULE.ID, {
                name: MODULE.NAME,
                version: MODULE.VERSION
            });
            console.log(`✅ ${MODULE.NAME}: Registered with Blacksmith successfully`);
        } else {
            console.warn(`⚠️ ${MODULE.NAME}: Blacksmith not available`);
        }
        
        // Initialize toolbar manager (menubar registration happens here)
        // This must happen in 'ready' hook, not 'canvasReady'
        try {
            await cartographerToolbar.initialize();
        } catch (error) {
            console.error(`❌ ${MODULE.NAME}: Failed to initialize toolbar:`, error);
        }
        
        // Initialize module features
        initializeModule();
        
    } catch (error) {
        console.error(`❌ ${MODULE.NAME}: Error during initialization:`, error);
    }
});

// ================================================================== 
// ===== SHARED SERVICES ============================================
// ================================================================== 

/**
 * Shared services available to all Cartographer tools
 * Provides centralized access to common resources
 */
export const CartographerServices = {
    // Canvas Layer (shared across tools)
    canvasLayer: null,
    
    // Blacksmith API access
    blacksmithAPI: null,
    
    // Module constants
    MODULE: null
};

// ================================================================== 
// ===== CANVAS LAYER INITIALIZATION ================================
// ================================================================== 

/**
 * Initialize Canvas Layer and tools when canvas is ready
 * This provides shared access to BlacksmithLayer for all tools
 */
Hooks.once('canvasReady', async () => {
    try {
        // Initialize shared services
        CartographerServices.MODULE = MODULE;
        CartographerServices.blacksmithAPI = await BlacksmithAPI.get();
        CartographerServices.canvasLayer = await BlacksmithAPI.getCanvasLayer();
        
        if (CartographerServices.canvasLayer) {
            console.log(`✅ ${MODULE.NAME}: Canvas Layer initialized`);
            
            // Initialize socket manager FIRST (before tools)
            // Tools will register their handlers during initialization
            try {
                await socketManager.initialize();
            } catch (error) {
                console.error(`❌ ${MODULE.NAME}: Failed to initialize socket manager:`, error);
            }
            
            // Initialize tools after Canvas Layer and Socket Manager are available
            // (Toolbar manager is already initialized in 'ready' hook)
            try {
                await drawingTool.initialize(CartographerServices);
            } catch (error) {
                console.error(`❌ ${MODULE.NAME}: Failed to initialize drawing tool:`, error);
            }
        } else {
            console.warn(`⚠️ ${MODULE.NAME}: Canvas Layer not available, tools not initialized`);
        }
    } catch (error) {
        console.error(`❌ ${MODULE.NAME}: Error initializing Canvas Layer:`, error);
    }
});









// ================================================================== 
// ===== MODULE INITIALIZATION ======================================
// ================================================================== 

/**
 * Initialize module features
 * This is where tool initialization will be coordinated
 * Tools are initialized in the canvasReady hook after Canvas Layer is available
 */
function initializeModule() {
    // Shared services and tools will be initialized in canvasReady hook
    console.log(`${MODULE.NAME}: Module initialized`);
}


// ================================================================== 
// ===== CARTOGRAPHER TOOLBAR MANAGER ===============================
// ================================================================== 

import { MODULE } from './const.js';
import { BlacksmithAPI } from '/modules/coffee-pub-blacksmith/api/blacksmith-api.js';

/**
 * Manages the Cartographer toolbar panel
 * Similar to the combat bar - opens/closes a dedicated toolbar for Cartographer tools
 */
class CartographerToolbar {
    constructor() {
        this.isOpen = false;
        this.tools = new Map(); // Store registered tools (for unregistration)
    }
    
    /**
     * Initialize the toolbar system
     * This should be called in the 'ready' hook, not 'canvasReady'
     * Uses Blacksmith Secondary Bar API instead of custom toolbar
     */
    async initialize() {
        // Register secondary bar type
        await this.registerSecondaryBarType();
        
        // Register menubar button (must happen in 'ready' hook)
        await this.registerMenubarButton();
        
        if (typeof BlacksmithUtils !== 'undefined') {
            BlacksmithUtils.postConsoleAndNotification(
                MODULE.NAME,
                'CARTOGRAPHER | Menubar | Toolbar manager initialized',
                'Secondary bar type and menubar button registered',
                false,
                false
            );
        } else {
            console.log(`${MODULE.NAME}: Toolbar manager initialized`);
        }
    }
    
    /**
     * Register secondary bar type with Blacksmith API
     * According to API docs: https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Menubar
     */
    async registerSecondaryBarType() {
        try {
            const blacksmithModule = game.modules.get('coffee-pub-blacksmith');
            
            if (!blacksmithModule?.api?.registerSecondaryBarType) {
                if (typeof BlacksmithUtils !== 'undefined') {
                    BlacksmithUtils.postConsoleAndNotification(
                        MODULE.NAME,
                        'CARTOGRAPHER | Menubar | Secondary Bar API not available',
                        'registerSecondaryBarType method not found',
                        true,
                        false
                    );
                }
                return;
            }
            
            const barTypeId = MODULE.ID;
            const barConfig = {
                name: "Cartographer Tools",
                icon: "fa-solid fa-map",
                title: "Cartographer Tools",
                persistence: "manual" // manual = stays open until closed, auto = closes after delay
            };
            
            if (typeof BlacksmithUtils !== 'undefined') {
                BlacksmithUtils.postConsoleAndNotification(
                    MODULE.NAME,
                    'CARTOGRAPHER | Menubar | Registering secondary bar type',
                    `barTypeId: ${barTypeId}`,
                    true,
                    false
                );
            }
            
            const success = blacksmithModule.api.registerSecondaryBarType(barTypeId, barConfig);
            
            if (success) {
                if (typeof BlacksmithUtils !== 'undefined') {
                    BlacksmithUtils.postConsoleAndNotification(
                        MODULE.NAME,
                        'CARTOGRAPHER | Menubar | Secondary bar type registered',
                        `Bar type: ${barTypeId}`,
                        false,
                        false
                    );
                }
            } else {
                if (typeof BlacksmithUtils !== 'undefined') {
                    BlacksmithUtils.postConsoleAndNotification(
                        MODULE.NAME,
                        'CARTOGRAPHER | Menubar | Secondary bar registration returned false',
                        'Bar type may already be registered',
                        true,
                        false
                    );
                }
            }
        } catch (error) {
            if (typeof BlacksmithUtils !== 'undefined') {
                BlacksmithUtils.postConsoleAndNotification(
                    MODULE.NAME,
                    'CARTOGRAPHER | Menubar | Error registering secondary bar type',
                    error.message + '\n' + error.stack,
                    true,
                    false
                );
            } else {
                console.error(`${MODULE.NAME}: Error registering secondary bar type:`, error);
            }
        }
    }
    
    /**
     * Register menubar button via Blacksmith Menubar API
     * According to API docs: https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Menubar
     * Method: registerMenubarTool(toolId, toolData)
     * Access: game.modules.get('coffee-pub-blacksmith')?.api.registerMenubarTool()
     */
    async registerMenubarButton() {
        try {
            if (typeof BlacksmithUtils !== 'undefined') {
                BlacksmithUtils.postConsoleAndNotification(
                    MODULE.NAME,
                    'CARTOGRAPHER | Menubar | Registering menubar button',
                    'Starting menubar registration',
                    true,
                    false
                );
            }
            
            // Access API via game.modules (as per API documentation)
            const blacksmithModule = game.modules.get('coffee-pub-blacksmith');
            
            if (!blacksmithModule) {
                const errorMsg = 'Blacksmith module not found';
                if (typeof BlacksmithUtils !== 'undefined') {
                    BlacksmithUtils.postConsoleAndNotification(
                        MODULE.NAME,
                        `CARTOGRAPHER | Menubar | ${errorMsg}`,
                        'coffee-pub-blacksmith module not loaded',
                        true,
                        false
                    );
                }
                return;
            }
            
            if (!blacksmithModule.api) {
                const errorMsg = 'Blacksmith API not available';
                if (typeof BlacksmithUtils !== 'undefined') {
                    BlacksmithUtils.postConsoleAndNotification(
                        MODULE.NAME,
                        `CARTOGRAPHER | Menubar | ${errorMsg}`,
                        'API not loaded yet, may need to wait for ready hook',
                        true,
                        false
                    );
                }
                return;
            }
            
            // Check if registerMenubarTool method exists
            if (typeof blacksmithModule.api.registerMenubarTool !== 'function') {
                const errorMsg = 'registerMenubarTool is not a function';
                const availableMethods = Object.keys(blacksmithModule.api).filter(k => typeof blacksmithModule.api[k] === 'function').join(', ');
                if (typeof BlacksmithUtils !== 'undefined') {
                    BlacksmithUtils.postConsoleAndNotification(
                        MODULE.NAME,
                        `CARTOGRAPHER | Menubar | ${errorMsg}`,
                        `Available API methods: ${availableMethods}`,
                        true,
                        false
                    );
                }
                return;
            }
            
            const self = this;
            
            // Register tool according to API: registerMenubarTool(toolId, toolData)
            const toolId = `${MODULE.ID}-menubar-tool`;
            const toolData = {
                icon: "fa-solid fa-map",
                name: "Cartographer",
                title: "Cartographer Tools",
                zone: "left",              // Optional: left, middle, right (default: left)
                order: 5,                  // Optional: order within zone
                moduleId: MODULE.ID,       // Optional: your module ID
                gmOnly: false,             // Optional: whether tool is GM-only
                leaderOnly: false,         // Optional: whether tool is leader-only
                visible: true,             // Optional: whether tool is visible
                onClick: () => {
                    self.toggleSecondaryBar();
                }
            };
            
            if (typeof BlacksmithUtils !== 'undefined') {
                BlacksmithUtils.postConsoleAndNotification(
                    MODULE.NAME,
                    'CARTOGRAPHER | Menubar | Calling registerMenubarTool',
                    `toolId: ${toolId}, toolData: ${JSON.stringify(toolData, null, 2)}`,
                    true,
                    false
                );
            }
            
            // Register the tool
            const success = blacksmithModule.api.registerMenubarTool(toolId, toolData);
            
            if (success) {
                if (typeof BlacksmithUtils !== 'undefined') {
                    BlacksmithUtils.postConsoleAndNotification(
                        MODULE.NAME,
                        'CARTOGRAPHER | Menubar | Button registered successfully',
                        `Tool ID: ${toolId}`,
                        false,
                        false
                    );
                } else {
                    console.log(`${MODULE.NAME}: Menubar button registered`);
                }
            } else {
                if (typeof BlacksmithUtils !== 'undefined') {
                    BlacksmithUtils.postConsoleAndNotification(
                        MODULE.NAME,
                        'CARTOGRAPHER | Menubar | Registration returned false',
                        'Tool may already be registered or registration failed',
                        true,
                        false
                    );
                } else {
                    console.warn(`${MODULE.NAME}: Menubar button registration returned false`);
                }
            }
        } catch (error) {
            if (typeof BlacksmithUtils !== 'undefined') {
                BlacksmithUtils.postConsoleAndNotification(
                    MODULE.NAME,
                    'CARTOGRAPHER | Menubar | Error registering menubar button',
                    error.message + '\n' + error.stack,
                    true,
                    false
                );
            } else {
                console.error(`${MODULE.NAME}: Error registering menubar button:`, error);
            }
        }
    }
    
    // Removed createToolbarPanel() - using Blacksmith Secondary Bar API instead
    
    /**
     * Toggle secondary bar visibility using Blacksmith API
     */
    toggleSecondaryBar() {
        try {
            const blacksmithModule = game.modules.get('coffee-pub-blacksmith');
            
            if (!blacksmithModule?.api?.toggleSecondaryBar) {
                if (typeof BlacksmithUtils !== 'undefined') {
                    BlacksmithUtils.postConsoleAndNotification(
                        MODULE.NAME,
                        'CARTOGRAPHER | Menubar | toggleSecondaryBar API not available',
                        'Cannot toggle secondary bar',
                        true,
                        false
                    );
                }
                return;
            }
            
            const barTypeId = MODULE.ID;
            blacksmithModule.api.toggleSecondaryBar(barTypeId);
            
            // Toggle our internal state for active indicator
            this.isOpen = !this.isOpen;
        } catch (error) {
            if (typeof BlacksmithUtils !== 'undefined') {
                BlacksmithUtils.postConsoleAndNotification(
                    MODULE.NAME,
                    'CARTOGRAPHER | Menubar | Error toggling secondary bar',
                    error.message,
                    true,
                    false
                );
            } else {
                console.error(`${MODULE.NAME}: Error toggling secondary bar:`, error);
            }
        }
    }
    
    /**
     * Register a tool in the Cartographer secondary bar using Blacksmith API
     * @param {string} toolId - Unique tool identifier
     * @param {Object} toolConfig - Tool configuration
     */
    registerTool(toolId, toolConfig) {
        try {
            const blacksmithModule = game.modules.get('coffee-pub-blacksmith');
            
            if (!blacksmithModule?.api?.registerSecondaryBarItem) {
                if (typeof BlacksmithUtils !== 'undefined') {
                    BlacksmithUtils.postConsoleAndNotification(
                        MODULE.NAME,
                        'CARTOGRAPHER | Menubar | registerSecondaryBarItem API not available',
                        'Cannot register tool in secondary bar',
                        true,
                        false
                    );
                }
                return;
            }
            
            const barTypeId = MODULE.ID;
            const itemId = toolId;
            
            // Convert our tool config to Blacksmith secondary bar item format
            const itemData = {
                icon: toolConfig.icon,
                title: toolConfig.title || toolConfig.name,
                active: toolConfig.active, // Optional: function that returns boolean
                onClick: toolConfig.onClick
            };
            
            if (typeof BlacksmithUtils !== 'undefined') {
                BlacksmithUtils.postConsoleAndNotification(
                    MODULE.NAME,
                    'CARTOGRAPHER | Menubar | Registering secondary bar item',
                    `barTypeId: ${barTypeId}, itemId: ${itemId}`,
                    true,
                    false
                );
            }
            
            const success = blacksmithModule.api.registerSecondaryBarItem(barTypeId, itemId, itemData);
            
            if (success) {
                // Store tool config for potential unregistration later
                this.tools.set(toolId, {
                    itemId: itemId,
                    config: toolConfig
                });
                
                if (typeof BlacksmithUtils !== 'undefined') {
                    BlacksmithUtils.postConsoleAndNotification(
                        MODULE.NAME,
                        'CARTOGRAPHER | Menubar | Tool registered in secondary bar',
                        `Item ID: ${itemId}`,
                        false,
                        false
                    );
                } else {
                    console.log(`${MODULE.NAME}: Tool registered in secondary bar: ${toolId}`);
                }
            } else {
                if (typeof BlacksmithUtils !== 'undefined') {
                    BlacksmithUtils.postConsoleAndNotification(
                        MODULE.NAME,
                        'CARTOGRAPHER | Menubar | Tool registration returned false',
                        `Item ID: ${itemId}`,
                        true,
                        false
                    );
                }
            }
        } catch (error) {
            if (typeof BlacksmithUtils !== 'undefined') {
                BlacksmithUtils.postConsoleAndNotification(
                    MODULE.NAME,
                    'CARTOGRAPHER | Menubar | Error registering tool',
                    error.message + '\n' + error.stack,
                    true,
                    false
                );
            } else {
                console.error(`${MODULE.NAME}: Error registering tool:`, error);
            }
        }
    }
    
    /**
     * Unregister a tool from the secondary bar using Blacksmith API
     * @param {string} toolId - Tool identifier to remove
     */
    unregisterTool(toolId) {
        try {
            const blacksmithModule = game.modules.get('coffee-pub-blacksmith');
            
            if (!blacksmithModule?.api?.unregisterSecondaryBarItem) {
                return;
            }
            
            const tool = this.tools.get(toolId);
            if (tool) {
                const barTypeId = MODULE.ID;
                blacksmithModule.api.unregisterSecondaryBarItem(barTypeId, tool.itemId);
                this.tools.delete(toolId);
            }
        } catch (error) {
            if (typeof BlacksmithUtils !== 'undefined') {
                BlacksmithUtils.postConsoleAndNotification(
                    MODULE.NAME,
                    'CARTOGRAPHER | Menubar | Error unregistering tool',
                    error.message,
                    true,
                    false
                );
            }
        }
    }
    
    /**
     * Cleanup toolbar
     */
    cleanup() {
        // Unregister all tools
        for (const toolId of this.tools.keys()) {
            this.unregisterTool(toolId);
        }
        
        // Close secondary bar if open
        try {
            const blacksmithModule = game.modules.get('coffee-pub-blacksmith');
            if (blacksmithModule?.api?.closeSecondaryBar) {
                blacksmithModule.api.closeSecondaryBar();
            }
        } catch (error) {
            // Ignore cleanup errors
        }
        
        this.tools.clear();
        this.isOpen = false;
    }
}

// ================================================================== 
// ===== EXPORTS ====================================================
// ================================================================== 

// Create and export singleton instance
const cartographerToolbar = new CartographerToolbar();
export { cartographerToolbar };


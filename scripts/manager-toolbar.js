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
                name: "Cartographer",
                icon: "fa-solid fa-map",
                title: "Cartographer",
                persistence: "manual", // manual = stays open until closed, auto = closes after delay
                groups: {
                    'line-width': {
                        mode: 'switch', // Radio-button behavior: only one active at a time
                        order: 10 // Order for the group
                    },
                    'color': {
                        mode: 'switch', // Radio-button behavior: only one active at a time
                        order: 15 // Order for the group
                    },
                    'erase': {
                        mode: 'default', // Independent buttons (supports toggleable)
                        order: 20 // Order for the group
                    }
                    // 'default' group is automatically created for items without a group
                }
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
                zone: "middle",              // Optional: left, middle, right (default: middle)
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
     * @param {string} toolConfig.icon - FontAwesome icon class (required)
     * @param {string} [toolConfig.label] - Text label (optional)
     * @param {string} [toolConfig.tooltip] - Custom tooltip text (optional)
     * @param {string} [toolConfig.title] - Alternative to tooltip (optional, for backwards compatibility)
     * @param {boolean|Function} [toolConfig.active] - Active state (boolean or function that returns boolean) (optional)
     * @param {Function} toolConfig.onClick - Click handler function (required)
     * @param {string} [toolConfig.buttonColor] - RGBA button background color, e.g., "rgba(161, 60, 41, 0.9)" (optional)
     * @param {string} [toolConfig.borderColor] - RGBA border color, e.g., "rgba(161, 60, 41, 0.5)" (optional)
     * @param {string} [toolConfig.iconColor] - Icon color, any valid CSS color, e.g., "#ff0000" (optional)
     * @param {number} [toolConfig.order] - Order/priority for button placement, lower numbers appear first (optional)
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
                tooltip: toolConfig.tooltip || toolConfig.title || toolConfig.name || toolId, // Use tooltip, title, name, or fallback to toolId
                onClick: toolConfig.onClick
            };
            
            // Add optional label if provided
            if (toolConfig.label) {
                itemData.label = toolConfig.label;
            }
            
            // Add optional toggleable if provided (for default-mode groups)
            if (toolConfig.toggleable !== undefined) {
                itemData.toggleable = toolConfig.toggleable; // Boolean: makes button toggleable
            }
            
            // Add optional active state if provided
            if (toolConfig.active !== undefined) {
                // Can be boolean or function that returns boolean
                if (typeof toolConfig.active === 'function') {
                    itemData.active = toolConfig.active();
                } else {
                    itemData.active = toolConfig.active;
                }
            }
            
            // Add optional buttonColor if provided
            if (toolConfig.buttonColor) {
                itemData.buttonColor = toolConfig.buttonColor; // RGBA string, e.g., "rgba(161, 60, 41, 0.9)"
            }
            
            // Add optional borderColor if provided
            if (toolConfig.borderColor) {
                itemData.borderColor = toolConfig.borderColor; // RGBA string, e.g., "rgba(161, 60, 41, 0.5)"
            }
            
            // Add optional iconColor if provided
            if (toolConfig.iconColor) {
                itemData.iconColor = toolConfig.iconColor; // Any valid CSS color, e.g., "#ff0000" or "rgba(255, 0, 0, 1.0)"
            }
            
            // Add optional order if provided
            if (toolConfig.order !== undefined && toolConfig.order !== null) {
                itemData.order = toolConfig.order; // Number, lower values appear first
            }
            
            // Add optional group if provided (items without group go to 'default' group)
            if (toolConfig.group) {
                itemData.group = toolConfig.group; // Group ID, e.g., 'line-width'
            }
            
            // Log the complete itemData being sent to Blacksmith API
            console.log(`${MODULE.NAME}: Registering secondary bar item:`, {
                barTypeId: barTypeId,
                itemId: itemId,
                group: toolConfig.group || 'default',
                itemData: itemData,
                fullConfig: JSON.stringify(itemData, null, 2)
            });
            
            if (typeof BlacksmithUtils !== 'undefined') {
                BlacksmithUtils.postConsoleAndNotification(
                    MODULE.NAME,
                    'CARTOGRAPHER | Menubar | Registering secondary bar item',
                    `barTypeId: ${barTypeId}, itemId: ${itemId}, order: ${toolConfig.order ?? 'default'}, buttonColor: ${toolConfig.buttonColor ?? 'none'}, borderColor: ${toolConfig.borderColor ?? 'none'}, iconColor: ${toolConfig.iconColor ?? 'none'}`,
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
                        `Item ID: ${itemId}, Order: ${toolConfig.order ?? 'default'}`,
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


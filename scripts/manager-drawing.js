// ================================================================== 
// ===== MODULE IMPORTS =============================================
// ================================================================== 

import { MODULE } from './const.js';
import { socketManager } from './manager-sockets.js';
import { notify } from './utils-toast.js';
import { STAMPS, stampById, isStamp, isProceduralStamp, buildStamp, stampPalette, drawStamp, stampDrawingData, parseColor } from './utils-stamps.js';
import { wallStrokeSegments, segmentsPath, strokeDrawingData, distanceToPolyline, drawingHit, keptGroup } from './utils-drawing.js';
import { terrainById, terrainPalette, smoothPath, buildTerrain, MAX_TEXTURE } from './utils-terrain.js';

// ================================================================== 
// ===== DRAWING TOOL CLASS ========================================
// ================================================================== 

/**
 * Drawing Tool Manager
 * Handles temporary player drawings on the canvas for planning purposes
 * This is the first tool in the Cartographer multi-tool module
 */
/** The most stamps one drag puts down, so a long stroke cannot bury the scene. */
const MAX_SCATTER = 400;

/** How many specks of texture a dab of ground keeps after the first, when a stroke is kept on the scene. */
const KEPT_SPECKS = 5;

class DrawingTool {
    // Color palette constants - defined once, can be moved to settings later
    static strColor1 = 'rgba(38, 38, 38, 0.7)';   // Black
    static strColor2 = 'rgba(186, 60, 49, 0.7)';  // Red
    static strColor3 = 'rgba(76, 147, 204, 0.7)'; // Blue
    static strColor4 = 'rgba(3, 105, 41, 0.7)';   // Green
    static strColor5 = 'rgba(219, 130, 12, 0.7)'; // Yellow
    
    // Symbol size constants - defined once, can be moved to settings later
    static strSmallSymbolSize = 40;   // px square
    static strMediumSymbolSize = 80;  // px square
    static strLargeSymbolSize = 140;    // px square
    
    constructor() {
        this.name = 'drawing';
        this.displayName = 'Drawing Tool';
        this.version = '1.0.0';
        this.active = false;
        this.services = null;
        
        // Drawing state
        this.state = {
            active: false,
            drawingMode: 'sketch', // 'sketch' (freehand), 'line' (straight segment), 'box', 'ellipse', 'stamp', 'wall' (GM: walls and a line)
            stampStyle: 'plus', // any stamp id from utils-stamps.js (the markers 'plus', 'x', 'dot', arrows, 'square', plus trees, rocks...) - used when mode is stamp
            stamp: {
                natural: true, // draw a stamp in its own colours; off tints it with the brush colour
                keep: false, // write the stamp to the scene as Drawings, not a temporary drawing
                rotate: true, // turn and flip each stamp as it is put down
                jitter: true, // vary each stamp's size a little
                spacing: 1, // how far apart dragging scatters stamps, as a multiple of a stamp's size
                terrain: 'dirt', // terrain mode: the kind of path laid (utils-terrain.js)
                pathWidth: 1 // terrain mode: how wide a path is, in grid squares
            },
            wallShape: 'line', // wall mode: 'line' (one straight wall) or 'sketch' (freehand, simplified to walls)
            wallSnap: true, // wall mode: put wall ends on Foundry's wall snap points
            symbolSize: 'medium', // 'small', 'medium', 'large' - controls square bounding box size
            lineStyle: 'solid', // 'solid', 'dotted', 'dashed'
            brushSettings: {
                size: 6, // Default to medium (6px)
                color: DrawingTool.strColor1, // Default to first color (black)
                type: 'pen' // pen, marker, highlighter
            },
            timedEraseEnabled: false, // Toggle for timed erase feature
            currentDrawing: null,
            isDrawing: false,
            drawingPoints: [],
            drawingStartPoint: null,
            boxStartPoint: null, // For box mode: upper left corner
            ellipseStartPoint: null, // For ellipse mode: upper left of bounding box
            lineStartPoint: null, // For line tool: start of straight segment
            lastMousePosition: null // Last mouse position (for box/ellipse/line finishing)
        };
        
        // Hook IDs for cleanup
        this.hookIds = [];
        
        // PIXI drawings storage
        this._pixiDrawings = [];
        this._cleanupInterval = null; // Store interval ID for cleanup
        
        // Preview graphics (shown while drawing)
        this._previewGraphics = null;
        
        // Preview symbol (shown while backslash is held in symbol mode)
        this._previewSymbol = null;
        
        // Undo history - tracks last drawing for undo functionality
        this._lastDrawing = null;
        
        // Key-based activation
        this._keyDown = false;

        // What has been written to the scene (wall strokes, kept stamps), newest last, for undo
        this._kept = [];
        // What the next stamp will look like, and where a drag of stamps was last put down
        this._roll = null;
        this._scatter = null;
        // The eraser: whether it is down, what it has taken this stroke, and the work still going on
        this._erasing = false;
        this._erased = new Set();
        this._eraseBatch = { Wall: [], Drawing: [] };
        this._eraseQueue = Promise.resolve();
    }
    
    /**
     * Initialize the drawing tool
     * Called by cartographer.js after Canvas Layer is ready
     * @param {Object} services - Shared services from cartographer.js
     */
    async initialize(services) {
        this.services = services;
        
        // Load saved toolbar selections from user-scope settings
        const savedDrawingMode = game.settings.get(MODULE.ID, 'toolbar.drawingMode');
        const savedStampStyle = game.settings.get(MODULE.ID, 'toolbar.stampStyle');
        const savedSymbolSize = game.settings.get(MODULE.ID, 'toolbar.symbolSize');
        const savedLineWidth = game.settings.get(MODULE.ID, 'toolbar.lineWidth');
        const savedLineStyle = game.settings.get(MODULE.ID, 'toolbar.lineStyle');
        const savedColor = game.settings.get(MODULE.ID, 'toolbar.color');
        
        // Apply saved selections if valid; migrate legacy 'line' (freehand) to 'sketch'
        const symbolTypes = STAMPS.filter(stamp => stamp.legacy).map(stamp => stamp.id);
        if (savedDrawingMode === 'line') {
            // Legacy: 'line' was freehand – treat as sketch
            this.state.drawingMode = 'sketch';
            game.settings.set(MODULE.ID, 'toolbar.drawingMode', 'sketch');
        } else if (['sketch', 'line', 'box', 'ellipse', 'stamp'].includes(savedDrawingMode)
            || (savedDrawingMode === 'wall' && game.user.isGM)
            || savedDrawingMode === 'terrain') {
            this.state.drawingMode = savedDrawingMode;
        } else if (symbolTypes.includes(savedDrawingMode)) {
            this.state.drawingMode = 'stamp';
            this.state.stampStyle = savedDrawingMode;
            game.settings.set(MODULE.ID, 'toolbar.drawingMode', 'stamp');
            game.settings.set(MODULE.ID, 'toolbar.stampStyle', savedDrawingMode);
        }
        if (isStamp(savedStampStyle)) {
            this.state.stampStyle = savedStampStyle;
        }
        const savedStampOptions = game.settings.get(MODULE.ID, 'toolbar.stampOptions');
        for (const name of Object.keys(this.state.stamp)) {
            if (typeof savedStampOptions?.[name] === typeof this.state.stamp[name]) this.state.stamp[name] = savedStampOptions[name];
        }
        const savedWallOptions = game.settings.get(MODULE.ID, 'toolbar.wallOptions');
        if (['line', 'sketch'].includes(savedWallOptions?.shape)) this.state.wallShape = savedWallOptions.shape;
        if (typeof savedWallOptions?.snap === 'boolean') this.state.wallSnap = savedWallOptions.snap;
        if (['small', 'medium', 'large'].includes(savedSymbolSize)) {
            this.state.symbolSize = savedSymbolSize;
        }
        if (typeof savedLineWidth === 'number' && savedLineWidth > 0) {
            this.state.brushSettings.size = savedLineWidth;
        }
        if (['solid', 'dotted', 'dashed'].includes(savedLineStyle)) {
            this.state.lineStyle = savedLineStyle;
        }
        if (savedColor && typeof savedColor === 'string') {
            this.state.brushSettings.color = savedColor;
        } else {
            // Set default color to player color if no saved color
            // Handle different formats of game.user.color (Color object, string, number, or undefined)
            let playerColorHex = '#000000'; // Default fallback
            
            if (game.user?.color) {
                // Check if it's a Foundry Color object
                if (game.user.color.constructor?.name === 'Color') {
                    // Foundry Color object - convert to number and then to hex
                    // Color objects can be converted to numbers directly
                    const colorValue = Number(game.user.color);
                    if (!isNaN(colorValue)) {
                        playerColorHex = '#' + colorValue.toString(16).padStart(6, '0');
                    }
                } else if (typeof game.user.color === 'string') {
                    playerColorHex = game.user.color;
                } else if (typeof game.user.color === 'number') {
                    // Convert number to hex string
                    playerColorHex = '#' + game.user.color.toString(16).padStart(6, '0');
                }
            }
            
            // Ensure it's a valid hex string
            if (!playerColorHex.startsWith('#')) {
                playerColorHex = '#000000';
            }
            
            const r = parseInt(playerColorHex.slice(1, 3), 16);
            const g = parseInt(playerColorHex.slice(3, 5), 16);
            const b = parseInt(playerColorHex.slice(5, 7), 16);
            this.state.brushSettings.color = `rgba(${r}, ${g}, ${b}, 1.0)`;
        }
        
        // Load timed erase toggle state
        const savedTimedEraseEnabled = game.settings.get(MODULE.ID, 'toolbar.timedEraseEnabled');
        if (typeof savedTimedEraseEnabled === 'boolean') {
            this.state.timedEraseEnabled = savedTimedEraseEnabled;
        }
        
        // Register settings
        this.registerSettings();
        
        // Register hooks
        this.registerHooks();
        
        // Register toolbar tools (this will update button states based on loaded values)
        this.registerToolbarTools();
        
        // Register socket handlers for cross-client synchronization
        // Socket manager will handle initialization timing - can register before or after init
        socketManager.registerToolHandlers('drawing', {
            'created': (data) => this.handleRemoteDrawingCreation(data),
            'deleted': (data) => this.handleRemoteDrawingDeletion(data)
        });
        
        // If timed erase was enabled, start cleanup interval
        if (this.state.timedEraseEnabled) {
            this.scheduleCleanup();
        }
        
        console.log(`✅ ${MODULE.NAME}: ${this.displayName} initialized`);
    }
    
    /**
     * Cleanup when module unloads
     */
    cleanup() {
        // Deactivate if active (keyBased=true for teardown: no extra log, full handler/preview teardown)
        if (this.state.active) {
            this.deactivate(true);
        }
        
        // Detach canvas handlers
        this.detachCanvasHandlers();

        // What was written to a scene cannot be taken back from another
        this._kept = [];

        // Hooks are automatically cleaned up by BlacksmithHookManager via context
        this.hookIds = [];
        
        // Clear cleanup interval if it exists
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
            this._cleanupInterval = null;
        }
        
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
        if (typeof BlacksmithHookManager === 'undefined') {
            console.warn(`${MODULE.NAME}: BlacksmithHookManager not available`);
            return;
        }
        
        // Register scene change cleanup hook
        const sceneChangeHookId = BlacksmithHookManager.registerHook({
            name: 'updateScene',
            description: 'Cartographer: Clear temporary drawings on scene change',
            context: `${MODULE.ID}.drawing`,
            priority: 10,
            callback: () => {
                // Only clear and broadcast when we actually have drawings
                if (this._pixiDrawings?.length) this.clearAllDrawings();
            }
        });
        this.hookIds.push(sceneChangeHookId);
        
        // Register player disconnect cleanup hook
        const disconnectHookId = BlacksmithHookManager.registerHook({
            name: 'deleteUser',
            description: 'Cartographer: Clean up drawings on player disconnect',
            context: `${MODULE.ID}.drawing`,
            priority: 10,
            callback: (user) => {
                this.cleanupPlayerDrawings(user.id);
            }
        });
        this.hookIds.push(disconnectHookId);
        
        console.log(`${MODULE.NAME}: Hooks registered for drawing tool`);
    }
    
    /**
     * Register toolbar tools in Cartographer toolbar panel
     */
    async registerToolbarTools() {
        try {
            // Import toolbar manager dynamically to avoid circular dependency
            const { cartographerToolbar } = await import('./manager-toolbar.js');
            
            const self = this;
            
            // Opens the drawing tools window: the same tools, with the stamps and walls
            cartographerToolbar.registerTool(`${MODULE.ID}-drawing-tools`, {
                icon: "fa-solid fa-pen-ruler",
                tooltip: "Drawing tools: drawing, stamps and walls",
                label: "Tools",
                group: "Drawing Tools",
                order: 1,
                onClick: () => self.openWindow()
            });

            // Register Drawing Mode buttons (Sketch, Line, Box, Ellipse, Stamp)
            self._modeButtons = {
                sketch: `${MODULE.ID}-mode-sketch`,
                line: `${MODULE.ID}-mode-line`,
                box: `${MODULE.ID}-mode-box`,
                ellipse: `${MODULE.ID}-mode-ellipse`,
                stamp: `${MODULE.ID}-mode-stamp`
            };
            
            cartographerToolbar.registerTool(self._modeButtons.sketch, {
                icon: "fa-solid fa-pen",
                tooltip: "Sketch",
                group: "Drawing Mode",
                order: 1,
                active: () => self.state.drawingMode === 'sketch',
                onClick: () => {
                    self.setDrawingMode('sketch');
                    self.updateModeButtons();
                    if (!self.state.active) self.activate();
                }
            });

            cartographerToolbar.registerTool(self._modeButtons.line, {
                icon: "fa-solid fa-slash-forward",
                tooltip: "Line Tool",
                group: "Drawing Mode",
                order: 2,
                active: () => self.state.drawingMode === 'line',
                onClick: () => {
                    self.setDrawingMode('line');
                    self.updateModeButtons();
                    if (!self.state.active) self.activate();
                }
            });
            
            cartographerToolbar.registerTool(self._modeButtons.box, {
                icon: "fa-regular fa-square",
                tooltip: "Box Tool",
                group: "Drawing Mode",
                order: 3,
                active: () => self.state.drawingMode === 'box',
                onClick: () => {
                    self.setDrawingMode('box');
                    self.updateModeButtons();
                    if (!self.state.active) self.activate();
                }
            });

            cartographerToolbar.registerTool(self._modeButtons.ellipse, {
                icon: "fa-regular fa-circle",
                tooltip: "Ellipse Tool",
                group: "Drawing Mode",
                order: 4,
                active: () => self.state.drawingMode === 'ellipse',
                onClick: () => {
                    self.setDrawingMode('ellipse');
                    self.updateModeButtons();
                    if (!self.state.active) self.activate();
                }
            });

            cartographerToolbar.registerTool(self._modeButtons.stamp, {
                icon: "fa-solid fa-stamp",
                tooltip: "Stamp Tool",
                group: "Drawing Mode",
                order: 5,
                active: () => self.state.drawingMode === 'stamp',
                onClick: () => {
                    self.setDrawingMode('stamp');
                    self.updateModeButtons();
                    self.updateStampStyleButtons();
                    if (!self.state.active) self.activate();
                }
            });

            // Register Stamp Style buttons (which shape to use when Stamp tool is selected)
            self._stampStyleButtons = {
                plus: `${MODULE.ID}-stamp-style-plus`,
                x: `${MODULE.ID}-stamp-style-x`,
                dot: `${MODULE.ID}-stamp-style-dot`,
                arrow: `${MODULE.ID}-stamp-style-arrow`,
                arrowUp: `${MODULE.ID}-stamp-style-arrow-up`,
                arrowDown: `${MODULE.ID}-stamp-style-arrow-down`,
                arrowLeft: `${MODULE.ID}-stamp-style-arrow-left`,
                square: `${MODULE.ID}-stamp-style-square`
            };

            const stampStyleConfig = [
                { key: 'plus', icon: 'fa-solid fa-plus', tooltip: 'Plus', order: 1 },
                { key: 'x', icon: 'fa-solid fa-xmark', tooltip: 'X', order: 2 },
                { key: 'dot', icon: 'fa-solid fa-circle', tooltip: 'Dot', order: 3 },
                { key: 'arrow', icon: 'fa-solid fa-arrow-right', tooltip: 'Arrow Right', order: 4 },
                { key: 'arrowUp', icon: 'fa-solid fa-arrow-up', tooltip: 'Arrow Up', order: 5 },
                { key: 'arrowDown', icon: 'fa-solid fa-arrow-down', tooltip: 'Arrow Down', order: 6 },
                { key: 'arrowLeft', icon: 'fa-solid fa-arrow-left', tooltip: 'Arrow Left', order: 7 },
                { key: 'square', icon: 'fa-solid fa-square', tooltip: 'Rounded Square', order: 8 }
            ];
            stampStyleConfig.forEach(({ key, icon, tooltip, order }) => {
                const styleKey = key === 'arrowUp' ? 'arrow-up' : key === 'arrowDown' ? 'arrow-down' : key === 'arrowLeft' ? 'arrow-left' : key;
                cartographerToolbar.registerTool(self._stampStyleButtons[key], {
                    icon,
                    tooltip,
                    group: "Stamp Style",
                    order,
                    active: () => self.state.stampStyle === styleKey,
                    onClick: () => {
                        self.setStampStyle(styleKey);
                        self.updateStampStyleButtons();
                    }
                });
            });
            
            // Update mode and stamp-style buttons to reflect current state
            self.updateModeButtons();
            self.updateStampStyleButtons();
            
            // Register line style buttons in switch group (radio-button behavior)
            // Store references for updating active state
            self._lineStyleButtons = {
                solid: `${MODULE.ID}-line-style-solid`,
                dotted: `${MODULE.ID}-line-style-dotted`,
                dashed: `${MODULE.ID}-line-style-dashed`
            };
            
            cartographerToolbar.registerTool(self._lineStyleButtons.solid, {
                icon: "fa-solid fa-pipe",
                tooltip: "Solid line style",
                group: "Line Style", // Switch group
                order: 1,
                active: () => self.state.lineStyle === 'solid',
                onClick: () => {
                    self.state.lineStyle = 'solid';
                    self.updateLineStyleButtons();
                    // Save to client-scope setting
                    game.settings.set(MODULE.ID, 'toolbar.lineStyle', 'solid');
                }
            });
            
            cartographerToolbar.registerTool(self._lineStyleButtons.dotted, {
                icon: "fa-solid fa-ellipsis-vertical",
                tooltip: "Dotted line style",
                group: "Line Style", // Switch group
                order: 2,
                active: () => self.state.lineStyle === 'dotted',
                onClick: () => {
                    self.state.lineStyle = 'dotted';
                    self.updateLineStyleButtons();
                    // Save to client-scope setting
                    game.settings.set(MODULE.ID, 'toolbar.lineStyle', 'dotted');
                }
            });
            
            cartographerToolbar.registerTool(self._lineStyleButtons.dashed, {
                icon: "fa-sharp fa-solid fa-ellipsis-vertical",
                tooltip: "Dashed line style",
                group: "Line Style", // Switch group
                order: 3,
                active: () => self.state.lineStyle === 'dashed',
                onClick: () => {
                    self.state.lineStyle = 'dashed';
                    self.updateLineStyleButtons();
                    // Save to client-scope setting
                    game.settings.set(MODULE.ID, 'toolbar.lineStyle', 'dashed');
                }
            });
            
            // Update line style buttons to reflect the default style (solid)
            self.updateLineStyleButtons();
            
            // Register symbol size buttons in switch group (radio-button behavior)
            // Store references for updating active state
            self._symbolSizeButtons = {
                small: `${MODULE.ID}-symbol-size-small`,
                medium: `${MODULE.ID}-symbol-size-medium`,
                large: `${MODULE.ID}-symbol-size-large`
            };
            
            cartographerToolbar.registerTool(self._symbolSizeButtons.small, {
                icon: "fa-solid fa-circle-s",
                tooltip: "Small symbol size",
                group: "Stamp Size", // Switch group
                order: 1,
                active: () => self.state.symbolSize === 'small',
                onClick: () => {
                    self.setSymbolSize('small');
                    self.updateSymbolSizeButtons();
                }
            });
            
            cartographerToolbar.registerTool(self._symbolSizeButtons.medium, {
                icon: "fa-solid fa-circle-m",
                tooltip: "Medium symbol size",
                group: "Stamp Size", // Switch group
                order: 2,
                active: () => self.state.symbolSize === 'medium',
                onClick: () => {
                    self.setSymbolSize('medium');
                    self.updateSymbolSizeButtons();
                }
            });
            
            cartographerToolbar.registerTool(self._symbolSizeButtons.large, {
                icon: "fa-solid fa-circle-l",
                tooltip: "Large symbol size",
                group: "Stamp Size", // Switch group
                order: 3,
                active: () => self.state.symbolSize === 'large',
                onClick: () => {
                    self.setSymbolSize('large');
                    self.updateSymbolSizeButtons();
                }
            });
            
            // Update symbol size buttons to reflect the default size (medium)
            self.updateSymbolSizeButtons();
            
            // Register erase group buttons (available to all users)
            // Clear own drawings button - clears only the current user's drawings (for both GM and players)
            cartographerToolbar.registerTool(`${MODULE.ID}-clear`, {
                icon: "fa-solid fa-eraser",
                tooltip: "Clear your temporary drawings",
                group: "Utilities", // Utilities group
                order: 1,
                buttonColor: "rgba(161, 60, 41, 0.2)", // Red tint for destructive action
                onClick: () => self.clearMine()
            });
            
            // GM-only: Clear all drawings button
            if (game.user.isGM) {
                cartographerToolbar.registerTool(`${MODULE.ID}-clear-all`, {
                    icon: "fa-solid fa-trash-can",
                    tooltip: "Clear all temporary drawings (GM only)",
                    group: "Utilities", // Utilities group
                    order: 0, // Show before the regular clear button
                    buttonColor: "rgba(200, 40, 20, 0.3)", // Darker red for more destructive action
                    onClick: () => self.clearEveryone()
                });
            }
            
            // Undo button - removes the last drawing created by the current user
            cartographerToolbar.registerTool(`${MODULE.ID}-undo`, {
                icon: "fa-solid fa-undo",
                tooltip: "Undo last drawing",
                group: "Utilities", // Utilities group
                order: 2,
                onClick: () => {
                    self.undoLastDrawing();
                }
            });
            
            // Timed erase toggle button - applies to own drawings for players, all for GM
            cartographerToolbar.registerTool(`${MODULE.ID}-timed-erase`, {
                icon: "fa-solid fa-clock",
                tooltip: game.user.isGM
                    ? "Toggle timed erase (all drawings auto-delete after timeout)"
                    : "Toggle timed erase (your drawings auto-delete after timeout)",
                group: "Utilities", // Utilities group
                order: 3,
                toggleable: true, // Makes it a toggle button
                active: () => self.state.timedEraseEnabled,
                onClick: () => self.setTimedErase(!self.state.timedEraseEnabled)
            });
            
            // Register line width buttons in switch group (radio-button behavior)
            // Store references for updating active state
            self._lineWidthButtons = {
                thin: `${MODULE.ID}-line-width-thin`,
                medium: `${MODULE.ID}-line-width-medium`,
                thick: `${MODULE.ID}-line-width-thick`
            };
            
            cartographerToolbar.registerTool(self._lineWidthButtons.thin, {
                icon: "fa-solid fa-minus",
                tooltip: "Thin line (3px)",
                group: "Line Weight", // Switch group
                order: 1,
                active: () => self.state.brushSettings.size === 3,
                onClick: () => {
                    self.setBrushSettings({ size: 3 });
                    self.updateLineWidthButtons();
                    // Save to client-scope setting
                    game.settings.set(MODULE.ID, 'toolbar.lineWidth', 3);
                }
            });
            
            cartographerToolbar.registerTool(self._lineWidthButtons.medium, {
                icon: "fa-solid fa-grip-lines",
                tooltip: "Medium line (6px)",
                group: "Line Weight", // Switch group
                order: 2,
                active: () => self.state.brushSettings.size === 6,
                onClick: () => {
                    self.setBrushSettings({ size: 6 });
                    self.updateLineWidthButtons();
                    // Save to client-scope setting
                    game.settings.set(MODULE.ID, 'toolbar.lineWidth', 6);
                }
            });
            
            cartographerToolbar.registerTool(self._lineWidthButtons.thick, {
                icon: "fa-solid fa-bars",
                tooltip: "Thick line (12px)",
                group: "Line Weight", // Switch group
                order: 3,
                active: () => self.state.brushSettings.size === 12,
                onClick: () => {
                    self.setBrushSettings({ size: 12 });
                    self.updateLineWidthButtons();
                    // Save to client-scope setting
                    game.settings.set(MODULE.ID, 'toolbar.lineWidth', 12);
                }
            });
            
            // Helper function to convert hex color to rgba format
            const hexToRgba = (hex, alpha = 1.0) => {
                // Ensure hex is a string and starts with #
                if (typeof hex !== 'string' || !hex.startsWith('#')) {
                    hex = '#000000';
                }
                const r = parseInt(hex.slice(1, 3), 16);
                const g = parseInt(hex.slice(3, 5), 16);
                const b = parseInt(hex.slice(5, 7), 16);
                return `rgba(${r}, ${g}, ${b}, ${alpha})`;
            };
            
            // Helper function to convert rgba to hex format
            const rgbaToHex = (rgba) => {
                const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
                if (match) {
                    const r = parseInt(match[1], 10).toString(16).padStart(2, '0');
                    const g = parseInt(match[2], 10).toString(16).padStart(2, '0');
                    const b = parseInt(match[3], 10).toString(16).padStart(2, '0');
                    return `#${r}${g}${b}`;
                }
                return '#000000'; // fallback
            };
            
            // Get player color and convert to rgba
            // Handle different formats of game.user.color (Color object, string, number, or undefined)
            let playerColorHex = '#000000'; // Default fallback
            
            if (game.user?.color) {
                // Check if it's a Foundry Color object
                if (game.user.color.constructor?.name === 'Color') {
                    // Foundry Color object - convert to number and then to hex
                    const colorValue = Number(game.user.color);
                    if (!isNaN(colorValue)) {
                        playerColorHex = '#' + colorValue.toString(16).padStart(6, '0');
                    }
                } else if (typeof game.user.color === 'string') {
                    playerColorHex = game.user.color;
                } else if (typeof game.user.color === 'number') {
                    // Convert number to hex string
                    playerColorHex = '#' + game.user.color.toString(16).padStart(6, '0');
                }
            }
            
            // Ensure it's a valid hex string
            if (!playerColorHex.startsWith('#')) {
                playerColorHex = '#000000';
            }
            
            const playerColorRgba = hexToRgba(playerColorHex, 1.0);
            
            // Register color buttons in switch group (radio-button behavior)
            // Store references for updating active state
            self._colorButtons = {
                player: `${MODULE.ID}-color-player`,
                black: `${MODULE.ID}-color-black`,
                red: `${MODULE.ID}-color-red`,
                blue: `${MODULE.ID}-color-blue`,
                green: `${MODULE.ID}-color-green`,
                yellow: `${MODULE.ID}-color-yellow`
            };
            
            // Define color palette using static color constants
            // These can be moved to settings later for user customization
            const colorPalette = {
                player: { rgba: playerColorRgba, name: 'Player Color', icon: 'fa-solid fa-user' },
                black: { rgba: DrawingTool.strColor1, name: 'Black', icon: 'fa-solid fa-circle' },
                red: { rgba: DrawingTool.strColor2, name: 'Red', icon: 'fa-solid fa-circle' },
                blue: { rgba: DrawingTool.strColor3, name: 'Blue', icon: 'fa-solid fa-circle' },
                green: { rgba: DrawingTool.strColor4, name: 'Green', icon: 'fa-solid fa-circle' },
                yellow: { rgba: DrawingTool.strColor5, name: 'Yellow', icon: 'fa-solid fa-circle' }
            };
            
            // Register color buttons
            Object.entries(colorPalette).forEach(([colorKey, colorData], index) => {
                // Convert rgba to hex for iconColor
                const iconColorHex = rgbaToHex(colorData.rgba);
                
                cartographerToolbar.registerTool(self._colorButtons[colorKey], {
                    icon: colorData.icon,
                    tooltip: `${colorData.name} color`,
                    group: "Color", // Switch group
                    order: index + 1, // Player color is first (order: 1)
                    iconColor: iconColorHex, // Icon color using color variable (converted to hex)
                    active: () => self.state.brushSettings.color === colorData.rgba,
                    onClick: () => {
                        self.setBrushSettings({ color: colorData.rgba });
                        self.updateColorButtons();
                        // Save to client-scope setting
                        game.settings.set(MODULE.ID, 'toolbar.color', colorData.rgba);
                    }
                });
            });
            
            // Update line width buttons to reflect the default size (medium = 6px)
            self.updateLineWidthButtons();
            
            // Update timed erase button to reflect saved state
            self.updateTimedEraseButton();
            
            // Update color buttons to reflect the default color (black)
            self.updateColorButtons();
            
            console.log(`${MODULE.NAME}: Toolbar tools registered in Cartographer toolbar`);
        } catch (error) {
            console.error(`${MODULE.NAME}: Error registering toolbar tools:`, error);
        }
    }
    
    /**
     * Register keyboard handlers for backslash (\) key activation
     */
    /**
     * Handle hold key down event (called by Foundry keybinding system)
     * For "hold" mode: activates tool when key is pressed
     */
    onHoldKeyDown() {
        if (this._fromWindow) return; // the window's press-and-drag is in charge
        if (this._keyDown) return; // already down
        this._keyDown = true;

        // Activate tool in "keyBased" mode (no spam logging)
        this.activate(true);

        // Do NOT start drawing here.
        // Current behavior starts drawing on first pointermove.
        // Symbol modes will stamp on click.
    }
    
    /**
     * Handle hold key up event (called by Foundry keybinding system)
     * For "hold" mode: finishes drawing and deactivates tool when key is released
     */
    onHoldKeyUp() {
        if (this._fromWindow) return;
        if (!this._keyDown) return;
        this._keyDown = false;

        // If currently drawing, finish it now
        if (this.state.isDrawing) {
            if (this._strokeMode() === 'box') {
                this.finishBoxDrawing(null);
            } else if (this._strokeMode() === 'ellipse') {
                this.finishEllipseDrawing(null);
            } else if (this._strokeMode() === 'line') {
                this.finishLineDrawing(null);
            } else {
                // Sketch: get current mouse position
                const mouse = canvas?.app?.renderer?.plugins?.interaction?.mouse?.global;
                if (mouse) {
                    const rect = canvas.app.view.getBoundingClientRect();
                    const syntheticEvent = {
                        clientX: mouse.x + rect.left,
                        clientY: mouse.y + rect.top
                    };
                    this.finishDrawing(syntheticEvent);
                } else {
                    this.finishDrawing({ clientX: 0, clientY: 0 });
                }
            }
        }

        // Deactivate tool (keyBased)
        this.deactivate(true);

        // Remove symbol preview
        this.removePreviewSymbol();
    }
    
    /**
     * Handle toggle key press (called by Foundry keybinding system)
     * For "toggle" mode: toggles tool on/off with each key press
     */
    toggleFromHotkey() {
        // If active, turning off
        if (this.state.active) {
            // Finish any in-progress drawing (equivalent to key-up in hold mode)
            if (this.state.isDrawing) {
                if (this._strokeMode() === 'box') {
                    this.finishBoxDrawing(null);
                } else if (this._strokeMode() === 'ellipse') {
                    this.finishEllipseDrawing(null);
                } else if (this._strokeMode() === 'line') {
                    this.finishLineDrawing(null);
                } else {
                    // Sketch: get current mouse position
                    const mouse = canvas?.app?.renderer?.plugins?.interaction?.mouse?.global;
                    if (mouse) {
                        const rect = canvas.app.view.getBoundingClientRect();
                        const syntheticEvent = {
                            clientX: mouse.x + rect.left,
                            clientY: mouse.y + rect.top
                        };
                        this.finishDrawing(syntheticEvent);
                    } else {
                        this.finishDrawing({ clientX: 0, clientY: 0 });
                    }
                }
            }

            this.deactivate(true);
            this.removePreviewSymbol();
            this._keyDown = false;
            return;
        }

        // Turning on
        this._keyDown = true; // keep current pointer handlers behavior consistent
        this.activate(true);
    }
    
    /**
     * Update cursor style based on tool state
     */
    updateCursor() {
        if (!canvas || !canvas.app || !canvas.app.view) return;
        
        if (this.state.active) {
            // Change to crosshair when tool is active
            canvas.app.view.style.cursor = 'crosshair';
        } else {
            // Reset to default when tool is inactive
            canvas.app.view.style.cursor = '';
        }
    }
    
    /**
     * Update preview symbol to follow mouse cursor
     * @param {PointerEvent} event - Pointer event with coordinates
     */
    updatePreviewSymbol(event) {
        if (!this.services || !this.services.canvasLayer) return;
        if (this.state.drawingMode !== 'stamp') return; // Only for stamp mode
        
        // Get world coordinates from event
        const rect = canvas.app.view.getBoundingClientRect();
        const screenX = event.clientX - rect.left;
        const screenY = event.clientY - rect.top;
        const worldPoint = canvas.app.stage.toLocal(new PIXI.Point(screenX, screenY));
        const worldX = worldPoint.x;
        const worldY = worldPoint.y;
        
        // Remove existing preview if it exists
        this.removePreviewSymbol();
        
        // The new stamps preview as they will be placed
        if (isProceduralStamp(this.state.stampStyle)) {
            this._previewStamp(worldX, worldY);
            return;
        }

        // Create new preview symbol at mouse position
        // Use a semi-transparent version for preview
        const layer = this.services.canvasLayer;
        const graphics = new PIXI.Graphics();
        
        // Symbol size determines the square bounding box
        const symbolSizeMap = {
            small: DrawingTool.strSmallSymbolSize,
            medium: DrawingTool.strMediumSymbolSize,
            large: DrawingTool.strLargeSymbolSize
        };
        const squareSize = symbolSizeMap[this.state.symbolSize] || symbolSizeMap.medium;
        
        // Stroke width is simply a proportion of the symbol size
        const strokeProportion = 0.30;
        const strokeWidth = squareSize * strokeProportion;
        const strokeColor = this.cssToPixiColor(this.state.brushSettings.color);
        const symbolAlpha = 0.5; // 50% opacity for preview (always fully opaque base)
        
        // Use rounded line joins and caps
        try {
            graphics.lineStyle({
                width: strokeWidth,
                color: strokeColor,
                alpha: symbolAlpha,
                lineJoin: 'round',
                lineCap: 'round'
            });
        } catch (e) {
            graphics.lineStyle(strokeWidth, strokeColor, symbolAlpha);
        }
        
        // Draw preview symbol (same as actual symbol but semi-transparent)
        const halfSize = squareSize / 2;
        const padding = squareSize * 0.1;
        const shadowOffset = 2; // Shadow offset in pixels
        const shadowAlpha = symbolAlpha * 0.3; // Shadow opacity (30% of main alpha)
        const shadowColor = 0x000000; // Black shadow
        
        const style = this.state.stampStyle;
        switch (style) {
            case 'plus':
                // Draw shadow plus
                const plusArmLength = halfSize - padding;
                graphics.lineStyle(strokeWidth, shadowColor, shadowAlpha);
                graphics.moveTo(worldX - plusArmLength + shadowOffset, worldY + shadowOffset);
                graphics.lineTo(worldX + plusArmLength + shadowOffset, worldY + shadowOffset);
                graphics.moveTo(worldX + shadowOffset, worldY - plusArmLength + shadowOffset);
                graphics.lineTo(worldX + shadowOffset, worldY + plusArmLength + shadowOffset);
                
                // Draw main plus
                try {
                    graphics.lineStyle({
                        width: strokeWidth,
                        color: strokeColor,
                        alpha: symbolAlpha,
                        lineJoin: 'round',
                        lineCap: 'round'
                    });
                } catch (e) {
                    graphics.lineStyle(strokeWidth, strokeColor, symbolAlpha);
                }
                graphics.moveTo(worldX - plusArmLength, worldY);
                graphics.lineTo(worldX + plusArmLength, worldY);
                graphics.moveTo(worldX, worldY - plusArmLength);
                graphics.lineTo(worldX, worldY + plusArmLength);
                break;
                
            case 'x':
                // Draw shadow X
                const xArmLength = (halfSize - padding) * 0.707;
                graphics.lineStyle(strokeWidth, shadowColor, shadowAlpha);
                graphics.moveTo(worldX - xArmLength + shadowOffset, worldY - xArmLength + shadowOffset);
                graphics.lineTo(worldX + xArmLength + shadowOffset, worldY + xArmLength + shadowOffset);
                graphics.moveTo(worldX + xArmLength + shadowOffset, worldY - xArmLength + shadowOffset);
                graphics.lineTo(worldX - xArmLength + shadowOffset, worldY + xArmLength + shadowOffset);
                
                // Draw main X
                try {
                    graphics.lineStyle({
                        width: strokeWidth,
                        color: strokeColor,
                        alpha: symbolAlpha,
                        lineJoin: 'round',
                        lineCap: 'round'
                    });
                } catch (e) {
                    graphics.lineStyle(strokeWidth, strokeColor, symbolAlpha);
                }
                graphics.moveTo(worldX - xArmLength, worldY - xArmLength);
                graphics.lineTo(worldX + xArmLength, worldY + xArmLength);
                graphics.moveTo(worldX + xArmLength, worldY - xArmLength);
                graphics.lineTo(worldX - xArmLength, worldY + xArmLength);
                break;
                
            case 'dot':
                // Draw shadow circle
                const dotRadius = halfSize - padding;
                graphics.beginFill(shadowColor, shadowAlpha);
                graphics.drawCircle(worldX + shadowOffset, worldY + shadowOffset, dotRadius);
                graphics.endFill();
                
                // Draw main circle
                graphics.beginFill(strokeColor, symbolAlpha);
                graphics.drawCircle(worldX, worldY, dotRadius);
                graphics.endFill();
                break;
                
            case 'arrow':
            case 'arrow-up':
            case 'arrow-down':
            case 'arrow-left':
                // Chevron arrow with notched edge - using drawPolygon
                // Scale to match circle visual size (circle uses radius = halfSize - padding)
                // Arrow should be roughly same visual size, so scale down to ~85% of available space
                const previewArrowScaleFactor = 0.85;
                const previewArrowScaledHalfSize = (halfSize - padding) * previewArrowScaleFactor;
                
                let previewArrowPoints, previewShadowPoints;
                
                if (style === 'arrow') {
                    // Right arrow (original)
                    const leftX = worldX - previewArrowScaledHalfSize;
                    const rightX = worldX + previewArrowScaledHalfSize;
                    const centerY = worldY;
                    const topY = centerY - previewArrowScaledHalfSize;
                    const bottomY = centerY + previewArrowScaledHalfSize;
                    const availableWidth = 2 * previewArrowScaledHalfSize;
                    const notchX = leftX + (availableWidth * 0.25);
                    const notchY = centerY;
                    
                    previewArrowPoints = [
                        leftX, topY,
                        notchX, notchY,
                        leftX, bottomY,
                        rightX, centerY
                    ];
                    previewShadowPoints = [
                        leftX + shadowOffset, topY + shadowOffset,
                        notchX + shadowOffset, notchY + shadowOffset,
                        leftX + shadowOffset, bottomY + shadowOffset,
                        rightX + shadowOffset, centerY + shadowOffset
                    ];
                } else if (style === 'arrow-up') {
                    // Up arrow
                    const leftX = worldX - previewArrowScaledHalfSize;
                    const rightX = worldX + previewArrowScaledHalfSize;
                    const centerX = worldX;
                    const topY = worldY - previewArrowScaledHalfSize;
                    const bottomY = worldY + previewArrowScaledHalfSize;
                    const availableHeight = 2 * previewArrowScaledHalfSize;
                    const notchX = centerX;
                    const notchY = bottomY - (availableHeight * 0.25);
                    
                    previewArrowPoints = [
                        leftX, bottomY,
                        notchX, notchY,
                        rightX, bottomY,
                        centerX, topY
                    ];
                    previewShadowPoints = [
                        leftX + shadowOffset, bottomY + shadowOffset,
                        notchX + shadowOffset, notchY + shadowOffset,
                        rightX + shadowOffset, bottomY + shadowOffset,
                        centerX + shadowOffset, topY + shadowOffset
                    ];
                } else if (style === 'arrow-down') {
                    // Down arrow
                    const leftX = worldX - previewArrowScaledHalfSize;
                    const rightX = worldX + previewArrowScaledHalfSize;
                    const centerX = worldX;
                    const topY = worldY - previewArrowScaledHalfSize;
                    const bottomY = worldY + previewArrowScaledHalfSize;
                    const availableHeight = 2 * previewArrowScaledHalfSize;
                    const notchX = centerX;
                    const notchY = topY + (availableHeight * 0.25);
                    
                    previewArrowPoints = [
                        leftX, topY,
                        notchX, notchY,
                        rightX, topY,
                        centerX, bottomY
                    ];
                    previewShadowPoints = [
                        leftX + shadowOffset, topY + shadowOffset,
                        notchX + shadowOffset, notchY + shadowOffset,
                        rightX + shadowOffset, topY + shadowOffset,
                        centerX + shadowOffset, bottomY + shadowOffset
                    ];
                } else if (style === 'arrow-left') {
                    // Left arrow
                    const leftX = worldX - previewArrowScaledHalfSize;
                    const rightX = worldX + previewArrowScaledHalfSize;
                    const centerY = worldY;
                    const topY = centerY - previewArrowScaledHalfSize;
                    const bottomY = centerY + previewArrowScaledHalfSize;
                    const availableWidth = 2 * previewArrowScaledHalfSize;
                    const notchX = rightX - (availableWidth * 0.25);
                    const notchY = centerY;
                    
                    previewArrowPoints = [
                        rightX, topY,
                        notchX, notchY,
                        rightX, bottomY,
                        leftX, centerY
                    ];
                    previewShadowPoints = [
                        rightX + shadowOffset, topY + shadowOffset,
                        notchX + shadowOffset, notchY + shadowOffset,
                        rightX + shadowOffset, bottomY + shadowOffset,
                        leftX + shadowOffset, centerY + shadowOffset
                    ];
                }
                
                // Draw shadow arrow
                graphics.beginFill(shadowColor, shadowAlpha);
                graphics.drawPolygon(previewShadowPoints);
                graphics.endFill();
                
                // Draw main arrow
                graphics.beginFill(strokeColor, symbolAlpha);
                graphics.drawPolygon(previewArrowPoints);
                graphics.endFill();
                break;
                
            case 'square':
                // Rounded square - using drawRoundedRect
                // Scale to match circle visual size (circle uses radius = halfSize - padding)
                const squareScaleFactor = 0.85;
                const squareScaledHalfSize = (halfSize - padding) * squareScaleFactor;
                const squareSize = squareScaledHalfSize * 2;
                const cornerRadius = squareSize * 0.2; // 20% corner radius for rounded corners
                
                // Draw shadow rounded square
                graphics.beginFill(shadowColor, shadowAlpha);
                graphics.drawRoundedRect(
                    worldX - squareScaledHalfSize + shadowOffset,
                    worldY - squareScaledHalfSize + shadowOffset,
                    squareSize,
                    squareSize,
                    cornerRadius
                );
                graphics.endFill();
                
                // Draw main rounded square
                graphics.beginFill(strokeColor, symbolAlpha);
                graphics.drawRoundedRect(
                    worldX - squareScaledHalfSize,
                    worldY - squareScaledHalfSize,
                    squareSize,
                    squareSize,
                    cornerRadius
                );
                graphics.endFill();
                break;
        }
        
        // Add to layer and store reference
        layer.addChild(graphics);
        this._previewSymbol = graphics;
    }
    
    /**
     * Remove preview symbol from canvas
     */
    removePreviewSymbol() {
        if (this._previewSymbol && this._previewSymbol.parent && this.services?.canvasLayer) {
            this.services.canvasLayer.removeChild(this._previewSymbol);
            this._previewSymbol.destroy();
            this._previewSymbol = null;
        }
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
     * @param {boolean} keyBased - If true, activated via key press (no console message)
     */
    activate(keyBased = false) {
        if (!this.canUserDraw()) {
            if (!keyBased) {
                console.warn(`${MODULE.NAME}: User cannot draw - check settings`);
            }
            return false;
        }
        
        if (this.state.active) return true; // Already active
        
        this.state.active = true;
        this.notifyChange();

        // Step off Foundry's own drawing layer so its tools and ours cannot both
        // claim a drag. Switching the active layer is what actually does that.
        if (canvas.drawings) {
            // On v14 `canvas.drawings.controls` does not exist -- `controls`
            // belongs to an individual placeable and to SceneControls, not to a
            // layer -- so this is inert there, and the guard is why it is inert
            // rather than an error. Whether it ever did anything on v13 is not
            // established, and v13 is still supported, so it stays: a guarded
            // no-op costs nothing, and removing it would be a silent behaviour
            // change on a version we cannot currently test. See TODO.
            if (canvas.drawings.controls) {
                canvas.drawings.controls.visible = false;
                canvas.drawings.controls.active = false;
            }

            if (canvas.activeLayer?.name === "drawings") {
                canvas.tokens.activate();
            }
        }
        
        this.attachCanvasHandlers();
        
        // Change cursor to crosshair when tool is active
        this.updateCursor();
        
        if (!keyBased) {
            console.log(`${MODULE.NAME}: ${this.displayName} activated`);
        }
        return true;
    }
    
    /**
     * Deactivate the drawing tool
     * @param {boolean} keyBased - If true, deactivated via key release (no console message)
     */
    deactivate(keyBased = false) {
        if (!this.state.active) return; // Already inactive
        
        this.state.active = false;
        this._fromWindow = false;
        this._endScatter();
        this.notifyChange();
        this.detachCanvasHandlers();
        
        // Remove preview symbol if it exists
        this.removePreviewSymbol();
        
        // Reset cursor to default
        this.updateCursor();
        
        // Cancel any active drawing
        if (this.state.isDrawing) {
            this.cancelDrawing();
        }
        
        // Re-enable Foundry's default drawing controls. Inert on v14, where the
        // member does not exist; see the note where they are hidden.
        if (canvas.drawings && canvas.drawings.controls) {
            canvas.drawings.controls.visible = true;
        }

        if (!keyBased) {
            console.log(`${MODULE.NAME}: ${this.displayName} deactivated`);
        }
    }
    
    /**
     * Fade out and remove a PIXI graphics object
     * @param {PIXI.Graphics} graphics - Graphics object to fade out
     * @param {number} duration - Fade duration in milliseconds (default: 300ms)
     * @param {Function} onComplete - Optional callback when fade completes
     */
    _fadeOutAndRemove(graphics, duration = 300, onComplete = null) {
        if (!graphics || !graphics.parent) {
            if (onComplete) onComplete();
            return;
        }
        
        const startAlpha = graphics.alpha;
        const startTime = Date.now();
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1.0);
            
            // Ease out animation (smooth deceleration)
            const easedProgress = 1 - Math.pow(1 - progress, 3);
            graphics.alpha = startAlpha * (1 - easedProgress);
            
            if (progress < 1.0) {
                requestAnimationFrame(animate);
            } else {
                // Fade complete - remove and destroy
                const layer = this.services?.canvasLayer;
                if (layer && graphics.parent === layer) {
                    layer.removeChild(graphics);
                }
                graphics.destroy();
                if (onComplete) onComplete();
            }
        };
        
        requestAnimationFrame(animate);
    }
    
    /**
     * Clear all PIXI drawings
     * @param {boolean} broadcast - Whether to broadcast deletion to other clients
     */
    clearAllDrawings(broadcast = true) {
        if (!this._pixiDrawings || !this.services?.canvasLayer) return;
        if (this._pixiDrawings.length === 0) return; // nothing to clear, skip broadcast and log
        
        // Fade out all drawings
        this._pixiDrawings.forEach(drawing => {
            if (drawing.graphics && drawing.graphics.parent) {
                this._fadeOutAndRemove(drawing.graphics, 300);
            }
        });
        
        this._pixiDrawings = [];
        this._cleanupScheduled = false;
        
        // Broadcast deletion to other clients
        if (broadcast) {
            this.broadcastDrawingDeletion(true);
        }
        
        console.log(`${MODULE.NAME}: All temporary drawings cleared`);
    }
    
    /**
     * Clear drawings created by the current user
     * @param {string} userId - User ID to clear drawings for (defaults to current user)
     * @param {boolean} broadcast - Whether to broadcast the deletion
     */
    clearUserDrawings(userId = game.user.id, broadcast = true) {
        if (!this._pixiDrawings || !this.services?.canvasLayer) return 0;
        if (this._pixiDrawings.length === 0) return 0; // nothing to clear
        
        const layer = this.services.canvasLayer;
        let removedCount = 0;
        
        this._pixiDrawings = this._pixiDrawings.filter(drawing => {
            if (drawing.userId === userId) {
                // Fade out and remove
                if (drawing.graphics && drawing.graphics.parent) {
                    this._fadeOutAndRemove(drawing.graphics, 300);
                }
                removedCount++;
                return false; // Remove from array
            }
            return true; // Keep in array
        });
        
        // Clear last drawing if it was removed
        if (this._lastDrawing && this._lastDrawing.userId === userId) {
            // Check if it still exists in the array
            const stillExists = this._pixiDrawings.some(d => d.id === this._lastDrawing.id);
            if (!stillExists) {
                this._lastDrawing = null;
            }
        }
        
        // Broadcast and log only when we actually removed something
        if (removedCount > 0) {
            if (broadcast) this.broadcastDrawingDeletion(false, userId);
            console.log(`${MODULE.NAME}: Cleared ${removedCount} drawing(s) for user ${userId}`);
        }
        return removedCount;
    }
    
    /**
     * Undo the last drawing created by the current user
     */
    undoLastDrawing() {
        // What was written to the scene last, if it came after the last temporary drawing
        if (this._keptIsNewest()) {
            void this._undoKept();
            return;
        }
        if (!this._lastDrawing || !this.services?.canvasLayer) {
            notify('Nothing to undo', {
                subtitle: 'You have no recent drawings on this scene',
                type: 'warn',
                icon: 'fa-solid fa-undo',
                stackKey: `${MODULE.ID}-undo`
            });
            return;
        }

        // Only allow undoing own drawings (unless GM)
        if (!game.user.isGM && this._lastDrawing.userId !== game.user.id) {
            notify('Cannot undo that drawing', {
                subtitle: 'You can only undo your own drawings',
                type: 'warn',
                icon: 'fa-solid fa-undo',
                stackKey: `${MODULE.ID}-undo`
            });
            return;
        }
        
        const layer = this.services.canvasLayer;
        const drawingToRemove = this._lastDrawing;
        
        // Fade out and remove
        if (drawingToRemove.graphics && drawingToRemove.graphics.parent) {
            this._fadeOutAndRemove(drawingToRemove.graphics, 300);
        }
        
        // A stroke of stamps -- a drag -- is one thing to undo
        const stroke = drawingToRemove.group ? this._pixiDrawings.filter(d => d.group === drawingToRemove.group && d.id !== drawingToRemove.id) : [];
        for (const other of stroke) {
            if (other.graphics?.parent) this._fadeOutAndRemove(other.graphics, 300);
        }
        const gone = new Set([drawingToRemove.id, ...stroke.map(d => d.id)]);
        this._pixiDrawings = this._pixiDrawings.filter(d => !gone.has(d.id));
        
        // Clear last drawing reference
        this._lastDrawing = null;
        
        // Find the most recent drawing by this user for next undo
        const userDrawings = this._pixiDrawings.filter(d => d.userId === game.user.id);
        if (userDrawings.length > 0) {
            // Sort by creation time (most recent first)
            userDrawings.sort((a, b) => b.createdAt - a.createdAt);
            this._lastDrawing = userDrawings[0];
        }
        
        // Broadcast specific drawing deletion to other clients (by ID, not all user drawings)
        for (const id of gone) this.broadcastDrawingDeletion(false, game.user.id, id);
        
        notify('Drawing undone', {
            subtitle: this._lastDrawing ? 'Click again to undo the one before it' : 'That was your last drawing',
            icon: 'fa-solid fa-undo',
            stackKey: `${MODULE.ID}-undo` // rapid undos replace rather than pile up
        });
    }
    
    /**
     * Clean up drawings from a specific player
     * @param {string} userId - User ID to clean up drawings for
     */
    cleanupPlayerDrawings(userId) {
        if (!this._pixiDrawings || !this.services?.canvasLayer) return;
        if (this._pixiDrawings.length === 0) return; // nothing to clean up
        
        const layer = this.services.canvasLayer;
        let removedCount = 0;
        
        this._pixiDrawings = this._pixiDrawings.filter(drawing => {
            // Check if drawing belongs to the specified user
            if (drawing.userId === userId) {
                if (drawing.graphics && drawing.graphics.parent) {
                    layer.removeChild(drawing.graphics);
                    drawing.graphics.destroy();
                }
                removedCount++;
                return false; // Remove from array
            }
            return true; // Keep in array
        });
        
        if (removedCount > 0) {
            console.log(`${MODULE.NAME}: Cleaned up ${removedCount} drawings for disconnected player`);
        }
    }
    
    /**
     * Check if user can draw
     * @returns {boolean}
     */
    canUserDraw() {
        if (!this.services) return false;
        
        // GMs can always draw (unless explicitly disabled)
        if (game.user.isGM) {
            return true;
        }
        
        // Check if drawing is enabled for players
        const enabled = BlacksmithUtils?.getSettingSafely(
            MODULE.ID, 
            'drawing.enablePlayerDrawing', 
            true
        );
        
        if (!enabled) return false;
        
        // Additional permission checks can be added here
        // (e.g., per-player permissions, role-based access)
        return true;
    }
    
    /**
     * Attach canvas event handlers for drawing
     */
    attachCanvasHandlers() {
        if (!canvas || !canvas.app || !canvas.ready) {
            console.warn(`${MODULE.NAME}: Canvas not ready for drawing handlers`);
            return;
        }
        
        // Store reference to this for event handlers
        const self = this;
        
        // Attach pointer event handlers with capture phase to intercept before Foundry
        // Handlers work for both "hold" and "toggle" modes
        this._handlePointerDown = (event) => {
            // Started from the window, the press is taken on the window instead (_handleWindowDown)
            if (self._fromWindow) return false;
            // Primary guard: only run when tool is active
            if (!self.state.active) {
                return false;
            }
            
            // For hold mode: require _keyDown to be true
            // For toggle mode: _keyDown remains true while active, so this check still works
            if (!self._keyDown) {
                return false;
            }
            
            // Box/ellipse mode: ignore mouse clicks (drawing starts on mouse move, not on click)
            if (self._strokeMode() === 'box' || self._strokeMode() === 'ellipse') {
                event.preventDefault();
                event.stopPropagation();
                return false;
            }
            
            // If in stamp mode, stamp the selected style on click
            if (self._strokeMode() === 'stamp' && self.canUserDraw() && !event.ctrlKey && !event.altKey) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                self._beginScatter(event);
                self.stampSymbol(self.state.stampStyle, event);
                return false;
            }
            
            // Sketch/line/box/ellipse: ignore mouse clicks (start on first move; line/box/ellipse finish on key release)
            if (['sketch', 'line', 'box', 'ellipse'].includes(self._strokeMode())) {
                event.preventDefault();
                event.stopPropagation();
                return false;
            }
        };
        
        this._handlePointerMove = (event) => {
            if (self._fromWindow) return self._windowPointerMove(event);
            // Primary guard: only run when tool is active
            if (!self.state.active) {
                return false;
            }
            
            // For hold mode: require _keyDown to be true
            // For toggle mode: _keyDown remains true while active, so this check still works
            if (self._keyDown) {
                if (self._strokeMode() === 'sketch') {
                    // Sketch: start/continue freehand on mouse move
                    if (!self.state.isDrawing) {
                        self.startDrawing(event);
                    } else {
                        self.updateDrawing(event);
                    }
                } else if (self._strokeMode() === 'line') {
                    // Line tool: start/update straight segment on mouse move
                    if (!self.state.isDrawing) {
                        self.startLineDrawing(event);
                    } else {
                        self.updateLinePreview(event);
                    }
                } else if (self._strokeMode() === 'box') {
                    // Box mode: start/update box drawing on mouse move
                    if (!self.state.isDrawing) {
                        self.startBoxDrawing(event);
                    } else {
                        self.updateBoxPreview(event);
                    }
                } else if (self._strokeMode() === 'ellipse') {
                    // Ellipse mode: start/update ellipse drawing on mouse move
                    if (!self.state.isDrawing) {
                        self.startEllipseDrawing(event);
                    } else {
                        self.updateEllipsePreview(event);
                    }
                } else if (self._strokeMode() === 'stamp') {
                    // Stamp mode: dragging with the button down scatters more of the same stamp;
                    // otherwise the preview follows the mouse
                    if (self._scatter && (event.buttons & 1)) {
                        self._scatterTo(event);
                    } else {
                        self._endScatter();
                        self.updatePreviewSymbol(event);
                    }
                }
            } else {
                // Remove preview when key is not held (hold mode only)
                self.removePreviewSymbol();
            }
        };
        
        this._handlePointerUp = (event) => {
            if (self._fromWindow) return self._windowPointerUp(event);
            // Primary guard: only run when tool is active
            if (!self.state.active) {
                return false;
            }
            self._endScatter();

            // Line/box/ellipse: ignore mouse up (drawing finishes when key is released/toggled off)
            if (self._strokeMode() === 'line' || self._strokeMode() === 'box' || self._strokeMode() === 'ellipse') {
                event.preventDefault();
                event.stopPropagation();
                return false;
            }
            
            // Sketch: finish on mouse up when not using key-based activation
            if (self.state.isDrawing && !self._keyDown) {
                self.finishDrawing(event);
            }
        };
        
        // The window's way of drawing takes the press on the window, in the capture phase. Foundry's own
        // canvas listens in the capture phase on the canvas element, registered before ours, so a
        // listener on the canvas runs after it and the press has already begun a drag-select box.
        // The window is above the canvas in the capture phase, and stopping the press there keeps
        // it from the canvas altogether. Only a press on the canvas itself is taken: one on a
        // window, the menubar or a dialog is left alone.
        this._handleWindowDown = (event) => {
            if (!self._fromWindow || event.target !== canvas.app?.view) return;
            self._windowPointerDown(event);
        };
        window.addEventListener('pointerdown', this._handleWindowDown, true);

        // Use capture phase to intercept events before Foundry's handlers
        canvas.app.view.addEventListener('pointerdown', this._handlePointerDown, true);
        canvas.app.view.addEventListener('pointermove', this._handlePointerMove, true);
        canvas.app.view.addEventListener('pointerup', this._handlePointerUp, true);
        
        console.log(`${MODULE.NAME}: Canvas drawing handlers attached`);
    }
    
    /**
     * Detach canvas event handlers
     */
    detachCanvasHandlers() {
        if (this._handleWindowDown) {
            window.removeEventListener('pointerdown', this._handleWindowDown, true);
            this._handleWindowDown = null;
        }
        const view = canvas?.app?.view;
        if (!view) return;

        if (this._handlePointerDown) {
            view.removeEventListener('pointerdown', this._handlePointerDown, true);
            this._handlePointerDown = null;
        }
        if (this._handlePointerMove) {
            view.removeEventListener('pointermove', this._handlePointerMove, true);
            this._handlePointerMove = null;
        }
        if (this._handlePointerUp) {
            view.removeEventListener('pointerup', this._handlePointerUp, true);
            this._handlePointerUp = null;
        }
    }
    
    /**
     * Get world coordinates from pointer event
     * @param {PointerEvent} event - Pointer event
     * @returns {Object} World coordinates {x, y}
     */
    getWorldCoordinates(event) {
        if (!canvas || !canvas.app || !canvas.grid) return null;
        
        // Get screen coordinates from event
        const rect = canvas.app.view.getBoundingClientRect();
        const screenX = event.clientX - rect.left;
        const screenY = event.clientY - rect.top;
        
        // Convert screen coordinates to canvas stage coordinates (world coordinates)
        // The canvas stage is the PIXI container that holds the scene
        // Canvas coordinates are already in world space
        const worldPoint = canvas.app.stage.toLocal(new PIXI.Point(screenX, screenY));
        
        // Validate coordinates are finite numbers
        if (!isFinite(worldPoint.x) || !isFinite(worldPoint.y)) {
            console.error(`${MODULE.NAME}: Invalid coordinates from canvas conversion`);
            return null;
        }
        
        return { x: worldPoint.x, y: worldPoint.y };
    }
    
    /**
     * Start a new drawing
     * @param {PointerEvent} event - Pointer event
     */
    startDrawing(event) {
        if (!canvas || !canvas.scene || !this.services?.canvasLayer) return;
        
        // Get world coordinates from pointer event
        const worldCoords = this.getWorldCoordinates(event);
        if (!worldCoords) return;
        
        this.state.isDrawing = true;
        this.state.drawingStartPoint = { x: worldCoords.x, y: worldCoords.y };
        // First point is always [0, 0] relative to start position
        this.state.drawingPoints = [[0, 0]];
        
        // Create preview graphics for real-time drawing
        // Use absolute coordinates for preview (matches what user sees)
        this._previewGraphics = new PIXI.Graphics();
        const previewAlpha = 1.0; // Always fully opaque (no transparency from color)
        const previewColor = this.cssToPixiColor(this.state.brushSettings.color);
        const shadowOffset = 2; // Shadow offset in pixels
        const shadowAlpha = previewAlpha * 0.3; // Shadow opacity (30% of main alpha)
        const shadowColor = 0x000000; // Black shadow
        
        // Draw shadow starting point
        this._previewGraphics.lineStyle(
            this.state.brushSettings.size,
            shadowColor,
            shadowAlpha
        );
        this._previewGraphics.moveTo(worldCoords.x + shadowOffset, worldCoords.y + shadowOffset);
        
        // Draw main line starting point
        this._previewGraphics.lineStyle(
            this.state.brushSettings.size,
            previewColor,
            previewAlpha
        );
        this._previewGraphics.moveTo(worldCoords.x, worldCoords.y);
        
        // Add to layer for immediate display
        this.services.canvasLayer.addChild(this._previewGraphics);
        
        console.log(`${MODULE.NAME}: Drawing started at`, worldCoords);
    }
    
    /**
     * Update drawing with new point
     * @param {PointerEvent} event - Pointer event
     */
    updateDrawing(event) {
        if (!canvas || !this.state.isDrawing || !this._previewGraphics || !this.services?.canvasLayer) return;
        
        // Get world coordinates from pointer event
        const worldCoords = this.getWorldCoordinates(event);
        if (!worldCoords) return;
        
        // Add point to drawing path (relative to start point) for final drawing
        const relativeX = worldCoords.x - this.state.drawingStartPoint.x;
        const relativeY = worldCoords.y - this.state.drawingStartPoint.y;
        this.state.drawingPoints.push([relativeX, relativeY]);

        // A path is previewed as the ribbon it will be, not as a thin line
        if (this.state.drawingMode === 'terrain') {
            this._previewTerrain();
            return;
        }
        
        // Clear and redraw preview graphics to avoid coordinate issues
        // This ensures clean drawing without weird lines
        this._previewGraphics.clear();
        const previewAlpha = 1.0; // Always fully opaque (no transparency from color)
        const previewColor = this.cssToPixiColor(this.state.brushSettings.color);
        const shadowOffset = 2; // Shadow offset in pixels
        const shadowAlpha = previewAlpha * 0.3; // Shadow opacity (30% of main alpha)
        const shadowColor = 0x000000; // Black shadow
        
        // Draw shadow first (offset version)
        this._previewGraphics.lineStyle(
            this.state.brushSettings.size,
            shadowColor,
            shadowAlpha
        );
        
        // Redraw entire path using absolute coordinates with shadow offset
        const startX = this.state.drawingStartPoint.x;
        const startY = this.state.drawingStartPoint.y;
        
        if (this.state.drawingPoints.length > 0) {
            const firstPoint = this.state.drawingPoints[0];
            this._previewGraphics.moveTo(startX + firstPoint[0] + shadowOffset, startY + firstPoint[1] + shadowOffset);
            
            for (let i = 1; i < this.state.drawingPoints.length; i++) {
                const point = this.state.drawingPoints[i];
                this._previewGraphics.lineTo(startX + point[0] + shadowOffset, startY + point[1] + shadowOffset);
            }
        }
        
        // Draw main line on top with line style
        const lineStyle = this.state.lineStyle || 'solid';
        this._drawLineWithStyle(
            this._previewGraphics,
            this.state.drawingPoints,
            startX,
            startY,
            this.state.brushSettings.size,
            previewColor,
            previewAlpha,
            lineStyle
        );
    }
    
    /**
     * Finish the current drawing and create temporary drawing object
     * @param {PointerEvent} event - Pointer event
     */
    async finishDrawing(event) {
        if (!canvas || !canvas.scene || !this.state.isDrawing) return;
        
        if (this.state.drawingPoints.length < 2) {
            // Not enough points for a drawing
            this.cancelDrawing();
            return;
        }
        
        try {
            // Remove preview graphics
            if (this._previewGraphics && this._previewGraphics.parent) {
                this.services.canvasLayer.removeChild(this._previewGraphics);
                this._previewGraphics.destroy();
                this._previewGraphics = null;
            }
            
            // A path is laid down as terrain, not kept as a thin sketch
            if (this.state.drawingMode === 'terrain') {
                const start = this.state.drawingStartPoint;
                const absolute = this.state.drawingPoints.map(([px, py]) => [start.x + px, start.y + py]);
                if (this._previewGraphics && this._previewGraphics.parent) {
                    this.services.canvasLayer.removeChild(this._previewGraphics);
                    this._previewGraphics.destroy();
                    this._previewGraphics = null;
                }
                this.state.isDrawing = false;
                this.state.drawingPoints = [];
                this.state.drawingStartPoint = null;
                this.state.currentDrawing = null;
                this.createTerrainPath(absolute);
                return;
            }

            // A wall stroke is written to the scene as walls and a line, not kept as a temporary drawing
            if (this.state.drawingMode === 'wall') {
                const start = this.state.drawingStartPoint;
                const absolute = this.state.drawingPoints.map(([px, py]) => [start.x + px, start.y + py]);
                this.state.isDrawing = false;
                this.state.drawingPoints = [];
                this.state.drawingStartPoint = null;
                this.state.currentDrawing = null;
                await this.createWallStroke(absolute);
                return;
            }

            // Create final drawing on BlacksmithLayer using PIXI graphics
            // This avoids Foundry's Drawing API validation issues
            this.createPIXIDrawing(
                this.state.drawingStartPoint.x,
                this.state.drawingStartPoint.y,
                this.state.drawingPoints,
                this.state.brushSettings.size,
                this.state.brushSettings.color
            );
            
            // Reset drawing state
            this.state.isDrawing = false;
            this.state.drawingPoints = [];
            this.state.drawingStartPoint = null;
            this.state.currentDrawing = null;
            
            console.log(`${MODULE.NAME}: Drawing created on canvas layer`);
        } catch (error) {
            console.error(`${MODULE.NAME}: Error creating drawing:`, error);
            this.cancelDrawing();
        }
    }
    
    /**
     * Start box drawing (set upper left corner)
     * @param {PointerEvent} event - Pointer event
     */
    startBoxDrawing(event) {
        if (!canvas || !canvas.scene || !this.services?.canvasLayer) return;
        
        // Get world coordinates from pointer event
        const worldCoords = this.getWorldCoordinates(event);
        if (!worldCoords) return;
        
        this.state.isDrawing = true;
        this.state.boxStartPoint = { x: worldCoords.x, y: worldCoords.y };
        
        // Create preview graphics for real-time box drawing
        this._previewGraphics = new PIXI.Graphics();
        this.services.canvasLayer.addChild(this._previewGraphics);
        
        console.log(`${MODULE.NAME}: Box drawing started at`, worldCoords);
    }
    
    /**
     * Start line drawing (set start point of straight segment)
     * @param {PointerEvent} event - Pointer event
     */
    startLineDrawing(event) {
        if (!canvas || !canvas.scene || !this.services?.canvasLayer) return;
        const worldCoords = this.getWorldCoordinates(event);
        if (!worldCoords) return;
        this.state.isDrawing = true;
        this.state.lineStartPoint = { x: worldCoords.x, y: worldCoords.y };
        this._previewGraphics = new PIXI.Graphics();
        this.services.canvasLayer.addChild(this._previewGraphics);
        console.log(`${MODULE.NAME}: Line drawing started at`, worldCoords);
    }
    
    /**
     * Update line preview as mouse moves (straight segment from start to current)
     * @param {PointerEvent} event - Pointer event
     */
    updateLinePreview(event) {
        if (!canvas || !this.state.isDrawing || !this._previewGraphics || !this.services?.canvasLayer || !this.state.lineStartPoint) return;
        const worldCoords = this.getWorldCoordinates(event);
        if (!worldCoords) return;
        this.state.lastMousePosition = worldCoords;
        const startX = this.state.lineStartPoint.x;
        const startY = this.state.lineStartPoint.y;
        const endX = worldCoords.x;
        const endY = worldCoords.y;
        this._previewGraphics.clear();
        const strokeWidth = this.state.brushSettings.size;
        const previewColor = this.cssToPixiColor(this.state.brushSettings.color);
        const shadowOffset = 2;
        const shadowAlpha = 0.3;
        const shadowColor = 0x000000;
        const lineStyle = this.state.lineStyle || 'solid';
        this._previewGraphics.lineStyle(strokeWidth, shadowColor, shadowAlpha);
        this._drawLineWithStyle(this._previewGraphics, [[0, 0], [endX - startX, endY - startY]], startX + shadowOffset, startY + shadowOffset, strokeWidth, shadowColor, shadowAlpha, 'solid');
        this._previewGraphics.lineStyle(strokeWidth, previewColor, 1.0);
        this._drawLineWithStyle(this._previewGraphics, [[0, 0], [endX - startX, endY - startY]], startX, startY, strokeWidth, previewColor, 1.0, lineStyle);
    }
    
    /**
     * Update box preview as mouse moves
     * @param {PointerEvent} event - Pointer event
     */
    updateBoxPreview(event) {
        if (!canvas || !this.state.isDrawing || !this._previewGraphics || !this.services?.canvasLayer || !this.state.boxStartPoint) return;
        
        // Get world coordinates from pointer event
        const worldCoords = this.getWorldCoordinates(event);
        if (!worldCoords) return;
        
        // Store last mouse position for finishing the box
        this.state.lastMousePosition = worldCoords;
        
        // Calculate box dimensions
        const startX = this.state.boxStartPoint.x;
        const startY = this.state.boxStartPoint.y;
        const endX = worldCoords.x;
        const endY = worldCoords.y;
        
        const width = endX - startX;
        const height = endY - startY;
        
        // Clear and redraw preview box
        this._previewGraphics.clear();
        
        const previewAlpha = 1.0; // Always fully opaque
        const previewColor = this.cssToPixiColor(this.state.brushSettings.color);
        const shadowOffset = 2; // Shadow offset in pixels
        const shadowAlpha = previewAlpha * 0.3; // Shadow opacity (30% of main alpha)
        const shadowColor = 0x000000; // Black shadow
        const strokeWidth = this.state.brushSettings.size;
        const lineStyle = this.state.lineStyle || 'solid';
        
        // Draw shadow first (offset version) - always solid for shadow
        this._previewGraphics.lineStyle(strokeWidth, shadowColor, shadowAlpha);
        this._drawBoxWithStyle(
            this._previewGraphics,
            startX + shadowOffset,
            startY + shadowOffset,
            width,
            height,
            'solid' // Shadow is always solid, regardless of line style
        );
        
        // Draw main box on top with actual line style
        this._previewGraphics.lineStyle(strokeWidth, previewColor, previewAlpha);
        this._drawBoxWithStyle(
            this._previewGraphics,
            startX,
            startY,
            width,
            height,
            lineStyle
        );
    }
    
    /**
     * Draw a box with the specified style (solid, dotted, dashed)
     * @param {PIXI.Graphics} graphics - PIXI Graphics object
     * @param {number} x - X coordinate of upper left corner
     * @param {number} y - Y coordinate of upper left corner
     * @param {number} width - Box width
     * @param {number} height - Box height
     * @param {string} style - Line style: 'solid', 'dotted', 'dashed'
     */
    _drawBoxWithStyle(graphics, x, y, width, height, style) {
        if (style === 'solid') {
            // Solid box - draw rectangle normally
            graphics.drawRect(x, y, width, height);
        } else {
            // For dotted/dashed, draw each side as a line with style
            // Top edge (left to right)
            const topPoints = [[0, 0], [width, 0]];
            this._drawLineWithStyle(graphics, topPoints, x, y, this.state.brushSettings.size, this.cssToPixiColor(this.state.brushSettings.color), 1.0, style);
            
            // Right edge (top to bottom)
            const rightPoints = [[0, 0], [0, height]];
            this._drawLineWithStyle(graphics, rightPoints, x + width, y, this.state.brushSettings.size, this.cssToPixiColor(this.state.brushSettings.color), 1.0, style);
            
            // Bottom edge (right to left)
            const bottomPoints = [[0, 0], [-width, 0]];
            this._drawLineWithStyle(graphics, bottomPoints, x + width, y + height, this.state.brushSettings.size, this.cssToPixiColor(this.state.brushSettings.color), 1.0, style);
            
            // Left edge (bottom to top)
            const leftPoints = [[0, 0], [0, -height]];
            this._drawLineWithStyle(graphics, leftPoints, x, y + height, this.state.brushSettings.size, this.cssToPixiColor(this.state.brushSettings.color), 1.0, style);
        }
    }
    
    /**
     * Finish box drawing (set lower right corner and create final box)
     * @param {PointerEvent} event - Pointer event
     */
    async finishBoxDrawing(event) {
        if (!canvas || !canvas.scene || !this.state.isDrawing || !this.state.boxStartPoint) return;
        
        // Get world coordinates - prefer stored last position, fallback to event
        let worldCoords = this.state.lastMousePosition;
        if (!worldCoords && event) {
            worldCoords = this.getWorldCoordinates(event);
        }
        
        // If still no coordinates, try to get current mouse position directly
        if (!worldCoords) {
            const mouse = canvas?.app?.renderer?.plugins?.interaction?.mouse?.global;
            if (mouse) {
                worldCoords = { x: mouse.x, y: mouse.y };
            }
        }
        
        if (!worldCoords) {
            this.cancelDrawing();
            return;
        }
        
        try {
            // Remove preview graphics
            if (this._previewGraphics && this._previewGraphics.parent) {
                this.services.canvasLayer.removeChild(this._previewGraphics);
                this._previewGraphics.destroy();
                this._previewGraphics = null;
            }
            
            // Calculate box dimensions
            const startX = this.state.boxStartPoint.x;
            const startY = this.state.boxStartPoint.y;
            const endX = worldCoords.x;
            const endY = worldCoords.y;
            
            const width = endX - startX;
            const height = endY - startY;
            
            // Create final box drawing on BlacksmithLayer using PIXI graphics
            const layer = this.services.canvasLayer;
            const graphics = new PIXI.Graphics();
            const drawingAlpha = 1.0;
            const drawingColor = this.cssToPixiColor(this.state.brushSettings.color);
            const shadowOffset = 2;
            const shadowAlpha = drawingAlpha * 0.3;
            const shadowColor = 0x000000;
            const strokeWidth = this.state.brushSettings.size;
            const lineStyle = this.state.lineStyle || 'solid';
            
            // Draw shadow first (offset version) - always solid for shadow
            graphics.lineStyle(strokeWidth, shadowColor, shadowAlpha);
            this._drawBoxWithStyle(
                graphics,
                startX + shadowOffset,
                startY + shadowOffset,
                width,
                height,
                'solid' // Shadow is always solid, regardless of line style
            );
            
            // Draw main box on top with actual line style
            graphics.lineStyle(strokeWidth, drawingColor, drawingAlpha);
            this._drawBoxWithStyle(
                graphics,
                startX,
                startY,
                width,
                height,
                lineStyle
            );
            
            // Add to layer
            layer.addChild(graphics);
            
            // Store reference for cleanup
            if (!this._pixiDrawings) {
                this._pixiDrawings = [];
            }
            
            const drawingId = `box-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const drawingData = {
                id: drawingId,
                graphics: graphics,
                createdAt: Date.now(),
                expiresAt: this.getExpirationTime(),
                userId: game.user.id,
                userName: game.user.name,
                startX: startX,
                startY: startY,
                width: width,
                height: height,
                strokeWidth: strokeWidth,
                strokeColor: this.state.brushSettings.color,
                lineStyle: lineStyle,
                type: 'box'
            };
            this._pixiDrawings.push(drawingData);
            
            // Store as last drawing for undo
            this._lastDrawing = drawingData;
            
            // Broadcast drawing creation to other clients
            this.broadcastDrawingCreation({
                drawingId: drawingId,
                userId: game.user.id,
                userName: game.user.name,
                startX: startX,
                startY: startY,
                width: width,
                height: height,
                strokeWidth: strokeWidth,
                strokeColor: this.state.brushSettings.color,
                lineStyle: lineStyle,
                type: 'box',
                createdAt: drawingData.createdAt,
                expiresAt: drawingData.expiresAt
            });
            
            // Schedule cleanup if needed
            this.scheduleCleanup();
            
            // Reset drawing state
            this.state.isDrawing = false;
            this.state.boxStartPoint = null;
            this.state.lastMousePosition = null;
            this.state.currentDrawing = null;
            
            console.log(`${MODULE.NAME}: Box drawing created on canvas layer`);
        } catch (error) {
            console.error(`${MODULE.NAME}: Error creating box drawing:`, error);
            this.cancelDrawing();
        }
    }
    
    /**
     * Finish line drawing and create final straight segment
     * @param {PointerEvent} event - Pointer event (null to use stored last position)
     */
    async finishLineDrawing(event) {
        if (!canvas || !canvas.scene || !this.state.isDrawing || !this.state.lineStartPoint) return;
        let worldCoords = this.state.lastMousePosition;
        if (!worldCoords && event) worldCoords = this.getWorldCoordinates(event);
        if (!worldCoords) {
            const mouse = canvas?.app?.renderer?.plugins?.interaction?.mouse?.global;
            if (mouse) worldCoords = { x: mouse.x, y: mouse.y };
        }
        if (!worldCoords) {
            this.cancelDrawing();
            return;
        }
        try {
            if (this._previewGraphics && this._previewGraphics.parent) {
                this.services.canvasLayer.removeChild(this._previewGraphics);
                this._previewGraphics.destroy();
                this._previewGraphics = null;
            }
            const startX = this.state.lineStartPoint.x;
            const startY = this.state.lineStartPoint.y;
            const endX = worldCoords.x;
            const endY = worldCoords.y;
            if (this.state.drawingMode === 'wall') {
                this.state.isDrawing = false;
                this.state.lineStartPoint = null;
                this.state.lastMousePosition = null;
                this.state.currentDrawing = null;
                await this.createWallStroke([[startX, startY], [endX, endY]]);
                return;
            }
            const points = [[0, 0], [endX - startX, endY - startY]];
            const layer = this.services.canvasLayer;
            const graphics = new PIXI.Graphics();
            const drawingAlpha = 1.0;
            const drawingColor = this.cssToPixiColor(this.state.brushSettings.color);
            const strokeWidth = this.state.brushSettings.size;
            const shadowOffset = 2;
            const shadowAlpha = drawingAlpha * 0.3;
            const shadowColor = 0x000000;
            const lineStyle = this.state.lineStyle || 'solid';
            graphics.lineStyle(strokeWidth, shadowColor, shadowAlpha);
            this._drawLineWithStyle(graphics, points, startX + shadowOffset, startY + shadowOffset, strokeWidth, shadowColor, shadowAlpha, 'solid');
            graphics.lineStyle(strokeWidth, drawingColor, drawingAlpha);
            this._drawLineWithStyle(graphics, points, startX, startY, strokeWidth, drawingColor, drawingAlpha, lineStyle);
            layer.addChild(graphics);
            if (!this._pixiDrawings) this._pixiDrawings = [];
            const drawingId = `line-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const drawingData = {
                id: drawingId,
                graphics,
                createdAt: Date.now(),
                expiresAt: this.getExpirationTime(),
                userId: game.user.id,
                userName: game.user.name,
                startX,
                startY,
                points,
                strokeWidth,
                strokeColor: this.state.brushSettings.color,
                lineStyle
            };
            this._pixiDrawings.push(drawingData);
            this._lastDrawing = drawingData;
            this.broadcastDrawingCreation({
                drawingId,
                userId: game.user.id,
                userName: game.user.name,
                startX,
                startY,
                points,
                strokeWidth,
                strokeColor: this.state.brushSettings.color,
                lineStyle,
                createdAt: drawingData.createdAt,
                expiresAt: drawingData.expiresAt
            });
            this.scheduleCleanup();
            this.state.isDrawing = false;
            this.state.lineStartPoint = null;
            this.state.lastMousePosition = null;
            this.state.currentDrawing = null;
            console.log(`${MODULE.NAME}: Line drawing created on canvas layer`);
        } catch (error) {
            console.error(`${MODULE.NAME}: Error creating line drawing:`, error);
            this.cancelDrawing();
        }
    }
    
    /**
     * Start ellipse drawing (set upper left of bounding box)
     * @param {PointerEvent} event - Pointer event
     */
    startEllipseDrawing(event) {
        if (!canvas || !canvas.scene || !this.services?.canvasLayer) return;
        const worldCoords = this.getWorldCoordinates(event);
        if (!worldCoords) return;
        this.state.isDrawing = true;
        this.state.ellipseStartPoint = { x: worldCoords.x, y: worldCoords.y };
        this._previewGraphics = new PIXI.Graphics();
        this.services.canvasLayer.addChild(this._previewGraphics);
        console.log(`${MODULE.NAME}: Ellipse drawing started at`, worldCoords);
    }
    
    /**
     * Update ellipse preview as mouse moves
     * @param {PointerEvent} event - Pointer event
     */
    updateEllipsePreview(event) {
        if (!canvas || !this.state.isDrawing || !this._previewGraphics || !this.services?.canvasLayer || !this.state.ellipseStartPoint) return;
        const worldCoords = this.getWorldCoordinates(event);
        if (!worldCoords) return;
        this.state.lastMousePosition = worldCoords;
        const startX = this.state.ellipseStartPoint.x;
        const startY = this.state.ellipseStartPoint.y;
        const endX = worldCoords.x;
        const endY = worldCoords.y;
        const width = endX - startX;
        const height = endY - startY;
        this._previewGraphics.clear();
        const previewAlpha = 1.0;
        const previewColor = this.cssToPixiColor(this.state.brushSettings.color);
        const shadowOffset = 2;
        const shadowAlpha = previewAlpha * 0.3;
        const shadowColor = 0x000000;
        const strokeWidth = this.state.brushSettings.size;
        const lineStyle = this.state.lineStyle || 'solid';
        this._previewGraphics.lineStyle(strokeWidth, shadowColor, shadowAlpha);
        this._drawEllipseWithStyle(this._previewGraphics, startX + shadowOffset, startY + shadowOffset, width, height, 'solid');
        this._previewGraphics.lineStyle(strokeWidth, previewColor, previewAlpha);
        this._drawEllipseWithStyle(this._previewGraphics, startX, startY, width, height, lineStyle);
    }
    
    /**
     * Draw an ellipse with the specified style (solid, dotted, dashed).
     * Uses bounding box (x, y, width, height) like box; ellipse is inscribed in that rectangle.
     * @param {PIXI.Graphics} graphics - PIXI Graphics object
     * @param {number} x - X of upper left of bounding box
     * @param {number} y - Y of upper left of bounding box
     * @param {number} width - Bounding box width
     * @param {number} height - Bounding box height
     * @param {string} style - Line style: 'solid', 'dotted', 'dashed'
     */
    _drawEllipseWithStyle(graphics, x, y, width, height, style, opts = {}) {
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const halfW = Math.abs(width) / 2;
        const halfH = Math.abs(height) / 2;
        const strokeWidth = opts.strokeWidth ?? this.state.brushSettings.size;
        const color = opts.strokeColor != null ? this.cssToPixiColor(opts.strokeColor) : this.cssToPixiColor(this.state.brushSettings.color);
        const alpha = opts.alpha ?? 1.0;
        if (style === 'solid') {
            graphics.drawEllipse(centerX, centerY, halfW, halfH);
        } else {
            const segments = 48;
            const pts = [];
            for (let i = 0; i <= segments; i++) {
                const t = (Math.PI * 2 * i) / segments;
                pts.push([centerX + halfW * Math.cos(t), centerY + halfH * Math.sin(t)]);
            }
            for (let i = 0; i < segments; i++) {
                const [x0, y0] = pts[i];
                const [x1, y1] = pts[i + 1];
                const segPoints = [[0, 0], [x1 - x0, y1 - y0]];
                this._drawLineWithStyle(graphics, segPoints, x0, y0, strokeWidth, color, alpha, style);
            }
        }
    }
    
    /**
     * Finish ellipse drawing and create final ellipse
     * @param {PointerEvent} event - Pointer event (null to use stored last position)
     */
    async finishEllipseDrawing(event) {
        if (!canvas || !canvas.scene || !this.state.isDrawing || !this.state.ellipseStartPoint) return;
        let worldCoords = this.state.lastMousePosition;
        if (!worldCoords && event) worldCoords = this.getWorldCoordinates(event);
        if (!worldCoords) {
            const mouse = canvas?.app?.renderer?.plugins?.interaction?.mouse?.global;
            if (mouse) worldCoords = { x: mouse.x, y: mouse.y };
        }
        if (!worldCoords) {
            this.cancelDrawing();
            return;
        }
        try {
            if (this._previewGraphics && this._previewGraphics.parent) {
                this.services.canvasLayer.removeChild(this._previewGraphics);
                this._previewGraphics.destroy();
                this._previewGraphics = null;
            }
            const startX = this.state.ellipseStartPoint.x;
            const startY = this.state.ellipseStartPoint.y;
            const endX = worldCoords.x;
            const endY = worldCoords.y;
            const width = endX - startX;
            const height = endY - startY;
            const layer = this.services.canvasLayer;
            const graphics = new PIXI.Graphics();
            const drawingAlpha = 1.0;
            const drawingColor = this.cssToPixiColor(this.state.brushSettings.color);
            const shadowOffset = 2;
            const shadowAlpha = drawingAlpha * 0.3;
            const shadowColor = 0x000000;
            const strokeWidth = this.state.brushSettings.size;
            const lineStyle = this.state.lineStyle || 'solid';
            graphics.lineStyle(strokeWidth, shadowColor, shadowAlpha);
            this._drawEllipseWithStyle(graphics, startX + shadowOffset, startY + shadowOffset, width, height, 'solid');
            graphics.lineStyle(strokeWidth, drawingColor, drawingAlpha);
            this._drawEllipseWithStyle(graphics, startX, startY, width, height, lineStyle);
            layer.addChild(graphics);
            if (!this._pixiDrawings) this._pixiDrawings = [];
            const drawingId = `ellipse-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const drawingData = {
                id: drawingId,
                graphics,
                createdAt: Date.now(),
                expiresAt: this.getExpirationTime(),
                userId: game.user.id,
                userName: game.user.name,
                startX,
                startY,
                width,
                height,
                strokeWidth,
                strokeColor: this.state.brushSettings.color,
                lineStyle,
                type: 'ellipse'
            };
            this._pixiDrawings.push(drawingData);
            this._lastDrawing = drawingData;
            this.broadcastDrawingCreation({
                drawingId,
                userId: game.user.id,
                userName: game.user.name,
                startX,
                startY,
                width,
                height,
                strokeWidth,
                strokeColor: this.state.brushSettings.color,
                lineStyle,
                type: 'ellipse',
                createdAt: drawingData.createdAt,
                expiresAt: drawingData.expiresAt
            });
            this.scheduleCleanup();
            this.state.isDrawing = false;
            this.state.ellipseStartPoint = null;
            this.state.lastMousePosition = null;
            this.state.currentDrawing = null;
            console.log(`${MODULE.NAME}: Ellipse drawing created on canvas layer`);
        } catch (error) {
            console.error(`${MODULE.NAME}: Error creating ellipse drawing:`, error);
            this.cancelDrawing();
        }
    }
    
    /**
     * Convert CSS color to PIXI color (number)
     * Supports hex (#RRGGBB) and rgba(r, g, b, a) formats
     * @param {string|number} cssColor - CSS color string or number
     * @returns {number} PIXI color number (0xRRGGBB)
     */
    /**
     * Extract alpha value from rgba color string
     * @param {string} rgbaColor - RGBA color string, e.g., "rgba(255, 0, 0, 0.7)"
     * @returns {number} Alpha value (0-1), defaults to 1.0 if not found
     */
    extractAlphaFromRgba(rgbaColor) {
        if (!rgbaColor || typeof rgbaColor !== 'string') {
            return 1.0;
        }
        
        // Match rgba(r, g, b, a) format
        const rgbaMatch = rgbaColor.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i);
        if (rgbaMatch && rgbaMatch[4] !== undefined) {
            const alpha = parseFloat(rgbaMatch[4]);
            return isNaN(alpha) ? 1.0 : Math.max(0, Math.min(1, alpha)); // Clamp between 0 and 1
        }
        
        // Default to 1.0 if no alpha found
        return 1.0;
    }
    
    cssToPixiColor(cssColor) {
        if (typeof cssColor === 'number') return cssColor;
        
        if (typeof cssColor === 'string') {
            // Handle hex format (#RRGGBB)
            if (cssColor.startsWith('#')) {
                return parseInt(cssColor.slice(1), 16);
            }
            
            // Handle rgba format (rgba(r, g, b, a))
            const rgbaMatch = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
            if (rgbaMatch) {
                const r = parseInt(rgbaMatch[1], 10);
                const g = parseInt(rgbaMatch[2], 10);
                const b = parseInt(rgbaMatch[3], 10);
                return (r << 16) | (g << 8) | b;
            }
        }
        
        return 0x000000; // black fallback
    }
    
    /**
     * Create a drawing directly on BlacksmithLayer using PIXI graphics
     * This bypasses Foundry's Drawing API and validation issues
     * @param {number} startX - Starting X coordinate
     * @param {number} startY - Starting Y coordinate
     * @param {Array} points - Array of relative [x, y] coordinate pairs
     * @param {number} strokeWidth - Brush size
     * @param {string} strokeColor - Brush color (CSS format)
     */
    createPIXIDrawing(startX, startY, points, strokeWidth, strokeColor) {
        if (!this.services || !this.services.canvasLayer) {
            throw new Error('Canvas Layer not available');
        }
        
        const layer = this.services.canvasLayer;
        
        // Create PIXI Graphics object
        const graphics = new PIXI.Graphics();
        const drawingAlpha = 1.0; // Always fully opaque (no transparency from color)
        const drawingColor = this.cssToPixiColor(strokeColor);
        const shadowOffset = 2; // Shadow offset in pixels
        const shadowAlpha = drawingAlpha * 0.3; // Shadow opacity (30% of main alpha)
        const shadowColor = 0x000000; // Black shadow
        
        // Draw shadow first (offset version)
        graphics.lineStyle(strokeWidth, shadowColor, shadowAlpha);
        
        if (points.length > 0) {
            const firstPoint = points[0];
            graphics.moveTo(startX + firstPoint[0] + shadowOffset, startY + firstPoint[1] + shadowOffset);
            
            for (let i = 1; i < points.length; i++) {
                const point = points[i];
                graphics.lineTo(startX + point[0] + shadowOffset, startY + point[1] + shadowOffset);
            }
        }
        
        // Draw main line on top with line style
        const lineStyle = this.state.lineStyle || 'solid';
        this._drawLineWithStyle(graphics, points, startX, startY, strokeWidth, drawingColor, drawingAlpha, lineStyle);
        
        // Add to layer
        layer.addChild(graphics);
        
        // Store reference for cleanup
        if (!this._pixiDrawings) {
            this._pixiDrawings = [];
        }
        
        const drawingId = `drawing-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const drawingData = {
            id: drawingId,
            graphics: graphics,
            createdAt: Date.now(),
            expiresAt: this.getExpirationTime(),
            userId: game.user.id,
            userName: game.user.name,
            startX: startX,
            startY: startY,
            points: points,
            strokeWidth: strokeWidth,
            strokeColor: strokeColor
        };
        this._pixiDrawings.push(drawingData);
        
        // Store as last drawing for undo
        this._lastDrawing = drawingData;
        
        // Broadcast drawing creation to other clients
        this.broadcastDrawingCreation({
            drawingId: drawingId,
            userId: game.user.id,
            userName: game.user.name,
            startX: startX,
            startY: startY,
            points: points,
            strokeWidth: strokeWidth,
            strokeColor: strokeColor,
            lineStyle: this.state.lineStyle || 'solid',
            createdAt: drawingData.createdAt,
            expiresAt: drawingData.expiresAt
        });
        
        // Schedule cleanup if needed
        this.scheduleCleanup();
        
        return graphics;
    }
    
    /**
     * Draw a line with the specified style (solid, dotted, dashed)
     * @param {PIXI.Graphics} graphics - PIXI Graphics object
     * @param {Array} points - Array of relative points [[dx, dy], ...]
     * @param {number} startX - Starting X coordinate
     * @param {number} startY - Starting Y coordinate
     * @param {number} strokeWidth - Line width
     * @param {number} color - PIXI color number
     * @param {number} alpha - Alpha value
     * @param {string} style - Line style: 'solid', 'dotted', 'dashed'
     */
    _drawLineWithStyle(graphics, points, startX, startY, strokeWidth, color, alpha, style) {
        if (!points || points.length === 0) return;
        
        graphics.lineStyle(strokeWidth, color, alpha);
        
        if (style === 'solid') {
            // Solid line - draw normally
            const firstPoint = points[0];
            graphics.moveTo(startX + firstPoint[0], startY + firstPoint[1]);
            
            for (let i = 1; i < points.length; i++) {
                const point = points[i];
                graphics.lineTo(startX + point[0], startY + point[1]);
            }
        } else if (style === 'dotted') {
            // Dotted line - draw dots along the entire path at fixed intervals
            // This avoids issues with variable mouse speed creating too many points
            const dotRadius = strokeWidth * 0.4; // Dot radius
            const dotSpacing = strokeWidth * 4; // MUCH larger space between dots
            
            // Calculate total path length and get points along the path
            let totalLength = 0;
            const segments = [];
            
            for (let i = 0; i < points.length - 1; i++) {
                const p1 = points[i];
                const p2 = points[i + 1];
                const dx = p2[0] - p1[0];
                const dy = p2[1] - p1[1];
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 0) {
                    segments.push({
                        x1: startX + p1[0],
                        y1: startY + p1[1],
                        x2: startX + p2[0],
                        y2: startY + p2[1],
                        dx: dx,
                        dy: dy,
                        dist: dist
                    });
                    totalLength += dist;
                }
            }
            
            // Draw dots at fixed intervals along the entire path
            let currentLength = 0;
            while (currentLength < totalLength) {
                // Find which segment contains this position
                let segmentLength = 0;
                for (const seg of segments) {
                    if (currentLength >= segmentLength && currentLength < segmentLength + seg.dist) {
                        const t = (currentLength - segmentLength) / seg.dist;
                        const x = seg.x1 + seg.dx * t;
                        const y = seg.y1 + seg.dy * t;
                        graphics.beginFill(color, alpha);
                        graphics.drawCircle(x, y, dotRadius);
                        graphics.endFill();
                        break;
                    }
                    segmentLength += seg.dist;
                }
                currentLength += dotSpacing;
            }
        } else if (style === 'dashed') {
            // Dashed line - draw dashes along the entire path at fixed intervals
            // This avoids issues with variable mouse speed creating too many points
            const dashLength = strokeWidth * 6; // MUCH larger dash length
            const gapLength = strokeWidth * 2; // Gap equal to dash length
            
            // Calculate total path length and get segments
            let totalLength = 0;
            const segments = [];
            
            for (let i = 0; i < points.length - 1; i++) {
                const p1 = points[i];
                const p2 = points[i + 1];
                const dx = p2[0] - p1[0];
                const dy = p2[1] - p1[1];
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 0) {
                    segments.push({
                        x1: startX + p1[0],
                        y1: startY + p1[1],
                        x2: startX + p2[0],
                        y2: startY + p2[1],
                        dx: dx,
                        dy: dy,
                        dist: dist
                    });
                    totalLength += dist;
                }
            }
            
            // Draw dashes at fixed intervals along the entire path
            let currentLength = 0;
            let isDrawing = true;
            
            while (currentLength < totalLength) {
                const segmentLength = isDrawing ? dashLength : gapLength;
                const nextLength = Math.min(currentLength + segmentLength, totalLength);
                
                if (isDrawing) {
                    // Find start and end positions along the path
                    let segStartLength = 0;
                    let segEndLength = 0;
                    let startX_seg = 0, startY_seg = 0, endX_seg = 0, endY_seg = 0;
                    let startFound = false, endFound = false;
                    
                    for (const seg of segments) {
                        if (!startFound && currentLength >= segStartLength && currentLength < segStartLength + seg.dist) {
                            const t = (currentLength - segStartLength) / seg.dist;
                            startX_seg = seg.x1 + seg.dx * t;
                            startY_seg = seg.y1 + seg.dy * t;
                            startFound = true;
                        }
                        if (!endFound && nextLength >= segEndLength && nextLength <= segEndLength + seg.dist) {
                            const t = (nextLength - segEndLength) / seg.dist;
                            endX_seg = seg.x1 + seg.dx * t;
                            endY_seg = seg.y1 + seg.dy * t;
                            endFound = true;
                        }
                        if (startFound && endFound) break;
                        segStartLength += seg.dist;
                        segEndLength += seg.dist;
                    }
                    
                    if (startFound && endFound) {
                        graphics.moveTo(startX_seg, startY_seg);
                        graphics.lineTo(endX_seg, endY_seg);
                    }
                }
                
                currentLength = nextLength;
                isDrawing = !isDrawing;
            }
        }
    }
    
    /**
     * Handle drawing creation from remote client
     * @param {Object} data - Drawing data from socket
     */
    handleRemoteDrawingCreation(data) {
        // Skip if this is our own drawing (already rendered locally)
        if (data.userId === game.user.id) {
            return; // Silently skip own events
        }
        
        // Validate required data
        if (!data || !data.drawingId) {
            console.warn(`${MODULE.NAME}: Invalid drawing data received:`, data);
            return;
        }
        
        // Check if drawing already exists (prevent duplicates)
        if (this._pixiDrawings && this._pixiDrawings.some(d => d.id === data.drawingId)) {
            return; // Silently skip duplicates
        }
        
        // Create the remote drawing (no logging to reduce spam)
        this.createRemoteDrawing(data);
    }
    
    /**
     * Handle drawing deletion from remote client
     * @param {Object} data - Deletion data from socket
     */
    handleRemoteDrawingDeletion(data) {
        // Skip if this is our own deletion (already handled locally)
        if (data.userId === game.user.id) {
            return;
        }
        
        if (!data) {
            console.warn(`${MODULE.NAME}: Invalid deletion data received:`, data);
            return;
        }
        
        if (data.clearAll) {
            // Clear all drawings (only if from GM)
            if (game.users.get(data.userId)?.isGM) {
                this.clearAllDrawings(false); // false = don't broadcast (already received via socket)
                console.log(`${MODULE.NAME}: All drawings cleared by GM ${data.userId}`);
            }
        } else if (data.drawingId) {
            // Delete specific drawing by ID (for undo)
            this.deleteDrawingById(data.drawingId, false); // false = don't broadcast (already received via socket)
        } else {
            // Clear all drawings from specific user (legacy behavior)
            this.clearUserDrawings(data.userId, false); // false = don't broadcast (already received via socket)
            console.log(`${MODULE.NAME}: Drawings cleared for user ${data.userId}`);
        }
    }
    
    /**
     * Delete a specific drawing by ID
     * @param {string} drawingId - Drawing ID to delete
     * @param {boolean} broadcast - Whether to broadcast the deletion
     */
    deleteDrawingById(drawingId, broadcast = true) {
        if (!this._pixiDrawings || !this.services?.canvasLayer) {
            return;
        }
        
        // Find the drawing
        const drawingIndex = this._pixiDrawings.findIndex(d => d.id === drawingId);
        if (drawingIndex === -1) {
            return; // Drawing not found
        }
        
        const drawing = this._pixiDrawings[drawingIndex];
        
        // Fade out and remove from canvas
        if (drawing.graphics && drawing.graphics.parent) {
            this._fadeOutAndRemove(drawing.graphics, 300);
        }
        
        // Remove from array
        this._pixiDrawings.splice(drawingIndex, 1);
        
        // Update _lastDrawing if it was the one removed
        if (this._lastDrawing && this._lastDrawing.id === drawingId) {
            // Find the most recent drawing by this user for next undo
            const userDrawings = this._pixiDrawings.filter(d => d.userId === game.user.id);
            if (userDrawings.length > 0) {
                userDrawings.sort((a, b) => b.createdAt - a.createdAt);
                this._lastDrawing = userDrawings[0];
            } else {
                this._lastDrawing = null;
            }
        }
        
        // Broadcast if requested
        if (broadcast) {
            this.broadcastDrawingDeletion(false, drawing.userId, drawingId);
        }
    }
    
    /**
     * Create a drawing from remote data
     * NOTE: This method does NOT broadcast - it's only for rendering remote drawings
     * @param {Object} data - Drawing data from socket
     */
    createRemoteDrawing(data) {
        if (!this.services || !this.services.canvasLayer) {
            console.warn(`${MODULE.NAME}: Canvas layer not available for remote drawing`);
            return;
        }
        
        try {
            // Determine if this is a box, ellipse, line, or symbol drawing
            if (data.terrainKind) {
                this.createRemoteTerrain(data);
            } else if (data.stampKind) {
                this.createRemoteStamp(data);
            } else if (data.type === 'box' && data.startX !== undefined && data.width !== undefined && data.height !== undefined) {
                this.createRemoteBox(data);
            } else if (data.type === 'ellipse' && data.startX !== undefined && data.width !== undefined && data.height !== undefined) {
                this.createRemoteEllipse(data);
            } else if (data.symbolType) {
                // Symbol drawing
                this.createRemoteSymbol(data);
            } else if (data.startX !== undefined && data.points) {
                // Line drawing
                this.createRemoteLine(data);
            } else {
                console.warn(`${MODULE.NAME}: Unknown drawing type in remote data:`, data);
            }
        } catch (error) {
            console.error(`${MODULE.NAME}: Error creating remote drawing:`, error);
        }
    }
    
    /**
     * Create a remote line drawing
     * NOTE: This method does NOT broadcast - it's only for rendering remote drawings
     * @param {Object} data - Line drawing data
     */
    createRemoteLine(data) {
        const layer = this.services.canvasLayer;
        const graphics = new PIXI.Graphics();
        
        const drawingAlpha = 1.0;
        const drawingColor = this.cssToPixiColor(data.strokeColor);
        const strokeWidth = data.strokeWidth || 6;
        const shadowOffset = 2;
        const shadowAlpha = drawingAlpha * 0.3;
        const shadowColor = 0x000000;
        
        // Draw shadow first
        graphics.lineStyle(strokeWidth, shadowColor, shadowAlpha);
        if (data.points.length > 0) {
            const firstPoint = data.points[0];
            graphics.moveTo(data.startX + firstPoint[0] + shadowOffset, data.startY + firstPoint[1] + shadowOffset);
            for (let i = 1; i < data.points.length; i++) {
                const point = data.points[i];
                graphics.lineTo(data.startX + point[0] + shadowOffset, data.startY + point[1] + shadowOffset);
            }
        }
        
        // Draw main line with style
        const lineStyle = data.lineStyle || 'solid';
        this._drawLineWithStyle(
            graphics,
            data.points,
            data.startX,
            data.startY,
            strokeWidth,
            drawingColor,
            drawingAlpha,
            lineStyle
        );
        
        // Add to layer
        layer.addChild(graphics);
        
        // Store reference
        if (!this._pixiDrawings) {
            this._pixiDrawings = [];
        }
        
        this._pixiDrawings.push({
            id: data.drawingId,
            graphics: graphics,
            createdAt: data.createdAt || Date.now(),
            expiresAt: data.expiresAt || null,
            userId: data.userId,
            userName: data.userName || 'Unknown',
            startX: data.startX,
            startY: data.startY,
            points: data.points,
            strokeWidth: strokeWidth,
            strokeColor: data.strokeColor
        });
        
        // Schedule cleanup if needed
        this.scheduleCleanup();
    }
    
    /**
     * Create a remote box drawing
     * NOTE: This method does NOT broadcast - it's only for rendering remote drawings
     * @param {Object} data - Box drawing data
     */
    createRemoteBox(data) {
        const layer = this.services.canvasLayer;
        const graphics = new PIXI.Graphics();
        
        const drawingAlpha = 1.0;
        const drawingColor = this.cssToPixiColor(data.strokeColor);
        const strokeWidth = data.strokeWidth || 6;
        const shadowOffset = 2;
        const shadowAlpha = drawingAlpha * 0.3;
        const shadowColor = 0x000000;
        const lineStyle = data.lineStyle || 'solid';
        
        // Draw shadow first (offset version) - always solid for shadow
        graphics.lineStyle(strokeWidth, shadowColor, shadowAlpha);
        this._drawBoxWithStyle(
            graphics,
            data.startX + shadowOffset,
            data.startY + shadowOffset,
            data.width,
            data.height,
            'solid' // Shadow is always solid, regardless of line style
        );
        
        // Draw main box on top with actual line style
        graphics.lineStyle(strokeWidth, drawingColor, drawingAlpha);
        this._drawBoxWithStyle(
            graphics,
            data.startX,
            data.startY,
            data.width,
            data.height,
            lineStyle
        );
        
        // Add to layer
        layer.addChild(graphics);
        
        // Store reference
        if (!this._pixiDrawings) {
            this._pixiDrawings = [];
        }
        
        this._pixiDrawings.push({
            id: data.drawingId,
            graphics: graphics,
            createdAt: data.createdAt || Date.now(),
            expiresAt: data.expiresAt || null,
            userId: data.userId,
            userName: data.userName || 'Unknown',
            startX: data.startX,
            startY: data.startY,
            width: data.width,
            height: data.height,
            strokeWidth: strokeWidth,
            strokeColor: data.strokeColor,
            lineStyle: lineStyle,
            type: 'box'
        });
        
        // Schedule cleanup if needed
        this.scheduleCleanup();
    }
    
    /**
     * Create a remote ellipse drawing
     * NOTE: This method does NOT broadcast - it's only for rendering remote drawings
     * @param {Object} data - Ellipse drawing data (startX, startY, width, height, strokeWidth, strokeColor, lineStyle)
     */
    createRemoteEllipse(data) {
        const layer = this.services.canvasLayer;
        const graphics = new PIXI.Graphics();
        const drawingAlpha = 1.0;
        const drawingColor = this.cssToPixiColor(data.strokeColor);
        const strokeWidth = data.strokeWidth || 6;
        const shadowOffset = 2;
        const shadowAlpha = drawingAlpha * 0.3;
        const shadowColor = 0x000000;
        const lineStyle = data.lineStyle || 'solid';
        const opts = { strokeWidth, strokeColor: data.strokeColor, alpha: drawingAlpha };
        graphics.lineStyle(strokeWidth, shadowColor, shadowAlpha);
        this._drawEllipseWithStyle(graphics, data.startX + shadowOffset, data.startY + shadowOffset, data.width, data.height, 'solid', opts);
        graphics.lineStyle(strokeWidth, drawingColor, drawingAlpha);
        this._drawEllipseWithStyle(graphics, data.startX, data.startY, data.width, data.height, lineStyle, opts);
        layer.addChild(graphics);
        if (!this._pixiDrawings) this._pixiDrawings = [];
        this._pixiDrawings.push({
            id: data.drawingId,
            graphics,
            createdAt: data.createdAt || Date.now(),
            expiresAt: data.expiresAt || null,
            userId: data.userId,
            userName: data.userName || 'Unknown',
            startX: data.startX,
            startY: data.startY,
            width: data.width,
            height: data.height,
            strokeWidth,
            strokeColor: data.strokeColor,
            lineStyle,
            type: 'ellipse'
        });
        this.scheduleCleanup();
    }
    
    /**
     * Create a remote symbol drawing
     * NOTE: This method does NOT broadcast - it's only for rendering remote drawings
     * @param {Object} data - Symbol drawing data
     */
    createRemoteSymbol(data) {
        const layer = this.services.canvasLayer;
        const graphics = new PIXI.Graphics();
        
        // Use REMOTE data for color, size, etc. - NOT local state
        const symbolSize = data.symbolSize || 'medium';
        const strokeColor = data.strokeColor || DrawingTool.strColor1; // Use remote color
        const strokeWidth = data.strokeWidth || 6; // Use remote stroke width
        
        // Symbol size determines the square bounding box
        const symbolSizeMap = {
            small: DrawingTool.strSmallSymbolSize,
            medium: DrawingTool.strMediumSymbolSize,
            large: DrawingTool.strLargeSymbolSize
        };
        const squareSize = symbolSizeMap[symbolSize] || symbolSizeMap.medium;
        
        // Use remote color (convert from CSS to PIXI)
        const drawingColor = this.cssToPixiColor(strokeColor);
        const drawingAlpha = 1.0;
        const shadowOffset = 2;
        const shadowAlpha = drawingAlpha * 0.3;
        const shadowColor = 0x000000;
        
        // Calculate symbol dimensions
        const halfSize = squareSize / 2;
        const padding = strokeWidth * 0.5; // Padding to prevent clipping
        const centerX = data.x;
        const centerY = data.y;
        
        // Create symbol using the same logic as _createSymbolAt but with remote data
        // This ensures we use the REMOTE color, not local state
        this._drawSymbolShape(graphics, data.symbolType, centerX, centerY, halfSize, padding, strokeWidth, drawingColor, drawingAlpha, shadowColor, shadowAlpha, shadowOffset);
        
        // Add to layer
        layer.addChild(graphics);
        
        // Store reference with REMOTE metadata
        if (!this._pixiDrawings) {
            this._pixiDrawings = [];
        }
        
        this._pixiDrawings.push({
            id: data.drawingId,
            graphics: graphics,
            createdAt: data.createdAt || Date.now(),
            expiresAt: data.expiresAt || null,
            userId: data.userId,
            userName: data.userName || 'Unknown',
            symbolType: data.symbolType,
            x: data.x,
            y: data.y,
            strokeWidth: strokeWidth,
            strokeColor: strokeColor,
            symbolSize: symbolSize
        });
        
        // Schedule cleanup if needed
        this.scheduleCleanup();
    }
    
    /**
     * Draw a symbol shape (extracted from _createSymbolAt for reuse)
     * @private
     */
    _drawSymbolShape(graphics, symbolType, centerX, centerY, halfSize, padding, strokeWidth, strokeColor, alpha, shadowColor, shadowAlpha, shadowOffset) {
        // This is the drawing logic from _createSymbolAt, but accepts all parameters
        // so we can use remote data instead of local state
        switch (symbolType) {
            case 'plus':
                // Plus sign - two perpendicular lines
                const plusSize = (halfSize - padding) * 0.7;
                
                // Shadow
                graphics.lineStyle(strokeWidth, shadowColor, shadowAlpha);
                graphics.moveTo(centerX - plusSize + shadowOffset, centerY + shadowOffset);
                graphics.lineTo(centerX + plusSize + shadowOffset, centerY + shadowOffset);
                graphics.moveTo(centerX + shadowOffset, centerY - plusSize + shadowOffset);
                graphics.lineTo(centerX + shadowOffset, centerY + plusSize + shadowOffset);
                
                // Main
                graphics.lineStyle(strokeWidth, strokeColor, alpha);
                graphics.moveTo(centerX - plusSize, centerY);
                graphics.lineTo(centerX + plusSize, centerY);
                graphics.moveTo(centerX, centerY - plusSize);
                graphics.lineTo(centerX, centerY + plusSize);
                break;
                
            case 'x':
                // X mark - two diagonal lines
                const xSize = (halfSize - padding) * 0.7;
                
                // Shadow
                graphics.lineStyle(strokeWidth, shadowColor, shadowAlpha);
                graphics.moveTo(centerX - xSize + shadowOffset, centerY - xSize + shadowOffset);
                graphics.lineTo(centerX + xSize + shadowOffset, centerY + xSize + shadowOffset);
                graphics.moveTo(centerX + xSize + shadowOffset, centerY - xSize + shadowOffset);
                graphics.lineTo(centerX - xSize + shadowOffset, centerY + xSize + shadowOffset);
                
                // Main
                graphics.lineStyle(strokeWidth, strokeColor, alpha);
                graphics.moveTo(centerX - xSize, centerY - xSize);
                graphics.lineTo(centerX + xSize, centerY + xSize);
                graphics.moveTo(centerX + xSize, centerY - xSize);
                graphics.lineTo(centerX - xSize, centerY + xSize);
                break;
                
            case 'dot':
                // Circle - clear lineStyle for filled shapes
                const dotRadius = (halfSize - padding) * 0.7;
                
                // Shadow
                graphics.lineStyle(0); // Clear line style for filled shapes
                graphics.beginFill(shadowColor, shadowAlpha);
                graphics.drawCircle(centerX + shadowOffset, centerY + shadowOffset, dotRadius);
                graphics.endFill();
                
                // Main
                graphics.lineStyle(0); // Clear line style for filled shapes
                graphics.beginFill(strokeColor, alpha);
                graphics.drawCircle(centerX, centerY, dotRadius);
                graphics.endFill();
                break;
                
            case 'arrow':
            case 'arrow-up':
            case 'arrow-down':
            case 'arrow-left':
                // Arrow - use existing arrow drawing logic
                const arrowScaleFactor = 0.70;
                const scaledHalfSizeArrow = (halfSize - padding) * arrowScaleFactor;
                
                let currentLeftX = centerX - scaledHalfSizeArrow;
                let currentRightX = centerX + scaledHalfSizeArrow;
                let currentTopY = centerY - scaledHalfSizeArrow;
                let currentBottomY = centerY + scaledHalfSizeArrow;
                let currentCenterY = centerY;
                
                const arrowAvailableWidth = 2 * scaledHalfSizeArrow;
                const arrowNotchX = currentLeftX + (arrowAvailableWidth * 0.25);
                const arrowNotchY = currentCenterY;
                
                let basePoints = [
                    currentLeftX, currentTopY,
                    arrowNotchX, arrowNotchY,
                    currentLeftX, currentBottomY,
                    currentRightX, currentCenterY
                ];
                
                let rotatedPoints = [];
                let rotationAngle = 0;
                
                switch (symbolType) {
                    case 'arrow-up':
                        rotationAngle = -Math.PI / 2;
                        break;
                    case 'arrow-down':
                        rotationAngle = Math.PI / 2;
                        break;
                    case 'arrow-left':
                        rotationAngle = Math.PI;
                        break;
                    default:
                        rotationAngle = 0;
                        break;
                }
                
                for (let i = 0; i < basePoints.length; i += 2) {
                    const px = basePoints[i];
                    const py = basePoints[i + 1];
                    const translatedX = px - centerX;
                    const translatedY = py - centerY;
                    const rotatedX = translatedX * Math.cos(rotationAngle) - translatedY * Math.sin(rotationAngle);
                    const rotatedY = translatedX * Math.sin(rotationAngle) + translatedY * Math.cos(rotationAngle);
                    rotatedPoints.push(rotatedX + centerX, rotatedY + centerY);
                }
                
                // Shadow - clear lineStyle for filled shapes
                graphics.lineStyle(0); // Clear line style for filled shapes
                graphics.beginFill(shadowColor, shadowAlpha);
                const shadowArrowPoints = [];
                for (let i = 0; i < rotatedPoints.length; i += 2) {
                    shadowArrowPoints.push(rotatedPoints[i] + shadowOffset, rotatedPoints[i + 1] + shadowOffset);
                }
                graphics.drawPolygon(shadowArrowPoints);
                graphics.endFill();
                
                // Main
                graphics.lineStyle(0); // Clear line style for filled shapes
                graphics.beginFill(strokeColor, alpha);
                graphics.drawPolygon(rotatedPoints);
                graphics.endFill();
                break;
                
            case 'square':
                const squareScaleFactor = 0.85;
                const squareScaledHalfSize = (halfSize - padding) * squareScaleFactor;
                const squareSize = squareScaledHalfSize * 2;
                const cornerRadius = squareSize * 0.08;
                
                const squareX = centerX - squareScaledHalfSize;
                const squareY = centerY - squareScaledHalfSize;
                
                // Shadow - clear lineStyle for filled shapes
                graphics.lineStyle(0); // Clear line style for filled shapes
                graphics.beginFill(shadowColor, shadowAlpha);
                graphics.drawRoundedRect(
                    squareX + shadowOffset,
                    squareY + shadowOffset,
                    squareSize,
                    squareSize,
                    cornerRadius
                );
                graphics.endFill();
                
                // Main
                graphics.lineStyle(0); // Clear line style for filled shapes
                graphics.beginFill(strokeColor, alpha);
                graphics.drawRoundedRect(
                    squareX,
                    squareY,
                    squareSize,
                    squareSize,
                    cornerRadius
                );
                graphics.endFill();
                break;
        }
    }
    
    /**
     * Broadcast drawing creation to other clients
     * @param {Object} drawingData - Drawing data to broadcast
     */
    async broadcastDrawingCreation(drawingData) {
        await socketManager.broadcast('drawing', 'created', drawingData);
    }
    
    /**
     * Broadcast drawing deletion to other clients
     * @param {boolean} clearAll - Whether all drawings were cleared
     * @param {string} userId - Optional user ID if clearing specific user's drawings
     * @param {string} drawingId - Optional specific drawing ID to delete (for undo)
     */
    async broadcastDrawingDeletion(clearAll = false, userId = null, drawingId = null) {
        await socketManager.broadcast('drawing', 'deleted', {
            userId: userId || game.user.id,
            clearAll: clearAll,
            drawingId: drawingId || null // Include specific drawing ID if provided
        });
    }
    
    /**
     * Get expiration time for drawings
     * Uses timed erase timeout if enabled, otherwise uses the regular timeout setting
     * @returns {number|null} Timestamp when drawing expires, or null if never
     */
    getExpirationTime() {
        // Only use expiration time if timed erase is enabled
        if (this.state.timedEraseEnabled) {
            const timedEraseTimeout = BlacksmithUtils?.getSettingSafely(
                MODULE.ID,
                'drawing.timedEraseTimeout',
                30
            ) || 30;
            
            return timedEraseTimeout > 0 ? Date.now() + (timedEraseTimeout * 1000) : null;
        }
        
        // If timed erase is disabled, drawings don't expire automatically
        return null;
    }
    
    /**
     * Schedule cleanup of expired drawings
     * Uses a shorter interval when timed erase is enabled for more responsive cleanup
     */
    scheduleCleanup() {
        // If cleanup is already scheduled, don't create another interval
        if (this._cleanupInterval) return;
        
        // Determine cleanup interval based on timed erase setting
        // If timed erase is enabled, check more frequently (every 2 seconds)
        // Otherwise, check every 10 seconds
        const interval = this.state.timedEraseEnabled ? 2000 : 10000;
        
        this._cleanupInterval = setInterval(() => {
            this.cleanupExpiredDrawings();
        }, interval);
        
        // Also check immediately if timed erase is enabled
        if (this.state.timedEraseEnabled) {
            this.cleanupExpiredDrawings();
        }
    }
    
    /**
     * Clean up expired PIXI drawings
     */
    cleanupExpiredDrawings() {
        if (!this._pixiDrawings || !this.services?.canvasLayer) return;
        if (this._pixiDrawings.length === 0) return; // nothing to check
        
        const now = Date.now();
        const layer = this.services.canvasLayer;
        const currentUserId = game.user.id;
        const isGM = game.user.isGM;
        
        let removedCount = 0;
        this._pixiDrawings = this._pixiDrawings.filter(drawing => {
            if (drawing.expiresAt && now > drawing.expiresAt) {
                // If timed erase is enabled and user is not GM, only expire own drawings
                // GMs can expire all drawings when timed erase is enabled
                if (this.state.timedEraseEnabled && !isGM && drawing.userId !== currentUserId) {
                    // Don't expire other players' drawings for non-GM users
                    return true; // Keep in array
                }
                
                // Fade out and remove
                if (drawing.graphics && drawing.graphics.parent) {
                    this._fadeOutAndRemove(drawing.graphics, 300);
                }
                removedCount++;
                return false; // Remove from array
            }
            return true; // Keep in array
        });
        
        // If we removed drawings and timed erase is enabled, log it
        if (removedCount > 0 && this.state.timedEraseEnabled) {
            const scope = isGM ? 'all' : 'your';
            console.log(`${MODULE.NAME}: Cleaned up ${removedCount} expired ${scope} drawing(s)`);
        }
        
        // If no drawings remain and cleanup interval exists, we can keep it running
        // in case new drawings are added, so we don't clear the interval
    }
    
    /**
     * Cancel the current drawing
     */
    cancelDrawing() {
        // Remove preview graphics if exists
        if (this._previewGraphics && this._previewGraphics.parent && this.services?.canvasLayer) {
            this.services.canvasLayer.removeChild(this._previewGraphics);
            this._previewGraphics.destroy();
            this._previewGraphics = null;
        }
        
        this.state.isDrawing = false;
        this.state.drawingPoints = [];
        this.state.drawingStartPoint = null;
        this.state.boxStartPoint = null;
        this.state.ellipseStartPoint = null;
        this.state.lineStartPoint = null;
        this.state.lastMousePosition = null;
        this.state.currentDrawing = null;
    }
    
    /**
     * Get brush settings
     * @returns {Object} Brush settings object
     */
    getBrushSettings() {
        return { ...this.state.brushSettings };
    }
    
    /**
     * Set brush settings
     * @param {Object} settings - Brush settings to update
     */
    setBrushSettings(settings, persist = false) {
        if (settings.size !== undefined) {
            this.state.brushSettings.size = Math.max(1, Math.min(20, settings.size));
        }
        if (settings.color !== undefined) {
            this.state.brushSettings.color = settings.color;
        }
        if (settings.type !== undefined) {
            this.state.brushSettings.type = settings.type;
        }
        
        if (persist) {
            if (settings.size !== undefined) game.settings.set(MODULE.ID, 'toolbar.lineWidth', this.state.brushSettings.size);
            if (settings.color !== undefined) game.settings.set(MODULE.ID, 'toolbar.color', this.state.brushSettings.color);
        }

        // Update button states when settings change
        if (settings.size !== undefined) {
            this.updateLineWidthButtons();
        }
        if (settings.color !== undefined) {
            this.updateColorButtons();
        }
        this.notifyChange();
    }
    
    /** Clear this user's temporary drawings, and say how many went. */
    clearMine() {
        // Always clear only the current user's drawings (for both GM and players)
        const removed = this.clearUserDrawings(game.user.id) ?? 0;
        notify(
            removed ? 'Your drawings cleared' : 'Nothing to clear',
            {
                subtitle: removed
                    ? `${removed} temporary drawing${removed === 1 ? '' : 's'} removed`
                    : 'You have no temporary drawings on this scene',
                type: removed ? 'info' : 'warn',
                icon: 'fa-solid fa-eraser',
                stackKey: `${MODULE.ID}-clear`
            }
        );
    }

    /** GM: clear every user's temporary drawings. */
    clearEveryone() {
        if (!game.user.isGM) return;
        const removed = this._pixiDrawings?.length ?? 0;
        this.clearAllDrawings();
        notify(
            removed ? 'All drawings cleared' : 'Nothing to clear',
            {
                subtitle: removed
                    ? `${removed} temporary drawing${removed === 1 ? '' : 's'} removed from every player`
                    : 'No temporary drawings on this scene',
                type: removed ? 'info' : 'warn',
                icon: 'fa-solid fa-trash-can',
                stackKey: `${MODULE.ID}-clear-all`
            }
        );
    }

    /** Turn timed erase on or off: drawings delete themselves after the timeout. */
    setTimedErase(enabled) {
        this.state.timedEraseEnabled = !!enabled;

        // Save state to settings
        game.settings.set(MODULE.ID, 'toolbar.timedEraseEnabled', this.state.timedEraseEnabled);

        this.updateTimedEraseButton();

        // Restart cleanup with new interval based on timed erase state
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
            this._cleanupInterval = null;
        }
        // Schedule cleanup with appropriate interval
        if (this._pixiDrawings && this._pixiDrawings.length > 0) {
            this.scheduleCleanup();
        }

        const status = this.state.timedEraseEnabled ? 'enabled' : 'disabled';
        const timeout = BlacksmithUtils?.getSettingSafely(
            MODULE.ID,
            'drawing.timedEraseTimeout',
            30
        ) || 30;
        const scope = game.user.isGM ? 'all drawings' : 'your drawings';
        notify(`Timed erase ${status}`, {
            subtitle: this.state.timedEraseEnabled
                ? `${scope} auto-delete after ${timeout}s`
                : `${scope} stay until cleared`,
            icon: 'fa-solid fa-clock',
            stackKey: `${MODULE.ID}-timed-erase` // toggling repeatedly replaces in place
        });
        this.notifyChange();
    }

    /**
     * Update active state of timed erase button in secondary bar
     * Uses Blacksmith's updateSecondaryBarItemActive API
     */
    updateTimedEraseButton() {
        try {
            const blacksmithModule = game.modules.get('coffee-pub-blacksmith');
            if (!blacksmithModule?.api?.updateSecondaryBarItemActive) {
                return;
            }
            
            const barTypeId = MODULE.ID;
            blacksmithModule.api.updateSecondaryBarItemActive(
                barTypeId,
                `${MODULE.ID}-timed-erase`,
                this.state.timedEraseEnabled
            );
        } catch (error) {
            console.error(`${MODULE.NAME}: Error updating timed erase button:`, error);
        }
    }
    
    /**
     * Set the drawing mode
     * @param {string} mode - Drawing mode: 'line', 'box', 'stamp'
     */
    setDrawingMode(mode) {
        if (['sketch', 'line', 'box', 'ellipse', 'stamp', 'terrain', 'erase'].includes(mode) || (mode === 'wall' && this.canMakeWalls())) {
            this.state.drawingMode = mode;
            // The eraser is only ever the window's: it is not remembered, or the hotkey would wake up holding it.
            if (mode !== 'erase') game.settings.set(MODULE.ID, 'toolbar.drawingMode', mode);
            this.removePreviewSymbol();
            this.notifyChange();
        }
    }

    /**
     * The kind of stroke the mode makes. Wall mode strokes like a line or a sketch, by its shape.
     * @returns {'sketch'|'line'|'box'|'ellipse'|'stamp'}
     */
    _strokeMode() {
        const mode = this.state.drawingMode;
        if (mode === 'terrain') return 'sketch';
        return mode === 'wall' ? (this.state.wallShape === 'sketch' ? 'sketch' : 'line') : mode;
    }

    /**
     * Set the stamp style (shape used when Stamp tool is selected)
     * @param {string} style - Stamp style: 'plus', 'x', 'dot', 'arrow', 'arrow-up', 'arrow-down', 'arrow-left', 'square'
     */
    setStampStyle(style) {
        if (isStamp(style)) {
            this.state.stampStyle = style;
            game.settings.set(MODULE.ID, 'toolbar.stampStyle', style);
            this._roll = null;
            this.notifyChange();
        }
    }
    
    /**
     * Set the symbol size
     * @param {string} size - Symbol size: 'small', 'medium', 'large'
     */
    setSymbolSize(size) {
        if (['small', 'medium', 'large'].includes(size)) {
            this.state.symbolSize = size;
            // Save to client-scope setting
            game.settings.set(MODULE.ID, 'toolbar.symbolSize', size);
            this.notifyChange();
        }
    }
    
    /**
     * Update active state of Drawing Mode buttons in secondary bar
     */
    updateModeButtons() {
        try {
            const blacksmithModule = game.modules.get('coffee-pub-blacksmith');
            if (!blacksmithModule?.api?.updateSecondaryBarItemActive || !this._modeButtons) return;
            const barTypeId = MODULE.ID;
            const currentMode = this.state.drawingMode;
            ['sketch', 'line', 'box', 'ellipse', 'stamp'].forEach(mode => {
                if (this._modeButtons[mode]) {
                    blacksmithModule.api.updateSecondaryBarItemActive(
                        barTypeId,
                        this._modeButtons[mode],
                        currentMode === mode
                    );
                }
            });
        } catch (error) {
            console.error(`${MODULE.NAME}: Error updating mode buttons:`, error);
        }
    }

    /**
     * Update active state of Stamp Style buttons in secondary bar
     */
    updateStampStyleButtons() {
        try {
            const blacksmithModule = game.modules.get('coffee-pub-blacksmith');
            if (!blacksmithModule?.api?.updateSecondaryBarItemActive || !this._stampStyleButtons) return;
            const barTypeId = MODULE.ID;
            const currentStyle = this.state.stampStyle;
            const styleForButton = { plus: 'plus', x: 'x', dot: 'dot', arrow: 'arrow', arrowUp: 'arrow-up', arrowDown: 'arrow-down', arrowLeft: 'arrow-left', square: 'square' };
            Object.keys(styleForButton).forEach(btnKey => {
                if (this._stampStyleButtons[btnKey]) {
                    blacksmithModule.api.updateSecondaryBarItemActive(
                        barTypeId,
                        this._stampStyleButtons[btnKey],
                        currentStyle === styleForButton[btnKey]
                    );
                }
            });
        } catch (error) {
            console.error(`${MODULE.NAME}: Error updating stamp style buttons:`, error);
        }
    }
    
    /**
     * Update active state of symbol size buttons in secondary bar
     * Uses Blacksmith's updateSecondaryBarItemActive API
     */
    updateSymbolSizeButtons() {
        try {
            const blacksmithModule = game.modules.get('coffee-pub-blacksmith');
            if (!blacksmithModule?.api?.updateSecondaryBarItemActive) {
                return;
            }
            
            const barTypeId = MODULE.ID;
            const currentSize = this.state.symbolSize;
            
            // Update active state for each symbol size button
            if (this._symbolSizeButtons) {
                const sizes = ['small', 'medium', 'large'];
                sizes.forEach(size => {
                    blacksmithModule.api.updateSecondaryBarItemActive(
                        barTypeId,
                        this._symbolSizeButtons[size],
                        currentSize === size
                    );
                });
            }
        } catch (error) {
            console.error(`${MODULE.NAME}: Error updating symbol size buttons:`, error);
        }
    }
    
    /**
     * Update active state of line style buttons in secondary bar
     * Uses Blacksmith's updateSecondaryBarItemActive API
     */
    updateLineStyleButtons() {
        try {
            const blacksmithModule = game.modules.get('coffee-pub-blacksmith');
            if (!blacksmithModule?.api?.updateSecondaryBarItemActive) {
                return;
            }
            
            const barTypeId = MODULE.ID;
            const currentStyle = this.state.lineStyle;
            
            // Update active state for each line style button
            if (this._lineStyleButtons) {
                const styles = ['solid', 'dotted', 'dashed'];
                styles.forEach(style => {
                    blacksmithModule.api.updateSecondaryBarItemActive(
                        barTypeId,
                        this._lineStyleButtons[style],
                        currentStyle === style
                    );
                });
            }
        } catch (error) {
            console.error(`${MODULE.NAME}: Error updating line style buttons:`, error);
        }
    }
    
    /**
     * Stamp a symbol on the canvas
     * If called from button click, will stamp on next canvas click
     * If called with event, will stamp at event position
     * @param {string} symbolType - Type of symbol: 'plus', 'x', 'dot', 'arrow'
     * @param {PointerEvent} event - Optional pointer event with coordinates
     */
    stampSymbol(symbolType, event = null) {
        if (!this.services || !this.services.canvasLayer) {
            console.warn(`${MODULE.NAME}: Canvas Layer not available for stamping`);
            return;
        }
        
        if (!canvas || !canvas.scene) {
            console.warn(`${MODULE.NAME}: Canvas or scene not available for stamping`);
            return;
        }
        
        let worldX, worldY;
        
        if (event) {
            // Use event coordinates
            const rect = canvas.app.view.getBoundingClientRect();
            const screenX = event.clientX - rect.left;
            const screenY = event.clientY - rect.top;
            const worldPoint = canvas.app.stage.toLocal(new PIXI.Point(screenX, screenY));
            worldX = worldPoint.x;
            worldY = worldPoint.y;
        } else {
            // Try to get current mouse position
            const mousePosition = canvas.app.renderer.plugins.interaction?.mouse?.global;
            if (mousePosition) {
                const worldPoint = canvas.app.stage.toLocal(mousePosition);
                worldX = worldPoint.x;
                worldY = worldPoint.y;
            } else {
                // Fallback: use center of viewport
                const view = canvas.app.view;
                const centerX = view.width / 2;
                const centerY = view.height / 2;
                const worldPoint = canvas.app.stage.toLocal(new PIXI.Point(centerX, centerY));
                worldX = worldPoint.x;
                worldY = worldPoint.y;
            }
        }
        
        // Remove preview before placing actual symbol
        this.removePreviewSymbol();
        
        this._createSymbolAt(symbolType, worldX, worldY);
    }
    
    /**
     * Create a symbol at the specified world coordinates
     * 
     * Symbol properties:
     * - strokeWidth: this.state.brushSettings.size (line width setting) * multiplier
     * - strokeColor: this.state.brushSettings.color (color setting)
     * - squareSize: Based on this.state.symbolSize ('small', 'medium', 'large')
     *   All symbols fit within a square bounding box of this size
     * 
     * @param {string} symbolType - Type of symbol: 'plus', 'x', 'dot', 'arrow'
     * @param {number} x - World X coordinate
     * @param {number} y - World Y coordinate
     */
    _createSymbolAt(symbolType, x, y) {
        if (isProceduralStamp(symbolType)) {
            this._placeStamp(symbolType, x, y);
            return;
        }
        const layer = this.services.canvasLayer;
        const graphics = new PIXI.Graphics();
        
        // Symbol size determines the square bounding box
        const symbolSizeMap = {
            small: DrawingTool.strSmallSymbolSize,   // px square
            medium: DrawingTool.strMediumSymbolSize,  // px square
            large: DrawingTool.strLargeSymbolSize    // px square
        };
        const squareSize = symbolSizeMap[this.state.symbolSize] || symbolSizeMap.medium;
        
        // Stroke width is simply a proportion of the symbol size
        // This ensures the stroke scales appropriately with the symbol size
        const strokeProportion = 0.30; // 30% of symbol size as stroke width
        const strokeWidth = squareSize * strokeProportion;
        const strokeColor = this.cssToPixiColor(this.state.brushSettings.color);
        const symbolAlpha = 1.0; // Always fully opaque (no transparency from color)
        
        // Use rounded line joins and caps for smooth corners
        // PIXI Graphics lineStyle - try object syntax first, fallback to traditional
        try {
            // PIXI v5+ object syntax
            graphics.lineStyle({
                width: strokeWidth,
                color: strokeColor,
                alpha: symbolAlpha,
                lineJoin: 'round',
                lineCap: 'round'
            });
        } catch (e) {
            // Fallback to traditional syntax and set properties if available
            graphics.lineStyle(strokeWidth, strokeColor, symbolAlpha);
            // Try to set rounded properties if the graphics object supports it
            if (graphics.geometry && graphics.geometry.graphicsData) {
                const lastData = graphics.geometry.graphicsData[graphics.geometry.graphicsData.length - 1];
                if (lastData && lastData.lineStyle) {
                    lastData.lineStyle.lineJoin = 'round';
                    lastData.lineStyle.lineCap = 'round';
                }
            }
        }
        
        // All symbols are drawn to fit within the squareSize x squareSize bounding box
        // Center the symbol at (x, y)
        const halfSize = squareSize / 2;
        const padding = squareSize * 0.1; // 10% padding from edges
        
        // Shadow properties
        const shadowOffset = 2; // Shadow offset in pixels
        const shadowAlpha = symbolAlpha * 0.3; // Shadow opacity (30% of main alpha)
        const shadowColor = 0x000000; // Black shadow
        
        switch (symbolType) {
            case 'plus':
                // Draw shadow plus sign
                const plusArmLength = halfSize - padding;
                graphics.lineStyle(strokeWidth, shadowColor, shadowAlpha);
                graphics.moveTo(x - plusArmLength + shadowOffset, y + shadowOffset);
                graphics.lineTo(x + plusArmLength + shadowOffset, y + shadowOffset);
                graphics.moveTo(x + shadowOffset, y - plusArmLength + shadowOffset);
                graphics.lineTo(x + shadowOffset, y + plusArmLength + shadowOffset);
                
                // Draw main plus sign
                try {
                    graphics.lineStyle({
                        width: strokeWidth,
                        color: strokeColor,
                        alpha: symbolAlpha,
                        lineJoin: 'round',
                        lineCap: 'round'
                    });
                } catch (e) {
                    graphics.lineStyle(strokeWidth, strokeColor, symbolAlpha);
                }
                graphics.moveTo(x - plusArmLength, y);
                graphics.lineTo(x + plusArmLength, y);
                graphics.moveTo(x, y - plusArmLength);
                graphics.lineTo(x, y + plusArmLength);
                break;
                
            case 'x':
                // Draw shadow X
                const xArmLength = (halfSize - padding) * 0.707; // Diagonal length (cos 45°)
                graphics.lineStyle(strokeWidth, shadowColor, shadowAlpha);
                graphics.moveTo(x - xArmLength + shadowOffset, y - xArmLength + shadowOffset);
                graphics.lineTo(x + xArmLength + shadowOffset, y + xArmLength + shadowOffset);
                graphics.moveTo(x + xArmLength + shadowOffset, y - xArmLength + shadowOffset);
                graphics.lineTo(x - xArmLength + shadowOffset, y + xArmLength + shadowOffset);
                
                // Draw main X
                try {
                    graphics.lineStyle({
                        width: strokeWidth,
                        color: strokeColor,
                        alpha: symbolAlpha,
                        lineJoin: 'round',
                        lineCap: 'round'
                    });
                } catch (e) {
                    graphics.lineStyle(strokeWidth, strokeColor, symbolAlpha);
                }
                graphics.moveTo(x - xArmLength, y - xArmLength);
                graphics.lineTo(x + xArmLength, y + xArmLength);
                graphics.moveTo(x + xArmLength, y - xArmLength);
                graphics.lineTo(x - xArmLength, y + xArmLength);
                break;
                
            case 'dot':
                // Draw shadow circle - clear lineStyle for filled shapes
                const dotRadius = halfSize - padding;
                graphics.lineStyle(0); // Clear line style for filled shapes
                graphics.beginFill(shadowColor, shadowAlpha);
                graphics.drawCircle(x + shadowOffset, y + shadowOffset, dotRadius);
                graphics.endFill();
                
                // Draw main circle
                graphics.lineStyle(0); // Clear line style for filled shapes
                graphics.beginFill(strokeColor, symbolAlpha);
                graphics.drawCircle(x, y, dotRadius);
                graphics.endFill();
                break;
                
            case 'arrow':
            case 'arrow-up':
            case 'arrow-down':
            case 'arrow-left':
                // Chevron arrow with notched edge - using drawPolygon
                // Scale to match circle visual size (circle uses radius = halfSize - padding)
                // Arrow should be roughly same visual size, so scale down to ~70% of available space
                const createArrowScaleFactor = 0.70;
                const createArrowScaledHalfSize = (halfSize - padding) * createArrowScaleFactor;
                
                let createArrowPoints, createShadowPoints;
                
                if (symbolType === 'arrow') {
                    // Right arrow (original)
                    const leftX = x - createArrowScaledHalfSize;
                    const rightX = x + createArrowScaledHalfSize;
                    const centerY = y;
                    const topY = centerY - createArrowScaledHalfSize;
                    const bottomY = centerY + createArrowScaledHalfSize;
                    const availableWidth = 2 * createArrowScaledHalfSize;
                    const notchX = leftX + (availableWidth * 0.25);
                    const notchY = centerY;
                    
                    createArrowPoints = [
                        leftX, topY,
                        notchX, notchY,
                        leftX, bottomY,
                        rightX, centerY
                    ];
                    createShadowPoints = [
                        leftX + shadowOffset, topY + shadowOffset,
                        notchX + shadowOffset, notchY + shadowOffset,
                        leftX + shadowOffset, bottomY + shadowOffset,
                        rightX + shadowOffset, centerY + shadowOffset
                    ];
                } else if (symbolType === 'arrow-up') {
                    // Up arrow
                    const leftX = x - createArrowScaledHalfSize;
                    const rightX = x + createArrowScaledHalfSize;
                    const centerX = x;
                    const topY = y - createArrowScaledHalfSize;
                    const bottomY = y + createArrowScaledHalfSize;
                    const availableHeight = 2 * createArrowScaledHalfSize;
                    const notchX = centerX;
                    const notchY = bottomY - (availableHeight * 0.25);
                    
                    createArrowPoints = [
                        leftX, bottomY,
                        notchX, notchY,
                        rightX, bottomY,
                        centerX, topY
                    ];
                    createShadowPoints = [
                        leftX + shadowOffset, bottomY + shadowOffset,
                        notchX + shadowOffset, notchY + shadowOffset,
                        rightX + shadowOffset, bottomY + shadowOffset,
                        centerX + shadowOffset, topY + shadowOffset
                    ];
                } else if (symbolType === 'arrow-down') {
                    // Down arrow
                    const leftX = x - createArrowScaledHalfSize;
                    const rightX = x + createArrowScaledHalfSize;
                    const centerX = x;
                    const topY = y - createArrowScaledHalfSize;
                    const bottomY = y + createArrowScaledHalfSize;
                    const availableHeight = 2 * createArrowScaledHalfSize;
                    const notchX = centerX;
                    const notchY = topY + (availableHeight * 0.25);
                    
                    createArrowPoints = [
                        leftX, topY,
                        notchX, notchY,
                        rightX, topY,
                        centerX, bottomY
                    ];
                    createShadowPoints = [
                        leftX + shadowOffset, topY + shadowOffset,
                        notchX + shadowOffset, notchY + shadowOffset,
                        rightX + shadowOffset, topY + shadowOffset,
                        centerX + shadowOffset, bottomY + shadowOffset
                    ];
                } else if (symbolType === 'arrow-left') {
                    // Left arrow
                    const leftX = x - createArrowScaledHalfSize;
                    const rightX = x + createArrowScaledHalfSize;
                    const centerY = y;
                    const topY = centerY - createArrowScaledHalfSize;
                    const bottomY = centerY + createArrowScaledHalfSize;
                    const availableWidth = 2 * createArrowScaledHalfSize;
                    const notchX = rightX - (availableWidth * 0.25);
                    const notchY = centerY;
                    
                    createArrowPoints = [
                        rightX, topY,
                        notchX, notchY,
                        rightX, bottomY,
                        leftX, centerY
                    ];
                    createShadowPoints = [
                        rightX + shadowOffset, topY + shadowOffset,
                        notchX + shadowOffset, notchY + shadowOffset,
                        rightX + shadowOffset, bottomY + shadowOffset,
                        leftX + shadowOffset, centerY + shadowOffset
                    ];
                }
                
                // Draw shadow arrow - clear lineStyle for filled shapes
                graphics.lineStyle(0); // Clear line style for filled shapes
                graphics.beginFill(shadowColor, shadowAlpha);
                graphics.drawPolygon(createShadowPoints);
                graphics.endFill();
                
                // Draw main arrow
                graphics.lineStyle(0); // Clear line style for filled shapes
                graphics.beginFill(strokeColor, symbolAlpha);
                graphics.drawPolygon(createArrowPoints);
                graphics.endFill();
                break;
                
            case 'square':
                // Rounded square - using drawRoundedRect
                // Scale to match circle visual size (circle uses radius = halfSize - padding)
                const squareScaleFactor = 0.85;
                const squareScaledHalfSize = (halfSize - padding) * squareScaleFactor;
                const squareSize = squareScaledHalfSize * 2;
                const cornerRadius = squareSize * 0.08; // 8% corner radius for rounded corners
                
                // Draw shadow rounded square - clear lineStyle for filled shapes
                graphics.lineStyle(0); // Clear line style for filled shapes
                graphics.beginFill(shadowColor, shadowAlpha);
                graphics.drawRoundedRect(
                    x - squareScaledHalfSize + shadowOffset,
                    y - squareScaledHalfSize + shadowOffset,
                    squareSize,
                    squareSize,
                    cornerRadius
                );
                graphics.endFill();
                
                // Draw main rounded square
                graphics.lineStyle(0); // Clear line style for filled shapes
                graphics.beginFill(strokeColor, symbolAlpha);
                graphics.drawRoundedRect(
                    x - squareScaledHalfSize,
                    y - squareScaledHalfSize,
                    squareSize,
                    squareSize,
                    cornerRadius
                );
                graphics.endFill();
                break;
                
            default:
                console.warn(`${MODULE.NAME}: Unknown symbol type: ${symbolType}`);
                return;
        }
        
        // Add to layer
        layer.addChild(graphics);
        
        // Store in drawings array for cleanup
        const drawingId = `symbol-${symbolType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        if (!this._pixiDrawings) {
            this._pixiDrawings = [];
        }
        const symbolData = {
            id: drawingId,
            graphics: graphics,
            createdAt: Date.now(),
            expiresAt: this.getExpirationTime(),
            userId: game.user.id,
            userName: game.user.name,
            symbolType: symbolType,
            x: x,
            y: y
        };
        this._pixiDrawings.push(symbolData);
        
        // Store as last drawing for undo
        this._lastDrawing = symbolData;
        
        // Schedule cleanup if needed
        this.scheduleCleanup();
        
        // Broadcast symbol creation to other clients
        this.broadcastDrawingCreation({
            drawingId: drawingId,
            userId: game.user.id,
            userName: game.user.name,
            symbolType: symbolType,
            x: x,
            y: y,
            strokeWidth: strokeWidth,
            strokeColor: this.state.brushSettings.color,
            symbolSize: this.state.symbolSize || 'medium',
            createdAt: symbolData.createdAt,
            expiresAt: symbolData.expiresAt
        });
    }
    
    /**
     * Update active state of color buttons in secondary bar
     * Uses Blacksmith's updateSecondaryBarItemActive API
     */
    updateColorButtons() {
        try {
            const blacksmithModule = game.modules.get('coffee-pub-blacksmith');
            if (!blacksmithModule?.api?.updateSecondaryBarItemActive) {
                return;
            }
            
            const barTypeId = MODULE.ID;
            const currentColor = this.state.brushSettings.color;
            
            // Update active state for each color button
            if (this._colorButtons) {
                // Get current player color with proper type checking
                let playerColorHex = '#000000'; // Default fallback
                if (game.user?.color) {
                    // Check if it's a Foundry Color object
                    if (game.user.color.constructor?.name === 'Color') {
                        // Foundry Color object - convert to number and then to hex
                        const colorValue = Number(game.user.color);
                        if (!isNaN(colorValue)) {
                            playerColorHex = '#' + colorValue.toString(16).padStart(6, '0');
                        }
                    } else if (typeof game.user.color === 'string') {
                        playerColorHex = game.user.color;
                    } else if (typeof game.user.color === 'number') {
                        // Convert number to hex string
                        playerColorHex = '#' + game.user.color.toString(16).padStart(6, '0');
                    }
                }
                
                // Ensure it's a valid hex string
                if (!playerColorHex.startsWith('#')) {
                    playerColorHex = '#000000';
                }
                
                const r = parseInt(playerColorHex.slice(1, 3), 16);
                const g = parseInt(playerColorHex.slice(3, 5), 16);
                const b = parseInt(playerColorHex.slice(5, 7), 16);
                const playerColorRgba = `rgba(${r}, ${g}, ${b}, 1.0)`;
                
                // Use the same static color constants
                const colorPalette = {
                    player: playerColorRgba,
                    black: DrawingTool.strColor1,
                    red: DrawingTool.strColor2,
                    blue: DrawingTool.strColor3,
                    green: DrawingTool.strColor4,
                    yellow: DrawingTool.strColor5
                };
                
                Object.entries(colorPalette).forEach(([colorKey, colorRgba]) => {
                    blacksmithModule.api.updateSecondaryBarItemActive(
                        barTypeId,
                        this._colorButtons[colorKey],
                        currentColor === colorRgba
                    );
                });
            }
        } catch (error) {
            console.error(`${MODULE.NAME}: Error updating color buttons:`, error);
        }
    }
    
    /**
     * Update active state of line width buttons in secondary bar
     * Uses Blacksmith's updateSecondaryBarItemActive API
     */
    updateLineWidthButtons() {
        try {
            const blacksmithModule = game.modules.get('coffee-pub-blacksmith');
            if (!blacksmithModule?.api?.updateSecondaryBarItemActive) {
                return;
            }
            
            const barTypeId = MODULE.ID;
            const currentSize = this.state.brushSettings.size;
            
            // Update all three buttons based on current size
            if (this._lineWidthButtons) {
                blacksmithModule.api.updateSecondaryBarItemActive(
                    barTypeId,
                    this._lineWidthButtons.thin,
                    currentSize === 3
                );
                blacksmithModule.api.updateSecondaryBarItemActive(
                    barTypeId,
                    this._lineWidthButtons.medium,
                    currentSize === 6
                );
                blacksmithModule.api.updateSecondaryBarItemActive(
                    barTypeId,
                    this._lineWidthButtons.thick,
                    currentSize === 12
                );
            }
        } catch (error) {
            console.error(`${MODULE.NAME}: Error updating line width buttons:`, error);
        }
    }
    
    // ==================================================================
    // ===== STAMPS =====================================================
    // ==================================================================

    /** The pixel size of the square a Small, Medium or Large stamp fits in, before the stamp's own scale. */
    _symbolPixels() {
        return {
            small: DrawingTool.strSmallSymbolSize,
            medium: DrawingTool.strMediumSymbolSize,
            large: DrawingTool.strLargeSymbolSize
        }[this.state.symbolSize] ?? DrawingTool.strMediumSymbolSize;
    }

    /** What the next stamp will look like -- its seed, turn, flip and size -- rolled ahead so the preview is what is placed. */
    _peekRoll() {
        if (!this._roll) {
            const stamp = stampById(this.state.stampStyle);
            const options = this.state.stamp;
            this._roll = {
                seed: 1 + Math.floor(Math.random() * 2147483646),
                rotation: options.rotate && stamp && !stamp.legacy ? Math.random() * Math.PI * 2 : 0,
                mirror: options.rotate && Math.random() < 0.5,
                jitter: options.jitter ? 0.85 + Math.random() * 0.3 : 1
            };
        }
        return this._roll;
    }

    _takeRoll() {
        const roll = this._peekRoll();
        this._roll = null;
        return roll;
    }

    /** The colour the stamp is tinted, or null for its own colours. */
    _stampTint(kind) {
        return this.state.stamp.natural && isProceduralStamp(kind) ? null : this.state.brushSettings.color;
    }

    /** Whether this user may write Drawings to the scene. */
    canKeepOnScene() {
        return !!(game.user?.isGM || game.user?.can?.('DRAWING_CREATE'));
    }

    /** Whether this user may make walls: only the GM. */
    canMakeWalls() {
        return !!game.user?.isGM;
    }

    /**
     * A stamp is being put down at a point, and now dragging goes on putting down more of it. The
     * stroke is remembered as one thing: undone together, and, for a stamp kept on the scene, written
     * together when the button comes up, with what has been put down drawn faintly until then.
     */
    _beginScatter(event) {
        this._endScatter();
        if (!isProceduralStamp(this.state.stampStyle)) return;
        const point = this.getWorldCoordinates(event);
        if (point) this._scatter = { x: point.x, y: point.y, group: foundry.utils.randomID(), count: 0, docs: [], live: [] };
    }

    /** The stroke is over: what is to be written to the scene is written, as one thing. */
    _endScatter() {
        const stroke = this._scatter;
        this._scatter = null;
        if (!stroke) return;
        const clear = () => {
            for (const graphics of stroke.live) {
                graphics.parent?.removeChild(graphics);
                graphics.destroy?.();
            }
        };
        if (stroke.docs.length) void this._keepDrawings(stroke.docs, 'stamp').finally(clear);
        else clear();
    }

    /** How far apart a drag puts stamps down. Ground is painted: dabs close enough to run together. */
    _scatterStep(kind) {
        const stamp = stampById(kind);
        const apart = stamp.category === 'ground' ? 0.2 : 0.6;
        return Math.max(6, this._symbolPixels() * stamp.scale * this.state.stamp.spacing * apart);
    }

    _scatterTo(event) {
        const point = this.getWorldCoordinates(event);
        const stroke = this._scatter;
        if (!point || !stroke) return;
        const kind = this.state.stampStyle;
        const step = this._scatterStep(kind);
        const loose = stampById(kind).category === 'ground' ? 0.1 : 0.3;
        this.removePreviewSymbol();
        // Every step along the way gets one, so a fast drag leaves no gaps.
        let distance = Math.hypot(point.x - stroke.x, point.y - stroke.y);
        while (distance >= step && stroke.count < MAX_SCATTER) {
            stroke.x += ((point.x - stroke.x) / distance) * step;
            stroke.y += ((point.y - stroke.y) / distance) * step;
            this._placeStamp(kind, stroke.x + (Math.random() - 0.5) * step * loose, stroke.y + (Math.random() - 0.5) * step * loose);
            distance = Math.hypot(point.x - stroke.x, point.y - stroke.y);
        }
    }

    /** The preview that follows the mouse in stamp mode: the stamp as it will be put down, faint. */
    _previewStamp(x, y) {
        const layer = this.services.canvasLayer;
        const kind = this.state.stampStyle;
        const stamp = stampById(kind);
        const roll = this._peekRoll();
        const graphics = new PIXI.Graphics();
        drawStamp(graphics, buildStamp(kind, roll), stampPalette(kind, this._stampTint(kind)), {
            x, y, size: this._symbolPixels() * stamp.scale * roll.jitter, alpha: 0.55
        });
        layer.addChild(graphics);
        this._previewSymbol = graphics;
    }

    /**
     * Put one of the new stamps at a point: a temporary drawing everyone sees, or, if asked and
     * allowed, Drawings written to the scene.
     */
    _placeStamp(kind, x, y) {
        const stamp = stampById(kind);
        if (!stamp || stamp.legacy) return;
        const roll = this._takeRoll();
        const size = this._symbolPixels() * stamp.scale * roll.jitter;
        const tint = this._stampTint(kind);
        const prims = buildStamp(kind, roll);
        const palette = stampPalette(kind, tint);
        const stroke = this._scatter;
        const later = !!stroke && stroke.count++ > 0;

        if (this.state.stamp.keep && this.canKeepOnScene()) {
            // A stroke of ground is a great many Drawings, so after the first dab each keeps only a few
            // specks of its texture. What is shown while the button is down is exactly what is written.
            let specks = 0;
            const kept = later && stamp.category === 'ground' ? prims.filter(prim => !prim.speck || ++specks <= KEPT_SPECKS) : prims;
            if (stroke) {
                const live = new PIXI.Graphics();
                drawStamp(live, kept, palette, { x, y, size });
                this.services.canvasLayer.addChild(live);
                stroke.live.push(live);
            }
            void this._keepStamp(kind, kept, palette, { x, y, size }, stroke);
            return;
        }

        const graphics = new PIXI.Graphics();
        drawStamp(graphics, prims, palette, { x, y, size });
        this.services.canvasLayer.addChild(graphics);
        const drawingId = `stamp-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        const record = {
            id: drawingId,
            graphics,
            createdAt: Date.now(),
            expiresAt: this.getExpirationTime(),
            userId: game.user.id,
            userName: game.user.name,
            stampKind: kind,
            group: stroke?.group,
            x,
            y
        };
        if (!this._pixiDrawings) this._pixiDrawings = [];
        this._pixiDrawings.push(record);
        this._lastDrawing = record;
        this.scheduleCleanup();
        this.broadcastDrawingCreation({
            drawingId,
            userId: game.user.id,
            userName: game.user.name,
            stampKind: kind,
            seed: roll.seed,
            rotation: roll.rotation,
            mirror: roll.mirror,
            size,
            tint,
            x,
            y,
            createdAt: record.createdAt,
            expiresAt: record.expiresAt
        });
    }

    /** A stamp from another client, drawn from the seed it was made with. */
    createRemoteStamp(data) {
        if (!isProceduralStamp(data.stampKind)) return;
        const graphics = new PIXI.Graphics();
        drawStamp(graphics, buildStamp(data.stampKind, data), stampPalette(data.stampKind, data.tint), {
            x: data.x, y: data.y, size: data.size
        });
        this.services.canvasLayer.addChild(graphics);
        if (!this._pixiDrawings) this._pixiDrawings = [];
        this._pixiDrawings.push({
            id: data.drawingId,
            graphics,
            createdAt: data.createdAt || Date.now(),
            expiresAt: data.expiresAt || null,
            userId: data.userId,
            userName: data.userName || 'Unknown',
            stampKind: data.stampKind,
            x: data.x,
            y: data.y
        });
        this.scheduleCleanup();
    }

    /** Write a stamp to the scene as Drawings, as one thing to take back. */
    async _keepStamp(kind, prims, palette, { x, y, size }, stroke = null) {
        const scene = canvas.scene;
        if (!scene) return;
        const group = foundry.utils.randomID();
        const docs = stampDrawingData(prims, palette, {
            x, y, size,
            flags: { [MODULE.ID]: { stamp: { id: group, kind } } },
            solid: CONST.DRAWING_FILL_TYPES.SOLID,
            none: CONST.DRAWING_FILL_TYPES.NONE
        });
        // In a stroke, they wait for its end and are written together.
        if (stroke) {
            stroke.docs.push(...docs);
            return;
        }
        await this._keepDrawings(docs, 'stamp');
    }

    /** Write Drawings to the scene, as one thing to take back. `what` is 'stamp' or 'path'. */
    async _keepDrawings(docs, what) {
        const scene = canvas.scene;
        if (!scene) return;
        try {
            const made = await scene.createEmbeddedDocuments('Drawing', docs);
            this._pushKept({ kind: what, drawingIds: (made ?? []).map(doc => doc.id) });
        } catch (error) {
            console.error(`${MODULE.NAME}: could not keep the ${what} on the scene`, error);
            notify(`Could not keep the ${what}`, {
                subtitle: 'The scene refused the drawing -- check you may create drawings here',
                type: 'warn',
                icon: what === 'path' ? 'fa-solid fa-road' : 'fa-solid fa-stamp',
                stackKey: `${MODULE.ID}-keep`
            });
        }
    }

    // ==================================================================
    // ===== TERRAIN PATHS ==============================================
    // ==================================================================

    /** How wide a path is, in pixels: its width in grid squares, by the grid. */
    _pathWidthPixels() {
        const grid = Number(canvas.grid?.size) || 100;
        return Math.max(12, this.state.stamp.pathWidth * grid);
    }

    /** The kind of path being laid, falling back to dirt if what was saved no longer exists. */
    _terrainKind() {
        return terrainById(this.state.stamp.terrain) ? this.state.stamp.terrain : 'dirt';
    }

    /** The ribbon of the path so far, faint, as the pointer drags. */
    _previewTerrain() {
        const graphics = this._previewGraphics;
        if (!graphics) return;
        const start = this.state.drawingStartPoint;
        const width = this._pathWidthPixels();
        const path = smoothPath(this.state.drawingPoints.map(([px, py]) => [start.x + px, start.y + py]), { spacing: Math.max(6, width * 0.25) });
        graphics.clear();
        const kind = this._terrainKind();
        drawStamp(graphics, buildTerrain(kind, path, { width, maxTexture: 0 }), terrainPalette(kind), { x: 0, y: 0, size: 1, alpha: 0.7, shadow: false });
    }

    /**
     * Lay a path down: a temporary drawing everyone sees, or, if asked and allowed, Drawings written
     * to the scene.
     * @param {number[][]} points  [[x, y], ...] in scene pixels, the stroke as dragged.
     */
    createTerrainPath(points) {
        const kind = this._terrainKind();
        const width = this._pathWidthPixels();
        const path = smoothPath(points, { spacing: Math.max(6, width * 0.25) });
        if (path.length < 4) return;
        const seed = 1 + Math.floor(Math.random() * 2147483646);
        const palette = terrainPalette(kind);
        const keep = this.state.stamp.keep && this.canKeepOnScene();
        const prims = buildTerrain(kind, path, { width, seed, maxTexture: keep ? MAX_TEXTURE.scene : MAX_TEXTURE.canvas });

        if (keep) {
            const docs = stampDrawingData(prims, palette, {
                x: 0, y: 0, size: 1,
                flags: { [MODULE.ID]: { terrain: { id: foundry.utils.randomID(), kind } } },
                solid: CONST.DRAWING_FILL_TYPES.SOLID,
                none: CONST.DRAWING_FILL_TYPES.NONE
            });
            void this._keepDrawings(docs, 'path');
            return;
        }

        const graphics = new PIXI.Graphics();
        drawStamp(graphics, prims, palette, { x: 0, y: 0, size: 1, shadow: false });
        this.services.canvasLayer.addChild(graphics);
        const drawingId = `terrain-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        const record = {
            id: drawingId, graphics, createdAt: Date.now(), expiresAt: this.getExpirationTime(),
            userId: game.user.id, userName: game.user.name, terrainKind: kind, path, width
        };
        if (!this._pixiDrawings) this._pixiDrawings = [];
        this._pixiDrawings.push(record);
        this._lastDrawing = record;
        this.scheduleCleanup();
        this.broadcastDrawingCreation({
            drawingId, userId: game.user.id, userName: game.user.name,
            terrainKind: kind, path, width, seed,
            createdAt: record.createdAt, expiresAt: record.expiresAt
        });
    }

    /** A path from another client, drawn from the line and seed it was made with. */
    createRemoteTerrain(data) {
        if (!terrainById(data.terrainKind) || !Array.isArray(data.path)) return;
        const graphics = new PIXI.Graphics();
        const prims = buildTerrain(data.terrainKind, data.path, { width: data.width, seed: data.seed, maxTexture: MAX_TEXTURE.canvas });
        drawStamp(graphics, prims, terrainPalette(data.terrainKind), { x: 0, y: 0, size: 1, shadow: false });
        this.services.canvasLayer.addChild(graphics);
        if (!this._pixiDrawings) this._pixiDrawings = [];
        this._pixiDrawings.push({
            id: data.drawingId, graphics,
            createdAt: data.createdAt || Date.now(), expiresAt: data.expiresAt || null,
            userId: data.userId, userName: data.userName || 'Unknown', terrainKind: data.terrainKind, path: data.path, width: data.width
        });
        this.scheduleCleanup();
    }

    /** Choose a kind of path from the window, and start laying it. */
    chooseTerrain(kind) {
        if (!terrainById(kind)) return;
        this.setStampOption('terrain', kind);
        this.setDrawingMode('terrain');
        this.updateModeButtons();
        this.startFromWindow();
        this.notifyChange();
    }

    // ==================================================================
    // ===== WALLS ======================================================
    // ==================================================================

    /** A point put where walls may go, as Foundry's own wall tool would, or left alone with snapping off. */
    _wallSnap(point) {
        if (!this.state.wallSnap) return point;
        const at = { x: point[0], y: point[1] };
        const target = canvas.walls?.getSnappedPoint
            ? canvas.walls.getSnappedPoint(at)
            : canvas.grid.getSnappedPoint(at, { mode: CONST.GRID_SNAPPING_MODES.VERTEX });
        return [target.x, target.y];
    }

    /**
     * A wall stroke, made: the walls it describes, and a line over them in the brush's colour so
     * the walls can be seen on the map. Both are written to the scene, and undo takes both back.
     * @param {number[][]} points  [[x, y], ...] in scene pixels, the stroke as drawn.
     */
    async createWallStroke(points) {
        const scene = canvas.scene;
        if (!scene) return;
        if (!this.canMakeWalls()) {
            notify('Only the GM can draw walls', {
                subtitle: 'Players can still sketch, box and stamp',
                type: 'warn',
                icon: 'fa-solid fa-border-none',
                stackKey: `${MODULE.ID}-wall`
            });
            return;
        }
        const grid = Number(canvas.grid?.size) || 100;
        const segments = wallStrokeSegments({
            shape: this.state.wallShape,
            points,
            snap: point => this._wallSnap(point),
            epsilon: Math.max(2, grid * 0.12),
            closeDistance: grid * 0.4
        });
        if (!segments.length) return;

        const group = foundry.utils.randomID();
        const flags = { [MODULE.ID]: { drawnWall: { id: group } } };
        const levels = scene.levels?.size > 1 && canvas.level?.id ? { levels: [canvas.level.id] } : {};
        const wallData = segments.map(([a, b]) => ({ c: [a[0], a[1], b[0], b[1]], flags, ...levels }));
        const channels = parseColor(this.state.brushSettings.color) ?? [0, 0, 0];
        const color = `#${channels.map(c => c.toString(16).padStart(2, '0')).join('')}`;
        const line = strokeDrawingData(segmentsPath(segments), {
            color,
            alpha: this.extractAlphaFromRgba(this.state.brushSettings.color),
            width: this.state.brushSettings.size,
            flags,
            none: CONST.DRAWING_FILL_TYPES.NONE
        });
        try {
            const walls = await scene.createEmbeddedDocuments('Wall', wallData);
            const lines = await scene.createEmbeddedDocuments('Drawing', [line]);
            this._pushKept({
                kind: 'wall',
                wallIds: (walls ?? []).map(doc => doc.id),
                drawingIds: (lines ?? []).map(doc => doc.id)
            });
        } catch (error) {
            console.error(`${MODULE.NAME}: could not draw the wall`, error);
            notify('Could not draw the wall', {
                subtitle: 'The scene refused the wall -- see the console',
                type: 'warn',
                icon: 'fa-solid fa-border-none',
                stackKey: `${MODULE.ID}-wall`
            });
        }
    }

    // ==================================================================
    // ===== WHAT IS ON THE SCENE, AND TAKING IT BACK ===================
    // ==================================================================

    _pushKept(entry) {
        this._kept.push({ ...entry, createdAt: Date.now(), userId: game.user.id });
        this.notifyChange();
    }

    /** Whether there is something written to the scene that undo would take back before any temporary drawing. */
    _keptIsNewest() {
        const kept = this._kept.at(-1);
        return !!kept && (!this._lastDrawing || kept.createdAt >= this._lastDrawing.createdAt);
    }

    /** Take back the last thing written to the scene: a wall stroke, or a stamp kept. */
    async _undoKept() {
        const entry = this._kept.pop();
        const scene = canvas.scene;
        if (!entry || !scene) return;
        if (entry.kind === 'erase') {
            try {
                if (entry.restore.Wall.length) await scene.createEmbeddedDocuments('Wall', entry.restore.Wall, { keepId: true });
                if (entry.restore.Drawing.length) await scene.createEmbeddedDocuments('Drawing', entry.restore.Drawing, { keepId: true });
            } catch (error) {
                console.error(`${MODULE.NAME}: could not put back what was erased`, error);
            }
            notify('Erase undone', {
                subtitle: 'What the eraser took off the scene is back',
                icon: 'fa-solid fa-undo',
                stackKey: `${MODULE.ID}-undo`
            });
            this.notifyChange();
            return;
        }
        try {
            const exists = (collection, ids) => (ids ?? []).filter(id => collection.has(id));
            const walls = exists(scene.walls, entry.wallIds);
            const drawings = exists(scene.drawings, entry.drawingIds);
            if (walls.length) await scene.deleteEmbeddedDocuments('Wall', walls);
            if (drawings.length) await scene.deleteEmbeddedDocuments('Drawing', drawings);
        } catch (error) {
            console.error(`${MODULE.NAME}: could not take it back`, error);
        }
        notify({ wall: 'Wall undone', path: 'Path undone' }[entry.kind] ?? 'Stamp undone', {
            subtitle: { wall: 'The walls and their line were removed', path: 'The path was removed from the scene' }[entry.kind] ?? 'The stamp was removed from the scene',
            icon: 'fa-solid fa-undo',
            stackKey: `${MODULE.ID}-undo`
        });
        this.notifyChange();
    }

    /** Whether undo has something to take back. */
    canUndo() {
        return !!(this._kept.length || this._lastDrawing);
    }

    // ==================================================================
    // ===== THE ERASER =================================================
    // ==================================================================

    /** How far from the pointer the eraser reaches, in pixels. */
    _eraserRadius() {
        return Math.max(10, (Number(canvas.grid?.size) || 100) * 0.3);
    }

    /** Whether the eraser is on a temporary drawing: near its line if it is a line, on its bounds if it is a shape. */
    _hitsRecord(record, x, y, reach) {
        if (Array.isArray(record.points) && record.startX !== undefined && record.type === undefined) {
            const pts = [];
            for (const [px, py] of record.points) pts.push(record.startX + px, record.startY + py);
            return distanceToPolyline(pts, x, y) <= reach + (record.strokeWidth || 6) / 2;
        }
        if (Array.isArray(record.path)) return distanceToPolyline(record.path, x, y) <= reach + (record.width || 0) / 2;
        const bounds = record.graphics?.getLocalBounds?.();
        if (!bounds) return false;
        return x >= bounds.x - reach && x <= bounds.x + bounds.width + reach && y >= bounds.y - reach && y <= bounds.y + bounds.height + reach;
    }

    /** The eraser's circle, following the pointer. */
    _previewEraser(event) {
        const point = this.getWorldCoordinates(event);
        if (!point || !this.services?.canvasLayer) return;
        this.removePreviewSymbol();
        const graphics = new PIXI.Graphics();
        graphics.lineStyle(2, 0xffffff, 0.9);
        graphics.beginFill(0xd04030, 0.18);
        graphics.drawCircle(point.x, point.y, this._eraserRadius());
        graphics.endFill();
        this.services.canvasLayer.addChild(graphics);
        this._previewSymbol = graphics;
    }

    _eraseAtEvent(event) {
        const point = this.getWorldCoordinates(event);
        if (point) this._eraseAt(point.x, point.y);
    }

    /**
     * Erase what the eraser is on: temporary drawings, and what was written to the scene as a stamp, a
     * path or a wall stroke -- the whole of it, with the walls of a wall stroke. A user erases their
     * own; the GM erases anyone's. Anything not drawn with these tools is left alone.
     */
    _eraseAt(x, y) {
        const reach = this._eraserRadius();
        for (const record of [...(this._pixiDrawings ?? [])]) {
            if (!game.user.isGM && record.userId !== game.user.id) continue;
            if (this._hitsRecord(record, x, y, reach)) this.deleteDrawingById(record.id, true);
        }
        const scene = canvas.scene;
        if (!scene) return;
        const hit = new Map();
        for (const doc of scene.drawings) {
            if (!game.user.isGM && !doc.isOwner) continue;
            const group = keptGroup(doc.flags, MODULE.ID);
            if (!group || this._erased.has(group.key) || hit.has(group.key)) continue;
            if (drawingHit(doc, x, y, reach, CONST.DRAWING_FILL_TYPES.NONE)) hit.set(group.key, group);
        }
        if (!hit.size) return;
        for (const key of hit.keys()) this._erased.add(key);
        this._eraseQueue = this._eraseQueue.then(() => this._eraseGroups([...hit.values()]));
    }

    /** Take groups off the scene, remembering them so the erase can be undone. */
    async _eraseGroups(groups) {
        const scene = canvas.scene;
        if (!scene) return;
        const keys = new Set(groups.map(group => group.key));
        const drawings = scene.drawings.contents.filter(doc => keys.has(keptGroup(doc.flags, MODULE.ID)?.key));
        const walls = game.user.isGM ? scene.walls.contents.filter(doc => keys.has(keptGroup(doc.flags, MODULE.ID)?.key)) : [];
        try {
            if (walls.length) await scene.deleteEmbeddedDocuments('Wall', walls.map(doc => doc.id));
            if (drawings.length) await scene.deleteEmbeddedDocuments('Drawing', drawings.map(doc => doc.id));
            // What went, kept as data, for Undo.
            this._eraseBatch.Wall.push(...walls.map(doc => doc.toObject()));
            this._eraseBatch.Drawing.push(...drawings.map(doc => doc.toObject()));
        } catch (error) {
            console.error(`${MODULE.NAME}: could not erase`, error);
        }
    }

    /** The stroke is over: what it erased is one thing for Undo to put back. */
    _commitErase() {
        this._eraseQueue = this._eraseQueue.then(() => {
            const batch = this._eraseBatch;
            this._eraseBatch = { Wall: [], Drawing: [] };
            this._erased.clear();
            if (batch.Wall.length || batch.Drawing.length) this._pushKept({ kind: 'erase', restore: batch });
        });
        return this._eraseQueue;
    }

    /** GM: take everything drawn here as a stamp, a path or a wall stroke off the scene. */
    async eraseAllKept() {
        const scene = canvas.scene;
        if (!scene || !game.user.isGM) return;
        const groups = new Map();
        for (const doc of [...scene.drawings.contents, ...scene.walls.contents]) {
            const group = keptGroup(doc.flags, MODULE.ID);
            if (group) groups.set(group.key, group);
        }
        if (!groups.size) {
            notify('Nothing to erase', { subtitle: 'No stamps, paths or wall strokes are on this scene', type: 'warn', icon: 'fa-solid fa-eraser', stackKey: `${MODULE.ID}-erase` });
            return;
        }
        const sure = await foundry.applications.api.DialogV2.confirm({
            window: { title: 'Erase everything drawn here?' },
            content: `<p>This removes every stamp, path and wall stroke drawn with Cartographer's tools on this scene, with the walls of the wall strokes. Undo puts them back.</p>`,
            rejectClose: false
        });
        if (!sure) return;
        this._erased.clear();
        await this._eraseGroups([...groups.values()]);
        await this._commitErase();
        notify('Erased', { subtitle: `${groups.size} thing${groups.size === 1 ? '' : 's'} removed from the scene`, icon: 'fa-solid fa-eraser', stackKey: `${MODULE.ID}-erase` });
    }

    /** Pick up the eraser from the window, and start. */
    chooseErase() {
        this.setDrawingMode('erase');
        this.updateModeButtons();
        this.startFromWindow();
        this.notifyChange();
    }

    /** Drawing has stopped: the eraser is put down, and the tool goes back to the one remembered. */
    _leaveErase() {
        if (this.state.drawingMode !== 'erase') return;
        this._erasing = false;
        const saved = game.settings.get(MODULE.ID, 'toolbar.drawingMode');
        this.state.drawingMode = ['sketch', 'line', 'box', 'ellipse', 'stamp', 'terrain', 'wall'].includes(saved) ? saved : 'sketch';
        this.removePreviewSymbol();
        this.notifyChange();
    }

    // ==================================================================
    // ===== THE SCENE ==================================================
    // ==================================================================

    /** Whether this user may change how the scene is seen: only the GM. */
    canSetScene() {
        return !!game.user?.isGM && !!canvas.scene;
    }

    /** How the scene is seen: whether tokens see, whether it is lit everywhere, and how dark it is. */
    sceneState() {
        const scene = canvas.scene;
        return {
            tokenVision: !!scene?.tokenVision,
            globalLight: !!scene?.environment?.globalLight?.enabled,
            darkness: Number(scene?.environment?.darknessLevel ?? 0)
        };
    }

    /**
     * Change how the scene is seen.
     * @param {'tokenVision'|'globalLight'|'darkness'} name
     */
    async setSceneOption(name, value) {
        if (!this.canSetScene()) return;
        const update = {
            tokenVision: { tokenVision: !!value },
            globalLight: { 'environment.globalLight.enabled': !!value },
            darkness: { 'environment.darknessLevel': Math.max(0, Math.min(1, Number(value) || 0)) }
        }[name];
        if (!update) return;
        try {
            await canvas.scene.update(update);
        } catch (error) {
            console.error(`${MODULE.NAME}: could not change the scene`, error);
        }
        this.notifyChange();
    }

    // ==================================================================
    // ===== THE TOOLS WINDOW ===========================================
    // ==================================================================

    /**
     * The window's button in Foundry's own scene controls: among the drawing tools if the user has
     * them, and among the token tools, which everyone has, if not. It opens the window, and closes
     * it again if it is open. Not offered to a player when the GM has turned player drawing off.
     */
    addDrawingTool(controls) {
        const group = controls?.drawings ?? controls?.tokens;
        if (!group) return;
        const allowed = game.user.isGM || globalThis.BlacksmithUtils?.getSettingSafely?.(MODULE.ID, 'drawing.enablePlayerDrawing', true) !== false;
        if (!allowed) return;
        const tool = {
            name: `${MODULE.ID}-drawing-tools`,
            order: 30,
            title: `${MODULE.ID}.drawingTools.title`,
            icon: 'fa-solid fa-pen-ruler',
            button: true,
            visible: true,
            onChange: () => {
                const open = this.window;
                if (open) void open.close();
                else void this.openWindow();
            }
        };
        if (Array.isArray(group.tools)) group.tools.push(tool);
        else (group.tools ??= {})[tool.name] = tool;
    }

    /** Open the drawing tools window, or bring the one that is open forward. */
    async openWindow(tab = null) {
        const { DrawingToolsWindow } = await import('./window-drawing.js');
        return DrawingToolsWindow.open(this, tab);
    }

    /** The window, if it is open. */
    get window() {
        return foundry.applications?.instances?.get(`${MODULE.ID}-drawing-tools`) ?? null;
    }

    /** Something the window shows has changed: draw it again, once, however many changes came together. */
    notifyChange() {
        const open = this.window;
        if (!open) return;
        clearTimeout(this._changeTimer);
        this._changeTimer = setTimeout(() => open.render?.(), 30);
    }

    /**
     * Start drawing from the window. The hotkey's way -- hold the key and the pointer draws as it
     * moves -- is wrong for a window, where a stroke should start when the button is pressed, so
     * from here a stroke is press, drag, release (see _windowPointerDown), and right-drag still pans.
     */
    startFromWindow() {
        this._fromWindow = true;
        if (this.state.active) {
            this.notifyChange();
            return true;
        }
        this.toggleFromHotkey();
        this.notifyChange();
        return this.state.active;
    }

    /** The button went down on the map in the window's way of drawing: begin whatever the tool draws. */
    _windowPointerDown(event) {
        if (!this.state.active) return false;
        // Only the left button draws. The others, and Ctrl and Alt, are Foundry's to pan, select and open menus with.
        if (event.button !== 0 || event.ctrlKey || event.altKey || event.metaKey) return false;
        if (!this.canUserDraw()) return false;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        const mode = this._strokeMode();
        if (mode === 'erase') {
            this._erasing = true;
            try { canvas.app.view.setPointerCapture?.(event.pointerId); } catch (error) { /* not every pointer can be held */ }
            this._eraseAtEvent(event);
            return false;
        }
        if (mode === 'stamp') {
            this._beginScatter(event);
            this.stampSymbol(this.state.stampStyle, event);
            return false;
        }
        const start = { sketch: 'startDrawing', line: 'startLineDrawing', box: 'startBoxDrawing', ellipse: 'startEllipseDrawing' }[mode];
        if (!start) return false;
        this._pressedAt = { x: event.clientX, y: event.clientY };
        // Hold the pointer, so the stroke goes on and ends properly if it leaves the canvas.
        try { canvas.app.view.setPointerCapture?.(event.pointerId); } catch (error) { /* not every pointer can be held */ }
        this[start](event);
        return false;
    }

    _windowPointerMove(event) {
        if (!this.state.active) return false;
        const mode = this._strokeMode();
        if (mode === 'erase') {
            if (this._erasing && (event.buttons & 1)) this._eraseAtEvent(event);
            this._previewEraser(event);
            return false;
        }
        if (this.state.isDrawing) {
            const update = { sketch: 'updateDrawing', line: 'updateLinePreview', box: 'updateBoxPreview', ellipse: 'updateEllipsePreview' }[mode];
            if (update) this[update](event);
        } else if (mode === 'stamp') {
            if (this._scatter && (event.buttons & 1)) this._scatterTo(event);
            else {
                this._endScatter();
                this.updatePreviewSymbol(event);
            }
        }
        return false;
    }

    _windowPointerUp(event) {
        if (!this.state.active) return false;
        this._endScatter();
        try { canvas.app.view.releasePointerCapture?.(event.pointerId); } catch (error) { /* it was not held */ }
        if (this._erasing) {
            this._erasing = false;
            this._commitErase();
            return false;
        }
        if (!this.state.isDrawing) return false;
        event.preventDefault?.();
        event.stopPropagation?.();
        const pressed = this._pressedAt;
        this._pressedAt = null;
        // A click with no drag draws nothing: not a speck, not a zero-length line, not a wall.
        if (pressed && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < 4) {
            this.cancelDrawing();
            return false;
        }
        const finish = { sketch: 'finishDrawing', line: 'finishLineDrawing', box: 'finishBoxDrawing', ellipse: 'finishEllipseDrawing' }[this._strokeMode()];
        if (finish) void this[finish](event);
        return false;
    }

    /** Stop drawing from the window. */
    stopFromWindow() {
        if (!this.state.active) return;
        this.toggleFromHotkey();
        this._fromWindow = false;
        this._leaveErase();
        this.notifyChange();
    }

    /** The window has closed: drawing it started stops with it. */
    onWindowClosed() {
        if (this._fromWindow && this.state.active) this.toggleFromHotkey();
        this._fromWindow = false;
        this._leaveErase();
    }

    /** Choose a tool from the window and, if nothing is drawing yet, start. */
    chooseMode(mode) {
        this.setDrawingMode(mode);
        this.updateModeButtons();
        this.startFromWindow();
        this.notifyChange();
    }

    /** Choose a stamp from the window. */
    chooseStamp(kind) {
        if (!isStamp(kind)) return;
        this.setStampStyle(kind);
        this.setDrawingMode('stamp');
        this.updateModeButtons();
        this.updateStampStyleButtons();
        this._roll = null;
        this.removePreviewSymbol();
        this.startFromWindow();
        this.notifyChange();
    }

    /**
     * Change one of the stamp options: natural, keep, rotate, jitter, spacing.
     * @param {string} name
     * @param {boolean|number} value
     */
    setStampOption(name, value) {
        if (!(name in this.state.stamp)) return;
        const current = this.state.stamp[name];
        this.state.stamp[name] = typeof current === 'number' ? Number(value) : typeof current === 'string' ? String(value) : !!value;
        this._roll = null;
        game.settings.set(MODULE.ID, 'toolbar.stampOptions', { ...this.state.stamp });
        this.notifyChange();
    }

    /** Change one of the wall options: shape ('line' or 'sketch') and snap. */
    setWallOption(name, value) {
        if (name === 'shape') this.state.wallShape = value === 'sketch' ? 'sketch' : 'line';
        else if (name === 'snap') this.state.wallSnap = !!value;
        else return;
        game.settings.set(MODULE.ID, 'toolbar.wallOptions', { shape: this.state.wallShape, snap: this.state.wallSnap });
        this.notifyChange();
    }

    setLineStyle(style) {
        if (!['solid', 'dotted', 'dashed'].includes(style)) return;
        this.state.lineStyle = style;
        game.settings.set(MODULE.ID, 'toolbar.lineStyle', style);
        this.updateLineStyleButtons();
        this.notifyChange();
    }

    /**
     * Get list of all current drawings with metadata
     * @returns {Array} Array of drawing metadata objects
     */
    getDrawingsList() {
        if (!this._pixiDrawings) return [];
        
        return this._pixiDrawings.map(drawing => ({
            id: drawing.id,
            userId: drawing.userId,
            userName: drawing.userName,
            createdAt: drawing.createdAt,
            expiresAt: drawing.expiresAt,
            strokeWidth: drawing.strokeWidth,
            strokeColor: drawing.strokeColor
        }));
    }
}

// ================================================================== 
// ===== EXPORTS ====================================================
// ================================================================== 

// Create and export singleton instance
const drawingTool = new DrawingTool();
export { drawingTool };


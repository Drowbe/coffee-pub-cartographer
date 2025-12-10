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
            drawingMode: 'line', // 'line', 'plus', 'x', 'dot', 'arrow'
            symbolSize: 'medium', // 'small', 'medium', 'large' - controls square bounding box size
            brushSettings: {
                size: 6, // Default to medium (6px)
                color: DrawingTool.strColor1, // Default to first color (black)
                type: 'pen' // pen, marker, highlighter
            },
            timedEraseEnabled: false, // Toggle for timed erase feature
            currentDrawing: null,
            isDrawing: false,
            drawingPoints: [],
            drawingStartPoint: null
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
        
        // Key-based activation
        this._keyDown = false;
        this._keyHandlers = {
            keydown: null,
            keyup: null
        };
    }
    
    /**
     * Initialize the drawing tool
     * Called by cartographer.js after Canvas Layer is ready
     * @param {Object} services - Shared services from cartographer.js
     */
    async initialize(services) {
        this.services = services;
        
        // Set default color to player color (always use player color as default)
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
        
        // Register settings
        this.registerSettings();
        
        // Register hooks
        this.registerHooks();
        
        // Register toolbar tools
        this.registerToolbarTools();
        
        console.log(`✅ ${MODULE.NAME}: ${this.displayName} initialized`);
    }
    
    /**
     * Cleanup when module unloads
     */
    cleanup() {
        // Deactivate if active
        if (this.state.active) {
            this.deactivate();
        }
        
        // Detach canvas handlers
        this.detachCanvasHandlers();
        
        // Remove keyboard handlers
        if (this._keyHandlers.keydown) {
            document.removeEventListener('keydown', this._keyHandlers.keydown);
        }
        if (this._keyHandlers.keyup) {
            document.removeEventListener('keyup', this._keyHandlers.keyup);
        }
        
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
        
        // Register keyboard handlers for backslash (\) key activation
        this.registerKeyboardHandlers();
        
        // Register scene change cleanup hook
        const sceneChangeHookId = BlacksmithHookManager.registerHook({
            name: 'updateScene',
            description: 'Cartographer: Clear temporary drawings on scene change',
            context: `${MODULE.ID}.drawing`,
            priority: 10,
            callback: () => {
                this.clearAllDrawings();
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
            
            // Register mode buttons in switch group (radio-button behavior)
            // Store references for updating active state
            self._modeButtons = {
                line: `${MODULE.ID}-mode-line`,
                plus: `${MODULE.ID}-mode-plus`,
                x: `${MODULE.ID}-mode-x`,
                dot: `${MODULE.ID}-mode-dot`,
                arrow: `${MODULE.ID}-mode-arrow`
            };
            
            // Register line tool button in mode group
            cartographerToolbar.registerTool(self._modeButtons.line, {
                icon: "fa-solid fa-pen",
                tooltip: "Line Tool (hold \\ key to draw)",
                group: "mode", // Switch group
                order: 1,
                active: () => self.state.drawingMode === 'line',
                onClick: () => {
                    self.setDrawingMode('line');
                    self.updateModeButtons();
                }
            });
            
            // Register symbol stamp buttons
            cartographerToolbar.registerTool(self._modeButtons.plus, {
                icon: "fa-solid fa-plus",
                tooltip: "Plus Symbol (click to stamp)",
                group: "mode", // Switch group
                order: 2,
                active: () => self.state.drawingMode === 'plus',
                onClick: () => {
                    self.setDrawingMode('plus');
                    self.updateModeButtons();
                    // Activate drawing tool if not already active (symbols will stamp on canvas click)
                    if (!self.state.active) {
                        self.activate();
                    }
                }
            });
            
            cartographerToolbar.registerTool(self._modeButtons.x, {
                icon: "fa-solid fa-xmark",
                tooltip: "X Symbol (click to stamp)",
                group: "mode", // Switch group
                order: 3,
                active: () => self.state.drawingMode === 'x',
                onClick: () => {
                    self.setDrawingMode('x');
                    self.updateModeButtons();
                    // Activate drawing tool if not already active (symbols will stamp on canvas click)
                    if (!self.state.active) {
                        self.activate();
                    }
                }
            });
            
            cartographerToolbar.registerTool(self._modeButtons.dot, {
                icon: "fa-solid fa-circle",
                tooltip: "Dot Symbol (click to stamp)",
                group: "mode", // Switch group
                order: 4,
                active: () => self.state.drawingMode === 'dot',
                onClick: () => {
                    self.setDrawingMode('dot');
                    self.updateModeButtons();
                    // Activate drawing tool if not already active (symbols will stamp on canvas click)
                    if (!self.state.active) {
                        self.activate();
                    }
                }
            });
            
            cartographerToolbar.registerTool(self._modeButtons.arrow, {
                icon: "fa-solid fa-arrow-right",
                tooltip: "Arrow Symbol (click to stamp)",
                group: "mode", // Switch group
                order: 5,
                active: () => self.state.drawingMode === 'arrow',
                onClick: () => {
                    self.setDrawingMode('arrow');
                    self.updateModeButtons();
                    // Activate drawing tool if not already active (symbols will stamp on canvas click)
                    if (!self.state.active) {
                        self.activate();
                    }
                }
            });
            
            // Update mode buttons to reflect the default mode (line)
            self.updateModeButtons();
            
            // Register symbol size buttons in switch group (radio-button behavior)
            // Store references for updating active state
            self._symbolSizeButtons = {
                small: `${MODULE.ID}-symbol-size-small`,
                medium: `${MODULE.ID}-symbol-size-medium`,
                large: `${MODULE.ID}-symbol-size-large`
            };
            
            cartographerToolbar.registerTool(self._symbolSizeButtons.small, {
                icon: "fa-solid fa-square fa-xs",
                tooltip: "Small symbol size",
                group: "symbols", // Switch group
                order: 1,
                active: () => self.state.symbolSize === 'small',
                onClick: () => {
                    self.setSymbolSize('small');
                    self.updateSymbolSizeButtons();
                }
            });
            
            cartographerToolbar.registerTool(self._symbolSizeButtons.medium, {
                icon: "fa-solid fa-square fa-sm",
                tooltip: "Medium symbol size",
                group: "symbols", // Switch group
                order: 2,
                active: () => self.state.symbolSize === 'medium',
                onClick: () => {
                    self.setSymbolSize('medium');
                    self.updateSymbolSizeButtons();
                }
            });
            
            cartographerToolbar.registerTool(self._symbolSizeButtons.large, {
                icon: "fa-solid fa-square fa-lg",
                tooltip: "Large symbol size",
                group: "symbols", // Switch group
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
            // Clear drawings button - clears all for GM, only own drawings for players
            cartographerToolbar.registerTool(`${MODULE.ID}-clear`, {
                icon: "fa-solid fa-eraser",
                tooltip: game.user.isGM 
                    ? "Clear all temporary drawings" 
                    : "Clear your temporary drawings",
                group: "erase", // Erase group
                order: 1,
                buttonColor: "rgba(161, 60, 41, 0.2)", // Red tint for destructive action
                onClick: () => {
                    if (game.user.isGM) {
                        // GM clears all drawings
                        self.clearAllDrawings();
                        ui.notifications.info(`${MODULE.NAME}: All temporary drawings cleared`);
                    } else {
                        // Players clear only their own drawings
                        self.clearUserDrawings(game.user.id);
                        ui.notifications.info(`${MODULE.NAME}: Your temporary drawings cleared`);
                    }
                }
            });
            
            // Timed erase toggle button - applies to own drawings for players, all for GM
            cartographerToolbar.registerTool(`${MODULE.ID}-timed-erase`, {
                icon: "fa-solid fa-clock",
                tooltip: game.user.isGM
                    ? "Toggle timed erase (all drawings auto-delete after timeout)"
                    : "Toggle timed erase (your drawings auto-delete after timeout)",
                group: "erase", // Erase group
                order: 2,
                toggleable: true, // Makes it a toggle button
                active: () => self.state.timedEraseEnabled,
                onClick: () => {
                    self.state.timedEraseEnabled = !self.state.timedEraseEnabled;
                    self.updateTimedEraseButton();
                    
                    // Restart cleanup with new interval based on timed erase state
                    if (self._cleanupInterval) {
                        clearInterval(self._cleanupInterval);
                        self._cleanupInterval = null;
                    }
                    // Schedule cleanup with appropriate interval
                    if (self._pixiDrawings && self._pixiDrawings.length > 0) {
                        self.scheduleCleanup();
                    }
                    
                    const status = self.state.timedEraseEnabled ? 'enabled' : 'disabled';
                    const timeout = BlacksmithUtils?.getSettingSafely(
                        MODULE.ID,
                        'drawing.timedEraseTimeout',
                        30
                    ) || 30;
                    const scope = game.user.isGM ? 'all drawings' : 'your drawings';
                    ui.notifications.info(
                        `${MODULE.NAME}: Timed erase ${status} for ${scope} (${timeout}s timeout)`
                    );
                }
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
                group: "line-width", // Switch group
                order: 1,
                active: () => self.state.brushSettings.size === 3,
                onClick: () => {
                    self.setBrushSettings({ size: 3 });
                    self.updateLineWidthButtons();
                }
            });
            
            cartographerToolbar.registerTool(self._lineWidthButtons.medium, {
                icon: "fa-solid fa-grip-lines",
                tooltip: "Medium line (6px)",
                group: "line-width", // Switch group
                order: 2,
                active: () => self.state.brushSettings.size === 6,
                onClick: () => {
                    self.setBrushSettings({ size: 6 });
                    self.updateLineWidthButtons();
                }
            });
            
            cartographerToolbar.registerTool(self._lineWidthButtons.thick, {
                icon: "fa-solid fa-bars",
                tooltip: "Thick line (12px)",
                group: "line-width", // Switch group
                order: 3,
                active: () => self.state.brushSettings.size === 12,
                onClick: () => {
                    self.setBrushSettings({ size: 12 });
                    self.updateLineWidthButtons();
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
                    group: "color", // Switch group
                    order: index + 1, // Player color is first (order: 1)
                    iconColor: iconColorHex, // Icon color using color variable (converted to hex)
                    active: () => self.state.brushSettings.color === colorData.rgba,
                    onClick: () => {
                        self.setBrushSettings({ color: colorData.rgba });
                        self.updateColorButtons();
                    }
                });
            });
            
            // Update line width buttons to reflect the default size (medium = 6px)
            self.updateLineWidthButtons();
            
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
    registerKeyboardHandlers() {
        const self = this;
        
        // Handle backslash key down - activate drawing mode
        // Works for both line drawing and symbol stamping
        this._keyHandlers.keydown = (event) => {
            // Activate if backslash key is pressed (works for all modes: line, plus, x, dot, arrow)
            // Ignore if typing in an input field
            // event.key === '\\' or event.code === 'Backslash' for backslash key
            if ((event.key === '\\' || event.code === 'Backslash') && 
                !event.ctrlKey && 
                !event.altKey && 
                !event.metaKey &&
                event.target.tagName !== 'INPUT' &&
                event.target.tagName !== 'TEXTAREA' &&
                !this._keyDown) {
                
                this._keyDown = true;
                this.activate(true); // keyBased = true
                // Line drawing will start on first mouse move (handled in pointermove)
                // Symbols will stamp on click (handled in pointerdown)
            }
        };
        
        // Handle backslash key up - stop drawing and deactivate
        this._keyHandlers.keyup = (event) => {
            if ((event.key === '\\' || event.code === 'Backslash') && this._keyDown) {
                this._keyDown = false;
                
                // Finish any active drawing first
                if (this.state.isDrawing) {
                    // Get current mouse position for final point
                    const mousePosition = canvas?.app?.renderer?.plugins?.interaction?.mouse?.global;
                    if (mousePosition) {
                        const syntheticEvent = {
                            clientX: mousePosition.x + canvas.app.view.getBoundingClientRect().left,
                            clientY: mousePosition.y + canvas.app.view.getBoundingClientRect().top
                        };
                        this.finishDrawing(syntheticEvent);
                    } else {
                        // Fallback: finish with empty event
                        this.finishDrawing({ clientX: 0, clientY: 0 });
                    }
                }
                
                this.deactivate(true); // keyBased = true
                
                // Remove preview symbol when backslash is released
                this.removePreviewSymbol();
            }
        };
        
        // Attach to document
        document.addEventListener('keydown', this._keyHandlers.keydown);
        document.addEventListener('keyup', this._keyHandlers.keyup);
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
        if (this.state.drawingMode === 'line') return; // Only for symbol modes
        
        // Get world coordinates from event
        const rect = canvas.app.view.getBoundingClientRect();
        const screenX = event.clientX - rect.left;
        const screenY = event.clientY - rect.top;
        const worldPoint = canvas.app.stage.toLocal(new PIXI.Point(screenX, screenY));
        const worldX = worldPoint.x;
        const worldY = worldPoint.y;
        
        // Remove existing preview if it exists
        this.removePreviewSymbol();
        
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
        
        switch (this.state.drawingMode) {
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
                // Chevron arrow with notched left edge - using drawPolygon
                // Must fit within squareSize x squareSize box (like circle)
                const leftX = worldX - halfSize + padding;
                const rightX = worldX + halfSize - padding;
                const centerY = worldY;
                const topY = centerY - (halfSize - padding);
                const bottomY = centerY + (halfSize - padding);
                
                // Notch: split left edge, move middle point 25% of width to the right
                const availableWidth = 2 * (halfSize - padding);
                const notchX = leftX + (availableWidth * 0.25);
                const notchY = centerY;
                
                // Polygon points: top-left, notch (inner), bottom-left, right tip
                const arrowPoints = [
                    leftX, topY,      // Top-left corner
                    notchX, notchY,   // Notch point (middle of left edge, moved right)
                    leftX, bottomY,   // Bottom-left corner
                    rightX, centerY   // Right tip
                ];
                
                // Draw shadow arrow
                graphics.beginFill(shadowColor, shadowAlpha);
                const shadowPoints = [
                    leftX + shadowOffset, topY + shadowOffset,
                    notchX + shadowOffset, notchY + shadowOffset,
                    leftX + shadowOffset, bottomY + shadowOffset,
                    rightX + shadowOffset, centerY + shadowOffset
                ];
                graphics.drawPolygon(shadowPoints);
                graphics.endFill();
                
                // Draw main arrow
                graphics.beginFill(strokeColor, symbolAlpha);
                graphics.drawPolygon(arrowPoints);
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
        
        // Disable Foundry's default drawing controls to prevent conflicts
        if (canvas.drawings) {
            // Hide drawing controls
            if (canvas.drawings.controls) {
                canvas.drawings.controls.visible = false;
                canvas.drawings.controls.active = false;
            }
            
            // Switch away from drawing layer if active
            if (canvas.activeLayer && canvas.activeLayer.name === "drawings") {
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
        this.detachCanvasHandlers();
        
        // Remove preview symbol if it exists
        this.removePreviewSymbol();
        
        // Reset cursor to default
        this.updateCursor();
        
        // Cancel any active drawing
        if (this.state.isDrawing) {
            this.cancelDrawing();
        }
        
        // Re-enable Foundry's default drawing controls
        if (canvas.drawings && canvas.drawings.controls) {
            canvas.drawings.controls.visible = true;
        }
        
        if (!keyBased) {
            console.log(`${MODULE.NAME}: ${this.displayName} deactivated`);
        }
    }
    
    /**
     * Clear all PIXI drawings
     * @param {boolean} broadcast - Whether to broadcast deletion to other clients
     */
    clearAllDrawings(broadcast = true) {
        if (!this._pixiDrawings || !this.services?.canvasLayer) return;
        
        const layer = this.services.canvasLayer;
        
        this._pixiDrawings.forEach(drawing => {
            if (drawing.graphics && drawing.graphics.parent) {
                layer.removeChild(drawing.graphics);
                drawing.graphics.destroy();
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
        
        const layer = this.services.canvasLayer;
        let removedCount = 0;
        
        this._pixiDrawings = this._pixiDrawings.filter(drawing => {
            if (drawing.userId === userId) {
                // Remove from layer
                if (drawing.graphics && drawing.graphics.parent) {
                    layer.removeChild(drawing.graphics);
                    drawing.graphics.destroy();
                }
                removedCount++;
                return false; // Remove from array
            }
            return true; // Keep in array
        });
        
        // Broadcast deletion to other clients
        if (broadcast) {
            this.broadcastDrawingDeletion(false, userId);
        }
        
        console.log(`${MODULE.NAME}: Cleared ${removedCount} drawing(s) for user ${userId}`);
        return removedCount;
    }
    
    /**
     * Clean up drawings from a specific player
     * @param {string} userId - User ID to clean up drawings for
     */
    cleanupPlayerDrawings(userId) {
        if (!this._pixiDrawings || !this.services?.canvasLayer) return;
        
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
     * Check if user can convert temporary drawings to permanent
     * @returns {boolean}
     */
    canUserPersistDrawings() {
        if (!this.services) return false;
        
        // Only GMs can persist drawings
        if (!game.user.isGM) return false;
        
        // Check if persistence is allowed
        const allowed = BlacksmithUtils?.getSettingSafely(
            MODULE.ID,
            'drawing.allowPersistence',
            true
        );
        
        return allowed;
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
        this._handlePointerDown = (event) => {
            // Symbols and line drawing both require backslash key to be held
            // Don't do anything on click if backslash is not held
            if (!self._keyDown) {
                return false;
            }
            
            // If in symbol mode and backslash is held, stamp the symbol on click
            if (self.state.active && self.state.drawingMode !== 'line' && self.canUserDraw() && !event.ctrlKey && !event.altKey) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                
                // Stamp the symbol at click position
                self.stampSymbol(self.state.drawingMode, event);
                return false;
            }
            
            // Line mode: ignore mouse clicks when backslash is held
            // Line drawing starts on mouse move, not on click
            if (self.state.active && self.state.drawingMode === 'line' && self._keyDown) {
                event.preventDefault();
                event.stopPropagation();
                return false;
            }
        };
        
        this._handlePointerMove = (event) => {
            // Only handle pointer move when backslash is held
            // Line mode: continue drawing
            // Symbol modes: show preview symbol following mouse
            if (self.state.active && self._keyDown) {
                if (self.state.drawingMode === 'line') {
                    // Key-based mode: if backslash is held, start/continue drawing on mouse move
                    if (!self.state.isDrawing) {
                        // Start drawing on first mouse move while backslash is held
                        self.startDrawing(event);
                    } else {
                        // Continue drawing
                        self.updateDrawing(event);
                    }
                } else {
                    // Symbol modes: show preview symbol following mouse
                    self.updatePreviewSymbol(event);
                }
            } else if (self.state.active && !self._keyDown) {
                // Remove preview when backslash is not held
                self.removePreviewSymbol();
            }
        };
        
        this._handlePointerUp = (event) => {
            // Only finish on mouse up if NOT using key-based activation
            // Key-based mode finishes when backslash is released, not on mouse up
            if (self.state.active && self.state.isDrawing && !self._keyDown) {
                self.finishDrawing(event);
            }
        };
        
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
        if (!canvas || !canvas.app) return;
        
        if (this._handlePointerDown) {
            canvas.app.view.removeEventListener('pointerdown', this._handlePointerDown);
            this._handlePointerDown = null;
        }
        
        if (this._handlePointerMove) {
            canvas.app.view.removeEventListener('pointermove', this._handlePointerMove);
            this._handlePointerMove = null;
        }
        
        if (this._handlePointerUp) {
            canvas.app.view.removeEventListener('pointerup', this._handlePointerUp);
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
        
        // Draw main line on top
        this._previewGraphics.lineStyle(
            this.state.brushSettings.size,
            previewColor,
            previewAlpha
        );
        
        if (this.state.drawingPoints.length > 0) {
            const firstPoint = this.state.drawingPoints[0];
            this._previewGraphics.moveTo(startX + firstPoint[0], startY + firstPoint[1]);
            
            for (let i = 1; i < this.state.drawingPoints.length; i++) {
                const point = this.state.drawingPoints[i];
                this._previewGraphics.lineTo(startX + point[0], startY + point[1]);
            }
        }
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
        
        // Draw main line on top
        graphics.lineStyle(strokeWidth, drawingColor, drawingAlpha);
        
        if (points.length > 0) {
            const firstPoint = points[0];
            graphics.moveTo(startX + firstPoint[0], startY + firstPoint[1]);
            
            for (let i = 1; i < points.length; i++) {
                const point = points[i];
                graphics.lineTo(startX + point[0], startY + point[1]);
            }
        }
        
        // Add to layer
        layer.addChild(graphics);
        
        // Store reference for cleanup
        if (!this._pixiDrawings) {
            this._pixiDrawings = [];
        }
        
        const drawingId = `drawing-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this._pixiDrawings.push({
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
        });
        
        // Broadcast drawing creation to other clients
        this.broadcastDrawingCreation({
            drawingId: drawingId,
            userId: game.user.id,
            userName: game.user.name,
            startX: startX,
            startY: startY,
            points: points,
            strokeWidth: strokeWidth,
            strokeColor: strokeColor
        });
        
        // Schedule cleanup if needed
        this.scheduleCleanup();
        
        return graphics;
    }
    
    /**
     * Broadcast drawing creation to other clients
     * @param {Object} drawingData - Drawing data to broadcast
     */
    broadcastDrawingCreation(drawingData) {
        if (typeof BlacksmithSocketManager === 'undefined') {
            return; // Socket manager not available
        }
        
        try {
            BlacksmithSocketManager.emit(MODULE.ID, 'drawing-created', drawingData);
        } catch (error) {
            console.error(`${MODULE.NAME}: Error broadcasting drawing creation:`, error);
        }
    }
    
    /**
     * Broadcast drawing deletion to other clients
     * @param {boolean} clearAll - Whether all drawings were cleared
     * @param {string} userId - Optional user ID if clearing specific user's drawings
     */
    broadcastDrawingDeletion(clearAll = false, userId = null) {
        if (typeof BlacksmithSocketManager === 'undefined') {
            return; // Socket manager not available
        }
        
        try {
            BlacksmithSocketManager.emit(MODULE.ID, 'drawing-deleted', {
                userId: userId || game.user.id,
                clearAll: clearAll
            });
        } catch (error) {
            console.error(`${MODULE.NAME}: Error broadcasting drawing deletion:`, error);
        }
    }
    
    /**
     * Get expiration time for drawings
     * Uses timed erase timeout if enabled, otherwise uses the regular timeout setting
     * @returns {number|null} Timestamp when drawing expires, or null if never
     */
    getExpirationTime() {
        // If timed erase is enabled, use the timed erase timeout
        if (this.state.timedEraseEnabled) {
            const timedEraseTimeout = BlacksmithUtils?.getSettingSafely(
                MODULE.ID,
                'drawing.timedEraseTimeout',
                30
            ) || 30;
            
            return timedEraseTimeout > 0 ? Date.now() + (timedEraseTimeout * 1000) : null;
        }
        
        // Otherwise use the regular timeout setting
        const timeout = BlacksmithUtils?.getSettingSafely(
            MODULE.ID,
            'drawing.timeout',
            3600
        ) || 3600;
        
        return timeout > 0 ? Date.now() + (timeout * 1000) : null;
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
                
                // Remove from layer
                if (drawing.graphics && drawing.graphics.parent) {
                    layer.removeChild(drawing.graphics);
                    drawing.graphics.destroy();
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
    setBrushSettings(settings) {
        if (settings.size !== undefined) {
            this.state.brushSettings.size = Math.max(1, Math.min(20, settings.size));
        }
        if (settings.color !== undefined) {
            this.state.brushSettings.color = settings.color;
        }
        if (settings.type !== undefined) {
            this.state.brushSettings.type = settings.type;
        }
        
        // Update button states when settings change
        if (settings.size !== undefined) {
            this.updateLineWidthButtons();
        }
        if (settings.color !== undefined) {
            this.updateColorButtons();
        }
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
     * @param {string} mode - Drawing mode: 'line', 'plus', 'x', 'dot', 'arrow'
     */
    setDrawingMode(mode) {
        if (['line', 'plus', 'x', 'dot', 'arrow'].includes(mode)) {
            this.state.drawingMode = mode;
        }
    }
    
    /**
     * Set the symbol size
     * @param {string} size - Symbol size: 'small', 'medium', 'large'
     */
    setSymbolSize(size) {
        if (['small', 'medium', 'large'].includes(size)) {
            this.state.symbolSize = size;
        }
    }
    
    /**
     * Update active state of mode buttons in secondary bar
     * Uses Blacksmith's updateSecondaryBarItemActive API
     */
    updateModeButtons() {
        try {
            const blacksmithModule = game.modules.get('coffee-pub-blacksmith');
            if (!blacksmithModule?.api?.updateSecondaryBarItemActive) {
                return;
            }
            
            const barTypeId = MODULE.ID;
            const currentMode = this.state.drawingMode;
            
            // Update active state for each mode button
            if (this._modeButtons) {
                const modes = ['line', 'plus', 'x', 'dot', 'arrow'];
                modes.forEach(mode => {
                    blacksmithModule.api.updateSecondaryBarItemActive(
                        barTypeId,
                        this._modeButtons[mode],
                        currentMode === mode
                    );
                });
            }
        } catch (error) {
            console.error(`${MODULE.NAME}: Error updating mode buttons:`, error);
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
                // Draw shadow circle
                const dotRadius = halfSize - padding;
                graphics.beginFill(shadowColor, shadowAlpha);
                graphics.drawCircle(x + shadowOffset, y + shadowOffset, dotRadius);
                graphics.endFill();
                
                // Draw main circle
                graphics.beginFill(strokeColor, symbolAlpha);
                graphics.drawCircle(x, y, dotRadius);
                graphics.endFill();
                break;
                
            case 'arrow':
                // Chevron arrow with notched left edge - using drawPolygon
                // Must fit within squareSize x squareSize box (like circle)
                const leftX = x - halfSize + padding;
                const rightX = x + halfSize - padding;
                const centerY = y;
                const topY = centerY - (halfSize - padding);
                const bottomY = centerY + (halfSize - padding);
                
                // Notch: split left edge, move middle point 25% of width to the right
                const availableWidth = 2 * (halfSize - padding);
                const notchX = leftX + (availableWidth * 0.25);
                const notchY = centerY;
                
                // Polygon points: top-left, notch (inner), bottom-left, right tip
                const arrowPoints = [
                    leftX, topY,      // Top-left corner
                    notchX, notchY,   // Notch point (middle of left edge, moved right)
                    leftX, bottomY,   // Bottom-left corner
                    rightX, centerY   // Right tip
                ];
                
                // Draw shadow arrow
                graphics.beginFill(shadowColor, shadowAlpha);
                const shadowPoints = [
                    leftX + shadowOffset, topY + shadowOffset,
                    notchX + shadowOffset, notchY + shadowOffset,
                    leftX + shadowOffset, bottomY + shadowOffset,
                    rightX + shadowOffset, centerY + shadowOffset
                ];
                graphics.drawPolygon(shadowPoints);
                graphics.endFill();
                
                // Draw main arrow
                graphics.beginFill(strokeColor, symbolAlpha);
                graphics.drawPolygon(arrowPoints);
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
        this._pixiDrawings.push({
            id: drawingId,
            graphics: graphics,
            createdAt: Date.now(),
            expiresAt: this.getExpirationTime(),
            userId: game.user.id,
            userName: game.user.name,
            symbolType: symbolType,
            x: x,
            y: y
        });
        
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
            strokeColor: this.state.brushSettings.color
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
    
    /**
     * Convert temporary PIXI drawing to permanent Foundry Drawing (GM only)
     * @param {string} drawingId - ID of the drawing to convert
     * @returns {Promise<Drawing|null>} Created Foundry Drawing or null if failed
     */
    async convertToPermanentDrawing(drawingId) {
        if (!this.canUserPersistDrawings()) {
            console.warn(`${MODULE.NAME}: User cannot persist drawings`);
            return null;
        }
        
        // Find the drawing
        const drawing = this._pixiDrawings?.find(d => d.id === drawingId);
        if (!drawing) {
            console.warn(`${MODULE.NAME}: Drawing not found: ${drawingId}`);
            return null;
        }
        
        if (!canvas || !canvas.scene) {
            throw new Error('Canvas or scene not available');
        }
        
        try {
            // Create Foundry Drawing from PIXI drawing data
            // Note: This uses Foundry's Drawing API which we had issues with before
            // For now, we'll just log that persistence is requested
            // Full implementation can be added later when needed
            
            console.log(`${MODULE.NAME}: Converting drawing ${drawingId} to permanent (feature not yet fully implemented)`);
            
            // TODO: Implement full conversion to Foundry Drawing API
            // This would require solving the validation issues we encountered earlier
            // For now, we'll keep it as a placeholder
            
            ui.notifications.info(`${MODULE.NAME}: Drawing persistence feature coming soon`);
            
            return null;
        } catch (error) {
            console.error(`${MODULE.NAME}: Error converting drawing to permanent:`, error);
            return null;
        }
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


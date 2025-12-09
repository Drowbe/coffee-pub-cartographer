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
            currentDrawing: null,
            isDrawing: false,
            drawingPoints: [],
            drawingStartPoint: null
        };
        
        // Hook IDs for cleanup
        this.hookIds = [];
        
        // PIXI drawings storage
        this._pixiDrawings = [];
        this._cleanupScheduled = false;
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
        // Deactivate if active
        if (this.state.active) {
            this.deactivate();
        }
        
        // Detach canvas handlers
        this.detachCanvasHandlers();
        
        // Hooks are automatically cleaned up by BlacksmithHookManager via context
        this.hookIds = [];
        
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
        
        // Canvas interactions will be set up when tool is activated
        // No hooks needed here - we'll attach event listeners directly
        console.log(`${MODULE.NAME}: Hooks registered for drawing tool`);
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
        if (!this.canUserDraw()) {
            console.warn(`${MODULE.NAME}: User cannot draw - check settings`);
            return false;
        }
        
        this.state.active = true;
        
        // Disable Foundry's default drawing controls to prevent conflicts
        if (canvas.drawings && canvas.drawings.controls) {
            canvas.drawings.controls.visible = false;
            canvas.drawings.controls.active = false;
        }
        
        // Switch to a non-drawing layer to prevent Foundry's drawing tool from activating
        if (canvas.activeLayer && canvas.activeLayer.name === "drawings") {
            canvas.tokens.activate();
        }
        
        this.attachCanvasHandlers();
        console.log(`${MODULE.NAME}: ${this.displayName} activated`);
        return true;
    }
    
    /**
     * Deactivate the drawing tool
     */
    deactivate() {
        this.state.active = false;
        this.detachCanvasHandlers();
        
        // Cancel any active drawing
        if (this.state.isDrawing) {
            this.cancelDrawing();
        }
        
        // Re-enable Foundry's default drawing controls
        if (canvas.drawings && canvas.drawings.controls) {
            canvas.drawings.controls.visible = true;
        }
        
        console.log(`${MODULE.NAME}: ${this.displayName} deactivated`);
    }
    
    /**
     * Clear all PIXI drawings
     */
    clearAllDrawings() {
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
    }
    
    /**
     * Check if user can draw
     * @returns {boolean}
     */
    canUserDraw() {
        if (!this.services) return false;
        
        // Check if drawing is enabled
        const enabled = BlacksmithUtils?.getSettingSafely(
            MODULE.ID, 
            'drawing.enablePlayerDrawing', 
            true
        );
        
        if (!enabled) return false;
        
        // Additional permission checks can be added here
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
        this._handlePointerDown = (event) => {
            if (self.state.active && self.canUserDraw() && !event.ctrlKey && !event.altKey) {
                // Prevent Foundry's default drawing tool from activating
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                self.startDrawing(event);
                return false;
            }
        };
        
        this._handlePointerMove = (event) => {
            if (self.state.active && self.state.isDrawing) {
                self.updateDrawing(event);
            }
        };
        
        this._handlePointerUp = (event) => {
            if (self.state.active && self.state.isDrawing) {
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
        if (!canvas || !canvas.scene) return;
        
        // Get world coordinates from pointer event
        const worldCoords = this.getWorldCoordinates(event);
        if (!worldCoords) return;
        
        this.state.isDrawing = true;
        this.state.drawingStartPoint = { x: worldCoords.x, y: worldCoords.y };
        // First point is always [0, 0] relative to start position
        this.state.drawingPoints = [[0, 0]];
        
        console.log(`${MODULE.NAME}: Drawing started at`, worldCoords);
    }
    
    /**
     * Update drawing with new point
     * @param {PointerEvent} event - Pointer event
     */
    updateDrawing(event) {
        if (!canvas || !this.state.isDrawing) return;
        
        // Get world coordinates from pointer event
        const worldCoords = this.getWorldCoordinates(event);
        if (!worldCoords) return;
        
        // Add point to drawing path (relative to start point)
        const relativeX = worldCoords.x - this.state.drawingStartPoint.x;
        const relativeY = worldCoords.y - this.state.drawingStartPoint.y;
        this.state.drawingPoints.push([relativeX, relativeY]);
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
            // Draw directly on BlacksmithLayer using PIXI graphics
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
        
        // Convert CSS color to PIXI color (number)
        function cssToPixiColor(cssColor) {
            if (typeof cssColor === 'number') return cssColor;
            if (cssColor.startsWith('#')) {
                return parseInt(cssColor.slice(1), 16);
            }
            return 0x000000; // black fallback
        }
        
        // Create PIXI Graphics object
        const graphics = new PIXI.Graphics();
        graphics.lineStyle(strokeWidth, cssToPixiColor(strokeColor), 1.0);
        
        // Draw the path
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
        this._pixiDrawings.push({
            graphics: graphics,
            createdAt: Date.now(),
            expiresAt: this.getExpirationTime()
        });
        
        // Schedule cleanup if needed
        this.scheduleCleanup();
        
        return graphics;
    }
    
    /**
     * Get expiration time for drawings
     * @returns {number|null} Timestamp when drawing expires, or null if never
     */
    getExpirationTime() {
        const timeout = BlacksmithUtils?.getSettingSafely(
            MODULE.ID,
            'drawing.timeout',
            3600
        ) || 3600;
        
        return timeout > 0 ? Date.now() + (timeout * 1000) : null;
    }
    
    /**
     * Schedule cleanup of expired drawings
     */
    scheduleCleanup() {
        if (this._cleanupScheduled) return;
        
        this._cleanupScheduled = true;
        
        // Clean up expired drawings periodically
        setInterval(() => {
            this.cleanupExpiredDrawings();
        }, 60000); // Check every minute
    }
    
    /**
     * Clean up expired PIXI drawings
     */
    cleanupExpiredDrawings() {
        if (!this._pixiDrawings || !this.services?.canvasLayer) return;
        
        const now = Date.now();
        const layer = this.services.canvasLayer;
        
        this._pixiDrawings = this._pixiDrawings.filter(drawing => {
            if (drawing.expiresAt && now > drawing.expiresAt) {
                // Remove from layer
                if (drawing.graphics && drawing.graphics.parent) {
                    layer.removeChild(drawing.graphics);
                    drawing.graphics.destroy();
                }
                return false; // Remove from array
            }
            return true; // Keep in array
        });
        
        if (this._pixiDrawings.length === 0) {
            this._cleanupScheduled = false;
        }
    }
    
    /**
     * Cancel the current drawing
     */
    cancelDrawing() {
        this.state.isDrawing = false;
        this.state.drawingPoints = [];
        this.state.drawingStartPoint = null;
        this.state.currentDrawing = null;
    }
    
    /**
     * Create a temporary drawing using Foundry's Drawing API
     * @param {number} startX - Starting X coordinate
     * @param {number} startY - Starting Y coordinate
     * @param {Array} points - Array of [x, y] coordinate pairs
     * @param {number} strokeWidth - Brush size
     * @param {string} strokeColor - Brush color
     * @returns {Promise<Drawing>} Created drawing object
     */
    async createTemporaryDrawing(startX, startY, points, strokeWidth, strokeColor) {
        if (!canvas || !canvas.scene) {
            throw new Error('Canvas or scene not available');
        }
        
        // Validate minimum requirements for a visible drawing
        if (!points || points.length < 2) {
            throw new Error('Drawing must have at least 2 points');
        }
        
        // Ensure stroke width is valid (minimum 1) - Foundry requires visible line
        const validStrokeWidth = Math.max(1, strokeWidth || 2);
        
        // Convert stroke color to numeric format (0xRRGGBB) for v13
        // Foundry v13 requires strokeColor to be a NUMBER, not a CSS string
        function normalizeStrokeColor(input) {
            if (typeof input === "number") {
                console.log(`${MODULE.NAME}: Color already numeric:`, input);
                return input;
            }
            
            if (typeof input === "string") {
                let c = input.trim().toLowerCase();
                if (c.startsWith("#")) c = c.slice(1);
                if (c.startsWith("0x")) c = c.slice(2);
                
                const parsed = Number.parseInt(c, 16);
                if (!Number.isNaN(parsed)) {
                    console.log(`${MODULE.NAME}: Converted color "${input}" to numeric:`, parsed);
                    return parsed;
                }
            }
            
            // Fallback to black
            console.warn(`${MODULE.NAME}: Invalid color "${strokeColor}", using black (0x000000)`);
            return 0x000000;
        }
        
        const strokeColorNumeric = normalizeStrokeColor(strokeColor);
        console.log(`${MODULE.NAME}: Final strokeColor:`, strokeColorNumeric, `(type: ${typeof strokeColorNumeric})`);
        
        // Get timeout setting
        const timeout = BlacksmithUtils?.getSettingSafely(
            MODULE.ID,
            'drawing.timeout',
            3600
        ) || 3600;
        
        // Calculate expiration time (0 = never expire)
        const expiresAt = timeout > 0 ? Date.now() + (timeout * 1000) : null;
        
        // Prepare drawing data for v13
        // v13 requires: strokeColor as NUMBER (0xRRGGBB), strokeAlpha > 0 for visible line
        const drawingData = {
            type: "f", // freehand
            author: game.user.id,
            x: startX,
            y: startY,
            bezierFactor: 0,
            points: points, // Points are relative to x, y
            strokeWidth: validStrokeWidth,
            strokeColor: strokeColorNumeric, // NUMBER, not string!
            strokeAlpha: 1.0, // Required for visible line in v13
            
            // Explicitly "no fill" / "no text"
            fillColor: null,
            fillAlpha: 0,
            text: "",
            textAlpha: 0,
            textColor: null
        };
        
        // Add flags AFTER creation succeeds, not during creation
        // This avoids validation issues
        
        // Debug: Log full drawing data before creation
        console.log(`${MODULE.NAME}: Creating drawing with:`, {
            type: drawingData.type,
            points: drawingData.points.length,
            firstPoint: drawingData.points[0],
            lastPoint: drawingData.points[drawingData.points.length - 1],
            strokeWidth: drawingData.strokeWidth,
            strokeColor: drawingData.strokeColor,
            strokeColorType: typeof drawingData.strokeColor,
            strokeAlpha: drawingData.strokeAlpha,
            x: drawingData.x,
            y: drawingData.y,
            fullData: drawingData
        });
        
        // Minimal test succeeded, so schema is correct
        // The issue might be with the points array or flags interfering
        
        // Create drawing using Foundry's Drawing API
        // Use the EXACT same format as the minimal test that succeeded
        const drawings = await canvas.scene.createEmbeddedDocuments("Drawing", [drawingData]);
        
        if (!drawings || drawings.length === 0) {
            throw new Error('Failed to create drawing');
        }
        
        const drawing = drawings[0];
        
        // Now add flags via update (after creation succeeds)
        if (expiresAt || this.state.brushSettings.type) {
            try {
                await drawing.update({
                    flags: {
                        [MODULE.ID]: {
                            temporary: true,
                            layerManaged: true,
                            playerDrawn: true,
                            expiresAt: expiresAt,
                            brushType: this.state.brushSettings.type,
                            sessionId: game.sessionId
                        }
                    }
                });
            } catch (flagError) {
                console.warn(`${MODULE.NAME}: Failed to add flags to drawing:`, flagError);
                // Continue anyway - drawing was created successfully
            }
        }
        
        // Log creation
        if (BlacksmithUtils) {
            BlacksmithUtils.postConsoleAndNotification(
                MODULE.ID,
                'Drawing created',
                { drawingId: drawing.id },
                false,
                false
            );
        }
        
        return drawing;
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
    }
}

// ================================================================== 
// ===== EXPORTS ====================================================
// ================================================================== 

// Create and export singleton instance
const drawingTool = new DrawingTool();
export { drawingTool };


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
    
    /**
     * OLD CODE REMOVED - Using PIXI graphics directly instead of Foundry's Drawing API
     * The createTemporaryDrawing function has been replaced with createPIXIDrawing
     */
}

// ================================================================== 
// ===== EXPORTS ====================================================
// ================================================================== 

// Create and export singleton instance
const drawingTool = new DrawingTool();
export { drawingTool };


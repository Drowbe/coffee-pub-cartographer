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
                size: 6, // Default to medium (6px)
                color: '#000000',
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
        this._cleanupScheduled = false;
        
        // Preview graphics (shown while drawing)
        this._previewGraphics = null;
        
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
        
        // Register keyboard handlers for "D" key activation
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
            
            // Register drawing tool toggle button in Cartographer toolbar
            cartographerToolbar.registerTool(`${MODULE.ID}-draw`, {
                icon: "fa-solid fa-pen",
                tooltip: "Toggle Drawing Tool (or hold 'D' key)",
                active: () => self.state.active,
                order: 1, // First button
                onClick: () => {
                    if (self.state.active) {
                        self.deactivate();
                    } else {
                        self.activate();
                    }
                }
            });
            
            // Register GM-only erase group buttons
            if (game.user.isGM) {
                // Clear all drawings button
                cartographerToolbar.registerTool(`${MODULE.ID}-clear`, {
                    icon: "fa-solid fa-eraser",
                    tooltip: "Clear all temporary drawings (GM only)",
                    group: "erase", // Erase group
                    order: 1,
                    buttonColor: "rgba(161, 60, 41, 0.2)", // Red tint for destructive action
                    onClick: () => {
                        if (game.user.isGM) {
                            self.clearAllDrawings();
                            ui.notifications.info(`${MODULE.NAME}: All temporary drawings cleared`);
                        }
                    }
                });
                
                // Timed erase toggle button
                cartographerToolbar.registerTool(`${MODULE.ID}-timed-erase`, {
                    icon: "fa-solid fa-clock",
                    tooltip: "Toggle timed erase (drawings auto-delete after timeout)",
                    group: "erase", // Erase group
                    order: 2,
                    toggleable: true, // Makes it a toggle button
                    active: () => self.state.timedEraseEnabled,
                    onClick: () => {
                        if (game.user.isGM) {
                            self.state.timedEraseEnabled = !self.state.timedEraseEnabled;
                            self.updateTimedEraseButton();
                            
                            const status = self.state.timedEraseEnabled ? 'enabled' : 'disabled';
                            const timeout = BlacksmithUtils?.getSettingSafely(
                                MODULE.ID,
                                'drawing.timedEraseTimeout',
                                30
                            ) || 30;
                            ui.notifications.info(
                                `${MODULE.NAME}: Timed erase ${status} (${timeout}s timeout)`
                            );
                        }
                    }
                });
            }
            
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
                icon: "fa-solid fa-grip-lines-vertical",
                tooltip: "Thick line (12px)",
                group: "line-width", // Switch group
                order: 3,
                active: () => self.state.brushSettings.size === 12,
                onClick: () => {
                    self.setBrushSettings({ size: 12 });
                    self.updateLineWidthButtons();
                }
            });
            
            // Update line width buttons to reflect the default size (medium = 6px)
            self.updateLineWidthButtons();
            
            console.log(`${MODULE.NAME}: Toolbar tools registered in Cartographer toolbar`);
        } catch (error) {
            console.error(`${MODULE.NAME}: Error registering toolbar tools:`, error);
        }
    }
    
    /**
     * Register keyboard handlers for "D" key activation
     */
    registerKeyboardHandlers() {
        const self = this;
        
        // Handle "D" key down - activate drawing mode
        // Drawing will start automatically on first mouse move
        this._keyHandlers.keydown = (event) => {
            // Only activate if "D" key is pressed and not already active
            // Ignore if typing in an input field
            if (event.key.toLowerCase() === 'd' && 
                !event.ctrlKey && 
                !event.altKey && 
                !event.metaKey &&
                event.target.tagName !== 'INPUT' &&
                event.target.tagName !== 'TEXTAREA' &&
                !this._keyDown) {
                
                this._keyDown = true;
                this.activate(true); // keyBased = true
                // Drawing will start on first mouse move (handled in pointermove)
            }
        };
        
        // Handle "D" key up - stop drawing and deactivate
        this._keyHandlers.keyup = (event) => {
            if (event.key.toLowerCase() === 'd' && this._keyDown) {
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
            }
        };
        
        // Attach to document
        document.addEventListener('keydown', this._keyHandlers.keydown);
        document.addEventListener('keyup', this._keyHandlers.keyup);
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
     * Clean up drawings from a specific player
     * @param {string} userId - User ID to clean up drawings for
     */
    cleanupPlayerDrawings(userId) {
        if (!this._pixiDrawings || !this.services?.canvasLayer) return;
        
        const layer = this.services.canvasLayer;
        let removedCount = 0;
        
        this._pixiDrawings = this._pixiDrawings.filter(drawing => {
            // If drawing has user info, check if it matches
            // For now, we'll clear all since we don't track user per drawing yet
            // This can be enhanced in Phase 6 with multi-player sync
            if (drawing.graphics && drawing.graphics.parent) {
                layer.removeChild(drawing.graphics);
                drawing.graphics.destroy();
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
            // If key-based mode is active, ignore mouse clicks (drawing is controlled by "D" key)
            if (self._keyDown) {
                event.preventDefault();
                event.stopPropagation();
                return false;
            }
            
            // Manual activation mode (console): allow mouse clicks
            if (self.state.active && self.canUserDraw() && !event.ctrlKey && !event.altKey) {
                // Prevent Foundry's default drawing tool from activating
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                
                // Ensure we're not on the drawings layer
                if (canvas.activeLayer && canvas.activeLayer.name === "drawings") {
                    canvas.tokens.activate();
                }
                
                self.startDrawing(event);
                return false;
            }
        };
        
        this._handlePointerMove = (event) => {
            // Update drawing while "D" is held OR while manually drawing
            if (self.state.active) {
                // Key-based mode: if "D" is held, start/continue drawing on mouse move
                if (self._keyDown) {
                    if (!self.state.isDrawing) {
                        // Start drawing on first mouse move while "D" is held
                        self.startDrawing(event);
                    } else {
                        // Continue drawing
                        self.updateDrawing(event);
                    }
                } 
                // Manual mode: only update if already drawing (mouse button was clicked)
                else if (self.state.isDrawing) {
                    self.updateDrawing(event);
                }
            }
        };
        
        this._handlePointerUp = (event) => {
            // Only finish on mouse up if NOT using key-based activation
            // Key-based mode finishes when "D" is released, not on mouse up
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
        this._previewGraphics.lineStyle(
            this.state.brushSettings.size,
            this.cssToPixiColor(this.state.brushSettings.color),
            1.0
        );
        // Start at the absolute position
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
        this._previewGraphics.lineStyle(
            this.state.brushSettings.size,
            this.cssToPixiColor(this.state.brushSettings.color),
            1.0
        );
        
        // Redraw entire path using absolute coordinates
        const startX = this.state.drawingStartPoint.x;
        const startY = this.state.drawingStartPoint.y;
        
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
     * @param {string|number} cssColor - CSS color string or number
     * @returns {number} PIXI color number
     */
    cssToPixiColor(cssColor) {
        if (typeof cssColor === 'number') return cssColor;
        if (typeof cssColor === 'string' && cssColor.startsWith('#')) {
            return parseInt(cssColor.slice(1), 16);
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
        graphics.lineStyle(strokeWidth, this.cssToPixiColor(strokeColor), 1.0);
        
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
     */
    broadcastDrawingDeletion(clearAll = false) {
        if (typeof BlacksmithSocketManager === 'undefined') {
            return; // Socket manager not available
        }
        
        try {
            BlacksmithSocketManager.emit(MODULE.ID, 'drawing-deleted', {
                userId: game.user.id,
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


# Blacksmith API Review for Cartographer

## Overview

This document summarizes the key Blacksmith APIs available for the Cartographer module, based on the official Blacksmith documentation. This review was prepared before beginning the real project work.

## Core Integration Pattern

### 1. Module Registration (✅ Already Implemented)

```javascript
// Import bridge file
import { BlacksmithAPI } from '/modules/coffee-pub-blacksmith/api/blacksmith-api.js';

// Register module during 'ready' hook
Hooks.once('ready', async () => {
    BlacksmithModuleManager.registerModule(MODULE.ID, {
        name: MODULE.NAME,
        version: MODULE.VERSION
    });
});
```

**Status**: ✅ Already implemented in `scripts/cartographer.js`

---

## Available APIs

### 1. Hook Manager API

**Purpose**: Centralized hook registration and management for FoundryVTT hooks

**Key Features**:
- Automatic cleanup by context
- Priority-based execution
- Hook lifecycle management
- Context-based organization

**Usage Pattern**:
```javascript
BlacksmithHookManager.registerHook({
    name: 'hookName',                    // FoundryVTT hook name
    description: 'Description',          // Human-readable description
    context: MODULE.ID,                  // Module ID for cleanup
    priority: 3,                         // 1=Critical, 2=High, 3=Normal, 4=Low, 5=Lowest
    callback: (args) => {
        // BEGIN - HOOKMANAGER CALLBACK
        // Your hook logic
        // END - HOOKMANAGER CALLBACK
    }
});
```

**For Cartographer**:
- Register hooks for canvas interactions (drawing, mouse events)
- Scene change hooks for cleanup
- Drawing creation/update hooks
- Player disconnect hooks for cleanup

**Documentation**: [Architecture: Hook Manager](https://github.com/Drowbe/coffee-pub-blacksmith/wiki/Architecture:-Hook-Manager)

---

### 2. Utils API

**Purpose**: Utility functions for logging, notifications, settings, and common operations

**Key Functions**:
- `postConsoleAndNotification(moduleId, message, details, debug, showNotification)`
- `getSettingSafely(moduleId, settingKey, defaultValue)`
- `setSettingSafely(moduleId, settingKey, value)`
- `playSound(path, volume)`

**Usage Pattern**:
```javascript
// Logging with notification
BlacksmithUtils.postConsoleAndNotification(
    MODULE.ID,
    'Drawing created',
    { drawingId: drawing.id },
    false,  // debug flag
    false   // show notification
);

// Safe settings access
const value = BlacksmithUtils.getSettingSafely(MODULE.ID, 'settingName', defaultValue);
```

**For Cartographer**:
- Log drawing operations
- Notify users of drawing events
- Access module settings safely
- Play sound effects for drawing actions

**Documentation**: [API: Core Blacksmith](https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Core-Blacksmith)

---

### 3. Toolbar API

**Purpose**: Register tools and buttons in Blacksmith/Foundry toolbars

**Key Features**:
- Dynamic toolbar registration
- Multiple toolbar zones
- Button and tool support
- Icon and styling customization

**Usage Pattern**:
```javascript
// Access toolbar API
const blacksmith = game.modules.get('coffee-pub-blacksmith')?.api;

// Register toolbar tool
blacksmith.registerToolbarTool('cartographer-draw', {
    icon: "fa-solid fa-pen",
    name: "cartographer-draw",
    title: "Drawing Tool",
    button: true,
    visible: true,
    zone: "utilities",  // or "controls", etc.
    onClick: () => {
        activateDrawingMode();
    }
});
```

**For Cartographer**:
- Register drawing tool button
- Brush settings panel
- Clear drawings button
- Tool selection UI

**Documentation**: [API: Toolbar](https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Toolbar)

---

### 4. Menubar API

**Purpose**: Add items to the global menubar for notifications and tools

**Key Features**:
- Global menubar integration
- Notification system
- Tool registration
- Cross-module coordination

**Usage Pattern**:
```javascript
// Access menubar API
const blacksmith = game.modules.get('coffee-pub-blacksmith')?.api;
const menubar = blacksmith.Menubar;

// Add tool to menubar
menubar.registerTool('cartographer', {
    icon: "fa-solid fa-map",
    name: "Cartographer",
    title: "Cartographer",
    onClick: () => {
        openCartographerWindow();
    }
});

// Send notification
menubar.sendNotification({
    message: "Drawing saved",
    type: "info"
});
```

**For Cartographer**:
- Add Cartographer menu item
- Show drawing status notifications
- Quick access to drawing tools
- Player activity notifications

**Documentation**: [API: Menubar](https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Menubar)

---

### 5. Socket Manager API

**Purpose**: Cross-client communication for real-time synchronization

**Key Features**:
- Socket event registration
- Cross-client messaging
- Player synchronization
- Event broadcasting

**Usage Pattern**:
```javascript
// Register socket handler
BlacksmithSocketManager.registerSocketHandler(MODULE.ID, 'drawing-created', (data) => {
    // Handle drawing creation from other clients
    handleRemoteDrawing(data);
});

// Send socket event
BlacksmithSocketManager.emit(MODULE.ID, 'drawing-created', {
    drawingId: drawing.id,
    author: game.user.id,
    data: drawingData
});
```

**For Cartographer**:
- Sync drawings across clients
- Broadcast drawing events
- Coordinate multi-player drawing
- Handle player disconnect cleanup

**Documentation**: [Socket Manager](https://github.com/Drowbe/coffee-pub-blacksmith/wiki/Socket-Manager)

---

### 6. Canvas Layer API

**Purpose**: Access to BlacksmithLayer for centralized canvas management

**Key Features**:
- Centralized canvas layer for Coffee Pub modules
- Temporary drawing management
- UI overlay support
- Event coordination
- Automatic cleanup coordination

**Usage Pattern**:
```javascript
// Access Canvas Layer (after canvasReady)
Hooks.once('canvasReady', async () => {
    const layer = await BlacksmithAPI.getCanvasLayer();
    if (layer) {
        // Layer is ready to use
        layer.activate();
    }
});

// Direct access methods
const layer = await BlacksmithAPI.getCanvasLayer();
const directLayer = canvas['blacksmith-utilities-layer'];
const globalLayer = window.BlacksmithCanvasLayer; // after canvasReady
```

**Layer Properties**:
- Extends `foundry.canvas.layers.CanvasLayer`
- Standard methods: `activate()`, `deactivate()`, `_draw()`
- Part of Foundry's "interface" layer group
- Persists across scene changes

**For Cartographer**:
- Create temporary drawings with flags
- Coordinate cleanup of temporary drawings
- UI overlays for drawing tools
- Centralized canvas management
- Scene change cleanup

**Temporary Drawing Pattern**:
```javascript
// Create temporary drawing
const drawings = await canvas.scene.createEmbeddedDocuments("Drawing", [{
    type: "f", // freehand
    author: game.user.id,
    x: startX,
    y: startY,
    points: [[x1, y1], [x2, y2], ...],
    strokeWidth: brushSize,
    strokeColor: brushColor,
    flags: {
        [MODULE.ID]: {
            temporary: true,
            layerManaged: true,
            playerDrawn: true,
            expiresAt: Date.now() + (timeout * 1000)
        }
    }
}]);

// Cleanup temporary drawings
function clearTemporaryDrawings() {
    const temporaryDrawings = canvas.drawings.placeables.filter(d => 
        d.flags?.[MODULE.ID]?.temporary === true
    );
    temporaryDrawings.forEach(drawing => drawing.delete());
}
```

**Availability**:
- Available **after** `canvasReady` hook fires
- Must wait for canvas initialization
- Persists across scene changes

**Documentation**: [API: Canvas](https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Canvas)

---

### 7. Constants API

**Purpose**: Access Blacksmith constants (themes, sounds, assets)

**Key Features**:
- Theme choices
- Sound choices
- Asset lookup
- Tag-based filtering

**Usage Pattern**:
```javascript
// Access constants
const themeChoices = BlacksmithConstants.arrThemeChoices;
const soundChoices = BlacksmithConstants.arrSoundChoices;

// Asset lookup
const assets = BlacksmithAssetLookup.getAssetsByType('sound', ['battle', 'victory']);
```

**For Cartographer**:
- Use Blacksmith sounds for drawing actions
- Match UI themes
- Access asset resources

**Documentation**: [API: Core Blacksmith](https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Core-Blacksmith)

---

## Integration Checklist for Cartographer

### Phase 1: Core Setup ✅
- [x] Module registration
- [x] Import bridge file
- [x] Basic initialization

### Phase 2: Drawing Functionality
- [ ] Canvas Layer: Access BlacksmithLayer after canvasReady
- [ ] Canvas Layer: Create temporary drawings with flags
- [ ] Canvas Layer: Implement cleanup for temporary drawings
- [ ] Hook Manager: Register canvas interaction hooks
- [ ] Hook Manager: Register scene change hooks for cleanup
- [ ] Utils: Logging for drawing operations
- [ ] Utils: Notifications for drawing events
- [ ] Socket Manager: Sync drawings across clients

### Phase 3: UI Integration
- [ ] Toolbar API: Register drawing tool button
- [ ] Toolbar API: Brush settings panel
- [ ] Toolbar API: Clear drawings button
- [ ] Menubar API: Cartographer menu item
- [ ] Menubar API: Status notifications

### Phase 4: Advanced Features
- [ ] Socket Manager: Multi-player coordination
- [ ] Hook Manager: Player disconnect cleanup
- [ ] Constants API: Sound effects for drawing
- [ ] Utils: Settings management

---

## Key Integration Points

### 1. Drawing Creation Flow
```javascript
// 1. Wait for canvasReady, access Canvas Layer
// 2. User activates drawing tool (Toolbar API)
// 3. Register canvas hooks (Hook Manager)
// 4. Create temporary drawing with flags (Canvas Layer)
// 5. Sync to other clients (Socket Manager)
// 6. Log and notify (Utils API)
// 7. Cleanup on scene change (Hook Manager + Canvas Layer)
```

### 2. Multi-Player Synchronization
```javascript
// 1. Local drawing created
// 2. Emit socket event (Socket Manager)
// 3. Other clients receive event
// 4. Render drawing on remote clients
// 5. Update UI (Menubar/Toolbar API)
```

### 3. Cleanup Flow
```javascript
// 1. Scene change detected (Hook Manager)
// 2. Access Canvas Layer
// 3. Filter and delete temporary drawings (Canvas Layer pattern)
// 4. Unregister hooks (Hook Manager auto-cleanup)
// 5. Notify users (Utils/Menubar API)
```

---

## Best Practices

### 1. Always Use Context
- Always provide `context: MODULE.ID` for hooks
- Enables automatic cleanup when module unloads

### 2. Error Handling
- Wrap API calls in try-catch
- Use Utils for error logging
- Provide fallbacks for missing APIs
- Always check Canvas Layer availability after canvasReady

### 3. Performance
- Use appropriate hook priorities
- Debounce frequent operations
- Clean up resources properly
- Wait for canvasReady before accessing Canvas Layer
- Use Canvas Layer flags for efficient drawing filtering

### 4. Testing
- Use console commands to verify integration
- Test with multiple clients
- Verify cleanup on scene changes

---

## Console Commands for Testing

```javascript
// Check API availability
BlacksmithAPIHooks();              // Show all registered hooks
BlacksmithAPIHookDetails();        // Detailed hook information
BlacksmithAPIModules();            // Show registered modules
BlacksmithAPIUtils();              // Test utility functions
```

---

## References

- [API: Core Blacksmith](https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Core-Blacksmith)
- [API: Canvas](https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Canvas)
- [Architecture: Hook Manager](https://github.com/Drowbe/coffee-pub-blacksmith/wiki/Architecture:-Hook-Manager)
- [Socket Manager](https://github.com/Drowbe/coffee-pub-blacksmith/wiki/Socket-Manager)
- [API: Toolbar](https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Toolbar)
- [API: Menubar](https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Menubar)

---

## Notes

- All APIs are available via global objects after importing the bridge file
- APIs handle timing issues automatically
- Use `ready` hook for module initialization
- Use `canvasReady` hook for Canvas Layer access
- Always provide module ID for context-based operations
- Canvas Layer must be accessed after `canvasReady` hook fires
- Temporary drawings should use flags for efficient cleanup
- Documentation files are reference only - don't modify during setup

---

**Review Date**: 2025-12-09  
**Status**: Ready for implementation  
**Next Steps**: Begin Cartographer drawing functionality implementation


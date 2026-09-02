# Cartographer Drawing Tool

**Audience:** someone changing Cartographer's drawing tool, and the rest of the suite.

How temporary player drawings are rendered, synchronised and cleaned up, and why they sit on
Blacksmith's shared canvas layer rather than on a layer of Cartographer's own. The mapping tool is a
separate subsystem and is not covered here.

## Architecture

### High-Level Design

```
Cartographer Module
├── DrawingManager (handles temporary drawings)
│   ├── Player Drawing State (active tool, brush settings)
│   ├── Drawing Storage (session-based, not persistent)
│   └── Cleanup System (auto-expire drawings)
├── Toolbar Integration (via Blacksmith Toolbar API)
│   ├── Drawing Tool Button
│   ├── Brush Settings Panel
│   └── Clear Drawings Button
└── BlacksmithLayer Integration
    ├── Drawing Coordination
    ├── UI Overlays
    └── Cleanup Management
```

## Using BlacksmithLayer

### Accessing BlacksmithLayer

The BlacksmithLayer is exposed via the Blacksmith API for consistent access:

```javascript
// Via API bridge
import { BlacksmithAPI } from '/modules/coffee-pub-blacksmith/api/blacksmith-api.js';

Hooks.once('ready', async () => {
    // Get BlacksmithLayer access
    const blacksmith = await BlacksmithAPI.get();
    const blacksmithLayer = blacksmith.CanvasLayer;
    
    // Or access directly via canvas
    const layer = canvas['blacksmith-utilities-layer'];
});
```

**Direct Access:**
```javascript
// Direct access after canvas is ready
Hooks.once('canvasReady', () => {
    const blacksmithLayer = canvas['blacksmith-utilities-layer'];
    if (blacksmithLayer) {
        // Use the layer
    }
});
```

### Benefits of Using BlacksmithLayer

1. **Centralized Management**: All Coffee Pub canvas interactions in one place
2. **Consistent Cleanup**: Unified cleanup system for temporary canvas elements
3. **Event Coordination**: Shared event handling for scene changes, player disconnects
4. **Module Integration**: Easy coordination between multiple Coffee Pub modules
5. **UI Overlay Management**: Centralized place for drawing-related UI overlays

## Implementation Strategy

### Drawing Creation Pattern

**Use Foundry's Drawing API** for the actual drawing objects (Foundry handles rendering):

```javascript
// Create temporary drawing using Foundry's Drawing API
const drawingData = {
    type: "f", // freehand
    author: game.user.id,
    x: startX,
    y: startY,
    bezierFactor: 0,
    points: [...], // path points array
    strokeWidth: brushSize,
    strokeColor: brushColor,
    // Flags to mark as temporary and managed by Cartographer
    flags: {
        "coffee-pub-cartographer": {
            temporary: true,
            layerManaged: true, // indicates BlacksmithLayer manages cleanup
            playerDrawn: true,
            expiresAt: Date.now() + (timeout * 1000),
            brushType: "pen", // or "marker", "highlighter"
            sessionId: game.sessionId
        }
    }
};

// Create non-persistent drawing (won't save to scene)
const drawings = await canvas.scene.createEmbeddedDocuments("Drawing", [drawingData]);
const drawing = drawings[0];
```

### Drawing Types Supported

Foundry's Drawing API supports multiple types:

- **"f"** (freehand): Best for drawing/writing
- **"r"** (rectangle): For boxes/shapes
- **"e"** (ellipse): For circles/ovals
- **"p"** (polygon): For complex shapes

### BlacksmithLayer Responsibilities

The BlacksmithLayer handles:

1. **Cleanup of Temporary Drawings**
   ```javascript
   // Auto-cleanup expired drawings
   Hooks.on("updateScene", () => {
       clearTemporaryDrawings();
   });
   ```

2. **UI Overlays** (brush preview, selection boxes, etc.)
   ```javascript
   // Render brush preview on BlacksmithLayer
   blacksmithLayer._drawBrushPreview(x, y, size, color);
   ```

3. **Drawing Coordination** between modules
   ```javascript
   // Coordinate drawing events across modules
   blacksmithLayer.emit('drawingCreated', drawing);
   ```

4. **Permission Management**
   ```javascript
   // Check if user can draw
   if (blacksmithLayer.canUserDraw(game.user)) {
       // Allow drawing
   }
   ```

### Cleanup System

**Automatic Cleanup:**
```javascript
// On scene change
Hooks.on("updateScene", () => {
    clearTemporaryDrawings();
});

// Periodic cleanup (expired drawings)
setInterval(() => {
    cleanupExpiredDrawings();
}, 60000); // Check every minute

function cleanupExpiredDrawings() {
    const now = Date.now();
    const temporaryDrawings = canvas.drawings.placeables.filter(d => 
        d.flags?.['coffee-pub-cartographer']?.temporary === true &&
        d.flags?.['coffee-pub-cartographer']?.expiresAt < now
    );
    
    temporaryDrawings.forEach(drawing => {
        drawing.delete();
    });
}
```

**Manual Cleanup:**
```javascript
function clearAllTemporaryDrawings() {
    const temporaryDrawings = canvas.drawings.placeables.filter(d => 
        d.flags?.['coffee-pub-cartographer']?.temporary === true
    );
    
    temporaryDrawings.forEach(drawing => {
        drawing.delete();
    });
}
```

## Player Drawing Flow

```
1. Player clicks "Drawing Tool" button (via Blacksmith Toolbar API)
   ↓
2. Toolbar activates drawing mode
   ↓
3. Player clicks/drags on canvas
   ↓
4. Create temporary Drawing object with flags
   ↓
5. Drawing renders immediately (via Foundry's DrawingLayer)
   ↓
6. Visible to all players in real-time
   ↓
7. On scene change or timeout → Auto-delete via BlacksmithLayer cleanup
```

## GM Controls

### Settings Configuration

```javascript
// Module settings for GM controls
game.settings.register(MODULE.ID, 'enablePlayerDrawing', {
    name: 'Enable Player Drawing',
    hint: 'Allow players to draw temporarily on the canvas',
    scope: 'world',
    config: true,
    default: true,
    type: Boolean
});

game.settings.register(MODULE.ID, 'drawingTimeout', {
    name: 'Drawing Timeout (seconds)',
    hint: 'Time before temporary drawings auto-expire (0 = never expire)',
    scope: 'world',
    config: true,
    default: 3600, // 1 hour
    type: Number
});

game.settings.register(MODULE.ID, 'allowDrawingPersistence', {
    name: 'Allow Drawing Persistence',
    hint: 'Allow GM to convert temporary drawings to permanent',
    scope: 'world',
    config: true,
    default: true,
    type: Boolean
});
```

### GM Features

- **Enable/Disable Player Drawing**: Toggle drawing permissions
- **Convert to Permanent**: Save temporary drawings to scene
- **Clear All Temporary Drawings**: Button to clear all temporary drawings
- **Per-Player Permissions**: Control who can draw
- **Brush Settings Override**: Set default brush settings for players

## Integration with Blacksmith

### Using Blacksmith APIs

```javascript
// 1. Register module with Blacksmith
BlacksmithModuleManager.registerModule(MODULE.ID, {
    name: MODULE.NAME,
    version: MODULE.VERSION
});

// 2. Use Blacksmith utilities for logging
BlacksmithUtils.postConsoleAndNotification(
    MODULE.ID,
    'Drawing created',
    { drawingId: drawing.id },
    false,
    false
);

// 3. Use Blacksmith HookManager for hooks
BlacksmithHookManager.registerHook({
    name: 'updateScene',
    description: 'Cartographer: Clear temporary drawings on scene change',
    context: MODULE.ID,
    priority: 10,
    callback: clearTemporaryDrawings
});

// 4. Register toolbar button via Blacksmith Toolbar API
const blacksmith = game.modules.get('coffee-pub-blacksmith')?.api;
blacksmith.registerToolbarTool('cartographer-draw', {
    icon: "fa-solid fa-pen",
    name: "cartographer-draw",
    title: "Drawing Tool",
    button: true,
    visible: true,
    zone: "utilities",
    onClick: () => {
        activateDrawingMode();
    }
});
```

## Technical Implementation Details

### Drawing Object Structure

```javascript
{
    type: "f", // Drawing type
    author: game.user.id,
    x: number, // Starting X coordinate
    y: number, // Starting Y coordinate
    bezierFactor: 0,
    points: [ // Path points for freehand
        [x1, y1],
        [x2, y2],
        ...
    ],
    strokeWidth: number,
    strokeColor: string,
    fillColor: string,
    fillAlpha: number,
    flags: {
        "coffee-pub-cartographer": {
            temporary: true,
            layerManaged: true,
            playerDrawn: true,
            expiresAt: number, // Timestamp
            brushType: string,
            sessionId: string
        }
    }
}
```

### BlacksmithLayer Access Methods

**Method 1: Via API (Recommended)**
```javascript
const blacksmith = await BlacksmithAPI.get();
const layer = blacksmith.CanvasLayer;
```

**Method 2: Direct Canvas Access**
```javascript
const layer = canvas['blacksmith-utilities-layer'];
```

**Method 3: Global Access (if exposed)**
```javascript
const layer = window.BlacksmithCanvasLayer;
```

### Event Handling

```javascript
// Listen for drawing creation
Hooks.on('createDrawing', (drawing, options, userId) => {
    if (drawing.flags?.['coffee-pub-cartographer']?.temporary) {
        // Handle temporary drawing creation
        notifyPlayers(drawing);
    }
});

// Listen for scene changes
Hooks.on('updateScene', (scene, data, options, userId) => {
    // Clear temporary drawings on scene change
    clearTemporaryDrawings();
});
```

## Storage Strategy

### Temporary Drawings
- **Don't persist** to scene (flags prevent saving)
- Store in memory only
- Auto-delete on scene change or timeout
- Use Foundry's built-in Drawing layer for rendering

### Optional Session History
- Store drawing history in module settings (session only)
- Limited to current game session
- Clear on game restart
- GM can export history if needed

## Best Practices

1. **Always check BlacksmithLayer availability** before use
2. **Use flags consistently** for temporary drawing identification
3. **Clean up on scene change** to prevent memory leaks
4. **Respect permissions** - check GM settings before allowing drawing
5. **Use Blacksmith APIs** for logging, hooks, and toolbar integration
6. **Coordinate with other modules** via BlacksmithLayer events
7. **Test cleanup** - ensure temporary drawings don't persist
8. **Handle edge cases** - player disconnects, scene transitions, etc.

## Troubleshooting

### BlacksmithLayer Not Available
```javascript
if (!canvas['blacksmith-utilities-layer']) {
    console.error('BlacksmithLayer not available - ensure Blacksmith is enabled');
    // Fallback: Use Foundry's Drawing API directly
}
```

### Drawings Persisting When They Shouldn't
- Check `flags['coffee-pub-cartographer'].temporary === true`
- Verify cleanup hooks are registered
- Ensure drawings are deleted, not just hidden

### Permission Issues
- Check `game.settings.get(MODULE.ID, 'enablePlayerDrawing')`
- Verify user permissions
- Check GM-only settings

## Resources

- [FoundryVTT Drawing API](https://foundryvtt.com/api/)
- Blacksmith API reference: https://github.com/Drowbe/coffee-pub-blacksmith/wiki
- [BlacksmithLayer Implementation](../scripts/canvas-layer.js)


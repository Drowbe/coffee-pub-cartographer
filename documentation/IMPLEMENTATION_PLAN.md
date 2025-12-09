# Cartographer Implementation Plan

## Overview

This document outlines the step-by-step implementation plan for the Coffee Pub Cartographer module. The plan is organized into phases that build upon each other, ensuring a solid foundation before adding advanced features.

**Architecture Note**: Cartographer is a **multi-tool module**. The drawing tool is the first tool to be implemented. `cartographer.js` serves as the main orchestration file that coordinates all tools. Each tool will have its own manager module following the naming convention: `manager-[tool-name].js`.

## Current State

### ✅ Completed
- Module structure and setup
- Blacksmith module registration
- Basic settings structure
- API testing code (to be removed)

### 🔲 To Be Implemented
- Drawing functionality
- Canvas Layer integration
- Toolbar integration
- Cleanup systems
- GM controls
- Multi-player synchronization

---

## Phase 1: Foundation & Cleanup

**Goal**: Clean up existing code and establish core infrastructure

### Tasks

1. **Remove API Testing Code**
   - Remove all API testing code from `cartographer.js` (lines 46-276)
   - Keep only the core initialization
   - Clean up empty lines

2. **Create Drawing Manager Module**
   - Create `scripts/manager-drawing.js`
   - Initialize basic structure for drawing state management
   - Set up module exports
   - Note: This is the first tool in a multi-tool module

3. **Update Settings**
   - Add Cartographer-specific settings to `settings.js`:
     - `enablePlayerDrawing` (Boolean, default: true)
     - `drawingTimeout` (Number, default: 3600 seconds)
     - `allowDrawingPersistence` (Boolean, default: true)
   - Add localization keys to `lang/en.json`

4. **Canvas Layer Integration Setup**
   - Add `canvasReady` hook handler
   - Implement Canvas Layer access pattern
   - Add availability checks

5. **CSS Organization Setup** ✅ **ALREADY DONE**
   - ✅ `default.css` imports tool CSS files
   - ✅ `common.css` created for shared styles
   - ✅ `tool-drawing.css` created for drawing tool styles
   - ✅ CSS import pattern established for future tools

**Files to Modify**:
- `scripts/cartographer.js` - Remove test code, add canvasReady hook (main orchestration file)
- `scripts/settings.js` - Add Cartographer settings
- `lang/en.json` - Add setting labels/hints
- `scripts/manager-drawing.js` - **NEW FILE** (first tool module)
- `styles/default.css` - Add CSS imports
- `styles/tool-drawing.css` - **NEW FILE** (drawing tool styles)

**Estimated Time**: 1-2 hours

---

## Phase 2: Core Drawing Functionality

**Goal**: Implement basic temporary drawing creation and management

### Tasks

1. **Drawing State Management**
   - Track active drawing mode (on/off)
   - Store brush settings (size, color, type)
   - Track current drawing session
   - Implement in `manager-drawing.js`

2. **Canvas Interaction Hooks**
   - Register `canvasReady` hook for initialization
   - Register mouse/pointer event handlers
   - Handle drawing start, update, end events
   - Use Blacksmith HookManager for hook registration

3. **Temporary Drawing Creation**
   - Implement `createTemporaryDrawing()` function
   - Use Foundry's Drawing API
   - Set proper flags for Cartographer identification
   - Handle freehand drawing type ("f")

4. **Drawing Flags Structure**
   ```javascript
   flags: {
       [MODULE.ID]: {
           temporary: true,
           layerManaged: true,
           playerDrawn: true,
           expiresAt: timestamp,
           brushType: "pen",
           sessionId: game.sessionId
       }
   }
   ```

**Files to Modify**:
- `scripts/manager-drawing.js` - Core drawing logic
- `scripts/cartographer.js` - Hook registration and orchestration

**Estimated Time**: 3-4 hours

---

## Phase 3: Cleanup System

**Goal**: Implement automatic and manual cleanup of temporary drawings

### Tasks

1. **Scene Change Cleanup**
   - Register `updateScene` hook via HookManager
   - Implement `clearTemporaryDrawings()` function
   - Filter drawings by Cartographer flags
   - Delete all temporary drawings on scene change

2. **Expiration Cleanup**
   - Implement periodic cleanup check (every minute)
   - Filter drawings by `expiresAt` timestamp
   - Delete expired drawings
   - Respect timeout setting (0 = never expire)

3. **Manual Cleanup Function**
   - Implement `clearAllTemporaryDrawings()` function
   - Filter by Cartographer flags
   - Provide GM-only access

4. **Player Disconnect Cleanup**
   - Register player disconnect hooks
   - Clean up drawings from disconnected players (optional)

**Files to Modify**:
- `scripts/manager-drawing.js` - Cleanup functions
- `scripts/cartographer.js` - Hook registration and orchestration

**Estimated Time**: 2-3 hours

---

## Phase 4: Toolbar Integration

**Goal**: Add UI controls via Blacksmith Toolbar API

### Tasks

1. **Drawing Tool Button**
   - Register toolbar button via Blacksmith Toolbar API
   - Toggle drawing mode on/off
   - Visual indicator when active
   - Icon: `fa-solid fa-pen`

2. **Brush Settings Panel** (Optional for Phase 4)
   - Basic brush size slider
   - Color picker
   - Brush type selector (pen, marker, highlighter)
   - Store settings in drawing state

3. **Clear Drawings Button** (GM only)
   - Register GM-only toolbar button
   - Call `clearAllTemporaryDrawings()`
   - Icon: `fa-solid fa-eraser`

**Files to Modify**:
- `scripts/cartographer.js` - Toolbar registration and orchestration
- `scripts/manager-drawing.js` - Brush settings management

**Estimated Time**: 2-3 hours

---

## Phase 5: Permission System & GM Controls

**Goal**: Implement permission checks and GM-only features

### Tasks

1. **Permission Checks**
   - Implement `canUserDraw()` function
   - Check `enablePlayerDrawing` setting
   - Check user permissions
   - Prevent drawing if disabled

2. **GM Controls**
   - Convert temporary to permanent drawings
   - Per-player permission controls (future)
   - Brush settings override (future)

3. **Settings Integration**
   - Use `getSettingSafely()` for settings access
   - Respect timeout settings
   - Handle persistence settings

**Files to Modify**:
- `scripts/manager-drawing.js` - Permission checks
- `scripts/cartographer.js` - GM feature hooks and orchestration

**Estimated Time**: 2-3 hours

---

## Phase 6: Multi-Player Synchronization

**Goal**: Sync drawings across all connected clients

### Tasks

1. **Socket Event Registration**
   - Register socket handlers via Blacksmith Socket Manager
   - Handle `drawing-created` events
   - Handle `drawing-updated` events (if needed)

2. **Broadcast Drawing Events**
   - Emit socket events when drawings are created
   - Include drawing data in socket payload
   - Handle remote drawing creation

3. **Remote Drawing Rendering**
   - Receive socket events from other clients
   - Create drawing objects for remote drawings
   - Maintain proper flags and ownership

**Files to Modify**:
- `scripts/manager-drawing.js` - Socket integration
- `scripts/cartographer.js` - Socket registration and orchestration

**Estimated Time**: 3-4 hours

---

## Phase 7: Advanced Features (Future)

**Goal**: Add polish and advanced functionality

### Tasks

1. **Undo/Redo System**
   - Track drawing history per player
   - Implement undo/redo stack
   - Session-based only

2. **Grid Snapping**
   - Optional grid alignment
   - Respect Foundry grid settings

3. **Drawing Templates/Stamps**
   - Pre-made shapes
   - Quick drawing tools

4. **Export/Import**
   - GM export of drawing history
   - Session save/load

**Estimated Time**: 4-6 hours (future work)

---

## File Structure

```
scripts/
├── const.js                    ✅ Exists
├── settings.js                 ✅ Exists (needs Cartographer settings)
├── cartographer.js             ✅ Exists - Main orchestration file
└── manager-drawing.js          🔲 NEW - Drawing tool module (first tool)

lang/
└── en.json                     ✅ Exists (needs Cartographer keys)

styles/
├── default.css                 ✅ Exists - Main import file
└── tool-drawing.css            🔲 NEW - Drawing tool styles
```

**Note**: 
- `cartographer.js` serves as the main orchestration file. Future tools will follow the same pattern:
  - `manager-[tool-name].js` for tool-specific logic
  - `cartographer.js` coordinates all tools
- `default.css` imports all tool CSS files. Each tool has its own CSS:
  - `tool-drawing.css` for drawing tool styles
  - `tool-notes.css` for notes tool styles (future)
  - etc.

---

## Implementation Order Summary

1. **Phase 1**: Foundation & Cleanup (1-2 hours)
2. **Phase 2**: Core Drawing Functionality (3-4 hours)
3. **Phase 3**: Cleanup System (2-3 hours)
4. **Phase 4**: Toolbar Integration (2-3 hours)
5. **Phase 5**: Permission System (2-3 hours)
6. **Phase 6**: Multi-Player Sync (3-4 hours)
7. **Phase 7**: Advanced Features (future)

**Total Estimated Time**: 13-19 hours for core functionality

---

## Key Implementation Patterns

### Canvas Layer Access
```javascript
Hooks.once('canvasReady', async () => {
    const layer = await BlacksmithAPI.getCanvasLayer();
    if (!layer) {
        console.warn('BlacksmithLayer not available');
        return;
    }
    // Initialize drawing system
});
```

### Hook Registration
```javascript
BlacksmithHookManager.registerHook({
    name: 'updateScene',
    description: 'Cartographer: Clear temporary drawings',
    context: MODULE.ID,
    priority: 10,
    callback: clearTemporaryDrawings
});
```

### Drawing Creation
```javascript
const drawings = await canvas.scene.createEmbeddedDocuments("Drawing", [{
    type: "f",
    author: game.user.id,
    x: startX,
    y: startY,
    points: [[x1, y1], [x2, y2]],
    strokeWidth: brushSize,
    strokeColor: brushColor,
    flags: {
        [MODULE.ID]: {
            temporary: true,
            layerManaged: true,
            playerDrawn: true,
            expiresAt: Date.now() + (timeout * 1000),
            brushType: "pen",
            sessionId: game.sessionId
        }
    }
}]);
```

### Toolbar Registration
```javascript
const blacksmith = game.modules.get('coffee-pub-blacksmith')?.api;
blacksmith.registerToolbarTool('cartographer-draw', {
    icon: "fa-solid fa-pen",
    name: "cartographer-draw",
    title: "Drawing Tool",
    button: true,
    visible: true,
    zone: "utilities",
    onClick: () => toggleDrawingMode()
});
```

---

## Testing Checklist

After each phase:

- [ ] Module loads without errors
- [ ] Blacksmith integration works
- [ ] Settings appear in configuration
- [ ] Canvas Layer is accessible
- [ ] No console errors
- [ ] Basic functionality works as expected

---

## Dependencies

- **Coffee Pub Blacksmith**: Required (already configured)
- **FoundryVTT v13**: Required
- **Canvas Layer API**: Available after `canvasReady`
- **Drawing API**: Foundry's built-in Drawing system

---

## Notes

- Start with Phase 1 to establish clean foundation
- Test each phase before moving to next
- Use Blacksmith APIs consistently
- Follow patterns from documentation
- Keep code organized and commented
- Handle edge cases (no canvas, no Blacksmith, etc.)

---

**Plan Created**: 2025-12-09  
**Status**: Ready for implementation  
**Next Step**: Begin Phase 1 - Foundation & Cleanup


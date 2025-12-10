# Socket Synchronization Plan for Cartographer Drawings

## Overview

This document outlines the plan for implementing real-time synchronization of drawings across all connected clients using the Blacksmith Socket API.

## Current State

### What's Already Implemented
- ✅ **Broadcasting**: Drawing creation and deletion events are being emitted via `BlacksmithSocketManager.emit()`
- ✅ **Event Types**: Two event types are being used:
  - `drawing-created` - When a new drawing is created
  - `drawing-deleted` - When drawings are deleted (all or user-specific)

### What's Missing
- ❌ **Socket Registration**: No handlers registered to receive events from other clients
- ❌ **Remote Drawing Rendering**: Drawings created by other players are not being rendered locally
- ❌ **API Compliance**: Using old `BlacksmithSocketManager` API instead of new `Blacksmith.socket` API
- ❌ **Initial Sync**: No mechanism to sync existing drawings when a player joins

## Blacksmith Socket API Pattern

According to the [Blacksmith Socket API documentation](https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Sockets), the proper pattern is:

```javascript
// Wait for socket system to be ready
Blacksmith.socket.waitForReady().then(() => {
  // Register event handlers
  Blacksmith.socket.register('eventName', (data) => {
    // Handle incoming event
  });

  // Emit events
  Blacksmith.socket.emit('eventName', { data });
});
```

## Implementation Plan

### Phase 1: Update to New Socket API

**Goal**: Migrate from old `BlacksmithSocketManager` to new `Blacksmith.socket` API

**Tasks**:
1. Replace `BlacksmithSocketManager.emit()` with `Blacksmith.socket.emit()`
2. Add `Blacksmith.socket.waitForReady()` checks before socket operations
3. Update error handling for new API

**Files to Modify**:
- `scripts/manager-drawing.js` - `broadcastDrawingCreation()` and `broadcastDrawingDeletion()`

**Code Changes**:
```javascript
// OLD (current):
BlacksmithSocketManager.emit(MODULE.ID, 'drawing-created', drawingData);

// NEW (proposed):
Blacksmith.socket.waitForReady().then(() => {
    Blacksmith.socket.emit(MODULE.ID, 'drawing-created', drawingData);
});
```

---

### Phase 2: Register Socket Event Handlers

**Goal**: Register handlers to receive drawing events from other clients

**Tasks**:
1. Create `registerSocketHandlers()` method
2. Register handler for `drawing-created` events
3. Register handler for `drawing-deleted` events
4. Call registration during initialization (after `waitForReady()`)

**Files to Modify**:
- `scripts/manager-drawing.js` - Add new method and call from `initialize()`

**Implementation**:
```javascript
async registerSocketHandlers() {
    // Wait for socket system to be ready
    await Blacksmith.socket.waitForReady();
    
    // Register handler for drawing creation
    Blacksmith.socket.register(`${MODULE.ID}.drawing-created`, (data) => {
        this.handleRemoteDrawingCreation(data);
    });
    
    // Register handler for drawing deletion
    Blacksmith.socket.register(`${MODULE.ID}.drawing-deleted`, (data) => {
        this.handleRemoteDrawingDeletion(data);
    });
}
```

---

### Phase 3: Handle Remote Drawing Creation

**Goal**: Render drawings created by other players on local client

**Tasks**:
1. Create `handleRemoteDrawingCreation()` method
2. Validate incoming drawing data
3. Check if drawing already exists (prevent duplicates)
4. Create PIXI graphics for remote drawing
5. Add to `_pixiDrawings` array with proper metadata
6. Set proper ownership flags (userId, userName from data)

**Files to Modify**:
- `scripts/manager-drawing.js` - Add `handleRemoteDrawingCreation()` method

**Implementation Considerations**:
- **Skip if from self**: Don't render if `data.userId === game.user.id` (already rendered locally)
- **Validate data**: Ensure all required fields are present
- **Check duplicates**: Use `drawingId` to prevent duplicate rendering
- **Preserve metadata**: Store userId, userName, createdAt, expiresAt from socket data
- **Support both types**: Handle both line drawings and symbol drawings

**Data Structure**:
```javascript
// Line drawing data:
{
    drawingId: string,
    userId: string,
    userName: string,
    startX: number,
    startY: number,
    points: Array<[number, number]>,
    strokeWidth: number,
    strokeColor: string,
    lineStyle: 'solid' | 'dotted' | 'dashed',
    createdAt: number,
    expiresAt: number | null
}

// Symbol drawing data:
{
    drawingId: string,
    userId: string,
    userName: string,
    symbolType: 'plus' | 'x' | 'dot' | 'arrow' | 'arrow-up' | 'arrow-down' | 'arrow-left' | 'square',
    x: number,
    y: number,
    strokeWidth: number,
    strokeColor: string,
    symbolSize: 'small' | 'medium' | 'large',
    createdAt: number,
    expiresAt: number | null
}
```

---

### Phase 4: Handle Remote Drawing Deletion

**Goal**: Remove drawings when other players delete them

**Tasks**:
1. Create `handleRemoteDrawingDeletion()` method
2. Handle two deletion types:
   - `clearAll: true` - Remove all drawings
   - `clearAll: false` - Remove only drawings from specific userId
3. Update `_pixiDrawings` array
4. Update `_lastDrawing` reference if needed

**Files to Modify**:
- `scripts/manager-drawing.js` - Add `handleRemoteDrawingDeletion()` method

**Implementation Considerations**:
- **Skip if from self**: Don't process if `data.userId === game.user.id` (already handled locally)
- **Respect permissions**: Only GMs can clear all drawings
- **Update undo reference**: Clear `_lastDrawing` if it was removed

---

### Phase 5: Update Broadcast Methods

**Goal**: Ensure broadcast methods include all necessary data

**Tasks**:
1. Update `broadcastDrawingCreation()` to include:
   - Line style (for line drawings)
   - Symbol size (for symbol drawings)
   - Timestamps (createdAt, expiresAt)
2. Update `broadcastDrawingDeletion()` to include:
   - Drawing ID (for specific deletion - future enhancement)
3. Add error handling and logging

**Files to Modify**:
- `scripts/manager-drawing.js` - Update `broadcastDrawingCreation()` and `broadcastDrawingDeletion()`

**Current Issues**:
- `broadcastDrawingCreation()` for symbols doesn't include `symbolSize`
- `broadcastDrawingCreation()` for lines doesn't include `lineStyle`
- Missing `createdAt` and `expiresAt` timestamps

---

### Phase 6: Initial Sync (Optional - Future Enhancement)

**Goal**: Sync existing drawings when a player joins mid-session

**Tasks**:
1. Create `requestInitialSync()` method
2. Emit `sync-request` event when player joins
3. GM or first player responds with `sync-response` containing all drawings
4. Render all received drawings locally

**Files to Modify**:
- `scripts/manager-drawing.js` - Add sync methods
- `scripts/manager-drawing.js` - Register sync handlers

**Considerations**:
- Only needed if players can join mid-session and need to see existing drawings
- May not be necessary if drawings are temporary and scene-specific
- Could be deferred to future enhancement

---

## Implementation Order

1. **Phase 1**: Update to new Socket API (foundation)
2. **Phase 2**: Register socket handlers (enable receiving)
3. **Phase 3**: Handle remote drawing creation (core functionality)
4. **Phase 4**: Handle remote drawing deletion (completeness)
5. **Phase 5**: Update broadcast methods (data completeness)
6. **Phase 6**: Initial sync (optional enhancement)

---

## Testing Plan

### Manual Testing Steps

1. **Basic Sync Test**:
   - Open two browser windows (or use two devices)
   - Connect both as different players
   - Draw a line in window 1
   - Verify line appears in window 2
   - Draw a symbol in window 2
   - Verify symbol appears in window 1

2. **Deletion Sync Test**:
   - Create drawings in both windows
   - Clear all drawings in window 1 (as GM)
   - Verify all drawings disappear in window 2
   - Create new drawings
   - Clear own drawings in window 2 (as player)
   - Verify only window 2's drawings disappear in both windows

3. **Permission Test**:
   - As player, try to clear all drawings
   - Verify only own drawings are cleared
   - Verify other players' drawings remain

4. **Error Handling Test**:
   - Disconnect one client
   - Verify other client doesn't crash
   - Reconnect and verify sync resumes

---

## Code Structure

### New Methods to Add

```javascript
class DrawingTool {
    // ... existing code ...
    
    /**
     * Register socket event handlers for receiving drawing events
     */
    async registerSocketHandlers() { }
    
    /**
     * Handle drawing creation from remote client
     * @param {Object} data - Drawing data from socket
     */
    handleRemoteDrawingCreation(data) { }
    
    /**
     * Handle drawing deletion from remote client
     * @param {Object} data - Deletion data from socket
     */
    handleRemoteDrawingDeletion(data) { }
    
    /**
     * Create a drawing from remote data (helper method)
     * @param {Object} data - Drawing data
     */
    createRemoteDrawing(data) { }
}
```

### Modified Methods

```javascript
// Update these methods:
broadcastDrawingCreation(drawingData) {
    // Update to use Blacksmith.socket API
    // Include all necessary data (lineStyle, symbolSize, timestamps)
}

broadcastDrawingDeletion(clearAll, userId) {
    // Update to use Blacksmith.socket API
}

async initialize(services) {
    // ... existing code ...
    // Add: await this.registerSocketHandlers();
}
```

---

## Edge Cases to Handle

1. **Duplicate Prevention**: Check if drawing already exists before creating
2. **Self-Event Filtering**: Don't process events from own userId
3. **Missing Data**: Validate all required fields before rendering
4. **Canvas Not Ready**: Wait for canvas layer before rendering
5. **Scene Mismatch**: Only sync drawings for current scene
6. **Expired Drawings**: Don't sync drawings that are already expired
7. **Permission Checks**: Respect player vs GM permissions for deletions

---

## Performance Considerations

1. **Debouncing**: Consider debouncing rapid drawing events (if needed)
2. **Batch Updates**: Group multiple deletions into single update (if needed)
3. **Memory Management**: Ensure remote drawings are cleaned up properly
4. **Network Efficiency**: Minimize data sent in socket events

---

## Future Enhancements

1. **Real-time Preview**: Sync drawing preview as user draws (not just on completion)
2. **Drawing Updates**: Allow editing drawings and syncing changes
3. **Conflict Resolution**: Handle simultaneous edits gracefully
4. **Drawing History**: Sync undo/redo across clients
5. **Selective Sync**: Allow players to hide/show specific players' drawings

---

## References

- [Blacksmith Socket API Documentation](https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Sockets)
- [Blacksmith Socket Manager Architecture](https://github.com/Drowbe/coffee-pub-blacksmith/wiki/Architecture:-Socket-Manager)


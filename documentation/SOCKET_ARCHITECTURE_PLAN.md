# Socket Architecture Plan

## Current State

**Problem**: Socket code is embedded in `manager-drawing.js`, which will bloat the file as we add more socket functionality and other tools.

**Current Location**: 
- Socket registration: `manager-drawing.js` (~150 lines of socket code)
- Socket handlers: `manager-drawing.js` 
- Broadcast methods: `manager-drawing.js`

## Proposed Architecture

### Option 1: Centralized Socket Manager (RECOMMENDED)

**Structure**:
```
scripts/
├── cartographer.js              (orchestrator)
├── manager-drawing.js           (drawing tool - NO socket code)
├── manager-sockets.js           (centralized socket handling) ⭐ NEW
├── manager-notes.js             (future - NO socket code)
└── manager-marching-orders.js   (future - NO socket code)
```

**Benefits**:
- ✅ Single responsibility: Socket manager handles ALL socket logic
- ✅ Tool managers stay focused on their domain logic
- ✅ Easy to add socket events for new tools
- ✅ Centralized socket registration and routing
- ✅ Prevents "god mode" files
- ✅ Easier to test and maintain

**How It Works**:
1. `manager-sockets.js` registers ALL socket handlers
2. Routes events to appropriate tool managers via callbacks
3. Tool managers register their handlers with socket manager
4. Tool managers call socket manager to broadcast events

### Option 2: Keep Socket Code in Tool Managers

**Structure**:
```
scripts/
├── manager-drawing.js           (drawing tool + socket code)
├── manager-notes.js             (notes tool + socket code)
└── manager-marching-orders.js   (marching orders + socket code)
```

**Drawbacks**:
- ❌ Duplicate socket registration code in each tool
- ❌ Socket logic mixed with tool logic
- ❌ Harder to maintain socket patterns
- ❌ Files become bloated (3000+ lines)

## Recommended Implementation: Option 1

### File Structure

```javascript
// manager-sockets.js
class SocketManager {
    constructor() {
        this.handlers = new Map(); // toolId -> { eventName -> handler }
        this.initialized = false;
    }
    
    async initialize() {
        // Register all socket handlers
        // Route events to tool handlers
    }
    
    // Tool managers call this to register their handlers
    registerToolHandlers(toolId, handlers) {
        // Store handlers for routing
    }
    
    // Tool managers call this to broadcast events
    broadcast(toolId, eventName, data) {
        // Emit socket event
    }
}

export const socketManager = new SocketManager();
```

### Integration Pattern

```javascript
// manager-drawing.js
import { socketManager } from './manager-sockets.js';

class DrawingTool {
    async initialize(services) {
        // ... other initialization ...
        
        // Register socket handlers with socket manager
        socketManager.registerToolHandlers('drawing', {
            'drawing-created': (data) => this.handleRemoteDrawingCreation(data),
            'drawing-deleted': (data) => this.handleRemoteDrawingDeletion(data)
        });
    }
    
    // Broadcast via socket manager
    broadcastDrawingCreation(data) {
        socketManager.broadcast('drawing', 'drawing-created', data);
    }
}
```

### Migration Plan

**Step 1**: Create `manager-sockets.js`
- Extract socket registration logic
- Create routing system
- Implement broadcast method

**Step 2**: Update `manager-drawing.js`
- Remove socket registration code
- Remove `registerSocketHandlers()` method
- Update `broadcastDrawingCreation()` to use socket manager
- Update `broadcastDrawingDeletion()` to use socket manager
- Keep `handleRemoteDrawingCreation()` and `handleRemoteDrawingDeletion()` (tool-specific logic)

**Step 3**: Update `cartographer.js`
- Initialize socket manager in `canvasReady` hook
- Before tool initialization

**Step 4**: Test
- Verify socket events still work
- Verify no duplicate registrations
- Verify routing works correctly

## File Size Targets

After refactoring:
- `manager-sockets.js`: ~200-300 lines (socket infrastructure)
- `manager-drawing.js`: ~2800 lines → ~2650 lines (removed ~150 lines of socket code)
- `cartographer.js`: ~130 lines (add socket manager init)

## Future Tools

When adding new tools:
```javascript
// manager-notes.js
import { socketManager } from './manager-sockets.js';

class NotesTool {
    async initialize(services) {
        // Register handlers
        socketManager.registerToolHandlers('notes', {
            'note-created': (data) => this.handleRemoteNote(data),
            'note-updated': (data) => this.handleRemoteNoteUpdate(data)
        });
    }
    
    broadcastNoteCreation(data) {
        socketManager.broadcast('notes', 'note-created', data);
    }
}
```

No socket code duplication! 🎉

## Decision

**Recommendation**: Implement Option 1 (Centralized Socket Manager)

**Rationale**:
- Follows single responsibility principle
- Prevents file bloat
- Makes adding new tools easier
- Centralized socket logic is easier to maintain
- Aligns with Coffee Pub architecture patterns


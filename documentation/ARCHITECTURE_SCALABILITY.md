# Cartographer Architecture Scalability Analysis

## Current Architecture

```
cartographer.js (Main Orchestrator)
  └── manager-drawing.js (Drawing Tool)
```

## Scaling to Multiple Tools

### Scenario: Adding Group Notes & Marching Orders

```
cartographer.js (Main Orchestrator)
  ├── manager-drawing.js (Drawing Tool)
  ├── manager-notes.js (Group Notes Tool)      🔲 Future
  └── manager-marching-orders.js (Marching Orders) 🔲 Future
```

---

## Architecture Patterns to Consider

### Pattern 1: Tool Registration Pattern (Recommended)

**Concept**: Each tool registers itself with the orchestrator, providing a standard interface.

**Structure**:
```javascript
// cartographer.js
const TOOLS = {
    drawing: null,
    notes: null,
    marchingOrders: null
};

// Each tool exports a standard interface
const toolInterface = {
    name: string,
    version: string,
    initialize: async function(),
    cleanup: function(),
    getSettings: function(),
    getToolbarTools: function()
};
```

**Pros**:
- ✅ Clear separation of concerns
- ✅ Tools are independent
- ✅ Easy to add/remove tools
- ✅ Standard interface ensures consistency
- ✅ Tools can be conditionally loaded

**Cons**:
- ⚠️ Requires discipline to maintain interface
- ⚠️ Slightly more complex initialization

---

### Pattern 2: Shared Services Pattern

**Concept**: cartographer.js provides shared services that all tools use.

**Structure**:
```javascript
// cartographer.js
export const CartographerServices = {
    canvasLayer: null,
    blacksmithAPI: null,
    settings: {},
    hooks: {},
    toolbar: {}
};

// Tools import and use shared services
import { CartographerServices } from './cartographer.js';
```

**Pros**:
- ✅ Centralized resource management
- ✅ Single point of access for shared resources
- ✅ Easy to coordinate between tools

**Cons**:
- ⚠️ Creates dependency on cartographer.js
- ⚠️ Tools become less independent
- ⚠️ Harder to test tools in isolation

---

### Pattern 3: Event Bus Pattern

**Concept**: Tools communicate via events, minimal direct coupling.

**Structure**:
```javascript
// cartographer.js
const eventBus = new EventTarget();

// Tools emit/listen to events
eventBus.dispatchEvent(new CustomEvent('tool-activated', { detail: { tool: 'drawing' } }));
```

**Pros**:
- ✅ Maximum decoupling
- ✅ Tools don't know about each other
- ✅ Easy to add cross-tool features

**Cons**:
- ⚠️ Can be harder to debug
- ⚠️ Event flow can be unclear
- ⚠️ May be overkill for this use case

---

## Recommended Hybrid Approach

### Core Principles

1. **cartographer.js as Orchestrator**: Coordinates initialization, provides shared services
2. **Tools are Independent**: Each tool is self-contained with minimal dependencies
3. **Standard Interface**: All tools implement the same interface
4. **Shared Infrastructure**: Common services (Canvas Layer, Blacksmith APIs) accessed via orchestrator
5. **Settings Per Tool**: Each tool manages its own settings namespace

### Proposed Structure

```javascript
// cartographer.js
// ================================================================== 
// ===== SHARED SERVICES ============================================
// ================================================================== 

export const CartographerServices = {
    // Canvas Layer (shared across tools)
    canvasLayer: null,
    
    // Blacksmith API access
    blacksmithAPI: null,
    
    // Module constants
    MODULE: null
};

// ================================================================== 
// ===== TOOL REGISTRY ==============================================
// ================================================================== 

const TOOL_REGISTRY = {
    drawing: null,
    notes: null,
    marchingOrders: null
};

// ================================================================== 
// ===== TOOL INTERFACE =============================================
// ================================================================== 

/**
 * Standard interface all tools must implement
 */
export const ToolInterface = {
    name: string,              // Tool identifier
    displayName: string,       // Human-readable name
    version: string,          // Tool version
    
    // Lifecycle
    initialize: async function(services),  // Initialize tool with shared services
    cleanup: function(),                   // Cleanup on module unload
    
    // Settings
    registerSettings: function(),          // Register tool-specific settings
    getSettings: function(),              // Get tool settings
    
    // UI
    getToolbarTools: function(),          // Return toolbar tool definitions
    getMenubarItems: function(),          // Return menubar items (if any)
    
    // State
    isActive: function(),                 // Is tool currently active?
    activate: function(),                 // Activate tool
    deactivate: function()                 // Deactivate tool
};

// ================================================================== 
// ===== TOOL INITIALIZATION =======================================
// ================================================================== 

async function initializeTools() {
    // Initialize shared services first
    CartographerServices.MODULE = MODULE;
    CartographerServices.blacksmithAPI = await BlacksmithAPI.get();
    
    // Wait for canvas if needed
    Hooks.once('canvasReady', async () => {
        CartographerServices.canvasLayer = await BlacksmithAPI.getCanvasLayer();
        
        // Initialize each tool
        for (const [toolName, tool] of Object.entries(TOOL_REGISTRY)) {
            if (tool) {
                try {
                    await tool.initialize(CartographerServices);
                    console.log(`✅ ${MODULE.NAME}: ${tool.displayName} initialized`);
                } catch (error) {
                    console.error(`❌ ${MODULE.NAME}: Failed to initialize ${toolName}:`, error);
                }
            }
        }
    });
}

// ================================================================== 
// ===== TOOL REGISTRATION =========================================
// ================================================================== 

export function registerTool(toolName, toolInstance) {
    if (!toolInstance || typeof toolInstance.initialize !== 'function') {
        console.error(`Invalid tool registration: ${toolName}`);
        return false;
    }
    
    TOOL_REGISTRY[toolName] = toolInstance;
    return true;
}
```

### Tool Implementation Example

```javascript
// manager-drawing.js
import { MODULE } from './const.js';
import { registerTool, CartographerServices } from './cartographer.js';

class DrawingTool {
    constructor() {
        this.name = 'drawing';
        this.displayName = 'Drawing Tool';
        this.version = '1.0.0';
        this.active = false;
    }
    
    async initialize(services) {
        this.services = services;
        this.registerSettings();
        this.registerHooks();
        this.registerToolbarTools();
    }
    
    cleanup() {
        // Cleanup hooks, toolbar tools, etc.
    }
    
    registerSettings() {
        // Register drawing-specific settings
        game.settings.register(MODULE.ID, 'drawing.enablePlayerDrawing', {
            // ...
        });
    }
    
    getToolbarTools() {
        return [{
            id: 'cartographer-draw',
            icon: "fa-solid fa-pen",
            title: "Drawing Tool",
            onClick: () => this.toggle()
        }];
    }
    
    // ... rest of tool logic
}

// Auto-register tool
const drawingTool = new DrawingTool();
registerTool('drawing', drawingTool);
export { drawingTool };
```

---

## File Structure for Multiple Tools

```
scripts/
├── const.js                    ✅ Module constants
├── settings.js                 ✅ Shared settings (if any)
├── cartographer.js             ✅ Main orchestrator + shared services
│
├── manager-drawing.js          ✅ Drawing tool
├── manager-notes.js            🔲 Notes tool (future)
└── manager-marching-orders.js  🔲 Marching orders tool (future)
│
└── utils/                      🔲 Shared utilities (if needed)
    ├── canvas-helpers.js
    └── storage-helpers.js

styles/
├── default.css                 ✅ Main import file (imports all tool CSS)
├── tool-drawing.css            ✅ Drawing tool styles
├── tool-notes.css              🔲 Notes tool styles (future)
└── tool-marching-orders.css    🔲 Marching orders styles (future)
```

---

## Settings Organization

### Option 1: Namespaced Settings (Recommended)

```javascript
// Drawing tool settings
game.settings.register(MODULE.ID, 'drawing.enablePlayerDrawing', { ... });
game.settings.register(MODULE.ID, 'drawing.timeout', { ... });

// Notes tool settings
game.settings.register(MODULE.ID, 'notes.enableGroupNotes', { ... });
game.settings.register(MODULE.ID, 'notes.maxNotes', { ... });

// Marching orders settings
game.settings.register(MODULE.ID, 'marchingOrders.enable', { ... });
```

**Pros**: Clear organization, no conflicts, easy to find settings

### Option 2: Tool-Specific Settings Objects

```javascript
// Each tool manages its own settings object
const drawingSettings = {
    enablePlayerDrawing: true,
    timeout: 3600
};
```

**Pros**: Simpler access, less verbose

**Cons**: Harder to see all settings in Foundry's settings UI

---

## Toolbar Organization

### Option 1: Tool-Specific Toolbar Groups

```javascript
// Drawing tools in "drawing" group
blacksmith.registerToolbarTool('cartographer-draw', {
    group: 'cartographer-drawing',
    // ...
});

// Notes tools in "notes" group
blacksmith.registerToolbarTool('cartographer-notes', {
    group: 'cartographer-notes',
    // ...
});
```

### Option 2: Unified Cartographer Toolbar

```javascript
// All tools in "cartographer" group
blacksmith.registerToolbarTool('cartographer-draw', {
    group: 'cartographer',
    // ...
});
```

**Recommendation**: Option 2 - keeps all Cartographer tools together

---

## Hook Management

### Per-Tool Hook Context

```javascript
// Drawing tool hooks
BlacksmithHookManager.registerHook({
    context: `${MODULE.ID}.drawing`,
    // ...
});

// Notes tool hooks
BlacksmithHookManager.registerHook({
    context: `${MODULE.ID}.notes`,
    // ...
});
```

**Benefit**: Automatic cleanup per tool, clear hook ownership

---

## Canvas Layer Sharing

### Shared Access Pattern

```javascript
// cartographer.js provides shared access
CartographerServices.canvasLayer = await BlacksmithAPI.getCanvasLayer();

// Tools access via services
const layer = CartographerServices.canvasLayer;
```

**Consideration**: Tools should coordinate if they both need to draw on Canvas Layer

---

## State Management

### Per-Tool State

```javascript
// Each tool manages its own state
class DrawingTool {
    constructor() {
        this.state = {
            active: false,
            brushSettings: {},
            currentDrawing: null
        };
    }
}
```

**Benefit**: No state conflicts between tools

---

## Cross-Tool Communication

### When Tools Need to Interact

**Scenario**: Notes tool wants to reference a drawing

**Option 1: Event Bus** (if needed)
```javascript
// Drawing tool emits event
eventBus.dispatchEvent(new CustomEvent('drawing-created', { detail: drawing }));

// Notes tool listens
eventBus.addEventListener('drawing-created', (event) => {
    // Handle drawing reference
});
```

**Option 2: Direct Access** (simpler)
```javascript
// Notes tool accesses drawing tool directly
import { drawingTool } from './manager-drawing.js';
const drawings = drawingTool.getDrawings();
```

**Recommendation**: Start with Option 2, add Event Bus only if needed

---

## Testing Considerations

### Tool Independence

- Each tool should be testable in isolation
- Tools should work even if other tools fail to load
- Tools should handle missing shared services gracefully

### Example Test Structure

```javascript
// Test drawing tool independently
import { drawingTool } from './manager-drawing.js';

// Mock services
const mockServices = {
    canvasLayer: mockCanvasLayer,
    blacksmithAPI: mockBlacksmithAPI
};

await drawingTool.initialize(mockServices);
// Test tool functionality
```

---

## Migration Path

### Phase 1: Single Tool (Current)
- `cartographer.js` orchestrates
- `manager-drawing.js` implements drawing

### Phase 2: Add Tool Interface
- Define standard tool interface
- Refactor drawing tool to implement interface
- Add tool registry to cartographer.js

### Phase 3: Add Second Tool
- Create `manager-notes.js`
- Implement tool interface
- Register with orchestrator
- Verify no conflicts

### Phase 4: Add Third Tool
- Repeat pattern
- Verify scalability

---

## Potential Issues & Solutions

### Issue 1: Tool Initialization Order

**Problem**: Tool B depends on Tool A being initialized first

**Solution**: 
- Tools should not depend on each other
- Use events for cross-tool communication
- Initialize tools in parallel

### Issue 2: Shared Resource Conflicts

**Problem**: Multiple tools want to use Canvas Layer simultaneously

**Solution**:
- Tools coordinate via shared services
- Use tool priorities if needed
- Document tool interactions

### Issue 3: Settings Bloat

**Problem**: Too many settings as tools are added

**Solution**:
- Use namespaced settings
- Group settings by tool in UI
- Use collapsible sections

### Issue 4: Toolbar Clutter

**Problem**: Too many toolbar buttons

**Solution**:
- Group related tools
- Use tool menus/dropdowns
- Allow GM to configure visibility

---

## File Size Management

### Preventing Bloated Files

**Principle**: Each file should have a single, clear responsibility

**File Size Guidelines**:
- `cartographer.js`: ~200-300 lines (orchestration only)
- Each `manager-*.js`: ~300-500 lines (tool-specific logic)
- `settings.js`: ~200-400 lines (all settings, but organized)
- Each `tool-*.css`: ~100-300 lines (tool-specific styles)

**If a file grows too large**:
- Split into logical sub-modules
- Extract utilities to `utils/` folder
- Break tool into multiple files (e.g., `manager-drawing-core.js`, `manager-drawing-ui.js`)

### CSS Organization

**Pattern**: `default.css` imports all tool CSS files

```css
/* styles/default.css */

/* Core Cartographer styles */
@import url('./core.css');

/* Tool-specific styles */
@import url('./tool-drawing.css');
@import url('./tool-notes.css');
@import url('./tool-marching-orders.css');
```

**Benefits**:
- ✅ Single entry point for all styles
- ✅ Each tool has isolated CSS
- ✅ Easy to add/remove tool styles
- ✅ Clear organization

## Recommendations

### ✅ DO

1. **Use Tool Registration Pattern**: Standard interface, clear separation
2. **Namespaced Settings**: `tool.settingName` format
3. **Shared Services**: Centralized access to Canvas Layer, Blacksmith APIs
4. **Independent Tools**: Each tool is self-contained
5. **Per-Tool Hook Context**: `${MODULE.ID}.toolName` for cleanup
6. **Tool-Specific State**: Each tool manages its own state
7. **Separate CSS per Tool**: Each tool has its own CSS file
8. **Keep Files Focused**: Single responsibility per file
9. **Split Large Files**: Extract utilities, break into sub-modules

### ❌ DON'T

1. **Don't create tool dependencies**: Tools shouldn't require other tools
2. **Don't share state between tools**: Use events if needed
3. **Don't hardcode tool names**: Use registry pattern
4. **Don't mix tool logic in cartographer.js**: Keep it as orchestrator only

---

## Summary

**Architecture**: Tool Registration Pattern with Shared Services

**Key Principles**:
- cartographer.js = Orchestrator + Shared Services
- Each tool = Independent module with standard interface
- Settings = Namespaced per tool
- Hooks = Per-tool context
- State = Per-tool management

**Scalability**: ✅ Can easily add 5+ tools without architectural changes

**Maintainability**: ✅ Clear separation, easy to understand

**Testability**: ✅ Tools can be tested independently

---

**Analysis Date**: 2025-12-09  
**Status**: Architecture validated for multi-tool scaling


# Socket API Testing & Blacksmith Integration

## Current Issue

**Error**: `CARTOGRAPHER: Blacksmith socket API not available`

**When**: Occurs when trying to broadcast drawing creation events

**Location**: `manager-sockets.js:164` in `broadcast()` method

## What We're Testing

We're implementing real-time synchronization of drawings across multiple clients using the Blacksmith Socket API.

### Implementation Details

1. **Centralized Socket Manager**: Created `manager-sockets.js` to handle all socket operations
2. **Tool Registration Pattern**: Tools register handlers via `socketManager.registerToolHandlers()`
3. **Broadcast Pattern**: Tools broadcast events via `socketManager.broadcast()`

### Access Patterns We're Trying

Our `_getSocketAPI()` method tries multiple access patterns:

1. **Global Blacksmith Object**: `Blacksmith.socket`
2. **Module API**: `game.modules.get('coffee-pub-blacksmith')?.api?.socket`
3. **BlacksmithAPI Bridge**: `BlacksmithAPI.socket` (if available)
4. **Legacy**: `BlacksmithSocketManager` (fallback)

**Current Result**: None of these patterns are finding the socket API.

## Questions for Blacksmith Team

### 1. Socket API Access Pattern
**Question**: How should we access the Blacksmith Socket API?

**What we've tried**:
- `Blacksmith.socket` (global)
- `game.modules.get('coffee-pub-blacksmith')?.api?.socket`
- `BlacksmithAPI.socket`
- `BlacksmithSocketManager` (legacy)

**Expected**: According to [API: Sockets documentation](https://github.com/Drowbe/coffee-pub-blacksmith/wiki/API:-Sockets), the pattern should be:
```javascript
Blacksmith.socket.waitForReady().then(() => {
    Blacksmith.socket.register('eventName', (data) => { ... });
    Blacksmith.socket.emit('eventName', data);
});
```

**Issue**: `Blacksmith.socket` is undefined when we try to access it.

### 2. Initialization Timing
**Question**: When is the socket API available?

**Our current flow**:
1. `ready` hook: Register settings, register module with Blacksmith
2. `canvasReady` hook: Initialize socket manager, then initialize tools

**Timing concerns**:
- Is `Blacksmith.socket` available in `canvasReady`?
- Do we need to wait for a specific hook?
- Is there an initialization order requirement?

### 3. Module Registration
**Question**: Do we need to register something specific for socket access?

**What we're doing**:
```javascript
BlacksmithModuleManager.registerModule(MODULE.ID, {
    name: MODULE.NAME,
    version: MODULE.VERSION
});
```

**Is this sufficient**, or do we need additional registration for socket access?

### 4. API Availability Check
**Question**: What's the correct way to check if the socket API is available?

**Current check**:
```javascript
if (typeof Blacksmith === 'undefined' || !Blacksmith.socket) {
    // API not available
}
```

**Is this correct**, or should we check differently?

## Debug Information to Collect

When testing, please check the console for:

1. **Module Registration**:
   - Look for: `✅ CARTOGRAPHER: Registered with Blacksmith successfully`
   - If missing, Blacksmith module might not be loaded

2. **Socket Manager Initialization**:
   - Look for: `CARTOGRAPHER: Socket manager initialized`
   - If missing, socket API wasn't found

3. **Debug Output** (we added this):
   - Look for: `CARTOGRAPHER: Socket API check - Blacksmith: ...`
   - This shows what socket APIs are detected

4. **Blacksmith Module Status**:
   ```javascript
   // In console:
   game.modules.get('coffee-pub-blacksmith')
   // Check: .active, .api, .api.socket
   ```

5. **Global Objects**:
   ```javascript
   // In console:
   typeof Blacksmith
   typeof BlacksmithSocketManager
   typeof BlacksmithAPI
   ```

## Test Steps

1. **Enable Blacksmith Module**: Ensure `coffee-pub-blacksmith` is active
2. **Load Cartographer**: Enable Cartographer module
3. **Check Console**: Look for initialization messages
4. **Try Drawing**: Create a drawing and check for socket errors
5. **Check Debug Output**: Look for socket API detection messages

## What We Need

1. **Correct Access Pattern**: How to access `Blacksmith.socket`
2. **Initialization Requirements**: Any hooks/registration needed
3. **Timing Information**: When is the API available?
4. **Error Handling**: Best practices for when API isn't available

## Current Workaround

Currently, drawings work locally but don't sync across clients. The socket manager gracefully handles missing API (doesn't crash), but socket sync is disabled.

## Files Involved

- `scripts/manager-sockets.js` - Socket manager (tries to access API)
- `scripts/manager-drawing.js` - Uses socket manager to broadcast
- `scripts/cartographer.js` - Initializes socket manager in `canvasReady` hook


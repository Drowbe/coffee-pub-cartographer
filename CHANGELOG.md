# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [13.0.3]

### Added
- **Group Banners**: Added visual banners above toolbar button groups
  - Enabled group banners in secondary bar configuration
  - Custom banner background color (green theme: `rgba(33, 77, 16, 0.9)`)
  - Banners automatically display group names for better organization

### Changed
- **Settings Scope Migration**: Migrated 9 settings from `client` scope to `user` scope for Foundry v13 compatibility
  - Personal preferences now persist across devices per user
  - Migrated settings: `drawing.hotkeyEnabled`, `drawing.hotkeyMode`, `drawing.blockWhenTyping`
  - Migrated toolbar state settings: `toolbar.drawingMode`, `toolbar.symbolSize`, `toolbar.lineWidth`, `toolbar.lineStyle`, `toolbar.color`, `toolbar.timedEraseEnabled`
  - `toolbar.height` remains `client` scope (screen-resolution dependent)
- **Group Names**: Updated all toolbar group names to user-friendly labels
  - `mode` → `Drawing Mode`
  - `symbols` → `Stamp Size`
  - `line-width` → `Line Weight`
  - `lineStyle` → `Line Style`
  - `color` → `Color`
  - `erase` → `Utilities`
  - Group names now support spaces and proper capitalization for better readability

### Technical
- Updated group definitions to use descriptive names with spaces
- All group references updated throughout codebase (24 tool registrations)
- Settings now use Foundry v13's new `user` scope for cross-device persistence
- Group banners leverage Blacksmith API's `groupBannerEnabled` feature


## [13.0.2]

### Changed
- **Menubar API Integration**: Updated to support Blacksmith's updated Menubar API
  - Migrated from nested `Menubar` object pattern to direct API methods
  - Changed from `blacksmith.Menubar.registerTool()` to `api.registerMenubarTool()`
  - Updated API access pattern to use `game.modules.get('coffee-pub-blacksmith')?.api` directly
  - Improved error handling and API availability checks
  - Enhanced compatibility with latest Blacksmith module version

## [13.0.1]

### Added
- **Box Drawing Tool**: New drawing mode for creating rectangular boxes
  - Key-based activation (no mouse clicks required)
  - Real-time preview as mouse moves
  - Works with both hold and toggle hotkey modes
  - Supports all line styles (solid, dotted, dashed)
  - Full multi-player synchronization
- **Configurable Hotkey System**: Enhanced keybinding configuration
  - Hotkey enable/disable setting
  - Hold vs. toggle mode selection
  - Option to ignore hotkey while typing in chat/forms
  - Hotkey appears in Foundry's Configure Controls for easy rebinding
- **Toolbar Height Setting**: Configurable toolbar height slider
  - Client-scope setting (per-user preference)
  - Range: 15-100 pixels
  - Default: 38 pixels
  - Adjustable in Module Settings → Common Settings

### Changed
- **Keybinding System**: Migrated to Foundry's native keybinding API
  - Replaced manual `document.addEventListener` with `game.keybindings.register`
  - Better integration with Foundry's keyboard routing (v13+ compatible)
  - Users can now rebind the hotkey in Settings → Configure Controls
  - Improved focus handling (respects `game.keyboard.hasFocus`)
- **Box Tool Position**: Moved box button to order 2 in toolbar (after line tool)

### Fixed
- **Shadow Rendering**: Fixed "second set of dots" issue for filled symbols
  - Circle/dot shadows now render correctly (cleared lineStyle before fill)
  - Arrow shadows now render correctly (cleared lineStyle before fill)
  - Rounded square shadows now render correctly (cleared lineStyle before fill)
  - Box shadows always use solid style (not affected by line style setting)
- **Event Handler Leaks**: Fixed `detachCanvasHandlers()` to match capture flag
  - Prevents accumulation of event handlers across activations
  - Eliminates potential double-drawing and janky behavior
- **Box Drawing Completion**: Fixed box finishing at correct mouse position
  - Now uses stored last mouse position instead of synthetic event
  - Prevents boxes from finishing at (0,0) or incorrect coordinates

### Technical
- Added `lastMousePosition` state tracking for box drawing
- Improved mouse position retrieval for key-based drawing completion
- Enhanced `finishBoxDrawing()` with multiple fallback methods for coordinate retrieval
- Added `createRemoteBox()` method for remote box synchronization

## [13.0.0]

### Added
- **Drawing Tool**: Full-featured canvas drawing system with PIXI graphics
  - Real-time drawing with backslash (`\`) key activation
  - Line drawing with configurable width (thin, medium, thick)
  - Multiple line styles: solid, dotted, dashed
  - Symbol stamping: plus, x, dot, arrow (4 directions), rounded square
  - Symbol size options: small, medium, large
  - Color picker with preset colors and player color support
  - Contact shadow effects for lines and symbols
  - Undo functionality for last drawing
  - Timed erase with configurable timeout (5-120 seconds)
  - Fade-out animations when drawings are deleted (300ms smooth fade)
  - Player permissions: players can draw and erase their own drawings
- **Toolbar Integration**: Secondary toolbar via Blacksmith Menubar API
  - Mode selection: line tool and symbol tools
  - Line width selection (switch group)
  - Line style selection (switch group)
  - Color selection (switch group)
  - Erase group: clear all, undo, timed erase toggle
  - Toolbar state persistence (client-scope settings)
- **Socket Manager**: Centralized socket communication system
  - `manager-sockets.js` for all socket operations
  - Tool-agnostic socket registration and routing
  - Broadcast system for cross-client synchronization
  - Multiple API access pattern support
  - Graceful handling when socket API unavailable
- **Settings System**: Comprehensive module settings
  - Drawing tool enable/disable
  - Player drawing permissions
  - Timed erase configuration
  - Toolbar state persistence (hidden, client-scope)
- **Canvas Layer Integration**: Direct PIXI graphics on BlacksmithLayer
  - Bypasses Foundry Drawing API validation issues
  - Real-time preview during drawing
  - Proper coordinate conversion for canvas interactions

### Changed
- **Architecture**: Refactored socket code into centralized `manager-sockets.js`
  - Removed socket code from `manager-drawing.js` (~150 lines)
  - Prevents "god mode" files as module scales
  - Easier to add socket support for future tools
- **Drawing Activation**: Changed from "D" key to backslash (`\`) key
  - Prevents conflicts with Foundry movement controls
  - Key must be held while drawing (like mouse button)
- **Symbol Rendering**: Improved arrow symbol design
  - Notched triangle shape with proper proportions
  - Four directional arrows (up, down, left, right)
  - Consistent sizing with other symbols
- **Line Styles**: Enhanced dotted and dashed line rendering
  - Proportional spacing based on line width
  - Consistent intervals regardless of mouse speed
  - Improved visual quality

### Fixed
- Canvas coordinate conversion for FoundryVTT v13
- Drawing preview showing stray lines
- Foundry bounding box appearing during drawing
- Real-time preview not showing until mouse-up
- Symbol stamping not respecting activation key
- Player color extraction from Foundry Color objects
- Default line width button not matching default width setting
- Circle and square symbols missing drop shadows
- Arrow shadow color matching arrow color (now uses shadow color)

### Technical
- Event handling with capture mode to prevent Foundry conflicts
- Proper cleanup of event listeners and PIXI graphics
- Client-scope settings for toolbar state persistence
- Debug logging with `BlacksmithUtils.postConsoleAndNotification`
- Multiple socket API access patterns for compatibility
- Smooth fade-out animations using `requestAnimationFrame` with ease-out curves

## [1.0.0] - Initial Release

### Added
- Initial module structure
- Integration with Coffee Pub Blacksmith


# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Menubar quick actions**: Right-clicking Cartographer's menubar button now opens a native quick menu for Party Maps, every drawing mode, and role-appropriate drawing cleanup without opening the full secondary toolbar.
- **Map placeables**: Right-clicking an explored map square now opens Blacksmith's shared context menu with a nested Place menu for Stairs, Trap, and Treasure. Actor owners and GMs can replace or remove the square's persisted symbol.
- **Discovered secret doors**: Secret doors continue to look like ordinary walls until the tracked token actually crosses their Foundry wall segment, after which the map permanently promotes that edge to the official S-style secret-door symbol.
- **Old-school party mapper**: Added a Mapping tool for square-grid scenes. It opens a separate Glass-themed Blacksmith Tool window where recording permanently maps the 5×5 grid area surrounding one controlled token as it moves.
- **Shared persistent maps**: Maps are stored as party-visible Actor+Scene records and synchronized to connected users. The Recorded Maps view lists maps from every scene, while recording remains limited to the current scene.
- **Map ownership controls**: Everyone can view the party's maps. An Actor owner or GM can add, continue, rename, reset, or delete that Actor's maps.
- **Map window controls**: Added Map/List views, zoom, center-on-token, remembered pan position, mapped-distance status, tracked-token status, and confirmed map-management actions.
- **Mapping configuration**: Added world settings to enable the mapper and allow or deny player mapping.
- **Placeholder map presentation**: Added theme-aware grid tiles and a party marker using Blacksmith's Tool content-surface variables, ready for later hand-drawn asset replacement.

### Fixed
- **Durable map deletion**: Reveal processing and map mutations now share one ordered GM-side queue, so an older in-flight reveal cannot recreate a map after Delete removes it. Deleted map IDs remain tombstoned against late reveal packets; deliberately starting Record explicitly creates a fresh map and clears that tombstone.
- **Source-aware wall reconciliation**: Persisted map geometry now retains the Foundry Wall source behind each abstract edge. Re-observing a wall or doorway replaces that source's earlier opposing placement instead of accumulating a false one-cell box or double door. Distinct opposing sources remain intact, preserving real one-grid hallway walls and doors flanked by structural walls. Existing maps repair progressively as their structure is observed again.
- **Corner-safe floor visibility**: Candidate floor squares now require visibility to their center and at least two nearby cardinal samples. Rays that merely graze a closed wall endpoint no longer reveal thin floor slivers or structure behind the join; the token's occupied square remains guaranteed for narrow passages.
- **Single-glyph door normalization**: Door-wall fragments whose midpoints share one Foundry grid square are collapsed to their first and last endpoints before snapping, even when decorative or curved fragments change angle inside that square. Re-observing the normalized doorway repairs older maps by removing the stale parallel door edge across the same square. Revealed secret doors perform the same targeted repair on their former opposing wall without erasing the corridor walls beside them.
- **Mapper initialization order**: The Mapping window is now imported lazily when opened, after Blacksmith's ready-time API is available, instead of reading `game.modules` during Foundry's early ES module loading phase.
- **Mapping from secondary GM clients**: A GM now applies and persists discoveries from their own controlled token locally instead of being blocked when another connected GM is Foundry's designated `activeGM`. Player-originated discoveries still require active-GM validation.
- **Foundry v13 grid coordinates**: Mapping now calls `getOffset({x, y})` and reads its `{i, j}` row/column result. The former legacy-shaped call produced `NaN,NaN` cell keys, which were discarded by state validation and left the map visually empty.
- **Single-grid map presentation**: Removed the second floating map grid and its white border. The Glass window's grid is now the map itself: each square represents one scene grid cell, unexplored squares remain dark, and explored squares fill in directly for future floor, wall, and doorway tile layers.
- **Simplified map tiles**: Explored floor tiles are now borderless solid fills with no decorative texture or inset outline.
- **Centered party tracking**: The party marker stays fixed in the middle of the Tool window while the map recenters beneath it after movement and zoom changes.
- **Wall element classification**: The mapper now reads placed Wall document fields directly and limits rendering to physical walls, windows, and regular doors. Terrain, invisible, and ethereal boundaries are ignored; secret doors deliberately render as ordinary walls to avoid revealing them to players. Strokes use simple solid colors: black walls, blue windows, and orange doors.
- **Token-relative map tracking**: The map pin is attached to the tracked token's actual grid cell again. The viewport now pans immediately after each move to keep that cell centered, with dynamic scroll margins so tokens near any scene edge can still reach the center.
- **Larger mapping footprint**: Each token step now reveals a 5×5 area centered on the tracked token, providing a more readable old-school map than the original 3×3 footprint.
- **Old-school wall linework**: Replaced whole-cell wall fills with a graph-paper tile vocabulary. Foundry walls are simplified into horizontal and vertical strokes, corners, junctions, and deliberate stair-steps instead of reproducing exact wall coordinates. Windows render above walls, and doors render last so short doorway segments are not erased by neighboring walls.
- **Stable token following**: Token movement now relocates and recenters the party marker directly, even while crossing previously mapped cells. Mapping window renders are serialized and duplicate state broadcasts are ignored, preventing competing renders from restoring stale scroll positions and making the map jump.
- **Hand-drawn map strokes**: Increased wall, window, and door line weight and added subtly bent paths with a faint second ink pass. Shared endpoints remain exact so the sketch treatment keeps corners and junctions connected.
- **Reliable discovery accumulation**: Ordinary mapping updates now merge explored cells instead of replacing them with queued scene snapshots. Rapid movement can no longer let an older persistence update erase the newly mapped cells in front of the tracked token; explicit map resets still replace the state normally.
- **Floor grid**: Added a very light graph-paper grid to explored floor cells, preserving spatial scale without competing with the heavier hand-drawn wall, window, and door strokes.
- **Map interaction cleanup**: The Cartographer Mapping tool now opens the map for viewing instead of toggling recording. Record/Stop lives inside the map window, right-drag pans like the Foundry canvas, native scrollbars are hidden, and Street View identifies the launcher and tracked party position.
- **Rebased default zoom**: Increased the base map-cell size so the former 160% presentation is now the clearer 100% default scale, while retaining the same zoom controls and range.
- **Selected-token map context**: Opening Mapping with one selected token now loads the existing scene map with that token marked and centered before recording begins. Record adds its movement; Stop retains the selected-token view, and changing selection while viewing updates the map context.
- **Cursor-centered wheel zoom**: The mouse wheel now zooms the map around the tile beneath the cursor like the Foundry canvas. Rapid wheel input is batched and serialized instead of scrolling the hidden viewport or launching overlapping renders.
- **Tile reveal animation**: Newly discovered floor and linework tiles fade and settle into place without replaying the animation on existing tiles during zoom, pan, wall updates, or ordinary rerenders. Reduced-motion preferences disable the effect.
- **Smooth movement recentering**: After manual map panning, token movement now scrolls the map smoothly back beneath the centered party marker instead of snapping there instantly.
- **Stable Record/Stop viewport**: The mapper now preserves its dynamic centering margin along with scroll coordinates, so stopping recording no longer shifts the map into the upper-left corner.
- **Distance mapped**: The map footer now reports feet mapped at five feet per discovered grid square instead of displaying the raw cell count.
- **Exploration-aware features**: Maps now persist only the abstract wall, window, and door strokes the recorded token could experience from each 5×5 reveal. Sight-blocking geometry prevents walls behind walls from leaking onto the party map, terrain walls remain ignored, and viewing an old map never rescans its live scene.
- **Reliable experienced-wall detection**: Structural discovery now uses Foundry's authoritative sight-collision backend instead of depending on a rendered token vision polygon on the GM client. Nearby corridor walls, windows, and doors are retained while intervening walls still hide geometry behind them.
- **Map window chrome**: Removed the floating control palette from the map surface. Map/List, Record/Stop, Add, and Reset now use the existing top toolbar; zoom out, center, zoom in, and the zoom readout use the footer beside mapped distance.
- **Queued path mapping**: Long and rapid token moves are now reconstructed as an ordered path through every crossed grid square. The mapper reveals and samples structure as if the token paused at each step, periodically yields for UI responsiveness, and keeps the party marker on the last completed map step until the drawing catches up.
- **Old-school door glyph**: Regular doors now use the guide's black wall-and-centered-box symbol, rotated to match horizontal or vertical placement, instead of an orange wall stroke. The glyph keeps the mapper's slightly hand-drawn line treatment.
- **Hover window chrome**: The complete Cartographer toolbar and footer now disappear when the pointer leaves the Tool window and return as theme-aware, slightly translucent overlays on hover or keyboard focus. The hidden bars reserve no empty space and their return does not resize or shift the map. List-item management controls appear only on their row.
- **Persistent map-row actions**: Rename and Delete remain visible on every manageable map entry in Recorded Maps instead of appearing only while that row is hovered. The window toolbar retains its hover-only overlay behavior.
- **Line-of-sight floor mapping**: The mapper now visibility-checks every candidate floor square before adding it to the recorded map. The 5×5 sampling neighborhood no longer reveals rooms or corridors hidden behind walls, and structural symbols remain limited to the same visible area.
- **True-position visibility sampling**: Replayed movement now casts visibility from the token's real pixel path instead of snapping each sample to its grid center. Curved or narrow passages whose walls share a token grid square no longer move the synthetic observer across the wall; the occupied square is always recorded even when its center lies beyond that wall.
- **Grid-boundary wall snapping**: Visible Foundry wall segments now snap to the nearest mapped grid boundary. Curved walls become continuous old-school stair-step boundaries instead of disconnected centerline hooks, and doors/windows use the same boundary vocabulary.
- **Selection-aware recording pause**: Recording now pauses instead of stopping when the tracked token loses control. Reselecting that token resumes from its current position without drawing across the paused interval; Stop remains available while paused.
- **Stable structure observations**: Doors now produce one midpoint symbol instead of one glyph per wall sample. Walls, windows, and doors snap to observer-independent grid boundaries, and re-observing an edge refreshes its classification instead of retaining stale alternatives.
- **Settled-movement catch-up**: Token destinations are now read directly from Foundry's update payload, followed by a short catch-up pass after movement settles. The queued map always finishes at the token's real grid cell instead of remaining one move behind.
- **Recording-only party marker**: The token marker is now shown only during an active recording session. Viewing a completed map presents the map by itself and centers on its explored drawing rather than a live token position.
- **Map-view control cleanup**: Removed the destructive clear/reset button from the map view. Destructive map management remains in the Recorded Maps list, where the target map is explicit.
- **Actor-and-scene map identity**: Replaced the single shared scene map with one map per Actor per Scene, including migration of the legacy scene map into the first Actor map continued on that scene.



## [13.0.7]

### Added
- **Settings introduction**: Added a concise introduction explaining Cartographer's temporary canvas drawing tools.
- **Feature planning**: Restored the project TODO with planned clipboard export, persistent Drawings, and an old-school mapping tool.
- **Mapping tool plan**: Added a phased implementation plan for a persistent party map. A player opens a Glass-themed Tool window from Cartographer and uses its Record button to begin revealing the 5×5 grid area around their controlled token; Stop ends recording without closing the map. The plan covers synchronization, permissions, rendering, placeholder and hand-drawn tiles, testing, and future wall-aware mapping.

### Changed
- **Simplified settings hierarchy**: Reorganized module settings under one H1 and two description-free H2 sections: **Configuration** for player-drawing enablement and erase timing, and **Drawing** for personal hotkey controls. Removed the unnecessary H3, H4, and divider headings.
- **Player-visible setting context**: Made headings that contain user-scoped settings user-scoped as well, so players see the same section context as the GM. Actual setting scopes and behavior are unchanged.
- **Settings workflow groups**: Assigned visible settings to their Configuration or Drawing group so each control remains associated with the correct heading.


## [13.0.6]

### Added
- **Toast notifications**: New `scripts/utils-toast.js` wraps Blacksmith's Toast API with a `notify(title, options)` helper — severity presets (info/warn/error) supply the accent color and default icon, and toasts are tagged with `moduleId` so Blacksmith can clear them as a group. Falls back to `ui.notifications` when Blacksmith is absent or predates the API.

### Changed
- **User feedback now uses toasts**: All six `ui.notifications` calls (clear, clear all, undo, timed erase) replaced with Blacksmith toasts. Messages gained a subtitle carrying the detail — clears report how many drawings were removed, undo says whether another one remains — and repeat actions use `stackKey` so rapid clicks replace the toast in place instead of stacking. Clearing with nothing to clear now reports "Nothing to clear" as a warning rather than claiming a clear happened.
- **Menubar button color**: Removed the explicit `iconColor` / `buttonNormalTint` / `buttonSelectedTint` keys from the menubar tool registration; the button takes Blacksmith's default coloring. They were already `null`, which Blacksmith coalesces to the default, so this is a code cleanup with no visual change. Group banner color and the destructive-button tints are unchanged.
- **Toolbar sizing**: The secondary bar now registers with Blacksmith's `size: 'default'` preset (30px) instead of a pixel `height`. Blacksmith ignores `height` and warns on it. Group banners are now additive rather than subtractive, so toolbar buttons render at full size under their banners — the old 38px was only buying banner room.

### Removed
- **`toolbar.height` setting**: Removed along with its localization strings. Under Blacksmith's scale-factor model, bar height drives every font, icon and gap in the bar, so a free-number slider was a typography control mislabelled as a height — and being client-scoped, two people at the same table saw different-sized text.

## [13.0.5]

### Fixed
- **Blacksmith bootstrap order**: Initialization could throw `Cannot read properties of null (reading 'postConsoleAndNotification')` when Cartographer’s `ready` ran before Blacksmith wired window globals like `BlacksmithUtils`.
  - Settings registration now prefers `game.modules.get('coffee-pub-blacksmith').api.utils.postConsoleAndNotification`, with safe fallbacks so registration never fails on that path.
  - When Blacksmith is active, `ready` awaits `BlacksmithAPI.waitForReady()` before registering settings and registering the module with Blacksmith.
  - Module registration uses `module.api.registerModule` first, with a fallback to `BlacksmithModuleManager` for older setups.

## [13.0.4]

### Added
- **Sketch**: Freehand drawing mode (renamed from the former “Line Tool”). First button in Drawing Mode.
- **Line Tool**: New straight-line mode. Draws a single segment from start point to end point (same interaction as Box/Ellipse: start on first move, finish on key release). Uses `fa-solid fa-slash-forward` icon.
- **Ellipse Tool**: New shape mode. Draws ellipses in a bounding box (start → end), with solid/dotted/dashed styles and sync. Uses `fa-regular fa-circle` icon.
- **Stamp Style group**: Toolbar group for “which stamp shape” when Stamp is selected
  - **Drawing Mode** (Sketch, Line, Box, Ellipse, Stamp): Chooses tool
  - **Stamp Style** (Plus, X, Dot, Arrow Right/Up/Down/Left, Rounded Square): Chooses stamp shape; behaves like Color / Line Style / Line Weight (option only, does not change mode)
  - **Stamp** button: When selected, uses the current Stamp Style for stamping on click
- **toolbar.stampStyle** setting (user scope, hidden): Persists selected stamp shape; legacy symbol modes are migrated to `drawingMode: stamp` + `stampStyle: <shape>`

### Changed
- **Drawing Mode** order and tools: **Sketch** (1), **Line Tool** (2), **Box** (3), **Ellipse** (4), **Stamp** (5)
  - Legacy freehand “Line” is now **Sketch**; saved `'line'` is migrated to `'sketch'`
  - **Box** icon: `fa-regular fa-square`
  - **Ellipse** icon: `fa-regular fa-circle`
- **Tooltips**: Removed hotkey text from tooltips so they stay correct when the hotkey is reconfigured in Foundry
- **Early-Exit When No Drawings**: Cartographer skips work when there is nothing to clear or broadcast
  - **updateScene hook**: Clears and broadcasts only when the canvas has Cartographer drawings; no-op when empty
  - **clearAllDrawings()**, **clearUserDrawings()**, **cleanupExpiredDrawings()**, **cleanupPlayerDrawings()**: Early return when there are no drawings (no broadcast, no log where applicable)
- Reduces console and socket traffic when another module fires scene-update hooks often and the canvas has no Cartographer drawings
- **toolbar.drawingMode** default set to `'sketch'`

### Technical
- Drawing mode: `drawingMode` is `'sketch' | 'line' | 'box' | 'ellipse' | 'stamp'`; `stampStyle` is used when mode is `'stamp'`
- Added `setStampStyle()`, `updateStampStyleButtons()`, Stamp Style group (order 6)
- Line tool: `startLineDrawing`, `updateLinePreview`, `finishLineDrawing`, `lineStartPoint`; reuses line broadcast/`createRemoteLine`
- Ellipse: `startEllipseDrawing`, `updateEllipsePreview`, `finishEllipseDrawing`, `_drawEllipseWithStyle`, `createRemoteEllipse`
- `_pixiDrawings.length === 0` / `?.length` guards to avoid log spam when updateScene is fired repeatedly

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


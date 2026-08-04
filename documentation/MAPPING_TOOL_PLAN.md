# Mapping Tool Implementation Plan

## Goal

Create a separate old-school party map that a player opens from the Cartographer toolbar and records from inside the map window. Each time the recorded token enters a new grid cell, the mapper permanently reveals the 5×5 area centered on the token.

The map appears in a resizable Blacksmith Tool window rather than as an overlay on the scene.

## Current Map Model

- A recorded map is uniquely identified by **Actor + Scene**.
- Maps belong to the party: every user can view the world-wide Recorded Maps list, including maps from scenes other than the current scene.
- Only a map for the current scene can be recorded or created.
- The Actor's owners and GMs can create, continue, rename, reset, and delete its maps.
- Explored floors and visibility-approved abstract wall, window, and door strokes are persisted with the record. Viewing a map never scans live scene walls, so it cannot reveal geometry the token did not experience.
- The record format reserves independent map features so official old-school symbols can be placed without coupling them to Foundry Wall documents.

### Planned symbol placement and Phase 2

Add a **Place** context menu with nested categories based on the official old-school mapping key. After choosing a door, passage, hazard, structure, terrain, or furnishing symbol, the next click places it on the map. In Phase 2, reuse this map model and symbol vocabulary for ad-hoc old-school maps authored directly on the Foundry canvas.

## Initial Scope

### Included

- Square-grid scenes.
- A **Mapping** tool in the Cartographer toolbar that opens the map window.
- One controlled token per actively mapping user.
- A 5×5 reveal centered on the tracked token.
- Previously revealed cells remain mapped.
- A separate map view using the Blacksmith Tool Window API.
- Glass as the initial Tool window theme, while allowing the standard theme selector.
- Record/stop, right-drag pan, zoom, and center-on-party controls.
- Persistent Actor+Scene map records stored in scene flags.
- A party-wide Recorded Maps list, including view-only maps from other scenes.
- Synchronized map updates for connected users.
- Visibility-filtered wall, window, and door memory.
- Placeholder tiles that can later be replaced by hand-drawn artwork.
- Actor-owner and GM create, rename, reset, and delete controls.

### Deferred

- Hex and gridless scenes.
- Full lighting-aware floor clipping; the initial implementation uses vision/LOS to decide which structural strokes are experienced while retaining the 5×5 floor reveal.
- Automatic room, corridor, or terrain classification.
- Tracking more than one token for a single user.
- Multiple floors or scene levels in one map.
- Player annotations and manual map editing.
- Exporting the completed map as an image.

## User Experience

### Player workflow

1. Select or control one owned token.
2. Open **Mapping** from the Cartographer toolbar to load the Glass map window with that token centered.
3. Press **Record** in the map window.
4. Move the token normally to add its 5×5 surroundings to the party map.
5. Press **Stop** to stop recording while leaving the map open, or close the window to stop and close it.

The Record button is the source of truth. Closing the map window stops recording; minimizing the window leaves recording active.

### GM workflow

The GM can use the same Record button with a controlled token and can manage any party map. Actor owners can manage their Actor's maps as well.

Players must never receive undiscovered scene geometry or hidden tile metadata.

## Map Window

Use `BlacksmithToolWindowBaseV2` and register the window through Blacksmith's Window API.

Recommended defaults:

- Window id: `coffee-pub-cartographer-mapper`
- Initial theme: `glass`
- Initial title bar: `micro`
- Resizable and minimizable
- Remember position, size, theme, and title-bar preference per user
- Opaque parchment or graph-paper map surface inside the Glass frame

Suggested controls:

- **Record / Stop**
- **Center on Party**
- **Zoom In**
- **Zoom Out**
- **Reset View**
- **Mapping status and tracked-token name**
- **Clear Map** — Actor owner or GM, with confirmation

While recording is stopped, changing to a different single selected token updates and recenters the viewing context without revealing new cells.

The Glass effect belongs to the frame. The map surface should remain opaque and use the Blacksmith Tool content-surface variables so the drawing stays legible in Light, Dark, and Glass themes.

## Reveal Rules

The tracked token's occupied grid cell is the center cell. On each grid-cell transition, reveal these offsets:

```text
(-2,-2) (-1,-2) ( 0,-2) ( 1,-2) ( 2,-2)
(-2,-1) (-1,-1) ( 0,-1) ( 1,-1) ( 2,-1)
(-2, 0) (-1, 0) ( 0, 0) ( 1, 0) ( 2, 0)
(-2, 1) (-1, 1) ( 0, 1) ( 1, 1) ( 2, 1)
(-2, 2) (-1, 2) ( 0, 2) ( 1, 2) ( 2, 2)
```

Rules:

- Clip coordinates to scene grid bounds.
- Do nothing when the token moves within its current grid cell.
- Do nothing while recording is stopped.
- Ignore movement on gridless or unsupported scenes and show a clear status message.
- Require exactly one controlled token when Record is pressed; otherwise leave recording stopped and explain what is needed.
- Reveal the starting 5×5 area as soon as Record is pressed.
- Long drags are interpolated through every crossed grid square. Each queued square receives the same 5×5 reveal and visibility-filtered structural sampling as a normal one-cell move.
- The party marker follows the last completed mapping step while queued drawing catches up to the live token.
- Each active user contributes discoveries from their own controlled token to the shared party map.
- An active GM client is authoritative for validating contributors, calculating discoveries, and persisting the map.

## Data Model

Store a versioned collection of Actor maps in each Scene's flags under the Cartographer module namespace. The window builds its party-wide list by reading these collections across the world's scenes.

Suggested shape:

```js
{
  version: 2,
  maps: {
    ACTOR_ID: {
      id: "ACTOR_ID::SCENE_ID",
      actorId: "ACTOR_ID",
      sceneId: "SCENE_ID",
      name: "Actor — Scene",
      gridType: "square",
      columns: 40,
      rows: 30,
      gridDistance: 5,
      explored: ["12,8", "13,8", "14,8"],
      features: {
        "12,8": ["wall:north", "door:east"]
      },
      symbols: [],
      updatedAt: 0,
      updatedBy: "USER_ID"
    }
  }
}
```

Implementation notes:

- Use a `Set` in memory and serialize it as an array.
- Store only discovered cell coordinates and visibility-approved abstract feature strokes; never store complete scene geometry.
- Batch or debounce scene-flag writes during rapid movement.
- Include a schema version so the format can evolve safely.
- Keep pan, zoom, window position, and theme local to each user rather than in shared scene data.
- Keep each user's Mapping toggle and tracked-token session state out of the persistent party-map data.

If map sizes make string coordinates too large, a later migration can use row spans or a compact bitset without changing the window contract.

## Architecture

Add the mapper as an independent Cartographer tool:

```text
scripts/
  manager-mapping.js       movement tracking, map records, permissions, persistence
  utils-mapping.js         wall classification, abstraction, and visibility checks
  window-mapping.js        Blacksmith Tool window and Map/List views
templates/
  window-mapping.hbs       map window content
styles/
  tool-mapping.css         map surface and controls
assets/mapping/
  placeholders/            initial development tiles
  tiles/                   final hand-drawn tiles
```

Responsibilities:

- `manager-mapping.js`
  - Handle the menubar Mapping toggle.
  - Resolve the activating user's single controlled token.
  - Detect grid-cell transitions.
  - Calculate newly revealed coordinates.
  - Persist and synchronize authoritative map state.
  - Expose map state to the window.

- `window-mapping.js`
  - Extend the Blacksmith Tool window base.
  - Render the map surface and local navigation controls.
  - React to synchronized discovery updates.
  - Reflect active mapping status and the tracked token.
  - Provide Actor-owner and GM management actions.

- `manager-sockets.js`
  - Add mapper state/update messages using the existing Cartographer socket pattern.
  - Send reveal requests to the authoritative GM when an active user's token enters a new grid cell.
  - Treat socket messages as notifications; the persisted scene flag remains the source of truth.

## Rendering Strategy

Begin with an HTML/CSS tile grid for the proof of concept. Render only explored cells inside the current viewport and update only newly revealed cells.

If large maps produce DOM performance problems, move the same tile model to a Canvas or PIXI renderer without changing discovery or persistence.

The map coordinate system should remain independent of scene pixels:

- Scene grid coordinate: `{ column, row }`
- Map coordinate: normalized relative to the first discovered cell or scene origin
- Display coordinate: map coordinate transformed by local pan and zoom

## Tile Art Pipeline

The engine should assemble a tile from layers rather than require artwork for every possible combination.

### Minimum placeholder set

- Floor
- Unexplored/empty background
- Party marker
- Grid line treatment

### Hand-drawn expansion set

- Several floor variants selected deterministically by coordinate
- Rotatable wall edge
- Inner and outer corner accents
- Rotatable open and closed doors
- Stairs up and down
- Entrance or exit
- Landmark, hazard, and point-of-interest symbols
- Party marker

Asset recommendations:

- PNG or WebP with transparent backgrounds for overlays.
- Consistent square dimensions, such as 256×256 pixels.
- Keep floor, walls, doors, and symbols on separate transparent layers.
- Author north-facing directional assets and rotate them in code.
- Include safe padding so hand-drawn lines do not clip at tile boundaries.
- Use filenames and a manifest rather than hard-coding asset paths throughout the renderer.

## Settings

Add only settings needed for stable behavior:

### Configuration — world scope

- Enable Mapping Tool
- Allow players to open the party map

### Mapping — user scope where applicable

- Default map zoom
- Automatically center on the tracked token

Mapping start and stop belong to the menubar toggle. Map reset belongs in the window because it is a scene-specific GM action.

## Permissions and Safety

- A player may start mapping only from a token they own and control.
- The authoritative GM validates the user/token relationship and calculates the revealed coordinates from actual token movement.
- Only a GM may reset the shared map.
- Player clients render only the explored coordinate set sent by the GM or read from scene flags.
- Do not send wall, door, light, room, or unexplored-cell data to players.
- Validate scene id, token id, sender, token ownership, and GM authority on every mapping socket event.
- Confirm destructive reset actions and report what was cleared.

## Implementation Phases

### Phase 1 — Window prototype

- Register and open the Blacksmith Tool window.
- Add the Mapping toolbar tool as a window launcher.
- Load and center the existing scene map for one selected token without starting recording.
- Add Record and Stop inside the map window.
- Make closing the window stop recording.
- Apply Glass and Micro defaults.
- Add a resizable opaque map surface with right-drag pan and zoom.
- Render a fixed sample grid with placeholder tiles.

**Exit condition:** The window opens reliably, remembers its presentation, and renders a navigable sample map.

### Phase 2 — Local discovery engine

- Resolve the activating user's single controlled token.
- Start and stop tracking from the map window's Record button.
- Convert token positions to square-grid coordinates.
- Detect cell transitions.
- Accumulate the 5×5 reveal locally.
- Center the window on the tracked token.

**Exit condition:** Moving the token reveals the correct 25-cell neighborhoods without duplicate work.

### Phase 3 — Persistence and synchronization

- Save versioned explored-cell state to scene flags.
- Restore state on canvas reload and scene change.
- Add mapper socket events.
- Enforce GM authority and player-safe payloads.
- Debounce persistence writes.

**Exit condition:** GM and player clients see the same map after movement, reconnect, and reload.

### Phase 4 — Controls and hardening

- Add mapping status, tracked-token name, center, and confirmed reset actions.
- Keep recording state synchronized with the Tool window lifecycle.
- Handle deleted tokens, scene changes, unsupported grids, and missing Blacksmith APIs.
- Add localization and accessible labels/tooltips.
- Add settings and status feedback.

**Exit condition:** All expected failure states are understandable and recoverable in the UI.

### Phase 5 — Art integration

- Define the tile manifest.
- Replace placeholder assets with hand-drawn tiles.
- Add deterministic floor variation and rotatable overlays.
- Verify seams, scaling, and all three Tool themes.

**Exit condition:** The mapper has a cohesive old-school visual style at multiple zoom levels.

### Phase 6 — Exploration-aware structural mapping (implemented)

- Evaluate scene wall segments adjacent to discovered cells on the GM client.
- Add only perceived wall/door edges to the shared mapped state.
- Never derive or transmit undiscovered geometry.

The persisted result is deliberately abstract graph-paper linework rather than a copy of the Foundry wall drawing.

## Testing Checklist

- Open Mapping, press Record with one controlled token, and reveal its starting 5×5 area.
- Open Mapping with one selected token and verify its existing map and marker load before Record is pressed.
- Change the selected token while viewing and verify the context recenters without adding cells.
- Press Record with zero or multiple controlled tokens and verify recording remains stopped with useful feedback.
- Move one cell horizontally, vertically, and diagonally.
- Confirm only newly discovered cells are added.
- Move rapidly and verify writes are batched without losing cells.
- Teleport the token and verify only the destination neighborhood is revealed.
- Press Stop and confirm movement reveals nothing while the map stays open.
- Press Record again and verify the current neighborhood is revealed.
- Close the Tool window and verify recording stops.
- Minimize the Tool window and verify recording remains active.
- Move at all four scene edges and corners without out-of-bounds cells.
- Delete the tracked token and verify graceful recovery.
- Reload the world and restore the same map.
- Verify maps are independent per Actor per Scene.
- Open Recorded Maps and view maps from current and inactive scenes.
- Verify only the current-scene map can record.
- Verify everyone can view, while only the Actor owner or GM can add, rename, reset, or delete.
- Walk near nested walls and verify only the first experienced wall is recorded; terrain walls remain absent.
- Connect as a player and verify synchronized updates.
- Verify players receive no undiscovered geometry.
- Test Light, Dark, and Glass themes with the map window open.
- Test window resizing, minimizing, right-drag pan, zoom, and position restoration with hidden scrollbars.

## Estimated Effort

- Window and local proof of concept: 1–2 development days.
- Persistent synchronized MVP: an additional 2–4 days.
- Controls, edge cases, testing, and polish: an additional 2–4 days.
- Hand-drawn art integration: dependent on asset availability, approximately 1–3 development days after the artwork is ready.

A reliable square-grid release is therefore approximately one to two focused development weeks. Wall-aware mapping, hex support, and annotations should be estimated separately after the MVP is tested in actual play.

## MVP Completion Criteria

The first release is complete when a player can open Mapping from the Cartographer toolbar, press Record with a controlled token, and build a persistent shared 5×5-per-step party map in a separate Glass Tool window; Stop ends recording without closing the map, and no undiscovered scene information is exposed.

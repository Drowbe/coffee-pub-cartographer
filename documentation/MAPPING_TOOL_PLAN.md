# Mapping Tool Implementation Plan

## Goal

Create a separate old-school party map that builds itself while a player has **Mapping** toggled on in the Cartographer menubar. Each time that player's controlled token enters a new grid cell, the mapper permanently reveals the 5×5 area centered on the token.

The map appears in a resizable Blacksmith Tool window rather than as an overlay on the scene.

## Initial Scope

### Included

- Square-grid scenes.
- A toggleable **Mapping** tool in the Cartographer menubar.
- One controlled token per actively mapping user.
- A 5×5 reveal centered on the tracked token.
- Previously revealed cells remain mapped.
- A separate map view using the Blacksmith Tool Window API.
- Glass as the initial Tool window theme, while allowing the standard theme selector.
- Pan, zoom, and center-on-party controls.
- Persistent scene-level map state.
- Synchronized map updates for connected users.
- Placeholder tiles that can later be replaced by hand-drawn artwork.
- GM-only map reset controls.

### Deferred

- Hex and gridless scenes.
- Foundry vision, lighting, and wall-based reveal clipping.
- Automatic room, corridor, or terrain classification.
- Tracking more than one token for a single user.
- Multiple floors or scene levels in one map.
- Player annotations and manual map editing.
- Exporting the completed map as an image.

## User Experience

### Player workflow

1. Select or control one owned token.
2. Toggle **Mapping** on in the Cartographer menubar.
3. The Glass map window opens and mapping starts immediately.
4. Move the token normally to add its 5×5 surroundings to the party map.
5. Toggle **Mapping** off to stop mapping and close the map window.

The menubar toggle is the source of truth. Closing the map window also turns the toggle off and stops mapping; minimizing the window leaves mapping active.

### GM workflow

The GM can use the same Mapping toggle with a controlled token. The GM can also clear or reset the shared map through a confirmed action in the map window.

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

- **Center on Party**
- **Zoom In**
- **Zoom Out**
- **Reset View**
- **Mapping status and tracked-token name**
- **Clear Map** — GM only, with confirmation

The Glass effect belongs to the frame. The map surface should remain opaque and use the Blacksmith Tool content-surface variables so the drawing stays legible in Light, Dark, and Glass themes.

## Reveal Rules

The tracked token's occupied grid cell is the center cell. On each grid-cell transition, reveal these offsets:

```text
(-1,-1) ( 0,-1) ( 1,-1)
(-1, 0) ( 0, 0) ( 1, 0)
(-1, 1) ( 0, 1) ( 1, 1)
```

Rules:

- Clip coordinates to scene grid bounds.
- Do nothing when the token moves within its current grid cell.
- Do nothing while the user's Mapping toggle is off.
- Ignore movement on gridless or unsupported scenes and show a clear status message.
- Require exactly one controlled token when Mapping is toggled on; otherwise leave the toggle off and explain what is needed.
- Reveal the starting 5×5 area as soon as Mapping is toggled on.
- Teleporting reveals only the 5×5 area at the destination in the initial version.
- Each active user contributes discoveries from their own controlled token to the shared party map.
- An active GM client is authoritative for validating contributors, calculating discoveries, and persisting the map.

## Data Model

Store shared mapping state in scene flags under the Cartographer module namespace.

Suggested shape:

```js
{
  version: 1,
  gridType: "square",
  explored: ["12,8", "13,8", "14,8"],
  updatedAt: 0,
  updatedBy: "USER_ID"
}
```

Implementation notes:

- Use a `Set` in memory and serialize it as an array.
- Store only discovered cell coordinates; never store the complete scene grid.
- Batch or debounce scene-flag writes during rapid movement.
- Include a schema version so the format can evolve safely.
- Keep pan, zoom, window position, and theme local to each user rather than in shared scene data.
- Keep each user's Mapping toggle and tracked-token session state out of the persistent party-map data.

If map sizes make string coordinates too large, a later migration can use row spans or a compact bitset without changing the window contract.

## Architecture

Add the mapper as an independent Cartographer tool:

```text
scripts/
  manager-mapping.js       movement tracking, reveal rules, persistence
  window-mapping.js        Blacksmith Tool window
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
  - Provide the GM-only reset action.

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
- Add the toggleable Mapping menubar tool.
- Make toggle-on open the window and toggle-off close it.
- Make closing the window turn mapping off.
- Apply Glass and Micro defaults.
- Add a resizable opaque map surface with pan and zoom.
- Render a fixed sample grid with placeholder tiles.

**Exit condition:** The window opens reliably, remembers its presentation, and renders a navigable sample map.

### Phase 2 — Local discovery engine

- Resolve the activating user's single controlled token.
- Start and stop tracking from the menubar toggle.
- Convert token positions to square-grid coordinates.
- Detect cell transitions.
- Accumulate the 5×5 reveal locally.
- Center the window on the tracked token.

**Exit condition:** Moving the token reveals the correct nine-cell neighborhoods without duplicate work.

### Phase 3 — Persistence and synchronization

- Save versioned explored-cell state to scene flags.
- Restore state on canvas reload and scene change.
- Add mapper socket events.
- Enforce GM authority and player-safe payloads.
- Debounce persistence writes.

**Exit condition:** GM and player clients see the same map after movement, reconnect, and reload.

### Phase 4 — Controls and hardening

- Add mapping status, tracked-token name, center, and confirmed reset actions.
- Keep the menubar toggle synchronized with the Tool window lifecycle.
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

### Phase 6 — Optional wall-aware mapping

- Evaluate scene wall segments adjacent to discovered cells on the GM client.
- Add only perceived wall/door edges to the shared mapped state.
- Never derive or transmit undiscovered geometry.

This phase should remain optional until the radius mapper is proven fun and reliable.

## Testing Checklist

- Toggle Mapping on with one controlled token and reveal its starting 5×5 area.
- Toggle Mapping on with zero or multiple controlled tokens and verify it remains off with useful feedback.
- Move one cell horizontally, vertically, and diagonally.
- Confirm only newly discovered cells are added.
- Move rapidly and verify writes are batched without losing cells.
- Teleport the token and verify only the destination neighborhood is revealed.
- Toggle Mapping off and confirm movement reveals nothing.
- Toggle Mapping back on and verify the current neighborhood is revealed.
- Close the Tool window and verify the menubar toggle turns off.
- Minimize the Tool window and verify mapping remains active.
- Move at all four scene edges and corners without out-of-bounds cells.
- Delete the tracked token and verify graceful recovery.
- Reload the world and restore the same map.
- Switch scenes and maintain independent maps.
- Connect as a player and verify synchronized updates.
- Verify players receive no undiscovered geometry.
- Test Light, Dark, and Glass themes with the map window open.
- Test window resizing, minimizing, pan, zoom, and position restoration.

## Estimated Effort

- Window and local proof of concept: 1–2 development days.
- Persistent synchronized MVP: an additional 2–4 days.
- Controls, edge cases, testing, and polish: an additional 2–4 days.
- Hand-drawn art integration: dependent on asset availability, approximately 1–3 development days after the artwork is ready.

A reliable square-grid release is therefore approximately one to two focused development weeks. Wall-aware mapping, hex support, and annotations should be estimated separately after the MVP is tested in actual play.

## MVP Completion Criteria

The first release is complete when a player can control a token, toggle Mapping on from the Cartographer menubar, and build a persistent shared 5×5-per-step party map in a separate Glass Tool window; toggling it off stops mapping, and no undiscovered scene information is exposed.

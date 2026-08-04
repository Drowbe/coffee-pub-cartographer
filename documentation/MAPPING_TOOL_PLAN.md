# Mapping Tool Implementation Plan

## Goal

Create a separate old-school party map that builds itself as a tracked token moves through a gridded scene. Each time the token enters a new grid cell, the mapper permanently reveals the 3×3 area centered on that token.

The map appears in a resizable Blacksmith Tool window rather than as an overlay on the scene.

## Initial Scope

### Included

- Square-grid scenes.
- One GM-selected token per scene.
- A 3×3 reveal centered on the tracked token.
- Previously revealed cells remain mapped.
- A separate map view using the Blacksmith Tool Window API.
- Glass as the initial Tool window theme, while allowing the standard theme selector.
- Pan, zoom, center-on-party, pause, and resume controls.
- Persistent scene-level map state.
- Synchronized map updates for connected users.
- Placeholder tiles that can later be replaced by hand-drawn artwork.
- GM-only reset and tracked-token controls.

### Deferred

- Hex and gridless scenes.
- Foundry vision, lighting, and wall-based reveal clipping.
- Automatic room, corridor, or terrain classification.
- Multiple tracked tokens.
- Multiple floors or scene levels in one map.
- Player annotations and manual map editing.
- Exporting the completed map as an image.

## User Experience

### GM workflow

1. Open the Mapper from the Cartographer secondary bar.
2. Select a token and choose **Track Selected Token**.
3. Start or pause mapping.
4. Move the token normally on the scene.
5. Open the map window at any time to inspect the accumulated party map.
6. Clear or reset the map through a confirmed GM-only action.

### Player workflow

1. Open the Mapper from the Cartographer secondary bar.
2. View the same accumulated party map.
3. Pan, zoom, or center the local view without changing shared map data.

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
- **Pause/Resume Mapping** — GM only
- **Track Selected Token** — GM only
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
- Do nothing while mapping is paused.
- Ignore movement on gridless or unsupported scenes and show a clear status message.
- Reveal the starting 3×3 area as soon as tracking begins.
- Teleporting reveals only the 3×3 area at the destination in the initial version.
- The GM is authoritative for discovery and persistence.

## Data Model

Store shared mapping state in scene flags under the Cartographer module namespace.

Suggested shape:

```js
{
  version: 1,
  enabled: true,
  trackedTokenId: "TOKEN_ID",
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
  - Track the selected token.
  - Detect grid-cell transitions.
  - Calculate newly revealed coordinates.
  - Persist and synchronize authoritative map state.
  - Expose map state to the window.

- `window-mapping.js`
  - Extend the Blacksmith Tool window base.
  - Render the map surface and local navigation controls.
  - React to synchronized discovery updates.
  - Provide GM-only tool actions.

- `manager-sockets.js`
  - Add mapper state/update messages using the existing Cartographer socket pattern.
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

Tracked token, pause state, and map reset belong in the map window because they are scene-specific actions, not global settings.

## Permissions and Safety

- Only a GM may select the tracked token, change shared mapping state, or reset a map.
- Player clients render only the explored coordinate set sent by the GM or read from scene flags.
- Do not send wall, door, light, room, or unexplored-cell data to players.
- Validate scene id, token id, sender, and GM authority on every mapping socket event.
- Confirm destructive reset actions and report what was cleared.

## Implementation Phases

### Phase 1 — Window prototype

- Register and open the Blacksmith Tool window.
- Apply Glass and Micro defaults.
- Add a resizable opaque map surface with pan and zoom.
- Render a fixed sample grid with placeholder tiles.

**Exit condition:** The window opens reliably, remembers its presentation, and renders a navigable sample map.

### Phase 2 — Local discovery engine

- Track a GM-selected token.
- Convert token positions to square-grid coordinates.
- Detect cell transitions.
- Accumulate the 3×3 reveal locally.
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

- Add pause/resume, track-token, center, and confirmed reset actions.
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

- Track a token and reveal its starting 3×3 area.
- Move one cell horizontally, vertically, and diagonally.
- Confirm only newly discovered cells are added.
- Move rapidly and verify writes are batched without losing cells.
- Teleport the token and verify only the destination neighborhood is revealed.
- Pause mapping and confirm movement reveals nothing.
- Resume and verify the current neighborhood is revealed.
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

The first release is complete when a GM can select a token, move it through a square-grid scene, and have a persistent 3×3-per-step party map appear consistently in a separate Glass Tool window for both GM and permitted players—without exposing undiscovered scene information.

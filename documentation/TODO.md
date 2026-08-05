# Coffee Pub Cartographer TODO

## Drawing tools

- [ ] Copy a drawing to the clipboard for use outside Foundry.
- [ ] Save a temporary drawing as a persistent Drawing, using a workflow similar to Notes with pins.

## Mapping tools

- [x] Add an old-school mapping tool that builds a simplified map as the party explores. See [Mapping Tool Implementation Plan](MAPPING_TOOL_PLAN.md).
  - Let a player select a token and open its existing scene map from the Cartographer toolbar, then use the map window's Record button to reveal the 5×5 grid area around that token; Stop ends recording without closing the map.
  - Display the accumulated map in a separate Glass-themed Blacksmith Tool window.
  - Begin with placeholder tiles that can be replaced by hand-drawn artwork.
- [x] Improve mapped-floor, grid, and wall contrast in Dark and Glass themes so the initial reveal is as legible as it is in Light mode.
- [x] Harden very long token moves so routed or unusually large drags cannot skip intermediate mapping samples.
- [x] Prevent floor and wall leakage at closed wall endpoints by requiring a visible footprint within each revealed square instead of trusting one center-point ray.
- [x] Replace the scene-sized mapping grid with an endless canvas that renders only the active drawing bounds plus a three-grid margin, expanding automatically as exploration reaches an edge.
- [x] Add an initial **Place** context menu on explored grid cells with old-school Stairs, Trap, and Treasure symbols.
- [x] Expand **Place** into the full official symbol categories: doors, passages, hazards, structures, terrain, and furnishings.
- [x] Cross-hatch the ground outside the mapped area in the old-school pen-and-ink style.
- [x] Add floor surfaces that apply to a whole contiguous area and carry into squares that later join it.
- [x] Add a follow mode that tracks a token without recording, including on a map the follower does not own.

### Next

- [ ] Organize the Recorded Maps list: filter and sort by player, actor, and scene. The list is flat today and grows one entry per actor per scene.
- [ ] Export a map as an image, to the clipboard and to a PNG file. Screen capture covers this for now. Worth staging: the linework and symbols are already SVG and can be assembled and rasterised nearly as-is, while floor surfaces and the rock hatching are CSS masks and gradients that would each need an SVG `<pattern>` equivalent kept in step with the CSS. Note also that `navigator.clipboard.write()` needs a secure context — a GM on `localhost` can copy, but a player on a LAN IP over plain http cannot, so a PNG download has to be offered alongside it.
- [ ] Distinguish one-way doors. Detection is trivial (`Wall#dir`), but the official glyph is a directional arrow and Foundry stores direction as LEFT/RIGHT relative to the wall's own vector rather than as a compass bearing. That has to be mapped through edge snapping first, or the arrow points the wrong way half the time.
- [ ] Expand the remaining official key symbols that have no Foundry equivalent and must be author-placed: false door, trapped door, revolving door, portcullis, gate, arrow slit, illusory wall.

### Deferred, with reasons

- [ ] **Cave and natural geometry.** Snapping to grid edges assumes walls mostly lie along grid lines, with diagonals as the exception worth patching. A cave inverts that, and no amount of stair-step tuning fixes it — see the tracing discussion in the plan. Wants free-form stroke storage, which is a record-format change.
- [ ] **Outdoor terrain** (slopes, contours, water bodies). Foundry has no canonical "this is a hill", so it cannot be detected; it has to be author-placed like symbols. Grid-friendly area fills work, contour lines do not.
- [ ] **Player map cleanup.** An erase-and-remap tool was considered and set aside: it would mask generation defects rather than fix them, and it hides exactly the cases needed to improve generation. If it returns, note that erasing must also prune the feature *sources*, or the next reveal flattens the old source back over the erased square. See the plan's note on manual edits as an override layer.
- [ ] Phase 2: reuse the mapping renderer and symbol vocabulary to draw ad-hoc old-school maps directly on the Foundry canvas.

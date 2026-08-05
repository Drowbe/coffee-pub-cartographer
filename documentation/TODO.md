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

- [ ] **Official maps.** Let a GM copy a map into a GM-owned artifact that can be hidden or revealed, for "you find a map" moments. Notes for whoever picks this up:
  - It is the first thing that genuinely breaks the `actorId::sceneId` key, since an official map belongs to no Actor. Bundle it with the v3 record work rather than wedging in a sentinel Actor id, which would also cap it at one official map per scene.
  - An official map is a **snapshot, not a live record**: nothing records into it, so it needs no `featureSources` and no `lastPosition`. That makes it a simpler shape than a live map, which argues for a distinct kind rather than a flag on the existing one.
  - **Hiding is not secrecy.** Scene flags are readable by any connected client, so a `hidden` flag only hides it in the UI — a curious player can still read the contents. If a found map must stay genuinely unknown until revealed, it has to live somewhere players cannot read (a GM-only Journal, or held by the GM and broadcast on reveal). Same principle as never sending undiscovered geometry.
  - Follow mode already works on a map the follower does not own, so an official map becomes navigable the moment it exists — no extra work for the "GPS on the map you found" case.
  - Editing is unproblematic *here*, unlike on live maps: a snapshot is never re-observed, so trimming or falsifying one cannot be undone by walking past. Partial and deliberately inaccurate maps are half the point, so this is likely where map editing belongs.
- [ ] **Maps as Items.** Carry a map snapshot on a Foundry Item, so acquiring the item adds the map to the party's list. Worth doing *with* official maps rather than after, because it resolves their hardest problem: an Item in a GM-only folder is genuinely unreadable by players, and moving it into a character's inventory is what grants access. **The Item becomes the access control**, which is both more secure than a `hidden` flag and better fiction — the party gets the map by looting it, not by the GM flipping a switch. It also gives maps a natural place to be lost, stolen, sold, or handed to an NPC.

### Ad-hoc map making

The mapper is a recorder today: it turns a scene the GM already built into a
drawing. The larger opportunity runs the other way — authoring the map first and
producing the scene from it. Treat this as a headline capability rather than a
Phase 2 footnote.

- [ ] **Author a map by hand.** Let a GM draw walls, doors and windows straight onto the map grid, alongside the symbols and floor surfaces that already exist. The window is most of an editor already: a grid, a context menu, symbols, floors, and hatching. What it lacks is a way to toggle a boundary on a square's edge.
- [ ] **Generate Foundry walls from a map.** This is far more tractable than it looks, and it is the payoff from storing boundaries canonically: a record is already a set of lattice edges (`h:c:r`, `v:c:r`), each of which maps to exact scene pixel coordinates. Emitting a Wall document per edge is close to mechanical, with door, window and secret-door records carrying the wall configuration Foundry needs.
- [ ] **Build a Scene from a map.** The walls above plus scene dimensions, grid size, and a background. The walls are the interesting part and they are the part already solved.
- [ ] **Convert an existing scene's walls into a map**, skipping exploration entirely. Technically easy — run the same observation over every square with the visibility test disabled. But it deliberately breaks the rule that the map only holds what a token experienced, so it must be a **GM authoring action that produces an official map**, never something that writes a party map. Useful for seeding an official map of a dungeon the party is about to find a plan of.
- [ ] **Templates.** Reusable pieces a GM can stamp down — a 20×20 chamber, a T-junction, a spiral stair well, a guard post — and whole starter layouts. A template is just a record fragment (explored squares, boundaries, symbols, floors) offset to where it is placed, so it needs no new storage concept: the same shape the record already has, saved and re-applied. Rotation and mirroring fall out of transforming the coordinates.
- [ ] **Random generation.** Generate a layout — rooms, corridors, doors, stairs — directly into a map. Because generation writes the abstract record rather than Foundry geometry, a generator only has to emit explored squares and boundaries; walls, doors and a playable Scene then come out of the generator above for free. Worth supporting seeds so a layout can be regenerated or shared, and worth letting a generator consume the templates above as its vocabulary rather than inventing shapes from nothing.

### Deferred, with reasons

- [ ] **Cave and natural geometry.** Snapping to grid edges assumes walls mostly lie along grid lines, with diagonals as the exception worth patching. A cave inverts that, and no amount of stair-step tuning fixes it — see the tracing discussion in the plan. Wants free-form stroke storage, which is a record-format change.
- [ ] **Outdoor terrain** (slopes, contours, water bodies). Foundry has no canonical "this is a hill", so it cannot be detected; it has to be author-placed like symbols. Grid-friendly area fills work, contour lines do not.
- [ ] **Player map cleanup.** An erase-and-remap tool was considered and set aside: it would mask generation defects rather than fix them, and it hides exactly the cases needed to improve generation. If it returns, note that erasing must also prune the feature *sources*, or the next reveal flattens the old source back over the erased square. See the plan's note on manual edits as an override layer.
- [ ] Phase 2: reuse the mapping renderer and symbol vocabulary to draw ad-hoc old-school maps directly on the Foundry canvas.

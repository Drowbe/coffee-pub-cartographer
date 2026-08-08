# Coffee Pub Cartographer TODO

## Drawing tools

- [ ] Copy a drawing to the clipboard for use outside Foundry.
- [ ] Save a temporary drawing as a persistent Drawing, using a workflow similar to Notes with pins.

## Mapping tools

### Known gaps

- [ ] **Angled walls can leave a square on the wrong side.** A wall set at an angle has its endpoints pulled onto grid intersections, which can move it by up to two thirds of a square. A square the party explored can end up beyond where the wall now lies, and nothing cuts it back, so its floor spills past. Curves do not have this problem (they are not snapped) and neither do square walls (they sit on square edges), so it is diagonals only. Fixing it means reconciling what the party explored against the *normalized* geometry rather than against Foundry's raw walls.
- [ ] **Fill ground the party has walked all the way round.** Moving room to room leaves gaps — a square behind furniture, a corner the sightlines skipped — that are plainly floor because the map has them surrounded. A version of this was built and reverted: it over-filled badly on a real dungeon, and could not be reproduced across four synthetic layouts (separate rooms, a cascading walk, inner-face-only tracing, and diagonal walls, which were checked and do seal). Do not re-land it without a case that reproduces. The **Fix Things** menu covers the same ground by hand in the meantime, and pointing at one square that filled wrongly is what would crack it.
- [ ] Clicking the party marker opens the square's menu, since the marker sits inside its square. Harmless, and a one-line exclusion if it becomes annoying in play.

### Next

- [ ] Search the Recorded Maps list by name. It is now read three ways -- by scene, by character, or just the reader's own -- which handles a campaign's worth of maps, but there is still no way to find one by typing part of its name.
- [ ] Export a map as an image, to the clipboard and to a PNG file. Screen capture covers this for now. Worth staging: the linework and symbols are already SVG and can be assembled and rasterised nearly as-is, while floor surfaces and the rock hatching are CSS masks and gradients that would each need an SVG `<pattern>` equivalent kept in step with the CSS. Note also that `navigator.clipboard.write()` needs a secure context — a GM on `localhost` can copy, but a player on a LAN IP over plain http cannot, so a PNG download has to be offered alongside it.
- [ ] Distinguish one-way doors. Detection is trivial (`Wall#dir`), but the official glyph is a directional arrow and Foundry stores direction as LEFT/RIGHT relative to the wall's own vector rather than as a compass bearing. That has to be mapped through the atlas's edge snapping first, or the arrow points the wrong way half the time.
- [ ] Expand the remaining official key symbols that have no Foundry equivalent and must be author-placed: false door, trapped door, revolving door, portcullis, gate, arrow slit, illusory wall.

- [ ] **Official maps.** Let a GM copy a map into a GM-owned artifact that can be hidden or revealed, for "you find a map" moments. Notes for whoever picks this up:
  - It is the first thing that genuinely breaks the `actorId::sceneId` key, since an official map belongs to no Actor. Bundle it with that key change rather than wedging in a sentinel Actor id, which would also cap it at one official map per scene.
  - An official map is a **snapshot, not a live record**: nothing records into it, so it needs no `sides`, no `hidden` and no `lastPosition`. That makes it a simpler shape than a live map, which argues for a distinct kind rather than a flag on the existing one.
  - It also cannot lean on the scene atlas the way a live map does. A live map draws its architecture from the scene's current walls; a snapshot has to carry its own, or it will silently follow the scene as the GM edits it — and change under a party who were told the map was old.
  - **Hiding is not secrecy.** Scene flags are readable by any connected client, so a `hidden` flag only hides it in the UI — a curious player can still read the contents. If a found map must stay genuinely unknown until revealed, it has to live somewhere players cannot read (a GM-only Journal, or held by the GM and broadcast on reveal).
  - Follow mode already works on a map the follower does not own, so an official map becomes navigable the moment it exists — no extra work for the "GPS on the map you found" case.
  - Editing is unproblematic *here*, unlike on live maps: a snapshot is never re-observed, so trimming or falsifying one cannot be undone by walking past. Partial and deliberately inaccurate maps are half the point, so this is likely where full map editing belongs.
- [ ] **Maps as Items.** Carry a map snapshot on a Foundry Item, so acquiring the item adds the map to the party's list. Worth doing *with* official maps rather than after, because it resolves their hardest problem: an Item in a GM-only folder is genuinely unreadable by players, and moving it into a character's inventory is what grants access. **The Item becomes the access control**, which is both more secure than a `hidden` flag and better fiction — the party gets the map by looting it, not by the GM flipping a switch. It also gives maps a natural place to be lost, stolen, sold, or handed to an NPC.

### Ad-hoc map making

The mapper is a recorder today: it turns a scene the GM already built into a
drawing. The larger opportunity runs the other way — authoring the map first and
producing the scene from it. Treat this as a headline capability rather than a
Phase 2 footnote.

- [ ] **Author a map by hand.** Let a GM draw walls, doors and windows straight onto the map grid, alongside the symbols and floor surfaces that already exist. The window is most of an editor already: a grid, a menu, symbols, floors, hatching, and — since **Fix Things** — a way to say a square is or is not floor. What it lacks is a way to toggle a boundary on a square's edge.
- [ ] **Generate Foundry walls from a map.** The atlas already proves the shape of this in reverse: it turns Wall documents into lattice edges (`h:c:r`, `v:c:r`) and true lines, each of which maps back to exact scene pixel coordinates. Emitting a Wall document per edge is close to mechanical, with door, window and secret-door records carrying the wall configuration Foundry needs. The one piece that does not exist yet is a map that *holds* boundaries of its own — a recorded map holds only where the party has been, and reads its architecture from the scene. Authoring above is what would produce them.
- [ ] **Build a Scene from a map.** The walls above plus scene dimensions, grid size, and a background. The walls are the interesting part and they are the part already half-solved.
- [ ] **Convert an existing scene's walls into a map**, skipping exploration entirely. Now nearly free: the atlas already settles the whole scene's architecture in one pass, so this is that atlas with every square marked explored. But it deliberately breaks the rule that the map only holds what a token experienced, so it must be a **GM authoring action that produces an official map**, never something that writes a party map. Useful for seeding an official map of a dungeon the party is about to find a plan of.
- [ ] **Templates.** Reusable pieces a GM can stamp down — a 20×20 chamber, a T-junction, a spiral stair well, a guard post — and whole starter layouts. A template is a record fragment (explored squares, boundaries, symbols, floors) offset to where it is placed, so it needs no new storage concept beyond the authored boundaries above. Rotation and mirroring fall out of transforming the coordinates.
- [ ] **Random generation.** Generate a layout — rooms, corridors, doors, stairs — directly into a map. Because generation writes the abstract record rather than Foundry geometry, a generator only has to emit squares and boundaries; walls, doors and a playable Scene then come out of the generator above for free. Worth supporting seeds so a layout can be regenerated or shared, and worth letting a generator consume the templates above as its vocabulary rather than inventing shapes from nothing.

### Deferred, with reasons

- [ ] **Caves and natural geometry.** No longer blocked on the record format: curves are first-class now, kept as true geometry and redrawn smoothly rather than snapped, and the rules that produce them are gated so they cannot reach a square room. What is untested is scale — a cave is nearly all curve, with far more vertices and far less coherent turning than a corridor arc. Point it at a cave scene and expect to tune `CURVE_MIN_BOW` and `CURVE_MAX_CHORD`. `CURVE_MIN_BOW` is the dangerous one: lowering it lets rectilinear traces slip onto the curve path, so it wants a rectilinear regression run alongside.
- [ ] **Outdoor terrain** (slopes, contours, water bodies). Foundry has no canonical "this is a hill", so it cannot be detected; it has to be author-placed like symbols. Grid-friendly area fills work, contour lines do not.
- [ ] Phase 2: reuse the mapping renderer and symbol vocabulary to draw ad-hoc old-school maps directly on the Foundry canvas.

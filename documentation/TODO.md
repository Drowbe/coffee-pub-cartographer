# TODO

**Master list of what we will do.** An entry is a title, enough to know what the work is and why it
matters, the file or setting it touches, and how it will be verified. If an entry needs more than
that, the extra is design and belongs in a plan -- link the plan and keep the entry short.

Defects we have shipped and not fixed are not here; they are in `known-issues.md`.

## Documentation

**Walk all eight user guides in a running world.** They were written from source: labels are quoted
from `lang/en.json` and permission claims are traced to the checks that enforce them, but nothing in
them has been done at a table. Source cannot tell you the two things a reader navigates by -- what
order controls appear in, and what a player sees as opposed to a GM.

Specifically unverified, roughly in the order they would be hit:

- The caption on the Cartographer scene-control button, and what the drawing toolbar's controls are
  actually called on screen. The five shapes are named from source constants, not from labels.
- The default hotkey, and whether hold and toggle behave as described.
- The order and wording of the three mode buttons on the map window, and whether Record relabels
  itself while recording.
- What the mapping menubar button's right-click menu offers.
- Every claim in `userguide-player.md`, which was read off permission checks rather than observed
  from a player's client. This is the guide most likely to be wrong and the one a player will read.
- Whether the toolbar controls listed in `userguide-settings.md` as "not in the settings window" are
  all present and named as described.
- Whether an official map on a scene with no sealed rooms really does report that it found nothing,
  and what it says.

Add screenshots once walked, and re-read every label against them. No screenshot beats a wrong one,
so publishing none until then is correct.

**Re-verify `tools/check-docs-structure.mjs` once Blacksmith commits it.** Four of the five publisher
files match the hub's HEAD; this one matches the hub's working tree only, because the hub has not
committed it. Compare all three -- our staged blob, the hub's working tree, and the hub's HEAD --
rather than only against HEAD: with one comparison, "the hub has not committed yet" and "our copy is
stale" are indistinguishable. Verified when it matches the hub on both worktree and HEAD.

**Write an architecture document for the mapping tool.** The only one that exists covers the drawing
tool, and mapping is now the larger half of the module by code and by guide count. The structure
checker reports the imbalance as "user guides: 8 against 1 architecture document(s)" -- read as a
prompt about the small number, which here is the architecture. What is worth writing down and lives
nowhere else: how the scene atlas is settled once and treated as a mask, why the side a square's
floor was seen from is recorded at reveal and never recomputed, how the floor surfaces are drawn as
one clipped layer per material rather than per square, and the additive-merge rules that donation and
live contribution both rest on. Much of it is currently in `plans/plan-map-kinds.md` and
`plans/plan-mapping-tool.md`, which are scaffolding and are supposed to be dismantled into exactly
this.

## Drawing tools

**Copy a drawing to the clipboard** for use outside Foundry. Verify by drawing, copying, and pasting
into an image editor.

**Save a temporary drawing as a persistent Drawing**, using a workflow similar to Notes with pins.
Verify that the saved drawing survives a scene change and a reload, where a temporary one does not.

**Decide the drawing feature set.** An April wishlist lived in two overlapping lists inside the
drawing architecture document and was removed from it when that document was brought under the
documentation standard, which does not allow work to live in architecture. The ideas, deduplicated:
undo and redo within a session, grid snapping, restricting drawing to particular layers, exporting a
session's drawing history, reusable templates or stamps, a collaborative mode, locking an area
against drawing, and measurement tools such as a ruler. None has an owner or a decision behind it.
Pick the ones worth doing and give each its own entry; drop the rest.

## Mapping tools

**Fill ground the party has walked all the way round.** Moving room to room leaves gaps -- a square
behind furniture, a corner the sightlines skipped -- that are plainly floor because the map has them
surrounded. A version of this was built and reverted: it over-filled badly on a real dungeon, and
could not be reproduced across four synthetic layouts (separate rooms, a cascading walk,
inner-face-only tracing, and diagonal walls, which were checked and do seal). Do not re-land it
without a case that reproduces. The Fix Things menu covers the same ground by hand in the meantime,
and pointing at one square that filled wrongly is what would crack it.

**Map Foundry region lines, not only walls.** Outdoor maps use topographic-style region lines: they
may or may not block vision, but they still need to be on the map. Walls are the wrong source --
they snap to the grid; these should stay curved and free of the grid, the same way cave curves
already do. The deferred outdoor-terrain item below said contour lines cannot be detected because
Foundry had no canonical hill; regions are a real document now, so this is the way in. Do not fold
them into the wall-snap path. Raised in the play session of 2026-08-27.

**Search the Recorded Maps list by name.** The list is read three ways -- by scene, by character, or
just the reader's own -- which handles a campaign's worth of maps, but there is still no way to find
one by typing part of its name.

**Export a map as an image**, to the clipboard and to a PNG file. Screen capture covers this for now.
Worth staging: the linework and symbols are already SVG and can be assembled and rasterised nearly
as-is, while floor surfaces and the rock hatching are CSS masks and gradients that would each need an
SVG `pattern` equivalent kept in step with the CSS. Note also that `navigator.clipboard.write()`
needs a secure context -- a GM on `localhost` can copy, but a player on a LAN IP over plain http
cannot, so a PNG download has to be offered alongside it.

**Maps as Items.** Carry a map snapshot on a Foundry Item, so acquiring the item adds the map to the
party's list. It gives a found map a natural place to be lost, stolen, sold, or handed to an NPC, and
an Item in a GM-only folder is genuinely unreadable by players where the current hidden flag only
hides an official map in the interface. Design and open decisions are in
[plan-map-kinds.md](plans/plan-map-kinds.md), steps 6 and 7.

**Distinguish one-way doors.** Detection is trivial (`Wall#dir`), but the official glyph is a
directional arrow and Foundry stores direction as LEFT/RIGHT relative to the wall's own vector rather
than as a compass bearing. That has to be mapped through the atlas's edge snapping first, or the
arrow points the wrong way half the time.

**Expand the remaining official key symbols** that have no Foundry equivalent and must be
author-placed: false door, trapped door, revolving door, portcullis, gate, arrow slit, illusory wall.

## Ad-hoc map making

The mapper is a recorder today: it turns a scene the GM already built into a drawing. The larger
opportunity runs the other way -- authoring the map first and producing the scene from it. Treat this
as a headline capability rather than a Phase 2 footnote.

**Author a map by hand.** Let a GM draw walls, doors and windows straight onto the map grid,
alongside the symbols and floor surfaces that already exist. The window is most of an editor already:
a grid, a menu, symbols, floors, hatching, and -- since Fix Things -- a way to say a square is or is
not floor. What it lacks is a way to toggle a boundary on a square's edge.

**Generate Foundry walls from a map.** The atlas already proves the shape of this in reverse: it
turns Wall documents into lattice edges (`h:c:r`, `v:c:r`) and true lines, each of which maps back to
exact scene pixel coordinates. Emitting a Wall document per edge is close to mechanical, with door,
window and secret-door records carrying the wall configuration Foundry needs. The one piece that does
not exist yet is a map that holds boundaries of its own -- a recorded map holds only where the party
has been, and reads its architecture from the scene. Authoring above is what would produce them.

**Build a Scene from a map.** The walls above plus scene dimensions, grid size, and a background. The
walls are the interesting part and they are the part already half-solved.

**Templates.** Reusable pieces a GM can stamp down -- a 20x20 chamber, a T-junction, a spiral stair
well, a guard post -- and whole starter layouts. A template is a record fragment (explored squares,
boundaries, symbols, floors) offset to where it is placed, so it needs no new storage concept beyond
the authored boundaries above. Rotation and mirroring fall out of transforming the coordinates.

**Random generation.** Generate a layout -- rooms, corridors, doors, stairs -- directly into a map.
Because generation writes the abstract record rather than Foundry geometry, a generator only has to
emit squares and boundaries; walls, doors and a playable Scene then come out of the generator above
for free. Worth supporting seeds so a layout can be regenerated or shared, and worth letting a
generator consume the templates above as its vocabulary rather than inventing shapes from nothing.

## Deferred, with reasons

**Caves and natural geometry.** No longer blocked on the record format: curves are first-class now,
kept as true geometry and redrawn smoothly rather than snapped, and the rules that produce them are
gated so they cannot reach a square room. What is untested is scale -- a cave is nearly all curve,
with far more vertices and far less coherent turning than a corridor arc. Point it at a cave scene
and expect to tune `CURVE_MIN_BOW` and `CURVE_MAX_CHORD`. `CURVE_MIN_BOW` is the dangerous one:
lowering it lets rectilinear traces slip onto the curve path, so it wants a rectilinear regression
run alongside.

**Outdoor terrain** (slopes, contours, water bodies). Foundry has no canonical "this is a hill", so
it cannot be detected; it has to be author-placed like symbols. Grid-friendly area fills work,
contour lines do not.

**Phase 2:** reuse the mapping renderer and symbol vocabulary to draw ad-hoc old-school maps directly
on the Foundry canvas.

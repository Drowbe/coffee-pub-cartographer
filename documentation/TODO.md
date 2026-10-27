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

## Walls, doors and windows

**Walk the walls tool in a running world.** Everything about it was built and checked without Foundry
running, apart from the first stages, which were walked on the author's own map. Not yet seen: the
window opening, moving and remembering its place; a door fitted into the gap between two wall ends,
including the second door that first chose a wrong end; a window written with Proximity and a
two-square threshold and accepted by Foundry; door sound and animation values accepted; Join nearest
endpoints, Ctrl-click to cut a wall, Clean up and Undo clean up; and a scene with several levels. Touches
`scripts/manager-autowall.js`, `scripts/window-autowall.js`. Verified when each has been done on a
real scene and the console shows nothing but the tool's own `auto-wall` lines.

**Walk the joined-walls behaviour in a running world.** The hooks that move a joint and join a dropped
end are tested against a stand-in scene that fires `preUpdateWall`, `updateWall` and `preCreateWall`
as Foundry does, but not in Foundry. Unconfirmed: that the hooks run in that order for a drag on a
single wall; that a wall dragged by one end arrives as a change to only that end; that Shift is seen
as `ShiftLeft` or `ShiftRight` in `game.keyboard.downKeys`; and that undo with Ctrl+Z puts the joint
back. Touches `scripts/manager-walljoin.js`. Verified by dragging a joint, a loose end and a new wall
on a real scene, and undoing each.

**Walk walls on tiles, the Draw tab and the Walls-controls button in a running world.** All three are
checked in node against stand-ins. Tiles rest on an assumption read from Foundry's source and not yet
seen: that a tile's picture sits on `tile.mesh` as a sprite does, anchored, then carried by the mesh's
world transform, with `texture.orig` as its size. Unconfirmed on a tile with a fit other than fill, one
turned, one flipped, and one whose picture has transparent edges. The button needs `getSceneControlButtons`
to hand over `controls.walls.tools`, and to show it for the GM only. Drawing needs the canvas events to
reach the tool in the capture phase ahead of Foundry's, as Ctrl-click does. Touches
`scripts/manager-autowall.js`, `scripts/window-autowall.js`. Verified by a wall found on a turned tile, a
chain begun on an existing end, a sketch, and the button, on a real scene.

**Find out why a found wall sometimes shows nothing with Snap to grid corners on.** One run found the
tower's arc, drew the cyan area, and reported nothing to add, with snapping on; the same click traced
one segment on the author's screenshot in node. The message now says the wall was lost to snapping or
to being too short, and the console records how many segments the tracer produced against how many
survived snapping, but the cause is not established. Verified when the console line from a failing
click explains it.

**Give curved walls a way to follow the curve.** A round tower is traced as straight chords whose
length follows the Smoothing setting, so a circle takes lower Smoothing and several clicks. A circle
fit, replacing a run of chords with an arc of equal steps, would give a tower in one click. Verified on
a painted ring of two or three radii.

**Handle a thick solid wall.** A wall drawn as a block rather than a line is refused as too wide,
because its centreline is meaningless. Mapping the block's outline, as two walls along its faces, is
the useful result, and is where an AI assist, which the module's API already has, would earn its
place. Verified on a painted map with a keep's walls.

**Secret doors and other door types.** Left out on purpose; a door is a normal door. The panel would
need a door type choice, and the written data a door type to match, with Foundry's own preset as the
guide. Verified by the openings test for the new type.

**Check version 13.** The data written reads `CONST.EDGE_SENSE_TYPES` with the older name as a
fallback and sets levels only where a scene has several, but version 13's schema was not available to
check against, so neither is confirmed. Verified by creating a wall, a door and a window on 13.

**Decide whether to keep the thumbnail and the console logging.** The small picture in the window and
the `auto-wall` console lines were added to find why clicks landed in the wrong place. The picture is
useful when a result looks wrong; the logs are noisy. Keep, hide behind a setting, or remove.

## Foundry v14

**Settle whether `canvas.drawings.controls` ever existed** (`scripts/manager-drawing.js`, around
1180 and 1230). It is absent on v14, so the two guarded blocks that set `visible` and `active` on it
are inert there. Whether v13 had it, and therefore whether those blocks ever suppressed anything, is
unknown -- there is no v13 install on this machine to check, and grepping the local `foundry.mjs`
answers for v14 only. They are kept because v13 is still supported and a guarded no-op is cheaper
than a silent behaviour change on a version nobody can test. Settle it against a v13 client or
Foundry's changelog, then either delete both blocks or replace them with whatever v14 calls the same
thing. Verified when sketch mode is activated on both versions with Foundry's Drawings layer active
and neither leaves Foundry's controls on screen.

## Drawing tools

**Copy a drawing to the clipboard** for use outside Foundry. Verify by drawing, copying, and pasting
into an image editor.

**Walk the drawing tools window in a running world.** It was built and tested against stand-ins for
Foundry, so nothing in it has been seen on a map. Specifically unverified: that Foundry accepts the
polygon Drawings written for a kept stamp and for the line under a wall stroke (a hand-written
schema, read from Foundry's own source, not exercised); that a wall drawn by Wall mode joins to
nearby walls through the existing join hook and that Undo takes back the walls and the line
together; how each stamp and path looks at Small, Medium and Large and at each width on a 100 px grid, and whether the
scale in `scripts/utils-stamps.js` suits it; that the preview shows exactly what lands; that a drag
scatters at a sensible spacing; that the window follows the bar and the bar the window; that
Start and Stop and closing the window leave the draw hotkey working; and what a player sees -- no
Wall tool, and Keep on the scene off unless the world lets them create Drawings. Also the eraser (that it
finds the right thing, and that Undo restores walls and Drawings with their ids), and that the scene's
vision, global illumination and darkness controls change the scene on v14. Verify by doing each
as a GM and as a player.

**Save a temporary drawing as a persistent Drawing**, using a workflow similar to Notes with pins.
Stamps and walls can now be kept as they are made; sketches, lines, boxes and ellipses cannot yet.
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

## Scene motion

**Walk scene motion in a running world.** Built and tested in node, but most of it has never been
seen in Foundry. In rough order of risk: tile rotation, scrolling and fades; the Scene Motion
sub-menubar buttons, including their lit state and the look menu opening on both left and right
click; applying a collection; dragging layers and dropping them on the Tokens line; copy, export and
import; and both confirmation prompts. Verified when each works on a GM client and a second, player
client sees the same motion in step.

**Check video layers and tiles.** Untested: whether a video plays and loops as a layer, as a
scrolling tile, and as a spinning one. Videos keep Foundry's own texture, so they can show the repeat
seam the still-image copy removes; if it shows, the fix is a render texture refreshed each frame.
Verified with a looping WebM as each of the three.

**Check scene motion on Foundry v13.** The module claims 13 as its minimum, and nothing here has run
on it. The parts most likely to differ are tile documents without `shape` and anchors (handled by a
fallback to the tile's middle) and the primary group's sort layers. Verified on a v13 client.

**Reduce motion, per player.** A client setting that freezes scene motion and skips fades on that
player's screen only, for anyone who finds scrolling scenery uncomfortable. The shared clock makes it
simple: the setting draws everything at its rest position. Verified by a player enabling it while the
GM's scene keeps moving for everyone else.

**A macro pack.** A compendium of ready-made macros -- Play/Stop layers, Play/Stop tiles, next and
previous collection, speed up, slow down -- to drag onto the hotbar. Everything they need is on the
module's API already. Verified by importing the pack and running each.

**Sound tied to Play/Stop.** Let a mode name an ambient sound -- wagon creaks, wind, rigging -- that
fades in on Play and out on Stop with the motion's ease. Verified by the sound following Play and Stop
on a second client.

## Routes

**Walk routes in a running world.** Drawing (click, double-click, Enter, Backspace, Escape, and
that a click on a token does not select it), editing (drag, double-click to add, right-click to
remove -- and that right-drag still pans elsewhere), a player drawing and deleting their own route
through the GM, a hidden route from a player's side, and measuring on a hex map, where the step is
read from Foundry's grid and has only been checked against a stand-in. The first two rounds were
walked by the GM on a square map and worked.

**Next: a token travelling a route or journey.** A token on the map that moves along it as the
odometer counts, using the same shared clock, speed and ease as the scenery -- so the map scene
and the animated scene are two views of one journey ("on the map" and "zoomed in on the road").
The geometry is done: `routesManager.pointAt(id, distance)` gives the point and heading.
Done: progress lives on the journey, on the map scene, as effort; the animated scene is a view that
drives it; terrain slows the party and the scenery. The marker is built: one Blacksmith pin per map, moved with
`pins.setLivePosition` (its `draggable` option lets the GM pick it up mid-trip; no heading in v1),
which shipped in Blacksmith 14.4.1 -- Cartographer's minimum Blacksmith version. **When Cartographer
adopts Blacksmith's shared Tool window controls** (`blacksmith-tool-*`, unreleased), raise the minimum
again to the Blacksmith release that ships them. Controls from the map are built (Play/Stop, speed, pace, reset per journey,
and the sub-menubar's Play), driving following animated scenes through `commitScene`. Not yet: a
journey driven only from the map does not follow the world clock (an animated scene that follows
the clock carries that to its journey); worth adding as a switch on the journey.

**Exhaustion on the road.** As the party travels, they -- or their mounts and draft animals --
tire. Track hours travelled per in-world day (the odometer and world clock already give both),
and past a day's travel (8 hours in D&D) warn the GM: in D&D 5e, a forced march's Constitution
saves and exhaustion levels, and a mount's gallop lasting about an hour. Decided for phase 1,
which is roleplay support:

- **Warn the GM only.** Cartographer never changes an actor. The GM applies exhaustion by hand,
  as the system's condition, and removes it the same way.
- **The party is the system's own** -- in D&D 5e, the primary party group (the `dnd5e`
  `primaryParty` setting) -- so the warning can name who is affected. Mounts and beasts are
  roleplay: mentioned in the warning (a gallop past its hour), not tracked as actors.
- **Pace and terrain set how fast fatigue builds** -- that is the core of it. A fast pace or
  difficult terrain brings the warning sooner.
- **Hours on the road come from the timeline.** A path that follows the clock keeps every change of
  pace and every stop against the world time (`travel.timeline`), so the hours travelled on any
  in-world day can be read off it exactly, scrubbing included.
- **Nothing resets it automatically.** Rest is roleplay; the GM clears exhaustion as the condition
  it is. What Cartographer counts (hours on the road today) starts again with each in-world day.

**Moments on a route.** Let the GM mark points along a route -- an **encounter** (an ambush at the
ford) or a **narrative** beat (the first sight of the city walls, a shrine by the road) -- that the trip
reaches as the party travels. Open questions: whether reaching one pauses the trip (likely an option
per moment, as Pause on arrival is), what the GM is told (a toast, a chat card for the GM, a journal
page to open), whether players see them on the map, and how they sit on a journey (on its routes, so
they travel with the route into every journey that uses it). The geometry is there: a moment is a
distance along a route, and `routesManager.pointAt` gives its place.

**A double-click on a route over a token** edits the route rather than opening the token's sheet,
for anyone who may change that route. Fine on a map, where tokens rarely sit on roads; worth
watching.

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

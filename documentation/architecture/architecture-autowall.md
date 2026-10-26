# Cartographer Walls, Doors and Windows

**Audience:** someone changing how Cartographer turns a painted battlemap into Foundry walls, doors
and windows.

How a click on the scene image becomes walls, why the picture work is kept apart from Foundry, how
doors and windows are found, and what the tool writes. The guide for GMs is
[Walls, doors and windows](../userguides/userguide-walls.md).

## Shape

The work is in three layers, each in its own file, and the dependency runs one way.

- `scripts/utils-autowall.js` is pixels in, geometry out. It imports nothing from Foundry and does
  not touch a document, a canvas or a window, so every function in it runs under node. It is where
  the hard part is.
- `scripts/manager-autowall.js` is the Foundry side. It reads the scene image, turns a click into an
  image pixel and the result back into scene pixels, draws the preview, and writes and takes back
  walls. It holds the state of a run.
- `scripts/window-autowall.js` is the window. It is a Blacksmith tool window and holds no state: it
  builds its HTML from the manager's session on each render and hands every click and change back
  to the manager. It is made from Blacksmith's own tool-window components and carries no look of its
  own for them: the underline tabs (`blacksmith-tool-tabs`), at the top of the body with no bar above
  them; a segmented control for the mode, since the mode changes what a click does; sections for the
  groups of settings; the range slider and the toggle switch; tool buttons; and the footer's
  secondary and primary buttons for Cancel and Add. Only what no shared component covers is in
  `styles/tool-autowall.css`: the status line, the small picture, and a row of label, control and
  value. Blacksmith's range slider colours its value readout for a dark window with no Tool-window
  override, so the slider's track and thumb are used and the readout is the window's own.

Keeping the first apart is what makes the work testable. The tracer is run on pictures painted in
code, with grain, ragged edges and shadows; the manager's scene-changing methods are sliced out of
the source and run against a stand-in scene.

## Tracing a wall

A click gives a seed pixel. The steps, each one function in `utils-autowall.js`:

1. **Flood.** Pixels connected to the seed whose colour is near the seed's, compared in CIE Lab so
   that near means near to the eye, with lightness counting for half what colour does so that light
   and shadow across a wall do not stop it. A pixel must also be close to the pixel it was reached
   from, so a shadow that fades in across a wall passes while a hard edge between wall and floor
   does not. The seed colour is the mean of a small patch, not one pixel.
2. **Tidy.** The mask is closed to fill the pinholes that texture leaves, since a hole is a loop in
   the centreline.
3. **Refuse a blob.** A wall is thin. If any part of the mask survives erosion by half the widest
   wall allowed, the flood has got out into a room, and the result says so and draws nothing.
   This is the guard that matters, because a click on a wall the colour of the floor is the
   commonest failure.
4. **Thin.** Zhang-Suen thinning reduces the mask to a one-pixel centreline.
5. **Trace.** The centreline is walked into polylines between ends and junctions. Free ends shorter
   than a length derived from the Smoothing setting are stubs the thinning grew off a rough edge,
   and are dropped.
6. **Join and straighten.** Paths that a staircase step cut in two are joined where exactly two
   meet. The curl the thinning leaves at a free end, which tilts the whole line, is cut off and the
   line carried on straight.
7. **Simplify.** Douglas-Peucker, to a tolerance that is never less than 0.6 of the wall's own
   thickness, measured as its area over the length of its centreline. A painted wall's edge is
   chipped, and the centreline follows every chip; nothing finer than the thickness is worth a point.
8. **Weld, merge, snap.** Ends within a weld distance of each other become one point, two segments
   meeting on a nearly straight line become one, and a segment within a few degrees of a multiple of
   45 is made true.

Everything after the flood runs on the bounding box of the mask, so the cost follows the wall and not
the map. More than one click is allowed: each is flooded on its own colour and the masks joined
before thinning, which is how a wall that changes material is mapped as one line.

The scene image can be large, so it is shrunk to at most 2400 pixels on its longer side before it is
read. All tracer options are in the shrunken image's pixels and are derived from the grid size, so
the settings mean the same thing on any map.

## Placing the picture on the scene

A click is in scene pixels; the tracer works in image pixels. The image is placed by measuring where
Foundry draws the background on screen -- the bounds of the background sprite, brought back through
the stage -- and not by reading the sprite's own position and size, whose meaning differs between
versions. The image itself is loaded from the scene's background file where there is one, falling back
to the texture Foundry holds. The first version used the sprite's own numbers and every click landed
in the wrong place; the small picture in the window, which shows where the tool took the click to be,
exists to make that kind of fault visible.

## Doors and windows

Walls found from the picture stop at a door, a gate or a window, because those are different
material, and so they leave a gap. A door or window is therefore found from the walls and not from
the picture. `findOpening` takes the walls already on the scene and the click, and returns the two
wall ends that face each other with the click between them: ends of two different walls, each wall
running away from the gap, a door's length apart. Free ends are preferred over ends something else
meets, and a gap that already has a door in it is not offered again.

Where the walls were drawn by hand straight across the door there is no gap, and `openingOnWall`
answers instead: the click is on a plain wall, away from its ends, and the opening is placed on it,
as long as the picture shows it if the picture ran along that wall and a square otherwise. Whether an
opening is cut out of a wall is decided when it is added, by where its ends are: `splitWallAt` cuts
from a wall exactly the opening that lies along it, so a door the GM has dragged to a different
size, or off the wall altogether, is treated as what it now is. The wall is shortened to what is
before the opening, what is after it becomes a new wall with the same properties, and the door's
flag records the wall as it was so that undo can restore it before deleting the run.

Only when there is neither a gap nor a wall to cut does it fall back to the picture. `mapOpening` floods the clicked art,
finds its long axis from how the pixels are spread (so a door at any angle works) and its ends along
that axis, and the manager fits each end to the nearest wall end within reach. The fallback is less
reliable: art close in colour to the wall floods into it, which is why an opening longer than four
squares is refused.

## What is written

A wall is written with its coordinates and a flag, `flags.coffee-pub-cartographer.autoWall`, holding
`run`, the time it was drawn, and `kind`, wall, door or window. Undo deletes every wall carrying the
latest `run`, so one press of Add is one thing to take back.

A door and a window are written as Foundry's own wall tool presets write them, read from the
installed Foundry rather than guessed. A door is a normal wall with `door` set to the door type and a
state, and optionally a door sound and an animation type. A window has Proximity for light and sight,
with a threshold of two grid distances and attenuation on. The constants are read as
`CONST.EDGE_SENSE_TYPES`, falling back to the older name so version 13 still works. On a scene with
more than one level, a wall is assigned to the level being viewed.

## Editing what was found

The segments of a run are held in scene pixels in the session, and the preview draws from them. An
end is a handle: dragging moves it and every end at the same point. With joining on, a dropped end
snaps to a nearby end on the scene or in the run, and two segments left meeting on a straight line are
merged -- only at the point just dropped, so a point put in deliberately elsewhere is not undone.
A click on a wall already found is not a new wall to find, and with Ctrl or Command held it cuts the
segment in two at the click. It is not a double-click: on a wall on the scene Foundry takes the
double-click to open the wall's settings. Changing a setting or clicking again works the
walls out afresh and discards the edits, because the edits are on the result and not on the settings.

## Clean up

Clean up works on every wall on the scene, not only those a run made. It joins ends within a distance
by single linkage, so a chain of near ends is one group and moves to its middle, then merges walls that
run on in a straight line. Two walls merge only if exactly two meet at the point, the turn is under
8 degrees, and they are alike: a key made from the senses, direction and levels. A door or a window has
no key and is never merged. Each joint may turn only a little, but a curve is made of such joints, so
each wall keeps the points it has been made from and a merge is refused unless every one of them still
lies within a few pixels of the new wall; without that, a hand-drawn oval of seventeen walls was
merged down to nine. Ends that are within a grid square but beyond the join distance are counted, so
the result can tell the GM to raise it. What the clean-up did is kept in memory: where each moved wall was, and
the full data of each wall merged away, so undo can recreate those with their own ids and put the
rest back.

## Joined walls in Foundry

`scripts/manager-walljoin.js` is separate from the walls tool and works on every wall edit the GM
makes. Foundry moves one end of a wall when it is dragged and leaves the walls that shared that
point, and leaves an end let go beside another end beside it; the module makes a joint behave as one.

It works on the update and not on the drag, so that it follows however the wall was changed and so
that Foundry's own undo, which moves the one wall back, brings the joint back with it. A
`preUpdateWall` hook asks `planJoinedMove` what follows from the change: it applies only when exactly
one end moved, since both ends changing is a wall carried or a group moved together. The plan names
the walls with an end where the end was, and any other wall end the dragged end was let go near, which
it lands on; the hook rewrites the update's own coordinates for that and keeps the plan for the
`updateWall` hook, which moves the other walls. A drawn wall is snapped in `preCreateWall` by
`snapNewWall`.

The same file cuts a wall in two on Ctrl-click, for walls already on the scene. It watches the canvas
without taking the click, so Foundry still selects the wall, and acts on release when the pointer
has not moved, so a Ctrl-drag, which Foundry uses to draw a chain, is left alone. It acts only on the
Walls layer, only for the GM, and not while the walls tool has a run of its own, which cuts the walls
it has found. The new wall is a copy of the old, made first, so a failure leaves an overlap rather
than a gap.

Two rules keep it from fighting itself. Updates the walls tool makes carry an option,
`SKIP_JOIN`, that both hooks ignore, so a clean-up that joins ends, or a door cutting a wall, is not
followed by joins of its own; and the follow-up update the hook makes carries it too, so it is not
followed in turn. The plan is held in the manager, keyed by the wall, between the two hooks, rather
than in the update's options, so nothing depends on Foundry returning them. Shift, which Foundry
already uses to place an end off the grid, also holds the joining back.

## Tests

- `tests/test-autowall.mjs` runs the tracer on painted pictures: straight, chipped and slanted
  walls, T-junctions, a wall that changes material, a leak into a room, doors at any angle, gaps,
  joining, splitting and merging.
- `tests/test-autowall-openings.mjs` slices the fitting and wall-data methods out of the manager and
  checks what is written for a door and for a window.
- `tests/test-autowall-scene.mjs` runs the clean-up, its undo, adding and undoing a run against a
  stand-in scene that keeps its walls.
- `tests/test-autowall-join.mjs` runs the real hook class against a stand-in scene that fires Foundry's
  two hooks around every update: a joint followed, an end joined, a wall drawn, a setting off, Shift
  held, and an update that must not be followed.
- `tests/test-autowall-wiring.mjs` checks that every string, class, action and control the window
  uses exists.
- `tests/test-autowall-window.mjs` builds the window's HTML for every mode and tab from the real
  methods and checks the controls, the selected values and the escaping.
- `tests/test-autowall-flow.mjs` runs the whole manager class in node, from its source, against
  stand-ins for Foundry, the canvas and PIXI, and drives it as the GM does: a click, a drag, a join,
  a Ctrl-click, a door in a gap and on a wall, Add.

None of them runs Foundry. They do not show that Foundry accepts the data written, that the
preview lines up with the map, or how any of it looks.

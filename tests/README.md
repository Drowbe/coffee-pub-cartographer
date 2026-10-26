# Tests

```
node tests/run.mjs
```

Plain node, no framework, nothing to install, and no `package.json` needed. Run
from the module root — the suites resolve source files relative to the working
directory.

## What these are, and are not

Each suite either imports the real module or **slices the real function out of
its source file** and runs that. None of them describes what the code ought to
do in a copy that could drift; a suite cannot pass against a function that has
been changed underneath it, which is the point.

They cover logic that can be decided without Foundry: geometry, merges,
permissions, and the shape of what gets written. They say nothing about how any
of it looks, so **they are not a substitute for opening the map**.

| Suite | Covers |
| --- | --- |
| `test-floor-layers` | The clipped floor-surface layers: run merging, grid-fraction coordinates, wall-cut polygons, pattern phasing. |
| `test-regions` | `propagateFloors` and `sameFloorRegion` — that a surface stops at a doorway even on a square a curve cuts through, and that clearing reaches squares a changed wall stranded. |
| `test-donation` | `mergeMapInto`. Every rule of an additive merge, including that a donor's struck-off square is not struck off for the party. |
| `test-mutations` | The real `_processMutationRequest` — the GM-side write path — for placing, removing, creating, sharing and donating, with the permission matrix applied through it. |
| `test-grid` | The grid-weight preference: that Medium still resolves to exactly what each theme was drawn at, and that no theme re-declares a whole grid colour and defeats the weight. |
| `test-css-and-template` | Every mask data URI is valid SVG with a matching `-webkit-` twin and a `mask-size` agreeing with its tile; tints exist in all three themes. |
| `test-wiring` | The joins where a typo fails silently: every `data-action` has a handler, every localisation key exists, every mutation sent is handled. |
| `test-scene-motion-timing` | The shared clock behind scene motion -- position stays continuous through an ease and through a change made mid-ease -- and the rules for which groups are on. |
| `test-scene-motion-managers` | The real parallax, tile-motion and collections managers driven through a GM's session: groups, duplicating, reordering, importing, a spinning tile's pivot, collections, and the window following the scene. |
| `test-scene-motion-wiring` | Every scene-motion button has a handler, every field is acted on, every string exists, and no string or style goes unused. |
| `test-autowall` | The wall tracer, on pictures painted in code: straight, chipped and slanted walls, junctions, a wall that changes material, a flood that leaks into a room, doors found at any angle and as the gap between wall ends, and joining, splitting and merging. |
| `test-autowall-openings` | The real fitting and wall-data methods of the walls tool: where a door or window is fitted to the wall ends, and exactly what is written for a wall, a door and a window. |
| `test-autowall-scene` | What the walls tool does to a scene's walls, against a stand-in scene: clean-up and its undo restoring every wall, adding a run, and taking a run back. |
| `test-autowall-flow` | The whole walls tool, from the real manager source, in node against stand-ins for Foundry, the canvas and PIXI: a click, a drag, joining, shift-double-click, a door in a gap and on a wall, and Add. A smoke test of the code's own wiring. |
| `test-autowall-window` | The walls window's HTML for every mode and tab: the controls each has, the values selected, nothing undefined, and names escaped. |
| `test-autowall-join` | The joined-walls hook, run against a stand-in scene that fires Foundry's two update hooks: a joint followed, an end joined, a wall drawn, the setting off, Shift held, and an update the walls tool made that must not be followed. |
| `test-autowall-wiring` | Every string, class, window action and control of the walls tool exists, and the window only calls what the manager has. |

## Why the mutation suite exists

A symbol placement was once saved from the wrong array — built in one variable
and written from another — so placing a symbol silently did nothing. Everything
was green, because every suite at the time covered geometry and stylesheets and
none touched the code that actually writes a record. That gap is what
`test-mutations` is for.

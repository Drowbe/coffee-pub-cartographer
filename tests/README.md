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

## Why the mutation suite exists

A symbol placement was once saved from the wrong array — built in one variable
and written from another — so placing a symbol silently did nothing. Everything
was green, because every suite at the time covered geometry and stylesheets and
none touched the code that actually writes a record. That gap is what
`test-mutations` is for.

# Scene Motion Architecture

**Audience:** anyone changing parallax, tile motion or collections, or adding another kind of motion
to them.

How scene motion keeps every client in step without streaming positions, where it draws on Foundry's
canvas, and how the window is put together.

## Files

| File | Holds |
| --- | --- |
| `scripts/utils-motion.js` | The shared clock: easing, travel, rebasing, and the ticker priority. |
| `scripts/utils-groups.js` | Which groups are on, and whether an item shows under them. |
| `scripts/utils-textures.js` | The mipmap-free copies that repeating images draw from. |
| `scripts/manager-parallax.js` | Parallax state, rendering, layer groups, copying between scenes, and the window's open state. |
| `scripts/manager-tilemotion.js` | Tile motion state, rendering, and tile groups. |
| `scripts/manager-collections.js` | Saved looks across both modes. |
| `scripts/manager-motionbar.js` | The Scene Motion section of the sub-menubar. |
| `scripts/utils-travel.js` | Distances on the grid, paces, and their units. |
| `scripts/manager-travel.js` | The on-screen odometer, arrival, the world clock's rate, and a followed route's length. |
| `scripts/utils-routes.js` | Route geometry: lengths, a point along a route, unit conversion. |
| `scripts/manager-routes.js`, `scripts/window-routes.js`, `templates/window-routes.hbs` | Routes: saving, drawing on the canvas, the click-to-place tool, and the Routes window. |
| `scripts/manager-travelpins.js` | The party's marker: a Blacksmith pin per route or journey that has set out, moved along it. |
| `scripts/window-parallax.js`, `templates/window-parallax.hbs`, `styles/tool-parallax.css` | The window. |

## Where state lives

| Where | Key | What |
| --- | --- | --- |
| Scene flag | `parallax` | Layers, layer groups (stored as `sets`), which are on (`activeSets`), and the parallax motion. |
| Scene flag | `tileMotion` | The tiles' motion, each managed tile's position at the anchor (`offsets`), tile groups, and which are on (`activeGroups`). |
| Scene flag | `collections` | `{ list }` of `{ id, name, layerGroups, tileGroups }`. |
| Scene flag | `routes` | `{ list, journeys }`. A route is `{ id, name, color, points, terrain, userId, hidden, travel? }`, points as `[[x, y], ...]` in scene pixels and terrain one id per leg; a journey is `{ id, name, routeIds, userId, travel? }`. `travel` is the progress along it (below). On map scenes. |
| Tile flag | `motion` | That tile's `visible`, `rotate` and `scroll` settings. A tile with this flag is managed. |
| `localStorage` | `parallax.windowPrefs`, `parallax.windowOpen` | The window's mode, tabs, folded rows, height, and whether the GM wants it open. Per browser, never shared. |

Only the GM writes. Players render whatever the flags say.

## The shared clock

A motion is five numbers: `playing`, `masterSpeed`, `easeSeconds`, `anchorAt` (server time) and
`rampFrom` (the speed in effect at `anchorAt`). Speed eases from `rampFrom` to the target -- the
master speed while playing, zero when stopped -- along a smoothstep curve.

Position is never sent. Each thing that moves stores where it stood at `anchorAt`, and every client
computes where it stands now as that plus `motionTravel(motion, now) * itsSpeed`. `motionTravel` is
the closed-form integral of the eased speed, so every client arrives at the same number from the
same five values, and a client that reloads mid-run is immediately in step.

Every change is a **rebase**: fold the travel so far into each stored position, set `rampFrom` to the
speed in effect now, move `anchorAt` to now, then apply the change. Position and speed are therefore
continuous through any change, including one made partway through an ease. Layers store their
positions as x and y rather than a distance, so turning the angle mid-run carries on rather than
jumping.

## Groups

What is on is saved as `null` (All), `[]` (None) or a list of group ids. An item shows when any group
that is on contains it and has not switched it off (`shownByGroups`). Older saves held a single id as
`activeSet` or `activeGroup`; `normalizeActive` reads either. If every group that was on has been
deleted, the scene falls back to All rather than going blank.

A collection stores one such value per mode. Which collection is current is not stored: it is
whichever matches what is on now, so it cannot disagree with the scene.

## Rendering

**Parallax layers** are `PIXI.TilingSprite`s in two containers added to `canvas.primary`, Foundry's
primary group, which sorts its children by elevation, then sort layer, then sort.

- **Ground** layers share the scene background's elevation and sort layer and sort one above it: over
  the background, under every tile.
- **Overhead** layers sit where Foundry puts its weather -- infinite elevation, so tokens at any
  elevation are below them -- one sort layer under the weather, so rain still falls in front.

Both containers are masked to the scene rectangle. Being in the primary group, they are lit.

**Ticker priority.** Motion updates run at `NORMAL + 4`: after Foundry's placeable refreshes (`HIGH -
2`), so a refresh that resets a tile's transform is overridden in the same frame, and before the
primary update (`NORMAL + 3`) and perception (`NORMAL + 2`), so Foundry's depth and lighting work from
this frame's positions. At the default priority they ran a frame behind, which showed as a fringe
along the trailing edge of moving art.

**Repeating images.** PIXI repeats an image that is not a power of two in the shader. Where it wraps,
the GPU samples the smallest mipmap for one pixel, which flickers as a seam line. Foundry mipmaps its
textures, so repeats draw from a copy rendered once into a render texture without mipmaps. Video
cannot be copied that way (the copy would be one frozen frame) and keeps Foundry's texture.

**Fades** -- a layer or tile coming into or out of view -- are timed on each client's own clock over
the mode's ease time and never saved. Whatever is showing when a scene loads appears at once.

**Depth** offsets a layer's tiling by the camera's distance from the scene's centre times its depth,
each frame, from that client's own view.

**Travel.** The odometer's state is `travel` in the `parallax` flag. Its pace is not stored: it
is the ground layer's speed read on the grid, so the scenery and the odometer cannot disagree, and
choosing a pace sets that speed (and scales the other layers with it). Distance is the ground's
scroll on the grid, folded into `travel.distance` at every rebase. Following Blacksmith's world
clock, the GM records the clock's rate (`api.worldClock.rate`, and again on
`blacksmith.worldClockRateChanged`) in `travel.clockRate`; distance is then the pace per second
times `motionTravel(travel.clockMotion)`, a second motion whose speed is the rate, and the scenery's
speeds are multiplied by `clockFactor`, the rate capped at four. A rate of 0 stops both.

**Routes.** A route or journey lives on its map scene; the travel lives on the animated scene, as
`travel.route = { sceneId, routeId }` or `{ sceneId, journeyId }`. A journey is turned into one
path by `chainRoutes` (utils-routes.js), which runs each route whichever way meets the last and
crosses any gap in a straight line.

**Progress lives on the path**, as `travel = { effort, pace, arrived, motion }` on the route or
journey record: a map outlasts any one animated scene, which is reused for many journeys. Progress
is kept as **effort** -- distance as if it were all open ground, in the map's units -- which grows
at the pace (map units an hour) times `motionTravel(motion)`, the same eased maths as the scenery,
with the world clock's full rate as the motion's `clockFactor`. `distanceForEffort` walks the
legs to turn it into distance, a difficult leg costing twice its length, so every client gets the
same place without anything streaming. `routesManager.progress(link)` gives the distance, the leg
and its terrain, and the point on the map; `setPathTravel` (GM) folds the effort and re-anchors.

The animated scene is a view. `_commit` in manager-parallax.js pushes its playing, master speed,
ease, clock and pace (its ground pace converted to the map's units) to the linked path whenever
they change, anchored at the same moment as the scene's own motion, and stops the path it stops
showing. Its odometer reads the path. The scenery's speed is multiplied by `terrainFactor` in
`targetSpeed` (utils-motion.js); the GM's client sets it as the party crosses into a leg of other
terrain (`_checkTerrain` in manager-travel.js), so it eases like any change of speed. The
distance never waits on that: it is exact from the effort; only the picture follows.

**The marker** is a Blacksmith pin, id `coffee-pub-cartographer-travel-j-<journeyId>` (or
`-r-<routeId>`), type `journey`, created by the GM's client the first time the path's travel is
written (`coffee-pub-cartographer.pathTravelChanged`, fired by `_apply` on the GM's client). Every
client puts it at `progress().point` each frame with Blacksmith's client-local
`pins.setLivePosition`, which is never saved or sent and locks the pin against dragging. At rest
(stopped and its ease run out) the GM's client saves the point with `pins.update`, and each client
clears its live position once the saved one matches, so nothing jumps. Without
`setLivePosition` (an older Blacksmith) the pin moves only at those saves. Shown or hidden is the
pin's own `config.blacksmithVisibility`. Its length, converted from the map's units to the scene's,
is written into `travel.destination` when it is chosen, and again by the GM (`_syncRoute` in
manager-travel.js) when the scene loads or any route changes -- `updateScene` on the map fires
`coffee-pub-cartographer.routesChanged`. Storing the length rather than reading it live keeps the
odometer working when the map is not loaded and after the route is deleted. Where the party is on
the route is `routesManager.pointAt(id, distance)`, the odometer's distance converted back to
the map's units: what the planned marker will read. Routes draw in `canvas.interface`, above tokens;
the drawing tool captures left clicks in the capture phase, as the sketch tool does, and leaves
right-drag to pan.

**Tiles.** A spinning tile turns its own mesh: the pivot's world position is worked out from the
tile's anchor, size and rotation, and the mesh is re-anchored there, so it turns in place. A scrolling
tile is drawn by a `TilingSprite` placed exactly where the mesh sorts, with the mesh kept but not
rendered, so Foundry still selects and hovers it. A tile that stops being managed is handed back with
`refreshTransform` and `refreshState`.

## The window

`window-parallax.js` extends Blacksmith's tool window. Its `DEFAULT_OPTIONS` is a plain object -- the
class chain is merged by Foundry, and copying `super`'s options in duplicates v14's window controls --
and its height is a number, because `'auto'` makes Foundry refit and reposition the window on every
render.

The bar is built in script; the settings body is the template. Parallax and Tiles share one shape
through `_groups()`, an adapter over each mode's groups, so the Groups tab, the bar's dropdown and the
group dialog are written once. Sliders preview locally on `input` and write the scene on `change`.

The window follows the scene: on each scene load it opens if the scene has motion and the GM left it
open, and closes otherwise, without forgetting that the GM wanted it.

## Tests

`tests/test-scene-motion-timing.mjs` covers the clock and the group rules,
`tests/test-scene-motion-managers.mjs` drives the real managers through a GM's session, and
`tests/test-scene-motion-wiring.mjs` checks that every button has a handler, every string exists and
nothing in the stylesheet is unused.

# Walls, Doors and Windows

**Audience:** GMs who have a painted battlemap and want its walls, doors and windows on the scene
without drawing each one by hand.

Click a wall on the map and Cartographer draws the walls along it. Then click the doors and the
windows. It reads the scene's background image, so it works on a painted map of any style, and it
shows you what it found before anything is written to the scene.

Only a GM can use it. It works from the scene image, so it needs a scene with a still background
image; a video background cannot be read.

## Start

There are two ways in. In Foundry's own controls, with the **Walls** layer open, there is a **Map
walls, doors and windows** button among the wall tools. And in Cartographer's sub-menubar, the
**Walls** section has the same button, and **Undo**, which takes back the last run.

The window can be moved. It opens beside the map so the middle of the map is clear to click, and it
remembers where you put it. The **Map**, **Draw** and **Options** tabs are at the top. On the Map
tab, under them, **What to map** chooses the mode -- **Walls**, **Doors** or **Windows** -- in the
order the work is done. **Add** and **Cancel** are at the foot, where they stay in reach on the Map
and Options tabs. The Map tab finds walls from the picture; the Draw tab is for placing them by hand.

## Walls

In **Walls** mode, click a wall on the map. Everything of the same material, joined to where you
clicked, is taken to be that wall. Three things appear:

- A **cyan area**: what it took to be the wall.
- **Red lines** with **yellow dots** at their ends: the walls it will add, down the middle of the
  painted wall.
- A **green dot**: where you clicked.

The window shows the same on a small picture of the map, and says in words what was found. When it
looks right, press **Add walls** (or Enter). To start over, click somewhere else.

A wall that changes material along its length -- stone, then a wooden section, then stone again --
is found in pieces, because each material is its own wall. **Shift-click** the other pieces to add
them to the same run, and they come out as one line.

A wall stops at a door, a gate or a window, because those are different material. That is what
leaves the gap the doors and windows are fitted into.

### The settings

- **Match** is how alike in colour a pixel must be to where you clicked to count as the same wall.
  Higher takes in more. Too high and it spills onto the floor or into a neighbouring wall; too low
  and it stops at every shadow. The default suits most maps; the range is 8 to 36.
- **Smoothing** is how plain the walls are, in grid squares. Higher gives fewer, straighter walls
  and drops short stubs off the sides of walls; lower follows the painted wall more closely. A
  curved wall, such as a round tower, comes out as straight pieces, and lower Smoothing gives it
  more of them.
- **Widest wall** is the widest a wall may be, in grid squares. A click that spreads into a room or a
  courtyard is much wider than any wall, so it is refused with a message rather than drawn. If a
  genuinely thick wall is refused, raise this.

Moving a slider works the walls out again from your last click.

### Adjust before adding

Every yellow dot can be dragged. Dragging an end moves every end that met it. **Ctrl-click** on a
wall (Command-click on a Mac) puts a new point in it where you clicked, and the point can then be
dragged. A plain click on a wall that has been found does nothing, since that wall is already there.
With **Join nearest
endpoints** on (see Options), an end let go near another wall end snaps onto it, and if the two then
run on in a straight line they become one wall.

Changing a slider, or clicking somewhere else on the map, starts the run over and discards what you
dragged.

## Walls on a tile

Some walls are painted on a tile, not on the scene's background. You do not choose which: **the
picture is read from where you click.** The top-most tile with a picture under your click is read, and
if there is none, the scene's background is. The window says which, under the small picture of the
map. A tile that is turned or flipped on the scene works the same, and the walls found are placed
where the tile's picture is drawn.

- A part of a tile that is transparent is not there to click: the click goes through it, to the tile
  below or to the background.
- A run reads one picture. Clicking on a different tile, or on the background, starts a fresh run
  on that picture and leaves what was found before. **Shift-click** only ever adds to the picture
  already being read.
- Video and animated tiles are skipped, as a video background is.

## Doors

Switch to **Doors** once the walls are in. Click a door on the map. Because the walls stopped at the
door, there is a gap in them, and the door is fitted into that gap: the two wall ends that face each
other with your click between them. The dots show the door; the window says it is fitted between two
wall ends.

If there is no gap because a wall runs straight across the door -- walls you drew by hand often do --
click the door on the wall. The door is placed on the wall, a square wide or as long as the picture
shows it, and the window says so. Drag its dots to size it. When you press **Add door**, the wall is
cut around it: what is before the door stays the wall, what is after it becomes a wall of its own,
and the door goes between. **Undo** puts the wall back whole.

If it finds neither a gap nor a wall to cut, it reads the door's art instead and fits it to the
nearest wall ends, and tells you if it could not reach one or both. Drag a dot onto the wall end it
should meet; with Join nearest endpoints on, it snaps there.

The door settings are:

- **Door state** -- closed, open or locked.
- **Door sound** -- any of Foundry's door sounds, or the default.
- **Animation** -- any of Foundry's door animations, or the default.

A door is written the way Foundry's own door tool writes one: a normal door that blocks movement,
light, sight and sound until it is opened.

## Windows

Click a window the same way. A window is written the way Foundry's window tool writes one: it blocks
movement and sound, and light and sight pass through it from close up but not from far away. The
settings are:

- **See through** -- how close, in grid squares, you must be to see and light through it. The
  default is two squares, as Foundry's own window tool uses.
- **Fade with distance** -- Foundry's attenuation setting for the window, on by default as it is
  for Foundry's own windows.

## Drawing walls by hand

The **Draw** tab is for when you would rather place the walls than have them found. Nothing is read
from the picture. Walls are made as you draw them, and a chain or a stroke is one thing for **Undo**
(in the sub-menubar) to take back.

**How you draw** is **Points** or **Sketch**, and **What you draw** is a **Wall**, a **Door** or a
**Window**; a door or window is drawn with the settings shown, as on the Map tab. Press **Start
drawing**: while it is on, the map is for drawing, and **Stop drawing** gives it back to Foundry.

**Points.** Click to place a point. Each click after it makes a wall from the last point to the new one,
so you click a shape out one corner at a time.

- **Carry on from a wall that is already there.** Start a chain by clicking at the end of a wall that
  is already on the scene: the point snaps onto that end, so the new wall begins exactly where the old
  one ends. This is the thing Foundry's own tool makes awkward, where dragging from an end takes hold
  of that wall. A point is snapped to a wall end that is within the **Join distance**, and the same
  for every later point, so a chain can end on a wall end too. A ring marks the end a point would join.
- **Close a shape.** Click back on the first point, with at least three sides, and the shape is closed
  and the chain ends.
- **The last point.** The window says where the last point is, and it is marked in green on the map,
  with a line to where the next would go. The first point of the chain is ringed.
- **Enter** ends the chain; the next click begins another. **Escape** ends it too, and with no chain
  turns drawing off. **Backspace** takes back the last wall and stands where it began.
- **Shift** places a point exactly where you click, with no joining or snapping.
- Points that are not joined to a wall end snap to the grid, unless **Freeform** is chosen (Options) or Shift is held.

**Sketch.** Drag to draw a line freehand. When you let go it is turned into straight walls, as few as
keep to your line; **Smoothing** sets how plain they are. A stroke that starts or ends near a wall end
is joined to it, and one that ends near its start is closed into a ring. **Backspace** takes back the
last stroke. Each stroke is one thing to undo.

## Cutting a wall in two

On the scene itself, with the **Walls** layer of Foundry's controls active, **Ctrl-click** (Command-click
on a Mac) a wall to cut it in two where you clicked. The new wall is a copy of the old, so it is the
same kind of wall, and the two meet at the new point; drag that point, or either wall, as you like.
Nothing is cut near an end of a wall, where there is already a point. **Clean up walls** makes two
cut walls into one again if they still run straight on. Foundry's own double-click is left alone: it
opens the wall's settings.

While the walls tool has a run going, Ctrl-click cuts the walls it has found instead, as above. Foundry
uses Ctrl only when dragging out a chain of new walls, so a Ctrl-drag still does that.

## Joined walls in Foundry

Cartographer also changes how walls behave when you edit them in Foundry itself, for the GM, while
**Join Walls Where They Meet** is on (it is by default; see [Settings](userguide-settings.md)).

- **A wall end let go near another wall's end snaps onto it**, and the two walls are joined there.
  That applies when you drag an end of a wall and when you draw a new wall. Two walls end to end with
  a small gap become two walls that meet.
- **Moving a joint moves the walls on each side of it.** Drag the end of a wall where it meets
  another, and the other wall's end comes with it. Lift the middle of two joined walls and both
  sides of it lift, so a straight run becomes a peak, with both walls still meeting at the top.
- **Shift** held while you place an end puts it exactly where you let go, with no joining.
- Undo in Foundry moves the wall back and the joint with it.

Without this, Foundry's own wall dragging moves only the end of the wall you grabbed and leaves
the others behind, and an end let go beside another is left beside it. Walls this tool adds are left
exactly where it put them.

## Options

The **Options** tab holds the settings that apply to every mode:

- **Join walls where they meet** -- the setting described above, on the same switch: an end you drag
  and let go near another wall end snaps onto it, and moving a joint moves the walls on each side. In
  this tool's own preview, two walls joined this way that then run on straight become one wall.
- **Snap to grid or Freeform** -- how walls are placed. **Snap to grid** is the default, as in Foundry:
  walls found, drawn and dragged land on the same points Foundry's own wall tool snaps to, which are
  the grid's corners, centres and side midpoints, and the steps between them, finer on a larger grid
  (quarter squares on a grid of 100 pixels); Foundry's Force Snap Vertices is honoured. **Freeform**
  places them exactly where you put them. Holding **Shift** while you place or drag an end is freeform
  for that end, as it is in Foundry, whichever is chosen.
- **Join distance** -- how near, in grid squares, an end must be let go to another to join it, and
  wall ends must be for Clean up to join them. The default is 0.3 of a square. If ends that nearly meet are left, the result says how many are within
  a square, so you know to raise this.
- **Clean up walls** -- joins the ends of every wall on the scene that are within the join distance,
  and makes walls that run on in a straight line into one wall. It works on every wall, door and
  window on the scene, including walls drawn by hand. Doors and windows are joined to the walls but
  stay as they are, and walls that differ in kind -- a normal wall beside an invisible one -- are not
  merged. A curved wall made of many short walls stays curved: walls are merged only where the result
  stays within about three percent of a square of every point that was merged into it. Very short
  walls that would collapse to a point are left alone, and the result says how many.
- **Undo clean up** -- puts every wall the last clean-up moved or merged back as it was. It is kept
  until you close the game window; reloading forgets it.

## Taking a run back

**Undo** in the sub-menubar deletes every wall, door and window added by the last run, and makes whole
again any wall a door or window was cut out of. A run is the set of walls from one press of Add. Walls
drawn by hand, and earlier runs, are not touched. Each run can be undone in turn.

## What it cannot do

- It reads one material at a time. A thick solid wall, such as a keep's wall shown as a block
  rather than a line, is refused; map its two faces some other way.
- It does not make secret doors, or other door types. A door it adds is a normal door.
- A curved wall comes out as straight pieces.

## If it does not find what you expect

- **"That spread across the map, not along a wall"** -- the click took in the floor or a
  neighbouring surface. Lower **Match** and click again.
- **"That area is too wide to be a wall"** -- the same, caught by width. Click a thinner part, lower
  Match, or raise **Widest wall** if the wall really is that thick.
- **"Found some wall there, but nothing long enough to keep"** -- what it found was too short once
  straightened or snapped. Switch to Freeform, lower **Smoothing**, or click a longer
  stretch.
- **"That click is outside the map image"** -- the click was off the picture. If it was on the map,
  something is wrong with how the image is placed on the scene; the browser console line beginning
  "auto-wall read the map" says what was read.
- **A door that is fitted to the wrong place** -- drag its dots onto the wall ends it should meet.

# Scene Motion

**Audience:** GMs who want a scene to move: scenery scrolling past a moving wagon or airship, clouds
drifting over the party, windmills turning, a whirlpool spinning.

Scene motion has three parts, each a mode of one window. **Parallax** scrolls layers of scenery at
different speeds so the scene reads as having depth. **Tiles** spins and scrolls individual tiles.
**Collections** saves the look of the whole scene -- which layers and tiles are showing -- so you can
switch it in one click during play.

Everything here is for the GM. Players see the result on their own screens, in step with yours, and
need nothing installed beyond the module.

## Open the window

In Cartographer's sub-menubar, the **Scene Motion** section starts with a sliders button that opens
the window. The same section has quick buttons to play and stop the layers and the tiles -- each lit
while its motion runs -- and a button for the scene's look, which opens a menu of collections, layer
groups and tile groups. Pick a collection to switch to it; click a group to turn it on or off.

The window remembers whether you left it open. It opens itself on scenes that have scene motion and
steps aside on scenes that do not; you can still open it on an empty scene to set one up.

## The control bar

The bar across the top runs the scene. From the left:

- **Parallax, Tiles, Collections** -- which mode the rest of the bar and the settings below it work
  on.
- **Play / Stop** -- the button says what pressing it will do. Stop eases the motion to a halt and
  keeps its speed; Play eases it back up to that speed.
- **Speed** -- centred on zero. Right of centre runs forward, left of centre runs in reverse, and the
  middle stops. It snaps to zero near the middle. Collections mode has no speed slider, because the
  layers and the tiles each keep their own.
- **The look** -- a dropdown of this mode's groups, or in Collections mode, of your collections.
- **The gear** -- shows and hides the settings. Hidden, the window is just the bar.

Changes of speed, and layers or tiles appearing and disappearing, ease in over the mode's **Ease**
time rather than snapping.

## Parallax layers

Settings in Parallax mode have three tabs: Movement, Layers and Groups.

### Add layers

On the Layers tab, **Add Layer** picks an image. Add them back to front: the sky or far distance
first, the nearest scenery last. Every layer but the farthest needs a transparent background.

The list shows layers nearest first. Drag a layer by its grip to reorder it. The **Tokens** line in
the list is where tokens sit: layers above it draw over tokens (clouds, smoke), layers below it draw
under them. Drop a layer on the line to move it across.

Each layer can be collapsed to a single line. Expanded, it has:

- **Speed** -- pixels per second, centred on zero, so one layer can run against the others.
- **Opacity** and **Scale**.
- **Direction** -- turns this layer away from the scene's angle; clouds blown across a road rather
  than along it.
- **Depth** -- how the layer moves as the view pans. Zero stays fixed to the map. Positive looks
  farther away, negative looks nearer, like clouds above. Keep it at zero for anything tokens stand
  on, or it will slide away from the grid.
- **Start X / Y** -- where the image sits at rest, for lining layers up. Reset Positions returns here.
- **Repeat** -- **Tile** repeats the image across the whole scene; **Band** repeats it only along the
  direction of travel, as a strip such as a tree line, at the offset you give.

Each layer also has an eye to hide it everywhere, a pen to rename it, a duplicate button, and a delete button that asks
first.

### Movement

The Movement tab sets the scene's **angle** -- which way the scenery runs, with quick picks for left,
right, up and down -- the **Ease** time, and **Reset Positions**.

### Travel

Also on the Movement tab, an odometer counts how far the party has come. It reads the scroll of the
ground on the scene's grid: with a 140-pixel, 5-foot grid, every 140 pixels the ground scrolls is 5
feet.

- **Show odometer** -- shows the distance traveled, how far is left and when the party arrives, to
  everyone. It starts at the top of the canvas, below any menubars. Anyone can drag it somewhere else
  on their own screen, and it stays there for them; a right-click puts it back. A double-click opens
  its window: this one on an animated scene (for the GM), the Routes window on a map.
- **Ground layer** -- the layer the party is travelling over. By default, the nearest layer below
  the Tokens line.
- **Pace** -- how fast the party travels. Choosing one sets the ground layer's speed from the grid,
  and scales every other layer by the same amount so the depth between them is kept. With D&D 5e the
  choices are the rules' own: slow, normal and fast (2, 3 and 4 miles an hour), the SRD's mounts at
  their speed over ten (a riding horse is 6 mph) and a one-hour gallop, and its ships and airship. In
  other systems they are everyday ones such as walking, a wagon or a galloping horse. Choose
  **Custom** to type a pace of your own. Scenes measured in feet, yards or miles take it in mph; metres or kilometres in km/h. A
  grid in hexes or squares has no pace, but the odometer still counts in them.
- **Follow world clock** -- takes time from Coffee Pub Blacksmith's world clock rather than real
  time, so with the clock on fast (×60) a real minute covers an hour of road. The scenery speeds up
  with the clock too, up to four times its pace -- faster than that only the numbers speed up, since
  the picture would be a blur -- and a stopped clock, paused or in combat, eases it to a halt and
  stops the odometer. Without Blacksmith's world clock the switch is greyed out.
- **Route** -- follows a route drawn on a map: its length becomes the destination. See
  [Routes](userguide-routes.md).
- **Destination** -- how far there is to go in all, in the scene's units or the longer one (feet or
  miles, metres or kilometres). With a destination set, the tab shows the distance remaining and the
  time to arrival, and **Stop on arrival** eases the scenery to a halt when it is reached.
- **Reset odometer** starts counting from zero again.

The master speed runs the party faster or slower than its pace, and running in reverse backs the
odometer up. Scene motion only reads Blacksmith's clock; it never moves Foundry's in-game time. On its
own, a jump in time -- a rest, or the GM adding an hour -- does not move the scenery or the odometer.
Following a route or journey on a map that follows the clock, though, where the party is goes with the
date and time, so scrubbing time moves the odometer with it; see [Routes](userguide-routes.md).

### Groups

A group is a named combination of layers, such as Base, Snow or Night. Groups **add together**: a
layer shows when any group that is on shows it, so a winter night can be Base plus Snow plus Night
rather than a group of its own.

On the Groups tab, each group has an on/off switch. **All Layers** shows everything and **No Layers**
hides everything, without changing any group. Expand a group to switch individual layers off within
that group only. The pen edits a group's name and members, and groups can be duplicated and deleted.

A layer added while groups are on joins them, so it does not vanish the moment it is added. Under
No Layers it joins nothing, and the Layers tab says so.

### Copy layers between scenes

On the Layers tab, three buttons beside Add Layer copy a scene's layers, groups, speed, angle and
ease: **Copy from another scene**, **Export** to a file, and **Import** from one. Copying or
importing can add to what is already here or replace it.

## Tiles

Settings in Tiles mode also have three tabs: Movement, Tiles and Groups.

Select a tile on the canvas, then **Add selected tile** on the Tiles tab. Each tile Cartographer
manages has:

- **Opacity** -- the tile's own opacity, the same number as in its configuration sheet.
- **Rotate** -- spins the whole tile. **Speed** is in degrees per second, centred on zero; **Pivot X
  / Y** is where it turns, as a fraction of the tile (0.5, 0.5 is the middle). For a windmill or a
  gear, the tile's image needs a transparent background.
- **Scroll** -- runs the tile's image inside its own frame, with a speed, a direction and a scale.
  Rotate and Scroll together make a whirlpool.
- An eye to hide it, a button to select it on the canvas, and a button to stop managing it, which asks
  first and puts the tile back exactly as Foundry draws it.

A tile does not have to move to be managed: a still tile can belong to groups and fade in and out
with them. Tile groups work exactly as layer groups do, and are chosen separately from them. A
tile's motion settings are saved on the tile, so a copied tile brings them along.

## Collections

A collection is a saved look for the whole scene: which layer groups and which tile groups are on.

**Add Collection** opens a dialog like the group one: a name, then for layers and for tiles, **All**,
**None**, or **These groups** with a checkbox per group. It starts from the look on the scene now, so
keeping what is showing is just a matter of naming it. A new collection is switched to as soon as it
is made. The pen edits a collection the same way; editing the one that is showing updates the scene.

In Collections mode, the settings also show every layer group and tile group as a chip, which switch
groups on and off live. Choosing a collection -- from the bar's dropdown, the Collections settings, or
the look menu in the sub-menubar -- switches both at once, and everything fades to match.

The current collection is the one that matches what is on now; if two save the same look, the one
made or chosen last. Change a group by hand and the bar reads **Custom** until the look matches a
collection again.

Play / Stop in Collections mode runs the layers and the tiles together.

## Macros

Everything above is also available to macros, Monk's Active Tiles and other modules, through
`game.modules.get('coffee-pub-cartographer').api`:

```js
const { parallax, tiles, collections } = game.modules.get('coffee-pub-cartographer').api;

parallax.play();                 // and stop(), toggle()
parallax.setSpeed(2);            // master speed; negative runs in reverse
parallax.setAngle('left');       // degrees, or left / right / up / down
parallax.setEase(3);             // seconds
parallax.setGroup('Winter');     // just this group; also 'all' and 'none'
parallax.toggleGroup('Night');   // add or remove one group
parallax.open();                 // open the window

tiles.play();                    // and stop(), toggle(), setSpeed(), setEase()
tiles.setGroup('Windmills');     // and toggleGroup()
tiles.setTileMotion(tileId, 'rotate.speed', 90);
tiles.show(tileId);              // and hide(), clear()

collections.apply('Winter Night');
collections.list;                // the names
collections.current;             // the one showing, or null
```

These act on the scene on the canvas, and only for a GM; on a player's client they do nothing.

## Things to know

- Animation runs on each screen from a shared clock, so every client sees the same position, and a
  player who reloads mid-scroll picks up where everyone else is. Nothing is sent while the scene
  moves.
- Each full-scene layer costs a full redraw of the screen every frame. Prefer Band for strips, keep
  images to about 2048 pixels on a side, and avoid stacking many full-scene layers.
- A trailing glow behind moving dark edges that changes side with the direction is usually the
  monitor's overdrive (response-time) setting, not the scene. Setting it to Normal removes it.
- A scrolling tile does not fade when a token walks under it, even if the tile is set to fade. A
  tile that only spins fades normally.
- A mirrored tile (negative scale) may turn about a mirrored pivot.
- Video layers and tiles draw from Foundry's own texture rather than the seam-free copy still images
  use, so they can show a faint line where the image repeats.
- If two GMs change the same scene's motion at once, the last change wins.

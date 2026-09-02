# Sketching on the Canvas

**Audience:** any player or GM who wants to draw on the map while the party is planning.

The sketching tool end to end: the shapes, the controls, what everyone else sees, and how drawings
clear themselves away.

Sketches are temporary by design. They are for working something out together -- who goes through
the door first, where the archers stand -- not for keeping. Nothing you draw here becomes part of the
scene.

## Start drawing

Click **Cartographer** in the scene controls down the left of the canvas, then drag on the map.

**Who can do it:** any player, unless the GM has turned **Enable Player Drawing** off. The GM can
always draw.

## Choose what to draw

The Cartographer tool offers five shapes:

- **Sketch** -- freehand, following the pointer.
- **Line** -- a straight line from where you press to where you release.
- **Box** -- a rectangle.
- **Ellipse** -- a circle or oval.
- **Stamp** -- drops a marker where you click, rather than drawing a shape.

Pick one, then drag on the canvas. The choice is remembered for you between sessions.

## Change how it looks

The toolbar carries the controls for the line itself:

- **Colour** -- your colour. It defaults to the colour Foundry assigns your user, so several people
  can draw at once and the table can tell who drew what.
- **Line width** and **line style** -- how heavy the stroke is and whether it is solid or broken.
- **Stamp style** and **symbol size** -- which marker the stamp drops, and how large.

Each is remembered per person, so your settings are yours and do not change anybody else's.

## Draw without leaving the tool you are using

Cartographer registers a hotkey so you can sketch mid-planning without switching tools. It is
**L** unless you change it, and Foundry's own Controls settings is where you change it.

By default it works while **held**: press and hold, draw, let go, and you are back where you were. It
can be set to **toggle** instead, so one press turns drawing on and another turns it off. See
**Draw Hotkey Mode** in [Settings](userguide-settings.md).

The hotkey ignores you while you are typing in chat, so an `L` in a message does not start a drawing.
That can be turned off with **Ignore Hotkey While Typing**.

## What everyone else sees

Drawings appear on other people's screens as you make them, not when you finish. Everyone connected
to the scene sees them, players and GM alike, each in the drawer's own colour.

There is no private sketch. If you draw it, the table sees it.

## How drawings clear

Three things remove a drawing, and you do not have to tidy up after yourself:

- **Changing scene** clears yours.
- **Disconnecting** clears yours.
- **Timed erase**, if it is switched on, removes each drawing a set number of seconds after it is
  drawn. The GM sets the delay with **Timed Erase Timeout (seconds)**; the toggle for whether it
  applies to your drawings is on the toolbar.

A GM can also clear everything on the canvas at once.

## What it does not do

Sketches are not Foundry Drawing objects. They are not saved with the scene, they cannot be selected
or edited after you release the mouse, and they do not survive a reload. Drawing something you want
to keep means drawing it with Foundry's own Drawing tools instead.

# Routes

**Audience:** GMs and players who want to measure a journey on an overland map -- how far it is from
Zhentil Keep to Phlan along the road, and how long that takes -- and GMs who want the scene-motion
odometer to count the party along it.

A route is a line of waypoints drawn on a map scene. Cartographer measures it on the map's grid --
square or hex -- saves it with the scene, and draws it for everyone.

## Draw a route

In Cartographer's sub-menubar, the **Routes** section has three buttons: **Draw a route**, an eye
that shows or hides routes on your screen, and **Routes on this map**, which opens the Routes window.

Anyone can draw a route. A player's route is saved by the GM's client, so a GM has to be online.

With Draw on:

- **Click** to place each waypoint -- the start, every bend in the road, and the end. The distance so
  far, and the length of the leg being drawn, follow the pointer.
- A waypoint placed near the end of another route **snaps** onto it, shown by a white ring, so the
  two meet exactly. That is how routes are joined into a journey.
- **Double-click** or press **Enter** to finish. Pressing the Draw button again also finishes.
- **Backspace** takes back the last waypoint. **Escape** gives up on the route.
- Right-drag still pans the map, and the mouse wheel still zooms, so a long road can be drawn
  across more than one screen.

Finishing asks for a name; closing that box without saving discards the route.

A route is measured as the true length of the line on the map's scale: a diagonal is as long as it
looks, not as long as Foundry's ruler would count it in squares. On a map whose squares are 5 miles,
a leg crossing ten squares' width is 50 miles. On a hex map, one hex is the distance from a hex's
centre to its neighbour's, so a leg crossing ten hexes on a 6-mile hex map is 60 miles.

## Change a route's waypoints

Double-click the line of a route you drew -- or any route, for the GM -- to add a waypoint there.
That also starts editing the route, and every waypoint becomes a handle:

- **Drag** a waypoint to move it. Near another route's end, it snaps on.
- **Double-click** the line to add another.
- **Click** a waypoint to select it (it fills in), then **Delete** or **Backspace** to remove it.
  **Right-click** or **Alt-click** a waypoint removes it in one go. A route keeps at least two.
- **Enter** or **Escape** stops editing.

Each change is saved as you make it, and the length updates everywhere. The bezier-curve button in
the Routes window starts and stops editing too.

## Terrain

Each leg of a route -- waypoint to waypoint -- has a terrain: road, open ground, forest, hills,
mountains, swamp, desert, snow or water. Forest, hills, mountains, swamp, desert and snow are
difficult terrain, which halves the pace, as in the D&D rules; road, open ground and water do not.
Legs over difficult terrain are drawn dashed.

In the Routes window, open a route's legs: **Every leg** sets them all at once, and each leg has its
own choice beside its length. A new route is open ground throughout. Adding a waypoint splits a leg
into two of the same terrain; removing one joins its two legs, keeping the first's terrain.

Travel times count the terrain: 10 miles of road and 10 of forest at 2 miles an hour is 15 hours.

## Journeys

A journey is routes in order, travelled end to end: Zhentil Keep to Phlan, then Phlan to Melvaunt.
Routes stay routes -- each can be edited, and be part of more than one journey -- and a journey only
says which to follow, in what order.

On the Routes window's **Journeys** tab:

- **New journey** names one; **Add a route** adds routes to the end, in order.
- The arrows reorder them, and the cross takes one out (the route itself stays).
- Each route runs whichever way joins it to the one before, so it does not matter which way it was
  drawn.
- The journey shows its total length and travel time, counting each route's terrain.
- Where two routes in a row do not meet, the journey says how many gaps it has and marks them; it
  crosses each in a straight line. Snap the ends together to close them.

Anyone can make a journey from any routes they can see; its maker and the GM can change it.
Deleting a route takes it out of every journey; deleting a journey leaves its routes.

## Show and hide routes

- **Hide a route from players** -- the eye on a route in the Routes window. Its maker and the GM
  still see it, faintly; nobody else does.
- **Turn routes off on your screen** -- the eye in the sub-menubar. It changes only what you see.

## The Routes window

The window lists the map's routes. Each shows its colour, its name and its total length, and below
that how many legs it has and how long it takes at a pace.

- **Times at** -- the pace the times are worked out at, chosen at the top right: with D&D 5e, the
  rules' paces, mounts and vehicles; in other systems, everyday ones. The time is shown as hours of
  travel and as travel days of 8 hours.
- Click a route's legs to list each leg's length.
- The coloured dot changes the route's colour; the crosshairs show the whole route on the map; the
  eye hides it from players; the bezier curve edits its waypoints; the pen renames it; the bin
  deletes it, after asking.

The window lists every route you can see. A route someone else drew shows their name, and only its
maker and the GM can change it.

## Follow a route with the odometer

On an animated scene, Scene Motion's Travel section has a **Route** choice listing the journeys and
routes on every map. Choose one, and its length becomes the odometer's destination -- converted to the scene's units,
so a 60-mile route on a map in miles is 60 miles on a scene measured in feet. The distance traveled is
then how far along the route the party has come.

While the odometer follows a route or journey, its destination is its length and cannot be typed,
and it keeps up as routes are reshaped. If it is deleted, the destination stays as it was. The
link-slash button stops following the route and keeps its length as the destination.

A route on a map in hexes or squares, or any unit that cannot be converted to the scene's, is listed
but cannot be chosen.

The map does not yet show where along the route the party is; the odometer's distance is the only
measure of progress for now.

## For macros

`game.modules.get('coffee-pub-cartographer').api.routes`:

```js
const { routes } = game.modules.get('coffee-pub-cartographer').api;

routes.list();                          // this scene's routes you can see: id, name, points, distance, units, legs
routes.list(sceneId);                   // another scene's
routes.journeys(sceneId);               // the journeys: id, name, routeIds, distance, gaps
routes.pointAt(id, 12, sceneId);        // where 12 (miles, say) along a route or journey reaches: { x, y, angle }
routes.draw();                          // start drawing one
routes.open();                          // open the window
```

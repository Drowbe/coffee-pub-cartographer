# Routes

**Audience:** GMs who want to measure a journey on an overland map -- how far it is from Zhentil
Keep to Phlan along the road, and how long that takes -- and have the scene-motion odometer count
the party along it.

A route is a line of waypoints drawn on a map scene. Cartographer measures it on the map's grid,
saves it with the scene, and draws it for everyone.

## Draw a route

In Cartographer's sub-menubar, the **Routes** section has two buttons: **Draw a route** and
**Routes on this map**, which opens the Routes window.

With Draw on:

- **Click** to place each waypoint -- the start, every bend in the road, and the end. The distance so
  far, and the length of the leg being drawn, follow the pointer.
- **Double-click** or press **Enter** to finish. Pressing the Draw button again also finishes.
- **Backspace** takes back the last waypoint. **Escape** gives up on the route.
- Right-drag still pans the map, and the mouse wheel still zooms, so a long road can be drawn
  across more than one screen.

Finishing asks for a name; closing that box without saving discards the route.

A route is measured as the true length of the line on the map's scale: a diagonal is as long as it
looks, not as long as Foundry's ruler would count it in squares. On a map whose squares are 5 miles,
a leg crossing ten squares' width is 50 miles.

## The Routes window

The window lists the map's routes. Each shows its colour, its name and its total length, and below
that how many legs it has and how long it takes at a pace.

- **Times at** -- the pace the times are worked out at, chosen at the top right: with D&D 5e, the
  rules' paces, mounts and vehicles; in other systems, everyday ones. The time is shown as hours of
  travel and as travel days of 8 hours.
- Click a route's legs to list each leg's length.
- The coloured dot changes the route's colour; the crosshairs show the whole route on the map; the
  pen renames it; the bin deletes it, after asking.

Only the GM can draw, rename or delete routes. Everyone sees them on the map, labelled with their
name and length.

## Follow a route with the odometer

On an animated scene, Scene Motion's Travel section has a **Route** choice listing the routes on every
map. Choose one, and its length becomes the odometer's destination -- converted to the scene's units,
so a 60-mile route on a map in miles is 60 miles on a scene measured in feet. The distance traveled is
then how far along the route the party has come.

While the odometer follows a route, its destination is the route's length and cannot be typed. If
the route is renamed it keeps following; if it is deleted, the destination stays as it was. The
link-slash button stops following the route and keeps its length as the destination.

A route on a map in hexes or squares, or any unit that cannot be converted to the scene's, is listed
but cannot be chosen.

The map does not yet show where along the route the party is; the odometer's distance is the only
measure of progress for now.

## For macros

`game.modules.get('coffee-pub-cartographer').api.routes`:

```js
const { routes } = game.modules.get('coffee-pub-cartographer').api;

routes.list();                          // this scene's routes: id, name, points, distance, units, legs
routes.list(sceneId);                   // another scene's
routes.pointAt(routeId, 12, sceneId);   // where 12 (miles, say) along it reaches: { x, y, angle }
routes.draw();                          // start drawing one (GM)
routes.open();                          // open the window (GM)
```

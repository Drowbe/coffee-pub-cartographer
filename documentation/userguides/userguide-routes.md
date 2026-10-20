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

**Draw route** is also at the top of the Routes window's Routes tab. With Draw on:

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

In the Routes window, open a route's card (the chevron before its name): **Every leg** sets them all at once, and each leg has its
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

The window has three tabs: **Routes**, **Journeys** and **Setup**.

On the Routes and Journeys tabs, each card shows its name and total length, and below that its legs
or routes and how long it takes at a pace. The chevron before the name opens it, for its pace, its
legs and their terrain, or a journey's routes in order.

- The coloured dot before a route's name opens a colour picker: any colour.
- The crosshairs show the whole route on the map; the eye hides it from players; the bezier curve
  edits its waypoints; the pen renames it; the bin deletes it, after asking.

The **Setup** tab holds what every route and journey on the map share:

- **Grid square** -- the map's grid, as the routes are measured on it.
- **Times at** -- the pace the times are worked out at: with D&D 5e, the rules' paces, mounts and
  vehicles; in other systems, everyday ones.
- **Travel day** -- how many hours a day the party plans to travel (8 to start). The GM sets it for
  the map, so everyone plans with the same day. Each time is the hours of travel the trip takes, and,
  when that is more than a day, the days it fills: "30 h of travel: 3 days of 8 h + 6 h". More than
  6 hours a day at a mounted pace warns that it is hard on the mounts; more than 8 warns that it is a
  forced march.
- **Follow world clock** -- see below; it is the map's, for all its routes and journeys.
- **Party marker** -- see below.

The window lists every route you can see. A route someone else drew shows their name, and only its
maker and the GM can change it.

## Follow a route with the odometer

On an animated scene, Scene Motion's Travel section has a **Route** choice listing the journeys and
routes on every map. Choose one, and its length becomes the odometer's destination -- converted to the scene's units,
so a 60-mile route on a map in miles is 60 miles on a scene measured in feet. The distance traveled is
then how far along the route the party has come.

While the odometer follows a route or journey, its destination is its length and cannot be typed,
and it keeps up as routes are reshaped. If it is deleted, the destination stays as it was.

The journey keeps its own progress, on the map. The animated scene is a view of it: its Play and
Stop, speed, ease, world clock and pace drive the journey, and its odometer reads how far the
journey has come. So a road scene can be reused for one journey after another -- choose a
different journey, and the first stops where it is and keeps its progress until you come back to
it. **Reset odometer** resets the journey too.

Terrain slows the party: a leg of forest takes twice as long as a leg of road, and when the party
reaches one, the scenery eases down to half speed until they are out of it. The arrival time counts
the difficult terrain still ahead. The Routes window shows each route's and journey's progress,
and the terrain the party is in, once it has set out. The link-slash button stops following the
route and keeps its length as the destination.

A route on a map in hexes or squares, or any unit that cannot be converted to the scene's, is listed
but cannot be chosen. Whether the journey follows the world clock is its map's setting; the scene
shows it rather than offering its own switch.

## Run a route or journey from the map

The GM can run a single route or a whole journey from its map, with or without an animated scene
showing it. The Routes
window's bar works as the Scene Motion window's does. From the left:

- **Play / Stop** -- the button says what pressing it will do. Stop eases the journey to a halt;
  Play eases it back up. Playing a journey that has arrived starts it again from the beginning.
- **Back to the start** (the rewind button) -- takes the party back to the beginning of the route or
  journey, after asking, since how far they had come is lost.
- **Speed** -- centred on zero, as a multiple of the pace. Right of centre runs onward, left of
  centre runs back along the way, and it snaps to a stop near the middle.
- **Which** -- the route or journey the bar runs, from the map's journeys and routes. It is outlined
  in the window.
- **The gear** -- shows and hides the settings. Hidden, the window is just the bar.

Each journey's and route's card, opened, holds its
**Pace**, how fast the party travels it, and **Reset** (the rewind button), back to the start. One
no animated scene shows needs a pace before it can set out; Play uses the pace chosen under **Times
at** if it has none.

**Follow world clock**, on the Setup tab, is one setting for the whole map -- there is one party, on
one clock. On, it ties where the party is to the world's date and time (Coffee Pub Blacksmith's
world clock, or Foundry's own time), on every route and journey on the map, including ones that set
out later. As the clock runs, they travel at the
pace, slowed by terrain; stopped, they stay put however much time passes. Scrubbing time moves them:
forward to where they will be, back to where they were then -- including back past a stop, to where
they were still travelling. Play, Stop or a change of speed or pace made after scrubbing back
replaces what had followed. An animated scene following a journey takes the map's setting; its scenery
speeds up with the clock to match.

While a route or journey is under way, the map shows only the routes it travels, and the same
odometer as an animated scene's -- distance travelled, how far is left, the arrival time and a
progress bar -- for everyone. It goes when the party comes to rest. Waypoints are shown only while a
route is drawn or edited; otherwise a route is its line and its label.

The **Routes** section of the sub-menubar has a Play button too: it plays or stops what the bar runs
on the map on screen.

If an animated scene follows the journey, it moves with these controls even though it is not the
scene on screen: Play on the map starts its scenery, the pace sets its ground speed, and its scenery
still slows in difficult terrain. The journey card names the scenes that follow it. Its own controls
work too; both drive the same journey.

At the end of the way the journey stops, for everyone, and is marked arrived.

## The party's marker

There is one party, so each map has one marker. Once the route or journey the bar runs has set out,
the marker appears where the party is, and moves along it as they travel -- for everyone, in step
with the odometer, and with the world time when it follows the clock, scrubbing included. Choose
another route or journey in the bar and the marker moves to where the party is on that one. It is a
Coffee Pub Blacksmith pin, so the GM styles it from the pin's own menu (Configure Pin): an icon, a
portrait, a wagon, its label and size.

- **Party marker**, on the Routes window's Setup tab, is the GM's: **Shown to players**
  switches it on and off for them (the GM always sees it), and **Change look** opens Blacksmith's
  Configure Pin window for it -- image or icon, shape, size, label, colours, animations. Before the
  party has set out there is no marker yet; Change look makes one at the start of the way, so it can
  be styled in advance.
- While the party is moving, the marker cannot be dragged. When they stop or arrive, it stays where
  they are.
- Setting out on one route or journey stops any other moving on the same map: it is one party.

With an older Blacksmith, the marker jumps to where the party is each time they stop, rather than
moving smoothly.

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

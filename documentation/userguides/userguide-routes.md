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

The trip -- the route or journey -- lives on the map: its pace, its time (real time or the world
clock), its progress and how difficult terrain slows it. The animated scene is a view of it that
says "we are travelling":

- Its scenery runs at the speeds set for its layers whenever the trip is moving, eases to a halt
  when it stops, and runs the other way when the trip runs back. It does not speed up with the clock
  or slow down on difficult ground; the trip does that, and the odometer shows it.
- Its Play and Stop are the trip's.
- Its odometer shows the trip's progress and arrival time.
- Its Pace and Follow world clock rows give way to a read-only **Travelling** line: "Riding horse
  (6 mph) · world clock, set on Faerun". They are changed on the map, in the Routes window.

So a road scene can be reused for one journey after another -- choose a
different journey, and the first stops where it is and keeps its progress until you come back to
it. **Reset odometer** resets the journey too. Playing it from the animated scene makes it the one its
map shows -- the Routes bar, the odometer on the map and the party marker -- and stops anything else
moving on that map, since there is one party.

Terrain slows the party: a leg of forest takes twice as long as a leg of road, and the arrival time
counts the difficult terrain still ahead. The Routes window shows each route's and journey's progress,
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
- **Time** -- the party always travels at its **pace**; the bar sets time, not speed.
  - Without the world clock, a slider sets how fast travel time runs: 1× is real time, then 10×,
    a minute a second, ten minutes a second, an hour a second. Left of centre runs back along the
    way. At an hour a second, a 6 mph horse covers 6 miles each real second.
  - Following the world clock (the map's Setup tab), the clock is the time: the bar chooses only
    onward or back, and shows the clock's rate. How fast time runs is set on Blacksmith's clock.
- **Which** -- the route or journey the bar runs, from the map's journeys and routes. It is outlined
  in the window.
- **The gear** -- shows and hides the settings. Hidden, the window is just the bar.

Each journey's and route's card, opened, holds its
**Pace**, how fast the party travels it, and **Reset** (the rewind button), back to the start. One
no animated scene shows needs a pace before it can set out; Play uses the pace chosen under **Times
at** if it has none.

The odometer's arrival time is hours on the road at the party's pace, slowed by terrain ahead --
travel time, whichever way time is run.

**Follow world clock**, on the Setup tab, is one setting for the whole map -- there is one party, on
one clock. On, it ties where the party is to the world's date and time (Coffee Pub Blacksmith's
world clock, or Foundry's own time), on every route and journey on the map, including ones that set
out later. As the clock runs, they travel at the
pace, slowed by terrain; stopped, they stay put however much time passes. Scrubbing time moves them:
forward to where they will be, back to where they were then -- including back past a stop, to where
they were still travelling. Play, Stop or a change of speed or pace made after scrubbing back
replaces what had followed. An animated scene following a journey shows the map's setting; its scenery
keeps its own speed.

While a route or journey is under way, the map shows only the routes it travels, and the same
odometer as an animated scene's -- distance travelled, how far is left, the arrival time and a
progress bar -- for everyone. It stays up while they are stopped or have arrived, and goes only
when nothing on the map is in progress: never set out, or reset to the start. Waypoints are shown only while a
route is drawn or edited; otherwise a route is its line and its label.

The **Routes** section of the sub-menubar has a Play button too: it plays or stops what the bar runs
on the map on screen.

If an animated scene follows the journey, Play and Stop on the map start and stop its scenery too,
even though it is not the scene on screen; the journey card names the scenes that follow it. Its own
Play and Stop work too; both run the same journey. Choosing another route or journey in the bar
while one is moving is a change of plan: the moving one stops, and the party is on the one chosen,
wherever it last was on it.

At the end of the way the journey stops, for everyone, and is marked arrived.

## The party's marker

There is one party, so each map has one marker. Once the route or journey the bar runs has set out,
the marker appears where the party is, and moves along it as they travel -- for everyone, in step
with the odometer, and with the world time when it follows the clock, scrubbing included. Choose
another route or journey in the bar and the marker moves to where the party is on that one. It is a
Coffee Pub Blacksmith pin, so the GM styles it from the pin's own menu (Configure Pin): an icon, a
portrait, a wagon, its label and size.

It is labelled with the party's name -- the world's primary party, as Blacksmith knows it -- or "The
party" when none is set. Renaming the party renames the marker, unless the GM has given it a label
of their own.

- **Party marker**, on the Routes window's Setup tab, is the GM's: **Shown to players**
  switches it on and off for them (the GM always sees it), and **Change look** opens Blacksmith's
  Configure Pin window for it -- image or icon, shape, size, label, colours, animations. Before the
  party has set out there is no marker yet; Change look makes one at the start of the way, so it can
  be styled in advance.
- **The GM can pick the party up and put it down.** Picking the marker up stops the party,
  whatever it was travelling. Dropped by a route's line, it snaps onto the line: the party is on that
  route -- or on the journey the map is showing, if the route is part of it -- at that point,
  stopped, and Play carries on from there. Put down anywhere but back on the trip it was on -- on
  another route, or off every route -- that trip is cancelled: stopped, and its odometer back to the
  start, along with any animated scene following it. Dropped off every route, the party is on none: Play says
  to put it on one, and the Routes tab offers **Draw from the party**, a new route starting where the
  marker stands. Choosing a route or journey in the bar also puts the party back on it. Players
  cannot move the marker.
- When the party stops or arrives, the marker stays where they are.
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

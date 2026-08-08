# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### CHANGED

- **The map is read from the scene, not guessed at a fragment at a time**: The mapper used to derive architecture from whatever walls were visible from each square the party crossed, snapping each fragment to the grid and then reconciling it against everything earlier passes had decided. Snapping is a decision, and those decisions were being made without enough information to make them — which boundary a wall sits on, how wide a doorway is, whether two fragments are one opening, where a corner closes. Seen from somewhere else the same wall answered differently, so the record carried merge, retraction and per-source attribution layers purely to argue with itself, and the map you ended up with depended on the route you walked. Some of those questions cannot be answered from a partial view at all: a corner needs both of its walls, a run of collinear wall needs the whole run, and a curve needs the whole fan of chords that drew it. The scene's architecture is now settled once, from the walls Foundry already holds, with everything in hand — and exploration is simply a mask over it. Walking around reveals this map; it no longer computes one.
- **The GM's trace is normalized, not reproduced**: A Foundry wall is not the architecture — it is a GM's mouse-trace over a *picture* of the architecture, laid down without ever seeing the line they were following. So it wanders a couple of degrees off square, overshoots its corners, and carries jogs where a click landed badly. None of that is intentional, and nobody in play ever sees it, because all a wall does for them is stop movement and sight. What the artist drew underneath was almost certainly square, so that is what gets drawn. A run is broken into the pieces it is really made of by asking where it stops being straight — a stretch that stays within half a square of the line between its own ends *is* that line, whatever wandering it did on the way, which disposes of every kind of trace noise at once because noise is by definition small. Straight is two things, not one: staying near that line **and pointing along it**, so a wall that steps from row to row is drawn as steps rather than flattened into one long diagonal. Anything under a square is not architecture and is dropped, and a wall that goes out and comes straight back has drawn nothing at all.
- **Straight walls are square, angled walls keep their angle, curves stay curved**: A run within a few degrees of square is made exactly square, on one shared row or column, so corners close by construction rather than by luck — and a long wall that genuinely drifts across a row steps rather than averaging onto the mean, which used to put one end a full square from where it belonged. A wall set at a real angle keeps it, drawn corner to corner so it still lands on the grid. A curve keeps its true shape and is redrawn smoothly through the points the trace gave, because a wide sweep is only ever traced as a handful of long chords and drawing those chords is drawing a polygon. What separates an arc from an angular room is the turn at each joint, not the length of the chords — an arc drawn with N chords across a quarter turn bends by 90/N at each joint, while a cut corner bends by forty-five however it was traced — and an arc has to actually bow away from the line between its own ends, or a wall that merely drifted would be kept crooked.
- **Rooms come out whole**: A boundary is drawn as soon as either square it separates has been explored, so standing in a room gives you the room rather than the fragments your sightlines happened to touch. Gaps mid-wall, corners that never closed, and walls drawn as several parallel offset lines are all gone with the incremental snapping that caused them. A wall crossing a square is drawn whole or not at all: smoothing leaves a curve as a chain of short pieces, and judging them one by one cut the middle out of every crossing.
- **Floor stops at the walls**: A map drawn on squares used to fill every explored square edge to edge, which turned a curved corridor into a staircase of blocks — the walls swept round while the floor beneath them stepped. Where a wall crosses a square, the floor is now cut back to it, with rock drawn behind the part cut away so the wall reads as the end of the floor rather than a line drawn over it. Which side is floor is settled when the square is first seen and never revisited: the point the party actually stood at, or the middle of the square if they saw it. Working it out afresh at drawing time meant reading the squares around it, and those change as the party walks — so a square would swap its floor for rock, or spill floor out past a wall, long after anyone had been near it.
- **Half-squares at the walls are floor too**: Seeing a square means seeing the middle of it, which is the right question for open floor and the wrong one for a square a wall runs through — the middle of one of those is very often inside the wall, so the party could be standing against it, looking straight at the floor in it, and the square still answered no. That left the far side of a curved corridor reading as solid rock until it had been walked square by square. Those squares are now taken on wherever they touch something seen, and cut back to their share. A room's flooring reaches them too, so a surface no longer stops short of its own edges.
- **Doors take their width and kind from Foundry**: Door, locked door and window come straight from the wall document, and an opening's width is measured from the whole cluster of fragments that authored it, so a one-square doorway is never drawn as a double door.
- **Wall edits are simply correct**: Adding, moving or deleting a wall rebuilds the scene's map. There is nothing to retract and nothing to reconcile.
- **Records only hold what is the party's**: A map now stores where they have been, the surfaces they chose, the symbols they placed, the secret doors they found, which way the floor lies in each square, and nothing else. The architecture is derived from the scene and never saved.
- **Detection window**: Now purely how far the party sees around their token as they walk, rather than how much the mapper re-examines per step.
- **One way to start a map, and it starts**: The plus button in the window's chrome is gone. Creating a map is what the card at the head of the Recorded Maps list is for, and having a second way to do it made the card look optional — while the card was the one that named the scene it would map. That card is now always offered, so a GM, who can record into anybody's map, can still start another once one exists. Choosing it begins recording rather than leaving Record to be pressed: it is offered only when a token is selected and it makes a map for that token on this scene, so pressing Record afterwards was a step with one sensible answer.

- **Rules for round rooms cannot reach square ones**: Everything the curve handling needs hangs off the scene's true wall lines, and a rectilinear scene produces none — no half-squares, no barriers, no floor clipping. A hand-traced dungeon of ordinary rooms and corridors is laid on the grid and left entirely alone by the machinery that draws caves and arcs.

### NEW FEATURES

- **The map list is gathered**: A campaign grows one map per character per scene, so the Recorded Maps list became a wall of near-identical rows, every one reading *someone at somewhere*, with no way to pick out the wanted one. Maps now sit under headings, read three ways from tabs in the top bar — **Scene**, **Character**, and **Just Mine** — with each row only having to name whichever of scene or character its heading does not. All three are on screen at once, so which one is in effect is read rather than inferred, and the choice is remembered per player. Whatever is in front of the reader comes first: the scene being stood in, or the character selected. The rest follow by how recently they were drawn on. **Just Mine** shows only the reader's own, by scene — and since Foundry considers a GM the owner of every actor, a GM's own maps are whichever token they have selected, the character they are currently speaking for, while a player gets every character they own rather than one of them.
- **Fix Things**: The mapper reads walls a GM traced over a picture of walls, so now and then it renders a corner the way the trace describes it rather than the way the room plainly is. Rather than guess harder, the map takes being told. Clicking any square offers **This is a floor** and **This is not a floor**, and marking sticks — a square struck off stays off however convincingly the sightlines later argue for it, and walking past cannot quietly restore it. Where in the square the click landed is kept and used: a square a wall cuts through is part floor and part rock, and the point clicked is known to be on the floor side of it, which is the one thing about such a square that nothing else can establish. A square marked as floor also joins the flooring of the room it joins. Rock offers the Fix menu alone, since every other annotation belongs to floor.

### FIXED

- **The menubar's map menu does something**: Every item in it named its handler `callback` -- which is what Foundry's own context menus use, and what the map window's menus use -- while the menubar calls `onClick`. So the menu opened, listed the right things, and did nothing whichever one was chosen, leaving the button looking like it only opened the window. The menu also now offers pausing and resuming, so recording can be run from the bar without the map open, which is the whole point of the button. Starting to record refreshes the button where the mode is actually set rather than where it is announced, so the icon cannot be left reporting the wrong state by a path that changes mode quietly. The icon itself needed a fix in Blacksmith to move at all: the menubar decides between rebuilding and a cheap refresh from a fingerprint that did not include a tool's icon, so the button kept whichever icon it was first drawn with however often it was re-registered. **Requires Blacksmith 13.15.4 or later.**
- **Following actually follows**: The view was centred on the party when following began and then left there. Every step after that redrew the map around a camera still pointing at where the party started, so the marker walked off the edge while the window sat still. Two separate things had to be true for the view to move and only one of them was: it re-centred on a redraw when the party was being *recorded*, never when they were merely being followed. The party is also drawn from the move itself now rather than from the token document -- following redraws the instant a move is reported, and at that point the document can still be carrying the coordinates it is moving away from, which is what put the marker a square behind the party. Following pins the marker at the centre of the view the way recording does, so the party no longer drifts while the camera catches up.
- **A step writes one map, not the whole scene**: A scene flag has no partial update of its own, so every change wrote the entire container back -- every character's map on the scene, serialized to the database and broadcast to every connected client -- for one party's single step. With a full party on a well-explored scene that was a quarter of a megabyte a move, growing all session as the maps filled in. A document update addresses a path, and the path can reach inside the container to one Actor's key, so now only the map that changed crosses the wire: five to six times less at party scale, and flat as the maps grow rather than rising with them. The forced-replacement marker is used only where there is already a map to replace, since Foundry drops one whose target does not exist and that would have lost a character's first map on a scene somebody else had already mapped. Deletions still speak for the whole scene, because an absence cannot be sent as a record.
- **Nothing is read until it is looked at**: Every map in the world was read, validated and held in memory when the module loaded, and again on every scene change -- for maps on scenes nobody had visited, belonging to characters nobody was playing. Foundry already holds every scene's flags in memory, so all of that was a second copy of data that was already there: at six players across sixty scenes, 360 maps, 450ms and 17MB, every time the canvas changed. Maps are now indexed rather than read -- who, where, when and how much, which is everything the list shows -- and a map is validated in full the moment it is opened or drawn. The same campaign now indexes in 2ms and holds exactly the one map on screen. Saving still writes back every map on the scene, including the ones this client never read.
- **A map opened for elsewhere draws its own scene**: Looking at the map of the tavern while standing in the dungeon drew the dungeon's walls across it. The architecture was read from whichever scene was in play rather than from the one the map belongs to; each scene's is now kept separately, and a scene that is not on screen is measured from its own recorded grid.
- **The list heading is legible**: Foundry styles headings for its own window chrome, which is dark, so *Recorded Maps* arrived in near-white on the tool's light surface.
- **The map menu opens on a left click**: Panning is a right-drag, and a right-drag ends in a right-click as far as the browser is concerned — so the menu and the pan were the same gesture, separated only by watching how far the pointer had moved and then ignoring the menu for a moment afterwards. That was a race, and it was lost often enough to be worth removing rather than tuning. Left to open, right to pan. Squares that have no element of their own — rock, which is drawn straight through by pointer events, and anything past the hatched band, which is not drawn at all — are found from the grid's own geometry, so every square can be clicked and not only the explored ones.
- **Flooring no longer runs out through a curved wall**: Curves and angled walls do not sit on the boundary lattice, so nothing recorded that they were in the way, and surfacing a room poured straight through them into whatever lay beyond. A wall now records which steps between squares it blocks, whether or not it lies on the grid.
- **Dragging a token maps the same as stepping it**: A drag reports every square the route passed through, and in a curve most of those have their middles inside the masonry. Taking the middle as floor there kept the wrong half, so dragging across a bend spilled floor out of it while walking the same route square by square did not.

## [13.1.0]

### NEW FEATURES
- **Follow mode**: The map window can now track a token without recording anything. The marker and viewport follow live movement like a GPS, and because following never writes to a map it can be pointed at any map in the list — including another character's — so one player can act as the party's cartographer while the others drive. Walking a followed token onto ground the open map does not cover offers to start recording, asked at most once per follow session so a long unmapped corridor cannot become a stream of dialogs.
- **Floor surfaces**: Explored areas can be given a material — brick, cobblestone, dirt, grass, rock, tile, or wood — from the map's context menu. A surface applies to a whole contiguous area in one click, spreading outward from the chosen square and stopping at any recorded wall or doorway, so surfacing a room never bleeds into the corridor it opens onto. Choosing a surface names the *area* rather than the squares that happened to be mapped at the time: as exploration fills in the rest of that room the new squares adopt its surface, while a genuinely new area stays default until it is named. Default doubles as the eraser.
- **Solid rock hatching**: The ground around the mapped area is drawn as pen-and-ink hatching in the old-school convention, packed hard against the walls and thinning over three rings so the band trails off rather than stopping at a hard edge. It is derived from the explored squares at draw time and never persisted, and deliberately says nothing about what is actually out there.
- **Endless map canvas**: The map spans only the drawn bounds plus a three-square margin, wherever those bounds sit, and grows on its own as exploration reaches an edge. The grid was previously always scene-sized, so a handful of rooms rendered inside a large empty sheet.
- **Locked doors**: Foundry records the lock on the wall itself, so a locked door is now drawn with the official bolt marking without any authoring.
- **Recorded map thumbnails**: The Recorded Maps list shows a silhouette of each map, drawn to a small cached canvas keyed on the map's last change. None are generated unless the list is actually on screen.
- **Status bar**: The window footer is now a status bar carrying the tracked character's portrait and name on the left and the mapped distance on the right. Zoom and centring moved up to the top bar, and the Record button carries its label.
- **Mapping indicator**: A spinner beside the recording dot says the map is still being drawn, covering the moment between a move finishing and its linework arriving. An area that has not filled in yet reads as pending rather than as a square the map missed.
- **Recording indicator**: A pulsing dot in the corner of the map shows that movement is being recorded even while the window's bars are hidden, and holds steady in amber when recording is paused.
- **Map creation card**: Opening the window on a scene with no map you could record into now lands on the Recorded Maps list, led by a card offering to create one here.
- **Symbol names**: Placed map symbols carry a tooltip naming them.
- **Menubar quick actions**: Right-clicking Cartographer's menubar button now opens a native quick menu for Party Maps, every drawing mode, and role-appropriate drawing cleanup without opening the full secondary toolbar.
- **Map placeables**: Right-clicking an explored map square now opens Blacksmith's shared context menu with direct symbol categories for stairs and ladders, traps and mechanisms, pits and shafts, water, fire, structures, seating, workspaces, storage, sleeping, decor, and utility. Fifty lightweight inline-SVG map symbols stay crisp at every zoom; Actor owners and GMs can replace or remove the square's single persisted symbol.
- **Discovered secret doors**: Secret doors continue to look like ordinary walls until the tracked token actually crosses their Foundry wall segment, after which the map permanently promotes that edge to the official S-style secret-door symbol.
- **Old-school party mapper**: Added a Mapping tool for square-grid scenes. It opens a separate Glass-themed Blacksmith Tool window where recording permanently maps the 5×5 grid area surrounding one controlled token as it moves.
- **Shared persistent maps**: Maps are stored as party-visible Actor+Scene records and synchronized to connected users. The Recorded Maps view lists maps from every scene, while recording remains limited to the current scene.
- **Map ownership controls**: Everyone can view the party's maps. An Actor owner or GM can add, continue, rename, reset, or delete that Actor's maps.
- **Map window controls**: Added Map/List views, zoom, center-on-token, remembered pan position, mapped-distance status, tracked-token status, and confirmed map-management actions.
- **Mapping configuration**: Added world settings to enable the mapper and allow or deny player mapping.
- **Placeholder map presentation**: Added theme-aware grid tiles and a party marker using Blacksmith's Tool content-surface variables, ready for later hand-drawn asset replacement.

### Fixed
- **Multiplayer mapping accuracy**: A player recording on their own client now produces the same map a GM would. The client used to report only where its token ended up, leaving the GM to reconstruct the route as a straight line from wherever its own copy of the record thought the token had been. A move around a corner is not a straight line, so that reconstruction cut corners and walked through walls, and it needed a growing pile of state — a per-session authoritative position, a fallback to the stored last position, and a teleport reset — to guess from the right place. Foundry already reports the route it took, so the client now sends the squares it actually crossed and the GM walks exactly those. Every square is sampled from the middle of the square it belongs to, so the reading no longer depends on where in a square the token happened to be. All of the origin-guessing state is gone with the guess.
- **Marker position while recording**: The party marker no longer appears on a square the map has not confirmed. It is hidden from the first sign of movement until the map comes back with where the move ended, then fades in there. It previously showed a provisional position throughout, which meant it could be wrong and appeared to jump when the map caught up — and where the party is standing is the one thing on the map that has to be right. Hidden-then-correct cannot be wrong, and there is nothing on screen to jump from. If a confirmation never arrives, the marker gives up waiting after a few seconds and shows itself at whatever the map does know, so a dropped update cannot hide it for a whole session.
- **Movement reports and doubling back**: A move is reported once, from the whole route, rather than once per update. Foundry restates the route so far on every update while a move plays out, so accumulating them recorded the token going forwards, then back, then forwards again. The route for a movement is now replaced on each update and only committed when a new movement begins.
- **Durable map deletion**: Deleting a map now actually persists. Setting a flag performs a recursive merge, so writing a map collection with an Actor key removed reads as "no change to that key" rather than as a deletion — every delete survived in the database and returned on reload, which is why a deleted map kept coming back. The scene flag is now written as an explicit replacement so a removal sticks, and the local suppression that hid the map in the meantime reconciles against the authoritative record instead of hiding it forever.
- **Centred party tracking**: The map holds its position across renders. View state used to live in the DOM as a scroll offset and an inline margin, both destroyed on every reveal because the window re-renders its whole body — and ApplicationV2 has no scroll-preservation step to restore them. The camera is now plain window state re-applied after each render, so the map cannot jump to a corner mid-movement. While following, the marker is pinned to the exact centre of the viewport, so it holds still and the map slides beneath it instead of drifting off-centre and snapping back.
- **Settled movement**: Dragging a token reliably lands the mapped position on the square where it stopped. Nothing is reported until the token has been still briefly, and stopping recording flushes whatever route was still in flight, so the final square is always recorded.
- **Windows**: Windows are detected and drawn again, and now use a proper glyph rather than a blue line — the map is pen and ink, and a colour was the one thing on it that could not have been drawn. Two separate faults were at work: classification required a window to threshold *both* sight and light, which misses the ordinary case of a window that passes light normally; and persistence validated feature-source names against a hardcoded list of two kinds, silently discarding every window observation on its way into the record. Windows are also clustered and marked like doorways now, so one window yields one symbol instead of a mark per sample.
- **Wide doors and windows**: An opening is drawn as wide as it really is. Doorway glyphs were four hardcoded coordinate sets that could only ever be one square across, so a warehouse door rendered as a single small box. Openings now mark every square they cross and the renderer joins those marks back into one symbol, which also means a long opening is still recorded when its midpoint happens to fall out of sight.
- **Path-independent records**: The map no longer depends on the route walked through it. Which of two squares owned a boundary was decided by the observer's distance, so walking a corridor one way and then back recorded the same wall two different ways — fragmenting wide openings and making artifacts irreproducible. Boundaries are stored in one canonical form and the renderer resolves which square draws them.
- **Diagonal and curved walls**: A diagonal wall is drawn as a closed staircase instead of disconnected treads. Boundary classification took its orientation from the whole wall document, so every sample along a 45° wall snapped the same way and left every corner open. Connected walls are also walked as one run, so steps join across the joins between wall documents — which is where a curve's gaps actually fall.
- **Corner artifacts**: Two openings meeting at a corner are no longer fused into one span running diagonally through open space. Fragment clustering checked whether they shared a square before checking whether they shared a heading.
- **Locked door handling**: Locked doors take part in the same doorway reconciliation as ordinary ones and are marked once per door. Both behaviours were keyed on a string prefix that `locked-door` does not match, so a locked door skipped the stale-edge cleanup and was drawn once per sample. The bolt marking is also drawn well clear of the door box, so a wide locked door no longer reads as two ordinary ones.
- **Secret door glyph**: A secret door is drawn as unbroken wall carrying its S marking. It previously left a gap in the stroke, which read as an ordinary opening — the opposite of what a secret door means.
- **Mapping churn during movement**: A reveal is no longer forced on every sub-square nudge. Foundry turns tokens to face their movement, so almost every move reported a rotation change, which defeated the same-square guard and re-walked the whole path each time.
- **Dark and Glass map surfaces**: The map carries its own palette instead of borrowing the window's. It used the shell's scrim as paper while hardcoding black ink, and scrim turns near-black in Dark and Glass — leaving black ink on black paper. Paper and ink are now declared as a pair per theme. In Glass the translucency applies to the undiscovered area only, so explored rooms read as solid paper floating over the canvas.
- **Reachable map symbols**: The Treasure symbol was defined but belonged to no category, leaving it unreachable from the context menu. Symbol categories are consolidated from twelve to five, sorted alphabetically by their translated names, gathered under one Placeables group, with floor surfaces moved below the per-square actions.
- **Teleport-aware mapping**: Foundry Region warps and other teleport movement now reset the mapper directly to the destination and reveal only the destination's visible area. The mapper no longer reconstructs an artificial walked path through every grid square between the teleport origin and destination.
- **Durable map deletion**: Reveal processing and map mutations now share one ordered GM-side queue, so an older in-flight reveal cannot recreate a map after Delete removes it. Deleted map IDs remain tombstoned against late reveal packets; deliberately starting Record explicitly creates a fresh map and clears that tombstone.
- **Source-aware wall reconciliation**: Persisted map geometry now retains the Foundry Wall source behind each abstract edge. Re-observing a wall or doorway replaces that source's earlier opposing placement instead of accumulating a false one-cell box or double door. Distinct opposing sources remain intact, preserving real one-grid hallway walls and doors flanked by structural walls. Existing maps repair progressively as their structure is observed again.
- **Corner-safe floor visibility**: Candidate floor squares now require visibility to their center and at least two nearby cardinal samples. Rays that merely graze a closed wall endpoint no longer reveal thin floor slivers or structure behind the join; the token's occupied square remains guaranteed for narrow passages.
- **Single-glyph door normalization**: Door-wall fragments whose midpoints share one Foundry grid square are collapsed to their first and last endpoints before snapping, even when decorative or curved fragments change angle inside that square. Re-observing the normalized doorway repairs older maps by removing the stale parallel door edge across the same square. Revealed secret doors perform the same targeted repair on their former opposing wall without erasing the corridor walls beside them.
- **Mapper initialization order**: The Mapping window is now imported lazily when opened, after Blacksmith's ready-time API is available, instead of reading `game.modules` during Foundry's early ES module loading phase.
- **Mapping from secondary GM clients**: A GM now applies and persists discoveries from their own controlled token locally instead of being blocked when another connected GM is Foundry's designated `activeGM`. Player-originated discoveries still require active-GM validation.
- **Foundry v13 grid coordinates**: Mapping now calls `getOffset({x, y})` and reads its `{i, j}` row/column result. The former legacy-shaped call produced `NaN,NaN` cell keys, which were discarded by state validation and left the map visually empty.
- **Single-grid map presentation**: Removed the second floating map grid and its white border. The Glass window's grid is now the map itself: each square represents one scene grid cell, unexplored squares remain dark, and explored squares fill in directly for future floor, wall, and doorway tile layers.
- **Simplified map tiles**: Explored floor tiles are now borderless solid fills with no decorative texture or inset outline.
- **Centered party tracking**: The party marker stays fixed in the middle of the Tool window while the map recenters beneath it after movement and zoom changes.
- **Wall element classification**: The mapper now reads placed Wall document fields directly and limits rendering to physical walls, windows, and regular doors. Terrain, invisible, and ethereal boundaries are ignored; secret doors deliberately render as ordinary walls to avoid revealing them to players. Strokes use simple solid colors: black walls, blue windows, and orange doors.
- **Token-relative map tracking**: The map pin is attached to the tracked token's actual grid cell again. The viewport now pans immediately after each move to keep that cell centered, with dynamic scroll margins so tokens near any scene edge can still reach the center.
- **Larger mapping footprint**: Each token step now reveals a 5×5 area centered on the tracked token, providing a more readable old-school map than the original 3×3 footprint.
- **Old-school wall linework**: Replaced whole-cell wall fills with a graph-paper tile vocabulary. Foundry walls are simplified into horizontal and vertical strokes, corners, junctions, and deliberate stair-steps instead of reproducing exact wall coordinates. Windows render above walls, and doors render last so short doorway segments are not erased by neighboring walls.
- **Stable token following**: Token movement now relocates and recenters the party marker directly, even while crossing previously mapped cells. Mapping window renders are serialized and duplicate state broadcasts are ignored, preventing competing renders from restoring stale scroll positions and making the map jump.
- **Hand-drawn map strokes**: Increased wall, window, and door line weight and added subtly bent paths with a faint second ink pass. Shared endpoints remain exact so the sketch treatment keeps corners and junctions connected.
- **Reliable discovery accumulation**: Ordinary mapping updates now merge explored cells instead of replacing them with queued scene snapshots. Rapid movement can no longer let an older persistence update erase the newly mapped cells in front of the tracked token; explicit map resets still replace the state normally.
- **Floor grid**: Added a very light graph-paper grid to explored floor cells, preserving spatial scale without competing with the heavier hand-drawn wall, window, and door strokes.
- **Map interaction cleanup**: The Cartographer Mapping tool now opens the map for viewing instead of toggling recording. Record/Stop lives inside the map window, right-drag pans like the Foundry canvas, native scrollbars are hidden, and Street View identifies the launcher and tracked party position.
- **Rebased default zoom**: Increased the base map-cell size so the former 160% presentation is now the clearer 100% default scale, while retaining the same zoom controls and range.
- **Selected-token map context**: Opening Mapping with one selected token loads its existing scene map without forcing the viewport onto the live token. Record adds its movement, Stop retains the selected-token view, and changing selection while viewing updates the map context.
- **Predictable map navigation**: Removed mouse-wheel zoom in favor of the footer's explicit zoom buttons. Manual pan and zoom preserve the inspected map location; starting Record and every subsequent recorded token move resume smooth token following, while the Center button remains the explicit way to refocus when viewing.
- **Tile reveal animation**: Newly discovered floor and linework tiles fade and settle into place without replaying the animation on existing tiles during zoom, pan, wall updates, or ordinary rerenders. Reduced-motion preferences disable the effect.
- **Smooth movement recentering**: After manual map panning, token movement now scrolls the map smoothly back beneath the centered party marker instead of snapping there instantly.
- **Stable Record/Stop viewport**: The mapper now preserves its dynamic centering margin along with scroll coordinates, so stopping recording no longer shifts the map into the upper-left corner.
- **Distance mapped**: The map footer now reports feet mapped at five feet per discovered grid square instead of displaying the raw cell count.
- **Exploration-aware features**: Maps now persist only the abstract wall, window, and door strokes the recorded token could experience from each 5×5 reveal. Sight-blocking geometry prevents walls behind walls from leaking onto the party map, terrain walls remain ignored, and viewing an old map never rescans its live scene.
- **Reliable experienced-wall detection**: Structural discovery now uses Foundry's authoritative sight-collision backend instead of depending on a rendered token vision polygon on the GM client. Nearby corridor walls, windows, and doors are retained while intervening walls still hide geometry behind them.
- **Map window chrome**: Removed the floating control palette from the map surface. Map/List, Record/Stop, Add, and Reset now use the existing top toolbar; zoom out, center, zoom in, and the zoom readout use the footer beside mapped distance.
- **Queued path mapping**: Long and rapid token moves are now reconstructed as an ordered path through every crossed grid square. The mapper reveals and samples structure as if the token paused at each step, periodically yields for UI responsiveness, and keeps the party marker on the last completed map step until the drawing catches up.
- **Old-school door glyph**: Regular doors now use the guide's black wall-and-centered-box symbol, rotated to match horizontal or vertical placement, instead of an orange wall stroke. The glyph keeps the mapper's slightly hand-drawn line treatment.
- **Hover window chrome**: The complete Cartographer toolbar and footer now disappear when the pointer leaves the Tool window and return as theme-aware, slightly translucent overlays on hover or keyboard focus. The hidden bars reserve no empty space and their return does not resize or shift the map. List-item management controls appear only on their row.
- **Persistent map-row actions**: Rename and Delete remain visible on every manageable map entry in Recorded Maps instead of appearing only while that row is hovered. The window toolbar retains its hover-only overlay behavior.
- **Line-of-sight floor mapping**: The mapper now visibility-checks every candidate floor square before adding it to the recorded map. The 5×5 sampling neighborhood no longer reveals rooms or corridors hidden behind walls, and structural symbols remain limited to the same visible area.
- **True-position visibility sampling**: Replayed movement now casts visibility from the token's real pixel path instead of snapping each sample to its grid center. Curved or narrow passages whose walls share a token grid square no longer move the synthetic observer across the wall; the occupied square is always recorded even when its center lies beyond that wall.
- **Grid-boundary wall snapping**: Visible Foundry wall segments now snap to the nearest mapped grid boundary. Curved walls become continuous old-school stair-step boundaries instead of disconnected centerline hooks, and doors/windows use the same boundary vocabulary.
- **Selection-aware recording pause**: Recording now pauses instead of stopping when the tracked token loses control. Reselecting that token resumes from its current position without drawing across the paused interval; Stop remains available while paused.
- **Stable structure observations**: Doors now produce one midpoint symbol instead of one glyph per wall sample. Walls, windows, and doors snap to observer-independent grid boundaries, and re-observing an edge refreshes its classification instead of retaining stale alternatives.
- **Settled-movement catch-up**: Token destinations are now read directly from Foundry's update payload, followed by a short catch-up pass after movement settles. The queued map always finishes at the token's real grid cell instead of remaining one move behind.
- **Recording-only party marker**: The token marker is now shown only during an active recording session. Viewing a completed map presents the map by itself and centers on its explored drawing rather than a live token position.
- **Map-view control cleanup**: Removed the destructive clear/reset button from the map view. Destructive map management remains in the Recorded Maps list, where the target map is explicit.
- **Actor-and-scene map identity**: Replaced the single shared scene map with one map per Actor per Scene, including migration of the legacy scene map into the first Actor map continued on that scene.



## [13.0.7]

### Added
- **Settings introduction**: Added a concise introduction explaining Cartographer's temporary canvas drawing tools.
- **Feature planning**: Restored the project TODO with planned clipboard export, persistent Drawings, and an old-school mapping tool.
- **Mapping tool plan**: Added a phased implementation plan for a persistent party map. A player opens a Glass-themed Tool window from Cartographer and uses its Record button to begin revealing the 5×5 grid area around their controlled token; Stop ends recording without closing the map. The plan covers synchronization, permissions, rendering, placeholder and hand-drawn tiles, testing, and future wall-aware mapping.

### Changed
- **Simplified settings hierarchy**: Reorganized module settings under one H1 and two description-free H2 sections: **Configuration** for player-drawing enablement and erase timing, and **Drawing** for personal hotkey controls. Removed the unnecessary H3, H4, and divider headings.
- **Player-visible setting context**: Made headings that contain user-scoped settings user-scoped as well, so players see the same section context as the GM. Actual setting scopes and behavior are unchanged.
- **Settings workflow groups**: Assigned visible settings to their Configuration or Drawing group so each control remains associated with the correct heading.


## [13.0.6]

### Added
- **Toast notifications**: New `scripts/utils-toast.js` wraps Blacksmith's Toast API with a `notify(title, options)` helper — severity presets (info/warn/error) supply the accent color and default icon, and toasts are tagged with `moduleId` so Blacksmith can clear them as a group. Falls back to `ui.notifications` when Blacksmith is absent or predates the API.

### Changed
- **User feedback now uses toasts**: All six `ui.notifications` calls (clear, clear all, undo, timed erase) replaced with Blacksmith toasts. Messages gained a subtitle carrying the detail — clears report how many drawings were removed, undo says whether another one remains — and repeat actions use `stackKey` so rapid clicks replace the toast in place instead of stacking. Clearing with nothing to clear now reports "Nothing to clear" as a warning rather than claiming a clear happened.
- **Menubar button color**: Removed the explicit `iconColor` / `buttonNormalTint` / `buttonSelectedTint` keys from the menubar tool registration; the button takes Blacksmith's default coloring. They were already `null`, which Blacksmith coalesces to the default, so this is a code cleanup with no visual change. Group banner color and the destructive-button tints are unchanged.
- **Toolbar sizing**: The secondary bar now registers with Blacksmith's `size: 'default'` preset (30px) instead of a pixel `height`. Blacksmith ignores `height` and warns on it. Group banners are now additive rather than subtractive, so toolbar buttons render at full size under their banners — the old 38px was only buying banner room.

### Removed
- **`toolbar.height` setting**: Removed along with its localization strings. Under Blacksmith's scale-factor model, bar height drives every font, icon and gap in the bar, so a free-number slider was a typography control mislabelled as a height — and being client-scoped, two people at the same table saw different-sized text.

## [13.0.5]

### Fixed
- **Blacksmith bootstrap order**: Initialization could throw `Cannot read properties of null (reading 'postConsoleAndNotification')` when Cartographer’s `ready` ran before Blacksmith wired window globals like `BlacksmithUtils`.
  - Settings registration now prefers `game.modules.get('coffee-pub-blacksmith').api.utils.postConsoleAndNotification`, with safe fallbacks so registration never fails on that path.
  - When Blacksmith is active, `ready` awaits `BlacksmithAPI.waitForReady()` before registering settings and registering the module with Blacksmith.
  - Module registration uses `module.api.registerModule` first, with a fallback to `BlacksmithModuleManager` for older setups.

## [13.0.4]

### Added
- **Sketch**: Freehand drawing mode (renamed from the former “Line Tool”). First button in Drawing Mode.
- **Line Tool**: New straight-line mode. Draws a single segment from start point to end point (same interaction as Box/Ellipse: start on first move, finish on key release). Uses `fa-solid fa-slash-forward` icon.
- **Ellipse Tool**: New shape mode. Draws ellipses in a bounding box (start → end), with solid/dotted/dashed styles and sync. Uses `fa-regular fa-circle` icon.
- **Stamp Style group**: Toolbar group for “which stamp shape” when Stamp is selected
  - **Drawing Mode** (Sketch, Line, Box, Ellipse, Stamp): Chooses tool
  - **Stamp Style** (Plus, X, Dot, Arrow Right/Up/Down/Left, Rounded Square): Chooses stamp shape; behaves like Color / Line Style / Line Weight (option only, does not change mode)
  - **Stamp** button: When selected, uses the current Stamp Style for stamping on click
- **toolbar.stampStyle** setting (user scope, hidden): Persists selected stamp shape; legacy symbol modes are migrated to `drawingMode: stamp` + `stampStyle: <shape>`

### Changed
- **Drawing Mode** order and tools: **Sketch** (1), **Line Tool** (2), **Box** (3), **Ellipse** (4), **Stamp** (5)
  - Legacy freehand “Line” is now **Sketch**; saved `'line'` is migrated to `'sketch'`
  - **Box** icon: `fa-regular fa-square`
  - **Ellipse** icon: `fa-regular fa-circle`
- **Tooltips**: Removed hotkey text from tooltips so they stay correct when the hotkey is reconfigured in Foundry
- **Early-Exit When No Drawings**: Cartographer skips work when there is nothing to clear or broadcast
  - **updateScene hook**: Clears and broadcasts only when the canvas has Cartographer drawings; no-op when empty
  - **clearAllDrawings()**, **clearUserDrawings()**, **cleanupExpiredDrawings()**, **cleanupPlayerDrawings()**: Early return when there are no drawings (no broadcast, no log where applicable)
- Reduces console and socket traffic when another module fires scene-update hooks often and the canvas has no Cartographer drawings
- **toolbar.drawingMode** default set to `'sketch'`

### Technical
- Drawing mode: `drawingMode` is `'sketch' | 'line' | 'box' | 'ellipse' | 'stamp'`; `stampStyle` is used when mode is `'stamp'`
- Added `setStampStyle()`, `updateStampStyleButtons()`, Stamp Style group (order 6)
- Line tool: `startLineDrawing`, `updateLinePreview`, `finishLineDrawing`, `lineStartPoint`; reuses line broadcast/`createRemoteLine`
- Ellipse: `startEllipseDrawing`, `updateEllipsePreview`, `finishEllipseDrawing`, `_drawEllipseWithStyle`, `createRemoteEllipse`
- `_pixiDrawings.length === 0` / `?.length` guards to avoid log spam when updateScene is fired repeatedly

## [13.0.3]

### Added
- **Group Banners**: Added visual banners above toolbar button groups
  - Enabled group banners in secondary bar configuration
  - Custom banner background color (green theme: `rgba(33, 77, 16, 0.9)`)
  - Banners automatically display group names for better organization

### Changed
- **Settings Scope Migration**: Migrated 9 settings from `client` scope to `user` scope for Foundry v13 compatibility
  - Personal preferences now persist across devices per user
  - Migrated settings: `drawing.hotkeyEnabled`, `drawing.hotkeyMode`, `drawing.blockWhenTyping`
  - Migrated toolbar state settings: `toolbar.drawingMode`, `toolbar.symbolSize`, `toolbar.lineWidth`, `toolbar.lineStyle`, `toolbar.color`, `toolbar.timedEraseEnabled`
  - `toolbar.height` remains `client` scope (screen-resolution dependent)
- **Group Names**: Updated all toolbar group names to user-friendly labels
  - `mode` → `Drawing Mode`
  - `symbols` → `Stamp Size`
  - `line-width` → `Line Weight`
  - `lineStyle` → `Line Style`
  - `color` → `Color`
  - `erase` → `Utilities`
  - Group names now support spaces and proper capitalization for better readability

### Technical
- Updated group definitions to use descriptive names with spaces
- All group references updated throughout codebase (24 tool registrations)
- Settings now use Foundry v13's new `user` scope for cross-device persistence
- Group banners leverage Blacksmith API's `groupBannerEnabled` feature


## [13.0.2]

### Changed
- **Menubar API Integration**: Updated to support Blacksmith's updated Menubar API
  - Migrated from nested `Menubar` object pattern to direct API methods
  - Changed from `blacksmith.Menubar.registerTool()` to `api.registerMenubarTool()`
  - Updated API access pattern to use `game.modules.get('coffee-pub-blacksmith')?.api` directly
  - Improved error handling and API availability checks
  - Enhanced compatibility with latest Blacksmith module version

## [13.0.1]

### Added
- **Box Drawing Tool**: New drawing mode for creating rectangular boxes
  - Key-based activation (no mouse clicks required)
  - Real-time preview as mouse moves
  - Works with both hold and toggle hotkey modes
  - Supports all line styles (solid, dotted, dashed)
  - Full multi-player synchronization
- **Configurable Hotkey System**: Enhanced keybinding configuration
  - Hotkey enable/disable setting
  - Hold vs. toggle mode selection
  - Option to ignore hotkey while typing in chat/forms
  - Hotkey appears in Foundry's Configure Controls for easy rebinding
- **Toolbar Height Setting**: Configurable toolbar height slider
  - Client-scope setting (per-user preference)
  - Range: 15-100 pixels
  - Default: 38 pixels
  - Adjustable in Module Settings → Common Settings

### Changed
- **Keybinding System**: Migrated to Foundry's native keybinding API
  - Replaced manual `document.addEventListener` with `game.keybindings.register`
  - Better integration with Foundry's keyboard routing (v13+ compatible)
  - Users can now rebind the hotkey in Settings → Configure Controls
  - Improved focus handling (respects `game.keyboard.hasFocus`)
- **Box Tool Position**: Moved box button to order 2 in toolbar (after line tool)

### Fixed
- **Shadow Rendering**: Fixed "second set of dots" issue for filled symbols
  - Circle/dot shadows now render correctly (cleared lineStyle before fill)
  - Arrow shadows now render correctly (cleared lineStyle before fill)
  - Rounded square shadows now render correctly (cleared lineStyle before fill)
  - Box shadows always use solid style (not affected by line style setting)
- **Event Handler Leaks**: Fixed `detachCanvasHandlers()` to match capture flag
  - Prevents accumulation of event handlers across activations
  - Eliminates potential double-drawing and janky behavior
- **Box Drawing Completion**: Fixed box finishing at correct mouse position
  - Now uses stored last mouse position instead of synthetic event
  - Prevents boxes from finishing at (0,0) or incorrect coordinates

### Technical
- Added `lastMousePosition` state tracking for box drawing
- Improved mouse position retrieval for key-based drawing completion
- Enhanced `finishBoxDrawing()` with multiple fallback methods for coordinate retrieval
- Added `createRemoteBox()` method for remote box synchronization

## [13.0.0]

### Added
- **Drawing Tool**: Full-featured canvas drawing system with PIXI graphics
  - Real-time drawing with backslash (`\`) key activation
  - Line drawing with configurable width (thin, medium, thick)
  - Multiple line styles: solid, dotted, dashed
  - Symbol stamping: plus, x, dot, arrow (4 directions), rounded square
  - Symbol size options: small, medium, large
  - Color picker with preset colors and player color support
  - Contact shadow effects for lines and symbols
  - Undo functionality for last drawing
  - Timed erase with configurable timeout (5-120 seconds)
  - Fade-out animations when drawings are deleted (300ms smooth fade)
  - Player permissions: players can draw and erase their own drawings
- **Toolbar Integration**: Secondary toolbar via Blacksmith Menubar API
  - Mode selection: line tool and symbol tools
  - Line width selection (switch group)
  - Line style selection (switch group)
  - Color selection (switch group)
  - Erase group: clear all, undo, timed erase toggle
  - Toolbar state persistence (client-scope settings)
- **Socket Manager**: Centralized socket communication system
  - `manager-sockets.js` for all socket operations
  - Tool-agnostic socket registration and routing
  - Broadcast system for cross-client synchronization
  - Multiple API access pattern support
  - Graceful handling when socket API unavailable
- **Settings System**: Comprehensive module settings
  - Drawing tool enable/disable
  - Player drawing permissions
  - Timed erase configuration
  - Toolbar state persistence (hidden, client-scope)
- **Canvas Layer Integration**: Direct PIXI graphics on BlacksmithLayer
  - Bypasses Foundry Drawing API validation issues
  - Real-time preview during drawing
  - Proper coordinate conversion for canvas interactions

### Changed
- **Architecture**: Refactored socket code into centralized `manager-sockets.js`
  - Removed socket code from `manager-drawing.js` (~150 lines)
  - Prevents "god mode" files as module scales
  - Easier to add socket support for future tools
- **Drawing Activation**: Changed from "D" key to backslash (`\`) key
  - Prevents conflicts with Foundry movement controls
  - Key must be held while drawing (like mouse button)
- **Symbol Rendering**: Improved arrow symbol design
  - Notched triangle shape with proper proportions
  - Four directional arrows (up, down, left, right)
  - Consistent sizing with other symbols
- **Line Styles**: Enhanced dotted and dashed line rendering
  - Proportional spacing based on line width
  - Consistent intervals regardless of mouse speed
  - Improved visual quality

### Fixed
- Canvas coordinate conversion for FoundryVTT v13
- Drawing preview showing stray lines
- Foundry bounding box appearing during drawing
- Real-time preview not showing until mouse-up
- Symbol stamping not respecting activation key
- Player color extraction from Foundry Color objects
- Default line width button not matching default width setting
- Circle and square symbols missing drop shadows
- Arrow shadow color matching arrow color (now uses shadow color)

### Technical
- Event handling with capture mode to prevent Foundry conflicts
- Proper cleanup of event listeners and PIXI graphics
- Client-scope settings for toolbar state persistence
- Debug logging with `BlacksmithUtils.postConsoleAndNotification`
- Multiple socket API access patterns for compatibility
- Smooth fade-out animations using `requestAnimationFrame` with ease-out curves

## [1.0.0] - Initial Release

### Added
- Initial module structure
- Integration with Coffee Pub Blacksmith


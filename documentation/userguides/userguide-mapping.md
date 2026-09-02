# Recording a Map

**Audience:** a GM or player mapping a scene by walking a token through it.

How a map fills itself in, what the three modes do, and how to find your way around the map window.

The map is drawn from what a token has actually seen. Walking a corridor puts that corridor on the
map; it does not put the room behind a closed door on it. That restraint is the point -- the map is
the party's own record of a place, not a copy of the GM's scene.

The mapping tool needs a square-grid scene. Hex and gridless scenes are not supported.

## Start a map

1. Select a token you own.
2. Open **Party Map** from the mapping button in the menubar.
3. Choose **Map this scene** at the top of the list. It names the scene it would map.

Recording begins immediately and the window switches from the list to the map. Walk the token and
the map draws itself.

One character gets one map per scene, so once that token has a map here the card stops being
offered. To map with a different character, select their token instead.

**Who can do it:** the token's owner, and the GM. A player also needs **Allow Player Mapping** left
on, and a GM must be logged in.

## The three modes

The buttons across the top of the map window are the modes, and one is always in effect:

- **Record** -- track the selected token and map where it goes. Pressing it while recording stops,
  and the button says so.
- **Follow** -- track the token without adding anything. The view keeps up with the party; the map
  does not grow.
- **View** -- neither. Look at the map without following anything.

Record and Follow appear only on a map a token could be recording into, and only on the scene you are
in. An official map is drawn rather than walked, so it offers View alone.

## Move around the map

- **Zoom** with the plus and minus buttons, or the wheel.
- **Pan** by dragging the map.
- **Fit the map** frames the whole thing. It is always available, and it is the way back when you
  have panned somewhere unrecognisable.
- **Centre on the party** jumps to the tracked token. It appears only when there is a token to centre
  on.

While following, the party marker stays pinned at the centre and the map slides beneath it.

## Find a map again

The button at the top left of the window switches between the map and **Recorded Maps**, the list of
every map you can see.

Maps are gathered under headings, and the tabs at the top read the list three ways:

- **Scene** -- grouped by the place, so every character's map of one dungeon sits together.
- **Character** -- grouped by who mapped it.
- **Just Mine** -- only your own, by scene.

Whichever you choose is remembered for you. Within a group, the shared maps come first -- the
official map of the place, then the party's -- and personal maps follow by how recently they were
drawn on.

## Rename, reset, or delete

Each row in the list carries its own actions, and they appear only on maps you may change:

- **Rename** -- a map is named after its scene by default.
- **Reset map** -- empties it and starts over.
- **Delete map** -- removes it entirely.

Resetting and deleting a shared map is the GM's alone, even where editing it is not.

## What the map is drawn from

Walls, doors and windows come from the scene itself, so the map shows a doorway as a doorway and a
secret door as plain wall until the party has walked through it. Nothing is stored about the
architecture -- only where the party has been -- so editing the scene's walls changes what an
existing map draws.

Squares a wall cuts through are handled as half-squares, so a curved corridor reads as a curve rather
than a staircase of blocks.

See [Marking up a map](userguide-marking-up-maps.md) for correcting a square the map got wrong.

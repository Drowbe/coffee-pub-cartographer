# For GMs

**Audience:** the GM running a game with Cartographer.

What only you can do, in the order a session tends to need it: what to set before play, how to make
a map the party can find, and what you can reach that players cannot.

## Before the session

Four world settings decide what the table can do at all. They are in Foundry's module settings under
Cartographer, and only you can change them:

- **Enable Player Drawing** -- whether players may sketch on the canvas.
- **Enable Mapping Tool** -- whether the mapping tool exists.
- **Allow Player Mapping** -- whether players may map with a token they own.
- **Detection Window** -- how far the party sees around their token as they walk.

See [Settings](userguide-settings.md) for what each does and what changing it costs.

## Make a map the party can find

This is the "you find a map" moment, and it is a GM action from start to finish.

1. Open **Party Map** and choose **Author an Official Map**.
2. Name it.

The whole scene arrives already mapped. No token is involved and none is wanted -- a token was only
ever a proxy for somebody having been somewhere, and a plan drawn by a dead wizard claims nothing of
the sort.

What counts as *inside* is worked out by flooding in from the edge of the scene: whatever the open
ground cannot reach is enclosed. Doors seal that flood as walls do. **A scene whose rooms are not
sealed has no inside to find**, and the map arrives blank -- you will be told when that happens, and
you can draw it by hand instead.

**It starts hidden from the players.** Reveal it when they find it, with the eye on its row. Until
then it is not in anybody's list but yours.

**You can draw on it freely.** Fix Things, floor surfaces, notes and symbols are all yours here, and
partial or deliberately misleading maps are half the point -- a found map does not have to be
accurate.

Once revealed, players may add notes and symbols and take back their own, but cannot alter what you
drew.

## Author a map from nothing

The same button makes an empty map on a scene with no sealed rooms, and the map window becomes a
drawing surface: right-click a square, **Fix Things**, **This is a floor**, and build from there.
Floor Type and Placeables work as they do anywhere.

There is one official map per scene.

## What you can reach that players cannot

- **Every map, whether shared or not.** A player map being private keeps it out of the party's way;
  it is not a secret from you.
- **Reset and delete on shared maps.** Any party member can edit the party map; emptying or removing
  it is yours, so nobody discards what everybody has been contributing to.
- **Rename, reset and delete on official maps.**
- **Revealing and hiding official maps.**
- **Clearing everybody's sketches** from the canvas at once.

## Mapping with your own tokens

Recording is always "record as some Actor", so you map by selecting a token and pressing **Record**
like anyone else -- a party member's, or an NPC scout's. That map is a player map belonging to that
Actor, and you can donate it to the party map afterwards.

There is no separate GM recording mode, and none is needed.

## Things worth knowing before they surprise you

**Editing a scene's walls changes existing maps.** A recorded map stores only where the party has
been and reads its architecture from the scene, so moving a wall redraws every map of that scene.
Official maps are seeded at creation but read the scene the same way afterwards.

**The mapping tool needs a square grid.** Hex and gridless scenes are not supported.

**Recording needs you logged in.** Players' maps are written through the GM's client, so if you are
not connected, their mapping does not record.

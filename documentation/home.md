# Coffee Pub Cartographer

**Audience:** anyone installing, playing with, or working on Cartographer.

The front door to Cartographer's documentation. What the module does, and where to read more.

Cartographer gives a table two things it cannot get from Foundry alone. The first is a shared
whiteboard: any player can sketch on the canvas while the party is planning, everyone sees it as it
is drawn, and it clears itself away. The second is an old-school party map that fills itself in as
tokens walk -- squares the party has actually seen, drawn in the pen-and-ink style of a dungeon map
someone kept on graph paper, with walls, doors, floor surfaces and hand-placed symbols.

Nothing on either is guessed. The map holds only what a token experienced, so it can show the party
a corridor they walked without showing them the room beyond the door they never opened.

![Cartographer: the party map beside sketches drawn on the canvas](assets/cartographer-product.webp)

## Using it

- [Getting started](userguides/userguide-getting-started.md) -- what appears when you enable it, and
  one thing to try with each tool.
- [Sketching on the canvas](userguides/userguide-sketching.md) -- the shapes, the controls, and how
  drawings clear themselves away.
- [Recording a map](userguides/userguide-mapping.md) -- how a map fills itself in, and what the
  modes do.
- [Marking up a map](userguides/userguide-marking-up-maps.md) -- notes, symbols, floor surfaces, and
  correcting a square the map got wrong.
- [Kinds of map](userguides/userguide-map-kinds.md) -- your own, the party's, and official maps.
- [For players](userguides/userguide-player.md) -- what you can do and what you cannot.
- [For GMs](userguides/userguide-gm.md) -- what only you can do.
- [Settings](userguides/userguide-settings.md) -- every setting, and who it affects.

## Working on it

- [Drawing tool architecture](architecture/architecture-drawing.md) -- how sketches are rendered,
  synchronised across clients, and cleaned up.
- [Known issues](known-issues.md) -- defects we have not fixed yet.

## Requirements

Cartographer needs [Coffee Pub Blacksmith](https://github.com/Drowbe/coffee-pub-blacksmith), which
provides the shared canvas layer, the socket transport, the toolbar and the window shell. The
mapping tool needs a square-grid scene; hex and gridless scenes are not supported.

## The Coffee Pub suite

Cartographer is one of a family of Foundry modules built around Blacksmith. Each is installed
separately and each does one job.

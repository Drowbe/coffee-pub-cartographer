# Known Issues

**Audience:** anyone using Cartographer who has hit something odd, and anyone about to fix it.

Defects that are in a shipped release and not yet fixed. When one is fixed it moves to the CHANGELOG
and leaves this list.

## An angled wall can leave a square on the wrong side of it

A wall set at an angle has its endpoints pulled onto grid intersections, which can move the wall by
up to two thirds of a square. A square the party explored can end up beyond where the wall now lies,
so its floor appears to spill past the wall.

Only diagonals are affected. Curved walls are not snapped and square walls already sit on square
edges, so neither shows it.

**Workaround:** right-click the square and choose Fix Things, then This is not a floor. A square
struck off by hand stays off.

**Where a fix starts:** the reveal reconciles what the party explored against Foundry's raw walls
rather than against the normalised geometry the map is drawn from.

## Clicking the party marker opens that square's menu

The marker sits inside a square, so a click on it lands on the square underneath and opens the
square's context menu.

**Workaround:** none needed; nothing is changed by opening the menu. Press Escape to dismiss it.

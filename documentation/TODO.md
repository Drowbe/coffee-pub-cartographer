# Coffee Pub Cartographer TODO

## Drawing tools

- [ ] Copy a drawing to the clipboard for use outside Foundry.
- [ ] Save a temporary drawing as a persistent Drawing, using a workflow similar to Notes with pins.

## Mapping tools

- [x] Add an old-school mapping tool that builds a simplified map as the party explores. See [Mapping Tool Implementation Plan](MAPPING_TOOL_PLAN.md).
  - Let a player select a token and open its existing scene map from the Cartographer toolbar, then use the map window's Record button to reveal the 5×5 grid area around that token; Stop ends recording without closing the map.
  - Display the accumulated map in a separate Glass-themed Blacksmith Tool window.
  - Begin with placeholder tiles that can be replaced by hand-drawn artwork.
- [ ] Improve mapped-floor, grid, and wall contrast in Dark and Glass themes so the initial reveal is as legible as it is in Light mode.
- [ ] Harden very long token moves so routed or unusually large drags cannot skip intermediate mapping samples.
- [x] Prevent floor and wall leakage at closed wall endpoints by requiring a visible footprint within each revealed square instead of trusting one center-point ray.
- [ ] Replace the scene-sized mapping grid with an endless canvas that renders only the active drawing bounds plus a three-grid margin, expanding automatically as exploration reaches an edge.
- [x] Add an initial **Place** context menu on explored grid cells with old-school Stairs, Trap, and Treasure symbols.
- [ ] Expand **Place** into the full official symbol categories: doors, passages, hazards, structures, terrain, and furnishings.
- [ ] Phase 2: reuse the mapping renderer and symbol vocabulary to draw ad-hoc old-school maps directly on the Foundry canvas.

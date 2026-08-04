# Coffee Pub Cartographer

![Latest Release](https://img.shields.io/github/v/release/Drowbe/coffee-pub-cartographer)
![Foundry v13](https://img.shields.io/badge/foundry-v13-yellow)
![MIT License](https://img.shields.io/badge/license-MIT-blue)

## Description

Party strategic planning, temporary canvas sketching, and shared old-school mapping.

## Features

- Temporary multiplayer canvas drawings with shapes, stamps, colors, and timed cleanup.
- A persistent party map that reveals the 5×5 grid area around a controlled token as it moves.
- A separate resizable map view using Blacksmith's Light, Dark, and Glass Tool window themes.

## Requirements

- **FoundryVTT**: Version 13.x
- **Coffee Pub Blacksmith**: Required dependency - provides shared services and functionality

## Installation

1. Inside Foundry VTT, use the following manifest URL:
   ```
   https://github.com/Drowbe/coffee-pub-cartographer/releases/latest/download/module.json
   ```
2. Enable the module in your game world's module settings
3. Ensure Coffee Pub Blacksmith is installed and enabled

## Usage

Open Cartographer from the Blacksmith menubar to access its drawing and mapping tools.

Select one token and open **Mapping** from the Cartographer toolbar to load the existing party map with that token centered. Press **Record** to add its exploration: the mapper records the 5×5 grid area surrounding the token as it moves. Press **Stop** to stop recording while retaining the selected-token view, or close the window to stop and close it. Right-drag the map to pan it and use the mouse wheel to zoom.

## Configuration

Module settings can be found in: Configure Settings → Coffee Pub Cartographer

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This module is licensed under the MIT License.

---

Part of the Coffee Pub module collection


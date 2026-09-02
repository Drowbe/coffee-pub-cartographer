# Settings

**Audience:** a GM configuring Cartographer, and players setting their own preferences.

Every setting Cartographer adds, by its on-screen name: what it does, who it affects, and what
changes when you change it.

Find them in Foundry's **Configure Settings**, under **Module Settings**, in the Cartographer
section.

Some settings are the GM's and change the game for everyone. Others are yours alone and change only
what you see. Each is marked below.

## Drawing

**Enable Player Drawing** -- GM, affects everyone.
Whether players may draw temporarily on the canvas for planning. Turn it off and the Cartographer
tool stops working for players; you can still draw. Existing sketches are not removed by changing it.

**Timed Erase Timeout (seconds)** -- GM, affects everyone.
How long a drawing lasts before it removes itself, when timed erase is switched on. Between 5 and 120
seconds. This sets the delay; whether the timer applies to your own drawings is a toggle on the
drawing toolbar rather than a setting here.

**Enable Draw Hotkey** -- yours alone.
Whether the drawing hotkey works for you. The key itself is set in Foundry's own **Controls**
settings, not here, and defaults to **L**.

**Draw Hotkey Mode** -- yours alone.
**Hold** means drawing is active only while the key is down, so you can sketch without leaving the
tool you were using. **Toggle** means one press turns it on and another turns it off.

**Ignore Hotkey While Typing** -- yours alone.
Stops the hotkey firing while chat or a form field has focus, so typing a word containing the hotkey
letter does not start a drawing. Leave this on unless the hotkey is a key you never type.

## Mapping

**Enable Mapping Tool** -- GM, affects everyone.
Whether the old-school party mapping tool exists at all. Turning it off removes the mapping button
and the Party Map window for everybody. Maps already recorded are not deleted; they become
unreachable until it is turned back on.

**Allow Player Mapping** -- GM, affects everyone.
Whether players may map with a token they own and control. With it off, only you can record. It does
not affect who can *view* maps, or who can annotate one they can see.

**Detection Window** -- GM, affects everyone.
How far the party sees around their token as they walk, as a square window of grid squares -- 11
means an 11 by 11 area centred on the token. Wider windows reveal more of a room per step, at some
cost in performance on large scenes. This is how much the map considers, not how far the token can
actually see: a square inside the window is still only mapped if the token could genuinely see it.

**Show Mapping Menubar Button** -- yours alone.
Whether the mapping button appears in your menubar. Hiding it does not disable mapping; the window
can still be opened by other means, and your maps are untouched.

## Settings that are not in the settings window

Some choices are remembered for you where you make them, rather than in Configure Settings:

- **Grid** -- how heavily the squares are ruled. From a right-click on any map square.
- **How the map list is grouped** -- by scene, by character, or just your own. From the tabs at the
  top of Recorded Maps.
- **Your drawing colour, line width, line style, stamp style and symbol size**, and whether timed
  erase applies to your drawings. From the drawing toolbar.

All of these are yours alone and are remembered between sessions.

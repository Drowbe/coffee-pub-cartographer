// ================================================================== 
// ===== IMPORTS ====================================================
// ================================================================== 

// -- Import MODULE variables --
import { MODULE } from './const.js';


// ================================================================== 
// ===== CONSTANTS ====================================================
// ================================================================== 

/**
 * WORKFLOW GROUPS
 * Use workflow groups to organize settings into visual sections
 * This will allow the global CSS rules to style the settings window.
 */
const WORKFLOW_GROUPS = {
    INTRODUCTION: 'introduction',
    CONFIGURATION: 'configuration',
    DRAWING: 'drawing',
};


// ================================================================== 
// ===== HELPER FUNCTIONS ===========================================
// ================================================================== 

/**
 * Helper function to register headers with reduced verbosity while preserving CSS styling
 * @param {string} id - Unique identifier for the header
 * @param {string} labelKey - Localization key for the label
 * @param {string} hintKey - Localization key for the hint
 * @param {string} level - Header level (H1, H2, H3, H4)
 * @param {string} group - Workflow group for collapsible sections
 * @param {string} scope - Foundry setting scope for controlling who can see the header
 */
function registerHeader(id, labelKey, hintKey, level = 'H2', group = null, scope = 'world') {
    game.settings.register(MODULE.ID, `heading${level}${id}`, {
        name: MODULE.ID + `.${labelKey}`,
        hint: MODULE.ID + `.${hintKey}`,
        scope,
        config: true,
        default: "",
        type: String,
        group: group
    });
}


// ================================================================== 
// ===== SETTINGS REGISTRATION ======================================
// ================================================================== 

/**
 * STYLING AND FORMATTING
 * Use registerHeader() to register headers with reduced verbosity while preserving CSS styling
 * This function will register the header with the following parameters:
 * - id: Unique identifier for the header
 * - labelKey: Localization key for the label
 * - hintKey: Localization key for the hint
 * - level: Header level (H1, H2, H3, H4, or HR)
 * - group: Workflow group for collapsible sections
 * Example: registerHeader('ExampleSection', 'headingH2ExampleSection-Label', 'headingH2ExampleSection-Hint', 'H2', WORKFLOW_GROUPS.DRAWING);
 * This will register the header with the following parameters:
 * - id: ExampleSection
 * - labelKey: headingH2ExampleSection-Label
 * - hintKey: headingH2ExampleSection-Hint
 * - level: H2
 * - group: DRAWING
 */



/**
 * Register all module settings
 * Called during the 'ready' phase when Foundry is ready
 */
export const registerSettings = () => {
   
	// ==================================================================================================================== 
	// ==================================================================================================================== 
	// == H1: INTRODUCTION
	// ==================================================================================================================== 
	// ==================================================================================================================== 
	registerHeader('Introduction', 'headingH1Introduction-Label', 'headingH1Introduction-Hint', 'H1', WORKFLOW_GROUPS.INTRODUCTION, 'user');


	// --------------------------------------
	// -- H2: CONFIGURATION
	// --------------------------------------
	registerHeader('Configuration', 'headingH2Configuration-Label', 'headingH2Configuration-Hint', 'H2', WORKFLOW_GROUPS.CONFIGURATION);

    // -- Enable Player Drawing --
	game.settings.register(MODULE.ID, 'drawing.enablePlayerDrawing', {
        name: MODULE.ID + '.drawing.enablePlayerDrawing-Label',
        hint: MODULE.ID + '.drawing.enablePlayerDrawing-Hint',
        scope: 'world',
        config: true,
        default: true,
        type: Boolean,
		group: WORKFLOW_GROUPS.CONFIGURATION
	});

    // -- Timed Erase Timeout --
    game.settings.register(MODULE.ID, 'drawing.timedEraseTimeout', {
        name: MODULE.ID + '.drawing.timedEraseTimeout-Label',
        hint: MODULE.ID + '.drawing.timedEraseTimeout-Hint',
        scope: 'world',
        config: true,
        default: 30,
        type: Number,
        range: {
            min: 5,
            max: 120,
            step: 5
        },
		group: WORKFLOW_GROUPS.CONFIGURATION
	});

    game.settings.register(MODULE.ID, 'mapping.enabled', {
        name: MODULE.ID + '.mapping.enabled-Label',
        hint: MODULE.ID + '.mapping.enabled-Hint',
        scope: 'world',
        config: true,
        default: true,
        type: Boolean,
        group: WORKFLOW_GROUPS.CONFIGURATION
    });

    // The width of the square detection window, in grid squares, so 11 means
    // 11x11 centred on the token. Only odd values centre, hence the step of 2.
    // Wider is not just more map per step: every boundary inside the window is
    // re-examined, so it is also how a mistaken reading gets corrected.
    game.settings.register(MODULE.ID, 'mapping.detectionSize', {
        name: MODULE.ID + '.mapping.detectionSize-Label',
        hint: MODULE.ID + '.mapping.detectionSize-Hint',
        scope: 'world',
        config: true,
        default: 11,
        type: Number,
        range: {
            min: 3,
            max: 15,
            step: 2
        },
        group: WORKFLOW_GROUPS.CONFIGURATION
    });

    game.settings.register(MODULE.ID, 'mapping.allowPlayers', {
        name: MODULE.ID + '.mapping.allowPlayers-Label',
        hint: MODULE.ID + '.mapping.allowPlayers-Hint',
        scope: 'world',
        config: true,
        default: true,
        type: Boolean,
        group: WORKFLOW_GROUPS.CONFIGURATION
    });

    // Client scope: it is this user's own menubar, and it decides whether
    // closing the map window can leave recording running for them.
    game.settings.register(MODULE.ID, 'mapping.menubarButton', {
        name: MODULE.ID + '.mapping.menubarButton-Label',
        hint: MODULE.ID + '.mapping.menubarButton-Hint',
        scope: 'client',
        config: true,
        default: true,
        type: Boolean,
        group: WORKFLOW_GROUPS.CONFIGURATION,
        onChange: () => {
            import('./manager-mapping.js').then(({ mappingManager }) => mappingManager.refreshMenubarTool());
        }
    });


	// --------------------------------------
	// -- H2: DRAWING
	// --------------------------------------
	registerHeader('Drawing', 'headingH2Drawing-Label', 'headingH2Drawing-Hint', 'H2', WORKFLOW_GROUPS.DRAWING, 'user');


	// -- Draw Hotkey Settings --

	game.settings.register(MODULE.ID, "drawing.hotkeyEnabled", {
		name: MODULE.ID + ".drawing.hotkeyEnabled-Label",
		hint: MODULE.ID + ".drawing.hotkeyEnabled-Hint",
		scope: "user",
		config: true,
		type: Boolean,
		default: true,
		group: WORKFLOW_GROUPS.DRAWING
	  });
	
	  game.settings.register(MODULE.ID, "drawing.hotkeyMode", {
		name: MODULE.ID + ".drawing.hotkeyMode-Label",
		hint: MODULE.ID + ".drawing.hotkeyMode-Hint",
		scope: "user",
		config: true,
		type: String,
		choices: {
		  hold: "Hold",
		  toggle: "Toggle"
		},
		default: "hold",
		group: WORKFLOW_GROUPS.DRAWING
	  });
	
	  game.settings.register(MODULE.ID, "drawing.blockWhenTyping", {
		name: MODULE.ID + ".drawing.blockWhenTyping-Label",
		hint: MODULE.ID + ".drawing.blockWhenTyping-Hint",
		scope: "user",
		config: true,
		type: Boolean,
		default: true,
		group: WORKFLOW_GROUPS.DRAWING
	  });

	  // Toolbar height is no longer a setting. The secondary bar takes its size from a
	  // Blacksmith preset (see manager-toolbar.js), which keeps it in step with the menubar.







    // --------------------------------------
	// -- HIDDEN USER-SCOPE SETTINGS (Toolbar State)
	// --------------------------------------
	// These settings persist the user's toolbar selections but are hidden from the settings UI
	// Using "user" scope so preferences follow the user across devices
	
	// Drawing mode selection (Drawing Mode group: sketch, line, box, ellipse, stamp)
	game.settings.register(MODULE.ID, 'toolbar.drawingMode', {
		name: '', // Hidden setting
		hint: '',
		scope: 'user',
		config: false, // Hidden from settings UI
		default: 'sketch',
		type: String
	});

	// Stamp style selection (Stamp Style group: plus, x, dot, arrow, etc.)
	game.settings.register(MODULE.ID, 'toolbar.stampStyle', {
		name: '', // Hidden setting
		hint: '',
		scope: 'user',
		config: false, // Hidden from settings UI
		default: 'plus',
		type: String
	});
	
	// Which of the Recorded Maps list's three tabs is in effect: by scene, by
	// character, or the reader's own. Chosen from the list itself, so it is not
	// offered in the settings form.
	game.settings.register(MODULE.ID, 'mapping.listGrouping', {
		name: '',
		hint: '',
		scope: 'user',
		config: false,
		default: 'scene',
		type: String
	});

	// How heavily the map's squares are ruled: off, light, medium or dark. Chosen
	// from a square's own menu, so it is not offered in the settings form. Per
	// user, because it is how someone likes to read a map rather than anything
	// about the map -- a player is free to turn the ruling down on a map they do
	// not own, and nobody else's view changes when they do.
	game.settings.register(MODULE.ID, 'mapping.gridWeight', {
		name: '',
		hint: '',
		scope: 'user',
		config: false,
		default: 'medium',
		type: String
	});

	// Symbol size selection (symbols group)
	game.settings.register(MODULE.ID, 'toolbar.symbolSize', {
		name: '', // Hidden setting
		hint: '',
		scope: 'user',
		config: false, // Hidden from settings UI
		default: 'medium',
		type: String
	});
	
	// Line width selection (line-width group)
	game.settings.register(MODULE.ID, 'toolbar.lineWidth', {
		name: '', // Hidden setting
		hint: '',
		scope: 'user',
		config: false, // Hidden from settings UI
		default: 6, // Medium (6px)
		type: Number
	});
	
	// Line style selection (lineStyle group)
	game.settings.register(MODULE.ID, 'toolbar.lineStyle', {
		name: '', // Hidden setting
		hint: '',
		scope: 'user',
		config: false, // Hidden from settings UI
		default: 'solid',
		type: String
	});
	
	// Color selection (color group)
	game.settings.register(MODULE.ID, 'toolbar.color', {
		name: '', // Hidden setting
		hint: '',
		scope: 'user',
		config: false, // Hidden from settings UI
		default: 'rgba(0, 0, 0, 1.0)', // Default to black
		type: String
	});
	
	// Timed erase toggle state (erase group)
	game.settings.register(MODULE.ID, 'toolbar.timedEraseEnabled', {
		name: '', // Hidden setting
		hint: '',
		scope: 'user',
		config: false, // Hidden from settings UI
		default: false,
		type: Boolean
	});
    



    // *** REPORT SETTINGS LOADED ***
    // Prefer module.api (available once Blacksmith assigns api); globals like BlacksmithUtils may still be null if our ready runs first.
    const blacksmithApi = game.modules.get('coffee-pub-blacksmith')?.api;
    const msg = `${MODULE.NAME}: Settings registered.`;
    if (blacksmithApi?.utils?.postConsoleAndNotification) {
        blacksmithApi.utils.postConsoleAndNotification(MODULE.NAME, msg, null, false, false);
    } else if (typeof globalThis.BlacksmithUtils?.postConsoleAndNotification === 'function') {
        globalThis.BlacksmithUtils.postConsoleAndNotification(MODULE.NAME, msg, null, false, false);
    } else {
        console.log(msg);
    }
};


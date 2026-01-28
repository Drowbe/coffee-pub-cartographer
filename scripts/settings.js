// ================================================================== 
// ===== IMPORTS ====================================================
// ================================================================== 

// -- Import MODULE variables --
import { MODULE } from './const.js';


// ================================================================== 
// ===== CONSTANTS ====================================================
// ================================================================== 

/**
 * WROKFLOW GROUPS
 * Use workflow groups to organize settings into visual sections
 * This will allow the global CSS rules to style the settings window.
 */
const WORKFLOW_GROUPS = {
    GETTING_STARTED: 'getting-started',
    COMMON_SETTINGS: 'common-settings',
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
 */
function registerHeader(id, labelKey, hintKey, level = 'H2', group = null) {
    game.settings.register(MODULE.ID, `heading${level}${id}`, {
        name: MODULE.ID + `.${labelKey}`,
        hint: MODULE.ID + `.${hintKey}`,
        scope: "world",
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
 * Example: registerHeader('ExampleSubheader', 'headingH3ExampleSubheader-Label', 'headingH3ExampleSubheader-Hint', 'H3', WORKFLOW_GROUPS.COMMON_SETTINGS);
 * This will register the header with the following parameters:
 * - id: ExampleSubheader
 * - labelKey: headingH3ExampleSubheader-Label
 * - hintKey: headingH3ExampleSubheader-Hint
 * - level: H3
 * - group: COMMON_SETTINGS
 */



/**
 * Register all module settings
 * Called during the 'ready' phase when Foundry is ready
 */
export const registerSettings = () => {
   
	// ==================================================================================================================== 
	// ==================================================================================================================== 
	// == H1: GETTING STARTED
	// ==================================================================================================================== 
	// ==================================================================================================================== 
	registerHeader('GettingStarted', 'headingH1GettingStarted-Label', 'headingH1GettingStarted-Hint', 'H1', WORKFLOW_GROUPS.GETTING_STARTED);

	// --------------------------------------
	// -- H4: INTRODUCTION
	// --------------------------------------
	registerHeader('Introduction', 'headingH4Introduction-Label', 'headingH4Introduction-Hint', 'H4', WORKFLOW_GROUPS.GETTING_STARTED);


	// ==================================================================================================================== 
	// ===== HR Visual Divider
	// ==================================================================================================================== 
	game.settings.register(MODULE.ID, "headingHR", {
		name: "",
		hint: "",
		scope: "world",
		config: true,
		default: "",
		type: String,
	});


	// --------------------------------------
	// -- H2: COMMON SETTINGS
	// --------------------------------------
	registerHeader('CommonSettings', 'headingH2CommonSettings-Label', 'headingH2CommonSettings-Hint', 'H2', WORKFLOW_GROUPS.COMMON_SETTINGS);


    // --------------------------------------
	// -- H3: DRAWING TOOL SETTINGS
	// --------------------------------------
	registerHeader('DrawingToolSettings', 'headingH3DrawingToolSettings-Label', 'headingH3DrawingToolSettings-Hint', 'H3', WORKFLOW_GROUPS.COMMON_SETTINGS);

    // -- Enable Player Drawing --
	game.settings.register(MODULE.ID, 'drawing.enablePlayerDrawing', {
        name: MODULE.ID + '.drawing.enablePlayerDrawing-Label',
        hint: MODULE.ID + '.drawing.enablePlayerDrawing-Hint',
        scope: 'world',
        config: true,
        default: true,
        type: Boolean,
		group: WORKFLOW_GROUPS.COMMON_SETTINGS
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
		group: WORKFLOW_GROUPS.COMMON_SETTINGS
	});
    


	// -- Draw Hotkey Settings --

	game.settings.register(MODULE.ID, "drawing.hotkeyEnabled", {
		name: MODULE.ID + ".drawing.hotkeyEnabled-Label",
		hint: MODULE.ID + ".drawing.hotkeyEnabled-Hint",
		scope: "user",
		config: true,
		type: Boolean,
		default: true
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
		default: "hold"
	  });
	
	  game.settings.register(MODULE.ID, "drawing.blockWhenTyping", {
		name: MODULE.ID + ".drawing.blockWhenTyping-Label",
		hint: MODULE.ID + ".drawing.blockWhenTyping-Hint",
		scope: "user",
		config: true,
		type: Boolean,
		default: true
	  });

	  // -- Toolbar Height --
	  game.settings.register(MODULE.ID, "toolbar.height", {
		name: MODULE.ID + ".toolbar.height-Label",
		hint: MODULE.ID + ".toolbar.height-Hint",
		scope: "client",
		config: true,
		type: Number,
		default: 38,
		range: {
			min: 15,
			max: 100,
			step: 1
		},
		group: WORKFLOW_GROUPS.COMMON_SETTINGS
	  });







    // --------------------------------------
	// -- HIDDEN USER-SCOPE SETTINGS (Toolbar State)
	// --------------------------------------
	// These settings persist the user's toolbar selections but are hidden from the settings UI
	// Using "user" scope so preferences follow the user across devices
	
	// Drawing mode selection (Drawing Mode group: line, box, stamp)
	game.settings.register(MODULE.ID, 'toolbar.drawingMode', {
		name: '', // Hidden setting
		hint: '',
		scope: 'user',
		config: false, // Hidden from settings UI
		default: 'line',
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
    BlacksmithUtils.postConsoleAndNotification(MODULE.NAME, `${MODULE.NAME}: Settings registered.`, null, false, false);
};


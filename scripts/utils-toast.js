// ==================================================================
// ===== MODULE IMPORTS =============================================
// ==================================================================

import { MODULE } from './const.js';

// ==================================================================
// ===== TOAST NOTIFICATIONS ========================================
// ==================================================================

/**
 * Thin wrapper over the Blacksmith Toast API.
 * Docs: https://github.com/Drowbe/coffee-pub-blacksmith/wiki/api-toast
 *
 * Toasts are a local, per-client primitive: show() renders only on the client
 * that calls it. Every Cartographer toast is feedback for an action the local
 * user just took, so that is exactly the semantics we want - do not expect these
 * to reach other players.
 *
 * Falls back to ui.notifications when Blacksmith is absent or too old to expose
 * the API, so the module still speaks without it.
 */

// Severity presets. Colors must be strict hex (#rgb / #rrggbb) - the API
// ignores anything else and renders the default look.
const TOAST_STYLES = {
    // No accent for ordinary toasts: Blacksmith's own look reads on its dark box.
    info:  { color: null, icon: 'fa-solid fa-map' },
    warn:  { color: '#DB820C', icon: 'fa-solid fa-triangle-exclamation' },
    error: { color: '#BA3C31', icon: 'fa-solid fa-circle-exclamation' }
};

/**
 * Show a Cartographer toast.
 * @param {string} title - Headline text. Rendered as text, never HTML.
 * @param {object} [options]
 * @param {string} [options.subtitle] - Second line, for detail or scope
 * @param {'info'|'warn'|'error'} [options.type='info'] - Drives color and default icon
 * @param {string} [options.icon] - FontAwesome class, overrides the severity default
 * @param {number} [options.duration] - Seconds before auto-dismiss; 0 = until closed (API default: 8)
 * @param {string} [options.stackKey] - Repeat toasts with this key replace in place instead of stacking
 * @returns {string|null} Toast ID, or null if nothing was shown
 */
export function notify(title, { subtitle, type = 'info', icon, duration, stackKey } = {}) {
    const style = TOAST_STYLES[type] ?? TOAST_STYLES.info;
    const toast = game.modules.get('coffee-pub-blacksmith')?.api?.toast;

    if (!toast?.show) {
        // No toast API - fall back to core notifications, which need the module
        // name inline because they carry no icon or color.
        const line = subtitle ? `${title} - ${subtitle}` : title;
        const fallback = ui.notifications?.[type] ?? ui.notifications?.info;
        fallback?.call(ui.notifications, `${MODULE.NAME}: ${line}`);
        return null;
    }

    return toast.show({
        title,
        subtitle,
        icon: icon ?? style.icon,
        ...(style.color ? { color: style.color } : {}),
        duration,
        stackKey,
        moduleId: MODULE.ID // lets Blacksmith clear our toasts as a group
    });
}

// ==================================================================
// ===== CONSOLE LOGGING ============================================
// ==================================================================

/**
 * Log through Blacksmith's postConsoleAndNotification, so Cartographer's
 * console lines look and filter like the rest of Coffee Pub's. `debug` lines
 * show only with Blacksmith's debug setting on. Falls back to the console.
 * @param {string} message
 * @param {*} [result] - Extra detail logged with the message
 * @param {object} [options]
 * @param {boolean} [options.debug=false] - Only when Blacksmith's debugging is on
 * @param {'log'|'warn'|'error'} [options.level='log'] - The console level, without Blacksmith
 */
export function log(message, result = '', { debug = false, level = 'log' } = {}) {
    const utils = game.modules.get('coffee-pub-blacksmith')?.api?.utils;
    if (typeof utils?.postConsoleAndNotification === 'function') {
        utils.postConsoleAndNotification(MODULE.NAME, message, result, debug, false);
        return;
    }
    if (debug) return;
    console[level]?.(`${MODULE.NAME}: ${message}`, result);
}

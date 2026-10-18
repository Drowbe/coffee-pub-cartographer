// ==================================================================
// ===== GROUPS =====================================================
// ==================================================================

/**
 * Which groups are on, for parallax layers and for tiles alike. Groups add
 * together: a layer or tile shows when any group that is on shows it, so a
 * scene can be built from parts -- Base, plus Snow, plus Night -- rather than
 * a separate group for every combination.
 *
 * What is on is saved as one of:
 *   null      All: every item shows, groups or not
 *   []        None: nothing shows
 *   [ids]     those groups, added together
 */

/** The value the window uses for None, where a choice is a single string (a select's options). */
export const NONE_GROUP = 'none';

/**
 * Read what is on from a saved scene, checked against the groups that exist.
 * `legacy` is the single group an older save held (an id, 'none', or null).
 */
export function normalizeActive(active, legacy, groups) {
    let list = active;
    if (list === undefined) {
        if (legacy === undefined || legacy === null) list = null;
        else if (legacy === NONE_GROUP) list = [];
        else list = [legacy];
    }
    if (!Array.isArray(list)) return null;
    const known = new Set(groups.map(group => group.id));
    const kept = [...new Set(list.filter(id => known.has(id)))];
    // Every group that was on has since been deleted: fall back to All
    // rather than leave the scene empty for no reason the GM can see.
    if (list.length && !kept.length) return null;
    return kept;
}

/**
 * Whether an item shows under the groups that are on. `membersOf` and
 * `offOf` read a group's item ids and the ids switched off in it.
 */
export function shownByGroups(itemId, groups, active, membersOf, offOf) {
    if (active === null) return true;
    return active.some(groupId => {
        const group = groups.find(entry => entry.id === groupId);
        return !!group && membersOf(group).includes(itemId) && !(offOf(group) ?? []).includes(itemId);
    });
}

/** Turn one group on or off among those on. From All, turning one on shows just that group. */
export function toggledActive(active, groupId) {
    const list = active ?? [];
    return list.includes(groupId) ? list.filter(id => id !== groupId) : [...list, groupId];
}

/** Whether two saved choices of what is on are the same, whatever the order. */
export function sameActive(a, b) {
    if (a === null || b === null) return a === b;
    if (a.length !== b.length) return false;
    const other = new Set(b);
    return a.every(id => other.has(id));
}

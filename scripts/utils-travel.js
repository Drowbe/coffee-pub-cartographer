// ==================================================================
// ===== TRAVEL DISTANCES ===========================================
// ==================================================================

/**
 * Turning scrolled pixels into distance, and distance into words, for the
 * parallax odometer. Nothing here touches Foundry, so it is tested in node.
 *
 * Distance is held in the scene's own grid units (feet, metres -- whatever
 * the scene's grid says) and only converted for display or entry, so a scene
 * in metres and one in feet both read naturally.
 */

/** For a short unit, the long one a journey is measured in, and how many short to one long. */
const LONGER_UNITS = {
    ft: { unit: 'mi', factor: 5280 },
    feet: { unit: 'mi', factor: 5280 },
    foot: { unit: 'mi', factor: 5280 },
    yd: { unit: 'mi', factor: 1760 },
    yards: { unit: 'mi', factor: 1760 },
    m: { unit: 'km', factor: 1000 },
    meters: { unit: 'km', factor: 1000 },
    metres: { unit: 'km', factor: 1000 }
};

/** The longer unit a scene's distances roll over into, if one is known. */
export function longerUnit(sceneUnits) {
    return LONGER_UNITS[String(sceneUnits ?? '').trim().toLowerCase()] ?? null;
}

/** The units a destination can be entered in: the scene's own, then its longer one. */
export function unitChoices(sceneUnits) {
    const units = String(sceneUnits ?? '').trim() || 'units';
    const longer = longerUnit(units);
    return longer ? [units, longer.unit] : [units];
}

/** Scrolled pixels as distance on the scene's grid: on a 140-pixel, 5-foot grid, 140 pixels is 5 feet. */
export function pixelsToDistance(pixels, grid) {
    const size = Number(grid?.size) || 0;
    const distance = Number(grid?.distance) || 0;
    if (!size || !distance) return 0;
    return (pixels / size) * distance;
}

/** An amount entered in either of the unit choices, as scene units. */
export function toSceneUnits(amount, unit, sceneUnits) {
    const value = Number(amount);
    if (!Number.isFinite(value)) return null;
    const longer = longerUnit(sceneUnits);
    return longer && unit === longer.unit ? value * longer.factor : value;
}

/** A distance in scene units as the amount and unit to show it in: long units once it reaches one. */
export function displayDistance(value, sceneUnits) {
    const units = String(sceneUnits ?? '').trim() || 'units';
    const longer = longerUnit(units);
    if (longer && Math.abs(value) >= longer.factor) {
        return { amount: Math.round((value / longer.factor) * 10) / 10, unit: longer.unit };
    }
    return { amount: Math.round(value), unit: units };
}

/**
 * An in-world span as its two largest units: "2 d 4 h", "5 h 20 m", "12 m".
 * Plain 24-hour days; when Blacksmith's calendar-aware span formatter lands,
 * this is the one place to hand over to it.
 */
export function formatSpan(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (days) return hours ? `${days} d ${hours} h` : `${days} d`;
    if (hours) return minutes ? `${hours} h ${minutes} m` : `${hours} h`;
    return `${minutes} m`;
}

// ==================================================================
// ===== PACES ======================================================
// ==================================================================

/**
 * Travel paces, as miles per hour, used when the game system defines none of
 * its own. Kilometres per hour are derived from them. `group` is the heading
 * the pace is listed under: foot, mount, water or air.
 */
export const REAL_WORLD_PACES = [
    { id: 'walking', group: 'foot', mph: 3 },
    { id: 'jogging', group: 'foot', mph: 6 },
    { id: 'running', group: 'foot', mph: 10 },
    { id: 'horseWalking', group: 'mount', mph: 4 },
    { id: 'horseTrotting', group: 'mount', mph: 8 },
    { id: 'horseCantering', group: 'mount', mph: 12 },
    { id: 'horseGalloping', group: 'mount', mph: 30 },
    { id: 'wagon', group: 'mount', mph: 2.5 },
    { id: 'rowingBoat', group: 'water', mph: 2 },
    { id: 'sailingShip', group: 'water', mph: 5 },
    { id: 'flying', group: 'air', mph: 30 }
];

/**
 * D&D 5e's mounts and vehicles, from the SRD. A mount travels at its speed
 * over ten, as the system converts any speed to a travel pace (30 ft is
 * 3 mph); a gallop is double the fast pace, for about an hour. Vehicles are
 * the rules' own speeds in mph.
 */
const DND5E_MOUNTS = [
    { id: 'ridingHorse', mph: 6 },
    { id: 'warhorse', mph: 6 },
    { id: 'camel', mph: 5 },
    { id: 'draftHorse', mph: 4 },
    { id: 'pony', mph: 4 },
    { id: 'mule', mph: 4 },
    { id: 'elephant', mph: 4 },
    { id: 'mastiff', mph: 4 },
    { id: 'gallop', mph: 8 }
];
const DND5E_VEHICLES = [
    { id: 'keelboat', group: 'water', mph: 1 },
    { id: 'rowboat', group: 'water', mph: 1.5 },
    { id: 'sailingShip', group: 'water', mph: 2 },
    { id: 'warship', group: 'water', mph: 2.5 },
    { id: 'longship', group: 'water', mph: 3 },
    { id: 'galley', group: 'water', mph: 4 },
    { id: 'airship', group: 'air', mph: 8 }
];

/** A day's travel, in hours: what turns a rules pace given per day into one per hour. */
const TRAVEL_HOURS_PER_DAY = 8;
const KM_PER_MILE = 1.609344;

/**
 * The paces a system's rules define, as { id, group, label?, mph }, or null
 * when it defines none. D&D 5e gives its paces as miles in a travel day
 * (18, 24, 30) and as multipliers of normal (2/3, 1, 4/3), with its own
 * labels; its mounts and vehicles come from the SRD and are labelled by
 * Cartographer (`parallax.pace.dnd5e.<id>`). `config` is the system's
 * CONFIG object, passed in so this stays testable.
 */
export function rulesPaces(systemId, config) {
    if (systemId === 'dnd5e' && config?.DND5E?.travelPace) {
        // The day totals are rounded, so per hour comes from normal's day over
        // a travel day, times each pace's multiplier: 2, 3 and 4 mph, as the
        // rules' own table gives them, not 2.25 and 3.75.
        const paces = config.DND5E.travelPace;
        const normalMph = (Number(paces.normal?.standard) || 24) / TRAVEL_HOURS_PER_DAY;
        return [
            ...Object.entries(paces).map(([id, pace]) => ({
                id: `dnd5e.${id}`,
                group: 'foot',
                label: pace.label,
                mph: normalMph * (Number(pace.multiplier) || 1)
            })),
            ...DND5E_MOUNTS.map(p => ({ id: `dnd5e.${p.id}`, group: 'mount', mph: p.mph })),
            ...DND5E_VEHICLES.map(p => ({ id: `dnd5e.${p.id}`, group: p.group, mph: p.mph }))
        ];
    }
    return null;
}

/** The headings paces are listed under, in order. */
export const PACE_GROUPS = ['foot', 'mount', 'water', 'air'];

/**
 * The paces to offer on a scene, as { id, group, perHour, label }: the game
 * system's own when its rules define them, or real-world ones, with perHour
 * in the scene's units and each label carrying its speed, "Normal (3 mph)".
 * `nameOf(pace)` gives a pace's name (localizing is the caller's business).
 * Empty when the scene's units have no pace (hexes, squares).
 */
export function paceChoices(systemId, config, sceneUnits, nameOf) {
    if (paceToSceneUnits(1, sceneUnits) === null) return [];
    const unit = paceUnit(sceneUnits);
    return (rulesPaces(systemId, config) ?? REAL_WORLD_PACES).map(pace => {
        const perHour = paceToSceneUnits(pace.mph, sceneUnits);
        const shown = Math.round(sceneUnitsToPace(perHour, sceneUnits) * 10) / 10;
        return { id: pace.id, group: pace.group, perHour, label: `${nameOf(pace)} (${shown} ${unit})` };
    });
}

/**
 * Scene units per in-world hour for a pace in miles per hour. Feet and yards
 * take it in miles; metres in kilometres. A scene in some other unit (hexes,
 * squares) has no conversion, and returns null.
 */
export function paceToSceneUnits(mph, sceneUnits) {
    const units = String(sceneUnits ?? '').trim().toLowerCase();
    if (['ft', 'feet', 'foot'].includes(units)) return mph * 5280;
    if (['yd', 'yards'].includes(units)) return mph * 1760;
    if (['mi', 'miles'].includes(units)) return mph;
    if (['m', 'meters', 'metres'].includes(units)) return mph * KM_PER_MILE * 1000;
    if (['km', 'kilometers', 'kilometres'].includes(units)) return mph * KM_PER_MILE;
    return null;
}

/** The unit a pace is shown in, for a scene: mph for imperial grids, km/h for metric. */
export function paceUnit(sceneUnits) {
    const units = String(sceneUnits ?? '').trim().toLowerCase();
    return ['m', 'meters', 'metres', 'km', 'kilometers', 'kilometres'].includes(units) ? 'km/h' : 'mph';
}

/** Scene units per hour to the pace unit's number (mph or km/h), for showing. */
export function sceneUnitsToPace(unitsPerHour, sceneUnits) {
    const perMph = paceToSceneUnits(1, sceneUnits);
    if (!perMph) return null;
    const mph = unitsPerHour / perMph;
    return paceUnit(sceneUnits) === 'km/h' ? mph * KM_PER_MILE : mph;
}

/** A pace typed in the pace unit (mph or km/h) as scene units per hour. */
export function paceInputToSceneUnits(value, sceneUnits) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    const mph = paceUnit(sceneUnits) === 'km/h' ? number / KM_PER_MILE : number;
    return paceToSceneUnits(mph, sceneUnits);
}

/** Scene units per hour as a scroll speed in pixels per second, on the scene's grid. */
export function unitsPerHourToPixels(unitsPerHour, grid) {
    const size = Number(grid?.size) || 0;
    const distance = Number(grid?.distance) || 0;
    if (!size || !distance) return 0;
    return (unitsPerHour / 3600 / distance) * size;
}

/** A scroll speed in pixels per second as scene units per hour, on the scene's grid. */
export function pixelsToUnitsPerHour(pixelsPerSecond, grid) {
    return pixelsToDistance(pixelsPerSecond, grid) * 3600;
}

export function formatDistance(value, sceneUnits) {
    const { amount, unit } = displayDistance(value, sceneUnits);
    return `${amount.toLocaleString()} ${unit}`;
}

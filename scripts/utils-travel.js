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

/**
 * Scrolled pixels as distance on the scene's grid, multiplied by the travel
 * scale. With a 140-pixel, 5-foot grid, 140 pixels at scale 1 is 5 feet.
 */
export function pixelsToDistance(pixels, grid, scale = 1) {
    const size = Number(grid?.size) || 0;
    const distance = Number(grid?.distance) || 0;
    if (!size || !distance) return 0;
    return (pixels / size) * distance * (Number(scale) || 1);
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

export function formatDistance(value, sceneUnits) {
    const { amount, unit } = displayDistance(value, sceneUnits);
    return `${amount.toLocaleString()} ${unit}`;
}

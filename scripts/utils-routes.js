// ==================================================================
// ===== ROUTES: GEOMETRY ===========================================
// ==================================================================

/**
 * Measuring a route: a line of waypoints drawn on a map scene, stored as
 * [[x, y], ...] in scene pixels. Lengths are the true length of the line on
 * the scene's grid -- a diagonal is as long as it looks -- because a road on
 * an overland map winds, and Foundry's diagonal rules are for token moves.
 * Nothing here touches Foundry, so it is tested in node.
 */

import { gridStep } from './utils-travel.js';
import { motionTravel } from './utils-motion.js';

/** Metres in one of each unit a distance can be converted between. */
const METRES = {
    ft: 0.3048, feet: 0.3048, foot: 0.3048,
    yd: 0.9144, yards: 0.9144, yard: 0.9144,
    mi: 1609.344, miles: 1609.344, mile: 1609.344,
    m: 1, meters: 1, metres: 1, meter: 1, metre: 1,
    km: 1000, kilometers: 1000, kilometres: 1000, kilometer: 1000, kilometre: 1000
};

/**
 * A distance in one scene's units as another's: a route on a map in miles
 * gives the odometer of a scene in feet its destination. Units that are the
 * same pass through as they are, so two maps in "days" agree; units that
 * cannot be compared (hexes and feet) give null.
 */
export function convertDistance(value, fromUnits, toUnits) {
    const from = String(fromUnits ?? '').trim().toLowerCase();
    const to = String(toUnits ?? '').trim().toLowerCase();
    if (from === to) return value;
    if (!(from in METRES) || !(to in METRES)) return null;
    return (value * METRES[from]) / METRES[to];
}

/** Each leg's length in pixels, waypoint to waypoint. */
export function legPixels(points) {
    const legs = [];
    for (let i = 1; i < (points?.length ?? 0); i++) {
        legs.push(Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    }
    return legs;
}

/** The whole route's length in pixels. */
export function routePixels(points) {
    return legPixels(points).reduce((sum, leg) => sum + leg, 0);
}

/** Pixels on a grid as its distance: on a 100 px, 5 mi grid, 100 px is 5 mi. Hexes too; see gridStep. */
export function gridDistance(pixels, grid) {
    const step = gridStep(grid);
    const distance = Number(grid?.distance) || 0;
    return step && distance ? (pixels / step) * distance : 0;
}

/** A distance on a grid as pixels: the other way from gridDistance. */
export function distancePixels(distance, grid) {
    const step = gridStep(grid);
    const per = Number(grid?.distance) || 0;
    return step && per ? (distance / per) * step : 0;
}

/** The waypoint nearest a point: { index, distance } in pixels, or null for no points. */
export function nearestWaypoint(points, [x, y]) {
    let best = null;
    (points ?? []).forEach(([px, py], index) => {
        const distance = Math.hypot(px - x, py - y);
        if (!best || distance < best.distance) best = { index, distance };
    });
    return best;
}

/**
 * The place on the route nearest a point: the leg it is on (`index` is the
 * waypoint the leg starts from), the point itself, and how far away it is,
 * in pixels. Where a double-click on the line puts a new waypoint.
 */
export function nearestOnRoute(points, [x, y]) {
    let best = null;
    for (let i = 1; i < (points?.length ?? 0); i++) {
        const [ax, ay] = points[i - 1];
        const [bx, by] = points[i];
        const dx = bx - ax;
        const dy = by - ay;
        const lengthSq = dx * dx + dy * dy;
        const t = lengthSq ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSq)) : 0;
        const point = [ax + dx * t, ay + dy * t];
        const distance = Math.hypot(point[0] - x, point[1] - y);
        if (!best || distance < best.distance) best = { index: i - 1, point, distance };
    }
    return best;
}

/**
 * The point a distance in pixels along the route reaches, with the heading
 * of the leg it is on (radians), clamped to the ends. Where the progress
 * marker will stand.
 */
export function pointAlong(points, pixels) {
    if (!points?.length) return null;
    if (points.length === 1 || pixels <= 0) {
        const angle = points.length > 1 ? Math.atan2(points[1][1] - points[0][1], points[1][0] - points[0][0]) : 0;
        return { x: points[0][0], y: points[0][1], angle };
    }
    let left = pixels;
    for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1];
        const [bx, by] = points[i];
        const leg = Math.hypot(bx - ax, by - ay);
        const angle = Math.atan2(by - ay, bx - ax);
        if (left <= leg || i === points.length - 1) {
            const t = leg ? Math.min(1, left / leg) : 0;
            return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, angle };
        }
        left -= leg;
    }
    return null;
}

/**
 * Waypoints tidied for saving: rounded to the pixel, with any that land on
 * the one before dropped -- a double-click to finish places the last point
 * twice.
 */
// ==================================================================
// ===== NAMES ======================================================
// ==================================================================

/**
 * A route's two ends as it is run: [where it sets out, where it is
 * heading]. `from` is the end it was drawn from, `to` the end it was drawn
 * to; reversed, they swap. Either may be empty.
 */
export function routeEnds(route, reversed = false) {
    const from = String(route?.from ?? '').trim();
    const to = String(route?.to ?? '').trim();
    return reversed ? [to, from] : [from, to];
}

/**
 * What a route is called: its ends, the way it is run ("Zhentil Keep →
 * Phlan"), after its name if it has one ("The Coast Road (Zhentil Keep →
 * Phlan)"); or just its name. `both` gives the ends as "↔", for lists where
 * it can be run either way.
 */
export function routeTitle(route, { reversed = false, both = false } = {}) {
    const [start, end] = routeEnds(route, reversed);
    const ends = start && end ? `${start} ${both ? '↔' : '→'} ${end}` : '';
    const name = String(route?.name ?? '').trim();
    if (name && ends) return `${name} (${ends})`;
    return name || ends || start || end;
}

/**
 * A name made of two places -- "Zhentil Keep <> Phlan", "Teshwave to Zhentil
 * Keep", "A -> B" -- as its two ends, { from, to }; null for any other name.
 */
export function splitRouteName(name) {
    const parts = String(name ?? '').trim().split(/\s+(?:<->|<>|↔|→|->|to)\s+/i);
    return parts.length === 2 && parts[0] && parts[1] ? { from: parts[0].trim(), to: parts[1].trim() } : null;
}

export function cleanPoints(points, minGap = 4) {
    const out = [];
    for (const [x, y] of points ?? []) {
        const point = [Math.round(x), Math.round(y)];
        const last = out.at(-1);
        if (last && Math.hypot(point[0] - last[0], point[1] - last[1]) < minGap) continue;
        out.push(point);
    }
    return out;
}

// ==================================================================
// ===== TERRAIN ====================================================
// ==================================================================

/**
 * The ground a leg crosses, and how it slows travel: difficult terrain halves
 * the pace, as in the D&D rules. A route stores one terrain per leg
 * (`terrain[i]` is the leg from waypoint i to i + 1).
 */
export const TERRAINS = [
    { id: 'road', factor: 1 },
    { id: 'open', factor: 1 },
    { id: 'forest', factor: 0.5 },
    { id: 'hills', factor: 0.5 },
    { id: 'mountains', factor: 0.5 },
    { id: 'swamp', factor: 0.5 },
    { id: 'desert', factor: 0.5 },
    { id: 'snow', factor: 0.5 },
    { id: 'water', factor: 1 }
];
export const DEFAULT_TERRAIN = 'open';

export function terrainFactor(id) {
    return TERRAINS.find(terrain => terrain.id === id)?.factor ?? 1;
}

/** Each leg's terrain, filling any that are missing or unknown with the default. */
export function legTerrains(points, terrain) {
    const legs = Math.max(0, (points?.length ?? 0) - 1);
    return Array.from({ length: legs }, (_, i) =>
        TERRAINS.some(known => known.id === terrain?.[i]) ? terrain[i] : DEFAULT_TERRAIN);
}

/** Hours to travel legs (in scene units) at a pace (scene units an hour), each slowed by its terrain. */
export function travelHours(legDistances, terrains, perHour) {
    if (!(perHour > 0)) return null;
    return legDistances.reduce((hours, distance, i) => hours + distance / (perHour * terrainFactor(terrains?.[i])), 0);
}

/** A waypoint added on leg `legIndex`: the leg splits in two, both keeping its terrain. */
export function insertWaypoint(points, terrain, legIndex, point) {
    const legs = legTerrains(points, terrain);
    return {
        points: [...points.slice(0, legIndex + 1), point, ...points.slice(legIndex + 1)],
        terrain: [...legs.slice(0, legIndex + 1), legs[legIndex] ?? DEFAULT_TERRAIN, ...legs.slice(legIndex + 1)]
    };
}

/**
 * Waypoint `index` removed. An end takes its leg with it; a middle one joins
 * its two legs into one, which keeps the terrain of the first.
 */
export function removeWaypoint(points, terrain, index) {
    const legs = legTerrains(points, terrain);
    const next = points.filter((_, i) => i !== index);
    if (index === 0) return { points: next, terrain: legs.slice(1) };
    if (index === points.length - 1) return { points: next, terrain: legs.slice(0, -1) };
    return { points: next, terrain: legs.filter((_, i) => i !== index) };
}

/**
 * How fast travel time runs when a map does not follow the world clock: in-world
 * seconds per real second, the choices the bar's slider steps through. 1 is real
 * time; 3600 is an hour a second. Always onward: which way the party goes is the
 * trip's direction (`travel.reversed`), not a negative time. The party's own
 * speed is its pace, which these never change.
 */
export const TIME_RATES = [1, 10, 60, 600, 3600];

/** The step of TIME_RATES nearest a rate (its size; a sign from an earlier version is ignored). */
export function timeRateIndex(rate) {
    const value = Math.abs(Number(rate) || 1) || 1;
    let best = 0;
    TIME_RATES.forEach((step, i) => {
        if (Math.abs(Math.log(step) - Math.log(value)) < Math.abs(Math.log(TIME_RATES[best]) - Math.log(value))) best = i;
    });
    return best;
}

/** Hours of travel in a day, unless the map says otherwise: D&D's travel day. */
export const DEFAULT_HOURS_PER_DAY = 8;
/** Past this many hours a day, mounts are pushed too hard. */
export const MOUNT_HOURS_PER_DAY = 6;
/** Past this many hours a day, it is a forced march (D&D: exhaustion saves). */
export const FORCED_MARCH_HOURS = 8;

/**
 * Hours of travel as days of a planned length: 30 h at 8 h a day is 3 days
 * and 6 h more. `days` is whole travel days; `rest` the hours left over.
 */
export function travelPlan(hours, perDay = DEFAULT_HOURS_PER_DAY) {
    const day = Number(perDay) > 0 ? Number(perDay) : DEFAULT_HOURS_PER_DAY;
    const total = Math.max(0, Number(hours) || 0);
    // A hair under a whole day counts as the whole day.
    const days = Math.floor(total / day + 1e-6);
    const rest = Math.max(0, total - days * day);
    return { hours: total, days, rest: rest < 0.05 ? 0 : rest, perDay: day };
}

// ==================================================================
// ===== SNAPPING AND JOURNEYS ======================================
// ==================================================================

/** The nearest of some points within a radius of a point, or null. */
export function snapTo(point, targets, radius) {
    let best = null;
    for (const target of targets ?? []) {
        const distance = Math.hypot(target[0] - point[0], target[1] - point[1]);
        if (distance <= radius && (!best || distance < best.distance)) best = { point: [...target], distance };
    }
    return best?.point ?? null;
}

/**
 * Routes, in order, as one path: a journey. Each route runs whichever way
 * joins it to the one before -- a road drawn from Phlan joins one drawn to
 * Phlan -- and the first runs whichever way meets the second. Where two do
 * not meet (further apart than `tolerance` pixels) the path crosses the gap
 * in a straight leg, and the join is listed in `gaps` so it can be shown.
 *
 * Returns { parts: [{ route, reversed }], points, terrain, gaps: [{ after, distance }] }.
 */
export function chainRoutes(routes, tolerance = 1) {
    const list = (routes ?? []).filter(route => (route?.points?.length ?? 0) >= 2);
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const parts = [];
    const points = [];
    const terrain = [];
    const gaps = [];
    list.forEach((route, index) => {
        let reversed;
        if (index === 0) {
            const next = list[1];
            if (!next) reversed = false;
            else {
                const ends = [next.points[0], next.points.at(-1)];
                const fromEnd = Math.min(...ends.map(end => d(route.points.at(-1), end)));
                const fromStart = Math.min(...ends.map(end => d(route.points[0], end)));
                reversed = fromStart < fromEnd;
            }
        } else {
            const at = points.at(-1);
            reversed = d(at, route.points.at(-1)) < d(at, route.points[0]);
        }
        const own = reversed ? [...route.points].reverse() : route.points;
        const legs = legTerrains(route.points, route.terrain);
        const ownTerrain = reversed ? [...legs].reverse() : legs;
        if (index > 0) {
            const gap = d(points.at(-1), own[0]);
            if (gap > tolerance) {
                gaps.push({ after: index - 1, distance: gap });
                terrain.push(DEFAULT_TERRAIN);
                points.push(own[0]);
            }
            points.push(...own.slice(1));
        } else {
            points.push(...own);
        }
        terrain.push(...ownTerrain);
        parts.push({ route, reversed });
    });
    return { parts, points, terrain, gaps };
}

// ==================================================================
// ===== PROGRESS ALONG A PATH ======================================
// ==================================================================

/**
 * Progress along a route or journey is kept as **effort**: distance as if it
 * were all open ground, in the map's units. A leg of difficult terrain costs
 * twice its length in effort, so at a steady pace the party covers it at half
 * the speed. Effort grows steadily with time -- the pace times the eased
 * master speed, from the same motion maths as the scenery -- and is turned
 * into distance by walking the legs, so every client works out the same
 * place from the same few numbers.
 */

/** A path's legs as { distance, factor }: length in the map's units and how fast its terrain lets the party go. */
export function pathLegs(points, terrain, grid) {
    const kinds = legTerrains(points, terrain);
    return legPixels(points).map((pixels, i) => ({ distance: gridDistance(pixels, grid), factor: terrainFactor(kinds[i]) }));
}

/** The effort a whole path takes. */
export function totalEffort(legs) {
    return (legs ?? []).reduce((sum, leg) => sum + leg.distance / leg.factor, 0);
}

/** How far along the path an amount of effort reaches, clamped to its ends. */
export function distanceForEffort(legs, effort) {
    let left = Math.max(0, Number(effort) || 0);
    let distance = 0;
    for (const leg of legs ?? []) {
        const cost = leg.distance / leg.factor;
        if (left <= cost) return distance + left * leg.factor;
        left -= cost;
        distance += leg.distance;
    }
    return distance;
}

/** The effort it takes to reach a distance along the path. */
export function effortForDistance(legs, distance) {
    let left = Math.max(0, Number(distance) || 0);
    let effort = 0;
    for (const leg of legs ?? []) {
        if (left <= leg.distance) return effort + left / leg.factor;
        left -= leg.distance;
        effort += leg.distance / leg.factor;
    }
    return effort;
}

/** The leg a distance along the path is on; past the end, the last. */
export function legIndexAt(legs, distance) {
    let left = Math.max(0, Number(distance) || 0);
    for (let i = 0; i < (legs?.length ?? 0); i++) {
        if (left < legs[i].distance) return i;
        left -= legs[i].distance;
    }
    return Math.max(0, (legs?.length ?? 0) - 1);
}

/**
 * A path's travel, as stored on the route or journey: the effort at the
 * anchor, the pace (map units an hour), whether it has been reached, and the
 * motion -- playing, master speed, ease, anchor -- whose clockFactor is the
 * world clock's rate when following it (in-world time drives the effort).
 */
export function defaultPathTravel() {
    return {
        effort: 0,
        pace: 0,
        arrived: false,
        followClock: false,
        timeline: [],
        motion: { playing: false, masterSpeed: 1, easeSeconds: 0, anchorAt: 0, rampFrom: null, clockFactor: 1 }
    };
}

/** How many changes a journey's timeline keeps: months of play, at a few a session. */
export const TIMELINE_LIMIT = 500;

/**
 * Following the world clock, a path's progress is a function of the date and
 * time: a **timeline** of changes, each `{ w, effort, rate }` -- the world
 * time it was made, the effort then, and the effort per in-world second from
 * then on (the pace times the master speed while playing, 0 while stopped).
 * Where the party is at any world time is read from the last change at or
 * before it, so scrubbing time forward or back moves them to where they were
 * or will be, and a stretch spent stopped stays stopped.
 */
export function timelineEffort(timeline, worldTime) {
    if (!timeline?.length) return 0;
    let at = timeline[0];
    if (worldTime <= at.w) return at.effort;
    for (const change of timeline) {
        if (change.w <= worldTime) at = change;
        else break;
    }
    return at.effort + at.rate * (worldTime - at.w);
}

/** The effort per in-world second a timeline has at a world time: 0 before it starts. */
export function timelineRate(timeline, worldTime) {
    let rate = 0;
    for (const change of timeline ?? []) {
        if (change.w <= worldTime) rate = change.rate;
        else break;
    }
    return rate;
}

/**
 * A change to a timeline at world time `w`: everything after it is
 * replaced -- changing course after scrubbing back rewrites what followed --
 * and the change is added, keeping the last TIMELINE_LIMIT.
 */
export function timelineWith(timeline, change) {
    const kept = (timeline ?? []).filter(earlier => earlier.w < change.w);
    return [...kept, change].slice(-TIMELINE_LIMIT);
}

/**
 * The effort a path's travel has reached, unclamped: from its timeline at
 * world time `worldTime` when it follows the clock, else from real time
 * `now` and its motion.
 */
export function travelEffort(travel, now, worldTime) {
    if (travel?.followClock && travel.timeline?.length && Number.isFinite(worldTime)) {
        return timelineEffort(travel.timeline, worldTime);
    }
    const pace = Number(travel?.pace) || 0;
    return (Number(travel?.effort) || 0) + (pace / 3600) * motionTravel(travel?.motion ?? {}, now);
}

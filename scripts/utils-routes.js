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

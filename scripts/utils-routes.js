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

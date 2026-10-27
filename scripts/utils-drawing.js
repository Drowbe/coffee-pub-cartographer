// ==================================================================
// ===== DRAWING HELPERS ============================================
// ==================================================================
//
// What the drawing tool works out before it writes anything to the scene, as plain functions:
// the walls a stroke makes, and the data of the Drawings that are written. No Foundry here, so a
// test can run them in node.

import { sketchToSegments } from './utils-autowall.js';

/**
 * The position and shape of a polygon Drawing through some points: the Drawing sits at the
 * top-left of the points' bounds, and its points are measured from there.
 * @param {number[]} abs  Flat [x, y, ...] in scene pixels.
 */
export function polygonShape(abs) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < abs.length; i += 2) {
        minX = Math.min(minX, abs[i]);
        maxX = Math.max(maxX, abs[i]);
        minY = Math.min(minY, abs[i + 1]);
        maxY = Math.max(maxY, abs[i + 1]);
    }
    const x = Math.floor(minX);
    const y = Math.floor(minY);
    const points = [];
    for (let i = 0; i < abs.length; i += 2) points.push(abs[i] - x, abs[i + 1] - y);
    return { x, y, shape: { type: 'p', width: Math.max(1, Math.ceil(maxX - x)), height: Math.max(1, Math.ceil(maxY - y)), points } };
}

/**
 * The walls a stroke makes, as [[[x, y], [x, y]], ...] in whole pixels, one after another.
 *
 * A straight stroke is one wall from its first point to its last. A freehand stroke is
 * simplified to straight pieces, and closed into a ring if it ends near where it began. Every end
 * goes through `snap`, and the same point is snapped the same way wherever it appears, so pieces
 * that met still meet. A piece that snaps to nothing is dropped.
 *
 * @param {object} stroke
 * @param {'line'|'sketch'} stroke.shape
 * @param {number[][]} stroke.points  [[x, y], ...] in scene pixels.
 * @param {(point: number[]) => number[]} [stroke.snap]  Puts a point where walls may go.
 * @param {number} [stroke.epsilon]  How far a freehand wall may stray from the line drawn.
 * @param {number} [stroke.closeDistance]  How near the end must come to the start to close a ring.
 */
export function wallStrokeSegments({ shape, points, snap = point => point, epsilon = 3, closeDistance = 0 }) {
    if (!Array.isArray(points) || points.length < 2) return [];
    const raw = shape === 'sketch'
        ? sketchToSegments(points, { epsilon, closeDistance })
        : [[[points[0][0], points[0][1]], [points[points.length - 1][0], points[points.length - 1][1]]]];
    const snapped = new Map();
    const place = point => {
        const key = `${Math.round(point[0])},${Math.round(point[1])}`;
        if (!snapped.has(key)) snapped.set(key, snap(point).map(Math.round));
        return snapped.get(key);
    };
    return raw
        .map(([a, b]) => [place(a), place(b)])
        .filter(([a, b]) => a[0] !== b[0] || a[1] !== b[1]);
}

/** The points a run of wall segments passes through, flat: each segment starts where the last ended. */
export function segmentsPath(segments) {
    const path = [];
    segments.forEach(([a, b], index) => {
        if (index === 0 || path[path.length - 2] !== a[0] || path[path.length - 1] !== a[1]) path.push(a[0], a[1]);
        path.push(b[0], b[1]);
    });
    return path;
}

/**
 * The Drawing that shows a wall stroke: an open line through the stroke's points.
 * @param {number[]} path  Flat [x, y, ...] in scene pixels.
 * @param {{ color: string, alpha?: number, width: number, flags?: object, none?: number }} style
 *   `none` is CONST.DRAWING_FILL_TYPES.NONE.
 */
export function strokeDrawingData(path, { color, alpha = 1, width, flags = {}, none = 0 }) {
    return {
        ...polygonShape(path),
        bezierFactor: 0,
        fillType: none, fillColor: color, fillAlpha: 0,
        strokeWidth: Math.max(1, Math.round(width)), strokeColor: color, strokeAlpha: alpha,
        flags
    };
}

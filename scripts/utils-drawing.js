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
export function strokeDrawingData(path, { color, alpha = 1, width, flags = {}, none = 0, sort = 0 }) {
    return {
        ...polygonShape(path),
        bezierFactor: 0,
        sort,
        fillType: none, fillColor: color, fillAlpha: 0,
        strokeWidth: Math.max(1, Math.round(width)), strokeColor: color, strokeAlpha: alpha,
        flags
    };
}

/**
 * A filled disc, as a polygon Drawing: the round cap on the end of a wall line, and the joint where
 * two meet, so a corner is a corner and not two slabs.
 * @param {{ color: string, alpha?: number, flags?: object, solid?: number, sort?: number }} style
 *   `solid` is CONST.DRAWING_FILL_TYPES.SOLID.
 */
export function discDrawingData(x, y, radius, { color, alpha = 1, flags = {}, solid = 1, sort = 0 }) {
    const steps = 16;
    const ring = [];
    for (let i = 0; i < steps; i++) ring.push(x + Math.cos((i / steps) * Math.PI * 2) * radius, y + Math.sin((i / steps) * Math.PI * 2) * radius);
    return {
        ...polygonShape(ring),
        bezierFactor: 0,
        sort,
        fillType: solid, fillColor: color, fillAlpha: alpha,
        strokeWidth: 0, strokeColor: color, strokeAlpha: 0,
        flags
    };
}

// ------------------------------------------------------------------
// Finding what is under the eraser
// ------------------------------------------------------------------

/** How far a point is from a run of points, flat [x, y, ...]. One point is the distance to it. */
export function distanceToPolyline(pts, x, y) {
    if (!pts || pts.length < 2) return Infinity;
    if (pts.length < 4) return Math.hypot(x - pts[0], y - pts[1]);
    let best = Infinity;
    for (let i = 0; i < pts.length - 2; i += 2) {
        const ax = pts[i];
        const ay = pts[i + 1];
        const dx = pts[i + 2] - ax;
        const dy = pts[i + 3] - ay;
        const lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared)) : 0;
        best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
    }
    return best;
}

/** Whether a point is inside a polygon, flat [x, y, ...]. */
export function insidePolygon(pts, x, y) {
    let inside = false;
    for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
        const xi = pts[i];
        const yi = pts[i + 1];
        const xj = pts[j];
        const yj = pts[j + 1];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

/**
 * Whether the eraser, a circle of `reach` pixels at (x, y), is on a polygon Drawing: inside it if it
 * is filled, or near its line.
 * @param {object} doc  A Drawing's data: x, y, shape, fillType, fillAlpha, strokeWidth, strokeAlpha.
 * @param {number} none  CONST.DRAWING_FILL_TYPES.NONE.
 */
export function drawingHit(doc, x, y, reach, none = 0) {
    const shape = doc?.shape;
    if (!shape || shape.type !== 'p' || !shape.points?.length) return false;
    const abs = [];
    for (let i = 0; i < shape.points.length; i += 2) abs.push(doc.x + shape.points[i], doc.y + shape.points[i + 1]);
    const filled = doc.fillType !== none && doc.fillAlpha > 0;
    if (filled && abs.length >= 6 && insidePolygon(abs, x, y)) return true;
    const outline = filled ? [...abs, abs[0], abs[1]] : abs;
    return distanceToPolyline(outline, x, y) <= reach + (doc.strokeAlpha > 0 ? doc.strokeWidth / 2 : 0);
}

/**
 * The group a Drawing or wall belongs to, from its flags, when this module drew it as a stamp, a
 * path or a wall stroke; null for anything else. Whatever has a group is erased with the rest of it.
 */
export function keptGroup(flags, moduleId) {
    const own = flags?.[moduleId];
    if (!own) return null;
    for (const type of ['stamp', 'terrain', 'drawnWall']) {
        if (own[type]?.id) return { type, id: own[type].id, key: `${type}:${own[type].id}` };
    }
    return null;
}

// ------------------------------------------------------------------
// Kinds of wall
// ------------------------------------------------------------------

/**
 * The kinds of wall that can be drawn. `color` is the line drawn over the walls, so that a kind can be
 * told from another on the map; `look` is how the picture in the window draws it.
 */
export const WALL_KINDS = [
    { id: 'wall', icon: 'fa-solid fa-border-none', labelKey: 'kindWall', color: '#d8cfa8', look: 'solid' },
    { id: 'invisible', icon: 'fa-regular fa-eye-slash', labelKey: 'kindInvisible', color: '#a394dc', look: 'dotted' },
    { id: 'terrain', icon: 'fa-solid fa-mountain', labelKey: 'kindTerrain', color: '#e0a64a', look: 'zigzag' },
    { id: 'ethereal', icon: 'fa-solid fa-ghost', labelKey: 'kindEthereal', color: '#7fc4e0', look: 'dashed' },
    { id: 'door', icon: 'fa-solid fa-door-closed', labelKey: 'kindDoor', color: '#4fae5a', look: 'door' },
    { id: 'secret', icon: 'fa-solid fa-door-closed', labelKey: 'kindSecret', color: '#c25a86', look: 'secret' },
    { id: 'window', icon: 'fa-solid fa-window-maximize', labelKey: 'kindWindow', color: '#6fb4e8', look: 'window' }
];
const KIND_BY_ID = new Map(WALL_KINDS.map(kind => [kind.id, kind]));
export const wallKindById = id => KIND_BY_ID.get(id) ?? null;

/** The kinds that are doors, and take a state. */
export const isDoorKind = id => id === 'door' || id === 'secret';

/**
 * The fields a wall of a kind is written with, over Foundry's defaults, which are a plain wall. These
 * are the settings Foundry's own wall tools give each kind.
 *
 * @param {string} kind
 * @param {object} constants  What Foundry calls its numbers:
 *   sense { NONE, LIMITED, NORMAL, PROXIMITY }, doorTypes { DOOR, SECRET }, doorStates { CLOSED, OPEN, LOCKED }.
 * @param {{ doorState?: string, windowDistance?: number }} [options]  windowDistance is in scene units.
 */
export function wallKindData(kind, constants, { doorState = 'closed', windowDistance = 10 } = {}) {
    const { sense, doorTypes, doorStates } = constants;
    switch (kind) {
        case 'invisible':
            // Stops movement, and nothing else.
            return { light: sense.NONE, sight: sense.NONE, sound: sense.NONE, move: sense.NORMAL };
        case 'terrain':
            // Sight, light and sound are cut short, not stopped; movement is stopped.
            return { light: sense.LIMITED, sight: sense.LIMITED, sound: sense.LIMITED, move: sense.NORMAL };
        case 'ethereal':
            // Stops sight, light and sound, and not movement.
            return { light: sense.NORMAL, sight: sense.NORMAL, sound: sense.NORMAL, move: sense.NONE };
        case 'door':
        case 'secret':
            return {
                light: sense.NORMAL, sight: sense.NORMAL, sound: sense.NORMAL, move: sense.NORMAL,
                door: kind === 'secret' ? doorTypes.SECRET : doorTypes.DOOR,
                ds: { closed: doorStates.CLOSED, open: doorStates.OPEN, locked: doorStates.LOCKED }[doorState] ?? doorStates.CLOSED
            };
        case 'window':
            // As the window tool does: light and sight pass at close range, fading with distance.
            return {
                light: sense.PROXIMITY, sight: sense.PROXIMITY, sound: sense.NORMAL, move: sense.NORMAL,
                threshold: { light: windowDistance, sight: windowDistance, attenuation: true }
            };
        default:
            return {};
    }
}

/** A kind of wall as a small SVG for the window: a length of it, drawn as it is on the map. */
export function wallKindSvg(kind) {
    const info = KIND_BY_ID.get(kind) ?? KIND_BY_ID.get('wall');
    const color = info.color;
    const line = (d, extra = '') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
    let body;
    switch (info.look) {
        case 'dotted': body = line('M10 20H90', ' stroke-dasharray="0.1 11"'); break;
        case 'dashed': body = line('M10 20H90', ' stroke-dasharray="13 9"'); break;
        case 'zigzag': body = line('M10 24L24 14L38 26L52 14L66 26L80 14L90 22'); break;
        case 'door':
        case 'secret': {
            const leaf = `<rect x="34" y="12" width="32" height="16" rx="2" fill="none" stroke="${color}" stroke-width="4"/>`;
            body = line('M10 20H30') + line('M70 20H90') + leaf + (info.look === 'secret' ? `<circle cx="50" cy="20" r="3" fill="${color}"/>` : '');
            break;
        }
        case 'window':
            body = line('M10 20H90') + `<path d="M10 20H90" fill="none" stroke="#fff" stroke-opacity="0.75" stroke-width="2.5" stroke-linecap="round"/>`;
            break;
        default: body = line('M10 20H90');
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" aria-hidden="true">${body}</svg>`;
}

// ------------------------------------------------------------------
// Openings: doors and windows
// ------------------------------------------------------------------

/** The kinds that are an opening in a wall -- two points, put on a wall if there is one. */
export const isOpeningKind = id => id === 'door' || id === 'secret' || id === 'window';

/**
 * An opening drawn near a solid wall, fitted onto it: its ends are put on the wall, and the wall is
 * worked out as it will be left, cut short to what is before the opening with what is after it a
 * wall of its own, or taken whole if the opening reaches both ends. Nothing is fitted if the
 * drawn opening is not along a wall: both ends within reach of its line, and not off its ends.
 *
 * @param {number[][]} walls  Each solid wall as [x1, y1, x2, y2].
 * @param {number[][]} segment  The opening as drawn, [[x, y], [x, y]].
 * @param {{ grid: number, reach?: number, minSquares?: number }} options  `reach` is how near, in grid squares.
 * @returns {{ wall: number, segment: number[][], pieces: number[][] } | null}  `wall` indexes `walls`; `pieces`
 *   is what is left of that wall: none, one or two walls.
 */
export function fitOpeningToWall(walls, segment, { grid, reach = 0.5, minSquares = 0.3 } = {}) {
    let best = null;
    walls.forEach((c, index) => {
        const [x1, y1, x2, y2] = c;
        const length = Math.hypot(x2 - x1, y2 - y1);
        if (length < grid * 0.5) return;
        const ux = (x2 - x1) / length;
        const uy = (y2 - y1) / length;
        const m = segment.map(([x, y]) => ({ along: (x - x1) * ux + (y - y1) * uy, across: Math.abs(-(x - x1) * uy + (y - y1) * ux) }));
        const worst = Math.max(m[0].across, m[1].across);
        if (worst > reach * grid) return;
        const low = Math.min(m[0].along, m[1].along);
        const high = Math.max(m[0].along, m[1].along);
        if (low < -reach * grid || high > length + reach * grid) return;
        const lo = Math.max(0, low);
        const hi = Math.min(length, high);
        if (hi - lo < grid * minSquares) return;
        if (!best || worst < best.worst) best = { index, worst, lo, hi, length, ux, uy, x1, y1, x2, y2 };
    });
    if (!best) return null;
    const tolerance = 2;
    const point = s => [Math.round(best.x1 + best.ux * s), Math.round(best.y1 + best.uy * s)];
    const before = best.lo > tolerance;
    const after = best.hi < best.length - tolerance;
    // An opening that all but reaches an end of the wall takes it to the end.
    const lo = before ? best.lo : 0;
    const hi = after ? best.hi : best.length;
    const pieces = [];
    if (before) pieces.push([best.x1, best.y1, ...point(lo)]);
    if (after) pieces.push([...point(hi), best.x2, best.y2]);
    return { wall: best.index, segment: [point(lo), point(hi)], pieces };
}

/**
 * The marks that say what an opening is, drawn over its line, as the picture on its button does: a door
 * leaf across a door, with a dot on a secret one, and a pane down the middle of a window. Nothing for
 * an opening too short to hold them, or a kind that has none.
 *
 * @param {string} kind
 * @param {number[][]} segment  [[x, y], [x, y]].
 * @param {{ weight: number, color: string, casing: string, flags?: object, solid?: number, none?: number, sort?: number }} style
 */
export function openingMarks(kind, segment, { weight, color, casing, flags = {}, solid = 1, none = 0, sort = 2 }) {
    const [[ax, ay], [bx, by]] = segment;
    const length = Math.hypot(bx - ax, by - ay);
    if (!isOpeningKind(kind) || length < 16) return [];
    const ux = (bx - ax) / length;
    const uy = (by - ay) / length;
    const cx = (ax + bx) / 2;
    const cy = (ay + by) / 2;
    if (kind === 'window') {
        const pane = strokeDrawingData([ax, ay, bx, by], { color: '#ffffff', alpha: 0.85, width: Math.max(2, weight * 0.35), flags, none, sort });
        return [pane];
    }
    // The leaf of a door: a panel across the middle, wider than the wall, in the door's colour.
    const half = length * 0.3;
    const thick = Math.max(weight * 0.9, 6);
    const corner = (along, across) => [cx + ux * along - uy * across, cy + uy * along + ux * across];
    const ring = [...corner(-half, -thick), ...corner(half, -thick), ...corner(half, thick), ...corner(-half, thick)];
    const leaf = {
        ...polygonShape(ring),
        bezierFactor: 0, sort,
        fillType: solid, fillColor: casing, fillAlpha: 1,
        strokeWidth: 3, strokeColor: color, strokeAlpha: 1,
        flags
    };
    const marks = [leaf];
    if (kind === 'secret') marks.push(discDrawingData(cx, cy, Math.max(3, weight * 0.4), { color, alpha: 1, flags, solid, sort }));
    return marks;
}

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

/** The four sides of the box with these two corners, one after another and back to the start; none if it has no area. */
export function boxSegments([x1, y1], [x2, y2]) {
    if (Math.abs(x2 - x1) < 4 || Math.abs(y2 - y1) < 4) return [];
    return [[[x1, y1], [x2, y1]], [[x2, y1], [x2, y2]], [[x2, y2], [x1, y2]], [[x1, y2], [x1, y1]]];
}

/**
 * The sides of an ellipse that fills the box with these two corners, as a ring of straight walls: enough
 * of them to look round -- about one to every half square round -- and no fewer than twelve.
 */
export function ellipseSegments([x1, y1], [x2, y2], grid = 100) {
    const rx = Math.abs(x2 - x1) / 2;
    const ry = Math.abs(y2 - y1) / 2;
    if (rx < 2 || ry < 2) return [];
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    // Ramanujan's approximation of the way round.
    const round = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
    // A multiple of four, so the ring touches all four sides of its box.
    const sides = Math.max(12, Math.min(48, Math.round(round / (grid * 0.5) / 4) * 4));
    const ring = [];
    for (let i = 0; i < sides; i++) ring.push([cx + Math.cos((i / sides) * Math.PI * 2) * rx, cy + Math.sin((i / sides) * Math.PI * 2) * ry]);
    return ring.map((point, i) => [point, ring[(i + 1) % sides]]);
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
 * @param {'line'|'sketch'|'box'|'ellipse'} stroke.shape  A box is a ring of four walls, corner to corner of
 *   the first and last points, and an ellipse a ring of straight walls round the box they make.
 * @param {number[][]} stroke.points  [[x, y], ...] in scene pixels.
 * @param {number} [stroke.grid]  The grid size, for how many sides an ellipse has.
 * @param {(point: number[]) => number[]} [stroke.snap]  Puts a point where walls may go.
 * @param {number} [stroke.epsilon]  How far a freehand wall may stray from the line drawn.
 * @param {number} [stroke.closeDistance]  How near the end must come to the start to close a ring.
 */
export function wallStrokeSegments({ shape, points, snap = point => point, epsilon = 3, closeDistance = 0, grid = 100 }) {
    if (!Array.isArray(points) || points.length < 2) return [];
    const first = [points[0][0], points[0][1]];
    const last = [points[points.length - 1][0], points[points.length - 1][1]];
    let raw;
    if (shape === 'sketch') raw = sketchToSegments(points, { epsilon, closeDistance });
    else if (shape === 'box') raw = boxSegments(first, last);
    else if (shape === 'ellipse') raw = ellipseSegments(first, last, grid);
    else raw = [[first, last]];
    const snapped = new Map();
    const place = point => {
        const key = `${Math.round(point[0])},${Math.round(point[1])}`;
        if (!snapped.has(key)) snapped.set(key, snap(point).map(Math.round));
        return snapped.get(key);
    };
    const walls = raw
        .map(([a, b]) => [place(a), place(b)])
        .filter(([a, b]) => a[0] !== b[0] || a[1] !== b[1]);
    // A room that snapping has squashed flat has no inside: it is not two walls on top of each other.
    if ((shape === 'box' || shape === 'ellipse') && walls.length) {
        const xs = walls.flatMap(([a, b]) => [a[0], b[0]]);
        const ys = walls.flatMap(([a, b]) => [a[1], b[1]]);
        if (Math.min(...xs) === Math.max(...xs) || Math.min(...ys) === Math.max(...ys)) return [];
    }
    return walls;
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

// ------------------------------------------------------------------
// Materials: what a wall looks like
// ------------------------------------------------------------------

/**
 * What a wall is made of, for how it looks on the map. A kind says what a wall does; a material says
 * what it is drawn like, and `suggests` the kind that suits it -- a fence stops movement and nothing
 * else -- which is chosen with it from a plain wall, and can be changed after.
 */
export const WALL_MATERIALS = [
    { id: 'plain', icon: 'fa-solid fa-minus', labelKey: 'materialPlain', color: '#d8cfa8' },
    { id: 'stone', icon: 'fa-solid fa-chess-rook', labelKey: 'materialStone', color: '#9c9a94', edge: '#2b2a28', suggests: null },
    { id: 'brick', icon: 'fa-solid fa-table-cells-large', labelKey: 'materialBrick', color: '#a8553d', edge: '#3a2018', suggests: null },
    { id: 'wood', icon: 'fa-solid fa-grip-lines', labelKey: 'materialWood', color: '#8a6238', edge: '#2e1d10', suggests: null },
    { id: 'fence', icon: 'fa-solid fa-grip-lines-vertical', labelKey: 'materialFence', color: '#8a6238', edge: '#2e1d10', suggests: 'invisible' },
    { id: 'iron', icon: 'fa-solid fa-bars', labelKey: 'materialIron', color: '#59606a', edge: '#1b1d20', suggests: 'invisible' },
    { id: 'hedge', icon: 'fa-solid fa-tree', labelKey: 'materialHedge', color: '#3f7d36', edge: '#24461f', suggests: 'terrain' }
];
const MATERIAL_BY_ID = new Map(WALL_MATERIALS.map(material => [material.id, material]));
export const wallMaterialById = id => MATERIAL_BY_ID.get(id) ?? null;

/** The most pieces of decoration one wall stroke may have: a long stroke spaces them out instead. */
export const MAX_WALL_DECOR = 240;

/** A seeded random number generator, for the little differences between one brick and the next. */
function seeded(seed = 1) {
    let state = (Number(seed) || 1) >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A line moved sideways by `distance`, point by point, along the normals of the line. */
export function offsetPath(path, distance) {
    const count = path.length / 2;
    const out = [];
    for (let i = 0; i < count; i++) {
        const a = Math.max(0, i - 1);
        const b = Math.min(count - 1, i + 1);
        const dx = path[b * 2] - path[a * 2];
        const dy = path[b * 2 + 1] - path[a * 2 + 1];
        const length = Math.hypot(dx, dy) || 1;
        out.push(path[i * 2] - (dy / length) * distance, path[i * 2 + 1] + (dx / length) * distance);
    }
    return out;
}

/**
 * Points at even distances along a line, each with the unit normal there.
 * @returns {{ x: number, y: number, nx: number, ny: number }[]}
 */
export function pointsAlong(path, step, first = step / 2) {
    const points = [];
    if (path.length < 4 || !(step > 0)) return points;
    let travelled = 0;
    let next = first;
    for (let i = 0; i < path.length - 2; i += 2) {
        const dx = path[i + 2] - path[i];
        const dy = path[i + 3] - path[i + 1];
        const length = Math.hypot(dx, dy);
        if (!length) continue;
        while (next <= travelled + length) {
            const t = (next - travelled) / length;
            points.push({ x: path[i] + dx * t, y: path[i + 1] + dy * t, nx: -dy / length, ny: dx / length });
            next += step;
        }
        travelled += length;
    }
    return points;
}

const pathLength = path => {
    let total = 0;
    for (let i = 0; i < path.length - 2; i += 2) total += Math.hypot(path[i + 2] - path[i], path[i + 3] - path[i + 1]);
    return total;
};

/**
 * How thick a wall is drawn, as a part of a grid square, so a wall is the same on any map: thin, medium
 * and thick are a eighth, a fifth and a third of a square.
 */
export const WALL_THICKNESS = { thin: 0.125, medium: 0.2, thick: 0.33 };

/** A wall's thickness in pixels on a grid of this size, never under 8 so a pattern has room to show. */
export function wallThickness(thickness, grid = 100) {
    return Math.max(8, Math.round((Number(grid) || 100) * (WALL_THICKNESS[thickness] ?? WALL_THICKNESS.medium)));
}

/** A filled polygon Drawing, for the blocks of a wall. `edge` outlines it when given. */
function blockDrawing(points, { fill, alpha = 1, edge = null, edgeWidth = 1, flags = {}, solid = 1, sort = 2 }) {
    return {
        ...polygonShape(points),
        bezierFactor: 0, sort,
        fillType: solid, fillColor: fill, fillAlpha: alpha,
        strokeWidth: edge ? edgeWidth : 0, strokeColor: edge ?? fill, strokeAlpha: edge ? 1 : 0,
        flags
    };
}

/** The straight pieces of a line, each with its length and direction. */
function legsOf(path) {
    const legs = [];
    for (let i = 0; i < path.length - 2; i += 2) {
        const dx = path[i + 2] - path[i];
        const dy = path[i + 3] - path[i + 1];
        const length = Math.hypot(dx, dy);
        if (length > 0.5) legs.push({ x: path[i], y: path[i + 1], length, ux: dx / length, uy: dy / length });
    }
    return legs;
}

/** A rectangle on a leg: from `a` to `b` along it, from `lo` to `hi` across it (measured from the line), as flat points. */
function onLeg(leg, a, b, lo, hi) {
    const at = (along, across) => [leg.x + leg.ux * along - leg.uy * across, leg.y + leg.uy * along + leg.ux * across];
    return [...at(a, lo), ...at(b, lo), ...at(b, hi), ...at(a, hi)];
}

/**
 * The Drawings that make a wall stroke show on the map: a dark line, the wall over it, round ends and
 * corners, and what a material is made of -- the stones, the bricks, the planks, the bars, the leaves --
 * laid down leg by leg, so a corner is a corner. All of one group, dark below and coloured above.
 *
 * @param {object} what
 * @param {number[]} what.path  The stroke, flat [x, y, ...] in scene pixels.
 * @param {string} [what.material]  A WALL_MATERIALS id; `plain` is the kind's own colour.
 * @param {string} what.color  The kind's colour, for a plain wall.
 * @param {string} what.casing  The dark line under a plain wall.
 * @param {number} what.weight  How thick the wall is, in pixels (see wallThickness).
 * @param {number} [what.grid]  The grid size, for how far apart posts stand.
 * @param {number} [what.seed]
 * @param {object} what.flags
 * @param {number} [what.solid]  CONST.DRAWING_FILL_TYPES.SOLID.
 * @param {number} [what.none]  CONST.DRAWING_FILL_TYPES.NONE.
 */
export function wallLineDrawings({ path, material = 'plain', color, casing, weight, grid = 100, seed = 1, flags = {}, solid = 1, none = 0 }) {
    const info = MATERIAL_BY_ID.get(material) ?? MATERIAL_BY_ID.get('plain');
    const rand = seeded(seed);
    const pick = list => list[Math.floor(rand() * list.length)];
    const line = (pts, width, fill, alpha, sort) => strokeDrawingData(pts, { color: fill, alpha, width, flags, none, sort });
    const disc = (x, y, radius, fill, sort, alpha = 1) => discDrawingData(x, y, radius, { color: fill, alpha, flags, solid, sort });
    const block = (pts, fill, sort = 2, edge = null) => blockDrawing(pts, { fill, edge, flags, solid, sort });
    const ends = (radius, fill, sort) => {
        const out = [];
        for (let i = 0; i < path.length; i += 2) out.push(disc(path[i], path[i + 1], radius, fill, sort));
        return out;
    };
    const total = pathLength(path);
    const legs = legsOf(path);
    const w = Math.max(weight, 8);
    // Spaced so a long stroke does not carry more than the cap.
    const spaced = (step, first) => pointsAlong(path, Math.max(step, total / MAX_WALL_DECOR), first);
    const cross = (p, width, fill, alpha, sort, half = w / 2) => line([p.x - p.nx * half, p.y - p.ny * half, p.x + p.nx * half, p.y + p.ny * half], width, fill, alpha, sort);

    if (info.id === 'plain') {
        return [
            line(path, w + 4, casing, 1, 0), ...ends(w / 2 + 2, casing, 0),
            line(path, w, color, 1, 1), ...ends(w / 2, color, 1)
        ];
    }

    const edge = info.edge;
    const body = info.color;
    const docs = [];
    // Rows of blocks along every leg: each row a band across the wall, each block a length along it, the
    // joints of one row falling in the middle of the blocks of the next.
    const courses = (rows, blockLength, tones, inset, stagger = true) => {
        const length = Math.max(blockLength, total / (MAX_WALL_DECOR / rows));
        legs.forEach(leg => {
            for (let row = 0; row < rows; row++) {
                const lo = -w / 2 + (w / rows) * row + inset;
                const hi = -w / 2 + (w / rows) * (row + 1) - inset;
                let at = stagger && row % 2 ? -length * (0.3 + rand() * 0.4) : 0;
                while (at < leg.length) {
                    const size = length * (0.75 + rand() * 0.5);
                    const a = Math.max(0, at) + inset;
                    const b = Math.min(leg.length, at + size) - inset;
                    if (b - a > 1.5) docs.push(block(onLeg(leg, a, b, lo, hi), pick(tones), 2));
                    at += size;
                }
            }
        });
    };

    switch (info.id) {
        case 'stone': {
            // Rubble: a dark joint line, and two rows of grey stones, no two alike.
            docs.push(line(path, w + 4, edge, 1, 0), ...ends(w / 2 + 2, edge, 0), line(path, w, '#6a6862', 1, 1), ...ends(w / 2, '#6a6862', 1));
            courses(w >= 16 ? 2 : 1, w * 0.95, ['#b4b2aa', '#a4a29a', '#bdbbb3', '#98968e', '#aeaca4'], 1.2);
            break;
        }
        case 'brick': {
            // Courses of red brick on pale mortar, each course shifted from the one below it.
            docs.push(line(path, w + 4, edge, 1, 0), ...ends(w / 2 + 2, edge, 0), line(path, w, '#dccfb8', 1, 1), ...ends(w / 2, '#dccfb8', 1));
            courses(Math.max(2, Math.round(w / 8)), w * 0.62, ['#a8553d', '#b5614a', '#9c4b35', '#ad5a41', '#a1503a'], 1, true);
            break;
        }
        case 'wood': {
            // Planks laid side by side, in three browns, with the ends of boards and a knot here and there.
            docs.push(line(path, w + 4, edge, 1, 0), ...ends(w / 2 + 2, edge, 0), line(path, w, '#4d3320', 1, 1), ...ends(w / 2, '#4d3320', 1));
            const strips = w >= 20 ? 3 : 2;
            const tones = ['#9a6c3b', '#85592f', '#a8793f', '#7a5230'];
            legs.forEach(leg => {
                for (let strip = 0; strip < strips; strip++) {
                    const lo = -w / 2 + (w / strips) * strip + 1;
                    const hi = -w / 2 + (w / strips) * (strip + 1) - 1;
                    // Boards a few widths long, end to end.
                    let at = 0;
                    while (at < leg.length) {
                        const size = Math.max(w * 2.2, total / (MAX_WALL_DECOR / strips / 2)) * (1 + rand());
                        const a = at + 0.8;
                        const b = Math.min(leg.length, at + size) - 0.8;
                        if (b - a > 1.5) docs.push(block(onLeg(leg, a, b, lo, hi), pick(tones), 2));
                        at += size;
                    }
                }
            });
            spaced(w * 1.6, w * 0.4).forEach(p => { if (rand() < 0.45) docs.push(disc(p.x + p.nx * (rand() - 0.5) * w * 0.6, p.y + p.ny * (rand() - 0.5) * w * 0.6, Math.max(1.5, w * 0.07), '#3d2a1a', 3, 0.85)); });
            break;
        }
        case 'fence': {
            // Open: two thin rails and a stout post at every half square, with the gap between to see through.
            const rail = Math.max(3, w * 0.2);
            for (const side of [-0.3, 0.3]) {
                docs.push(line(offsetPath(path, w * side), rail + 3, edge, 1, 0), line(offsetPath(path, w * side), rail, '#b08650', 1, 1));
            }
            const post = Math.max(4, w * 0.28);
            const stand = [...pointsAlong(path, Math.max(grid * 0.5, total / (MAX_WALL_DECOR / 3)), grid * 0.25)];
            [{ x: path[0], y: path[1] }, { x: path[path.length - 2], y: path[path.length - 1] }, ...stand].forEach(p => {
                docs.push(disc(p.x, p.y, post + 2, edge, 1), disc(p.x, p.y, post, '#c9a46a', 2), disc(p.x - post * 0.2, p.y - post * 0.2, post * 0.4, '#e0c18a', 3, 0.8));
            });
            break;
        }
        case 'iron': {
            // A black rail, bars standing across it in silver, and a ball on every post.
            const rail = Math.max(4, w * 0.3);
            for (const side of [-0.42, 0.42]) docs.push(line(offsetPath(path, w * side), rail * 0.6 + 2, edge, 1, 0), line(offsetPath(path, w * side), rail * 0.6, '#454b53', 1, 1));
            spaced(Math.max(w * 0.5, 7), w * 0.25).forEach(p => docs.push(cross(p, 2.4, '#d3dae2', 1, 2, w * 0.46)));
            const post = Math.max(4, w * 0.3);
            const posts = [{ x: path[0], y: path[1] }, { x: path[path.length - 2], y: path[path.length - 1] }, ...pointsAlong(path, Math.max(grid * 0.5, total / (MAX_WALL_DECOR / 4)), grid * 0.25)];
            posts.forEach(p => docs.push(disc(p.x, p.y, post + 1.5, edge, 3), disc(p.x, p.y, post, '#59606a', 4), disc(p.x - post * 0.25, p.y - post * 0.25, post * 0.38, '#b9c1ca', 5, 0.9)));
            break;
        }
        case 'hedge': {
            // Wider than a wall, and soft: a dark mass, and clumps of leaves in three greens, with the odd berry.
            const hw = w * 1.5;
            docs.push(line(path, hw + 4, edge, 1, 0), ...ends(hw / 2 + 2, edge, 0), line(path, hw, '#2f6a2a', 1, 1), ...ends(hw / 2, '#2f6a2a', 1));
            spaced(Math.max(w * 0.55, 8), w * 0.2).forEach(p => {
                const across = (rand() - 0.5) * hw * 0.55;
                docs.push(disc(p.x + p.nx * across, p.y + p.ny * across, w * (0.4 + rand() * 0.3), pick(['#3f8a36', '#4f9a3c', '#5aa84a', '#357a2e']), 2, 0.95));
                if (rand() < 0.12) docs.push(disc(p.x + p.nx * across * 1.2, p.y + p.ny * across * 1.2, Math.max(1.8, w * 0.1), '#c0392b', 3));
            });
            break;
        }
        default:
            break;
    }
    return docs;
}

/** A material as a small SVG for the window: a length of wall in it, drawn as it is on the map. */
export function wallMaterialSvg(material) {
    const info = MATERIAL_BY_ID.get(material) ?? MATERIAL_BY_ID.get('plain');
    const rr = (x, y, width, height, fill, radius = 1.2) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}"/>`;
    const band = (fill, edge, top = 11, height = 18) => rr(8, top - 2, 84, height + 4, edge, 8) + rr(10, top, 80, height, fill, 7);
    let body;
    switch (info.id) {
        case 'stone': {
            const tones = ['#b4b2aa', '#a4a29a', '#bdbbb3', '#98968e'];
            const row = (y, xs) => xs.map(([x, width], i) => rr(x, y, width, 7.4, tones[(i + Math.round(y)) % 4], 1.6)).join('');
            body = band('#6a6862', info.edge) + row(12, [[11, 14], [26, 19], [46, 12], [59, 18], [78, 11]]) + row(20.4, [[11, 9], [21, 17], [39, 13], [53, 16], [70, 19]]);
            break;
        }
        case 'brick': {
            const tones = ['#a8553d', '#b5614a', '#9c4b35', '#ad5a41'];
            const row = (y, offset) => Array.from({ length: 7 }, (_, i) => rr(10 + offset + i * 12, y, 11, 4.2, tones[(i + Math.round(y)) % 4], 0.6)).join('');
            body = band('#dccfb8', info.edge) + row(11.5, 0) + row(16, -6) + row(20.5, 0) + row(25, -6);
            break;
        }
        case 'wood': {
            const strip = (y, tone, cuts) => rr(10, y, 80, 5.6, tone, 0.5) + cuts.map(x => `<path d="M${x} ${y}v5.6" stroke="#3d2a1a" stroke-width="0.9"/>`).join('');
            body = band('#4d3320', info.edge) + strip(11.6, '#9a6c3b', [34, 70]) + strip(17.4, '#85592f', [22, 56]) + strip(23.2, '#a8793f', [44, 82]) + '<circle cx="62" cy="20" r="1.6" fill="#3d2a1a"/>';
            break;
        }
        case 'fence': {
            body = [14.5, 25.5].map(y => `<path d="M8 ${y}H92" stroke="${info.edge}" stroke-width="6.5" stroke-linecap="round"/><path d="M8 ${y}H92" stroke="#b08650" stroke-width="3.6" stroke-linecap="round"/>`).join('')
                + [14, 50, 86].map(x => `<circle cx="${x}" cy="20" r="8" fill="${info.edge}"/><circle cx="${x}" cy="20" r="6" fill="#c9a46a"/><circle cx="${x - 1.6}" cy="18.4" r="2.4" fill="#e0c18a" fill-opacity="0.8"/>`).join('');
            break;
        }
        case 'iron': {
            body = [11.5, 28.5].map(y => `<path d="M8 ${y}H92" stroke="${info.edge}" stroke-width="4.4" stroke-linecap="round"/><path d="M8 ${y}H92" stroke="#454b53" stroke-width="2.4" stroke-linecap="round"/>`).join('')
                + Array.from({ length: 12 }, (_, i) => `<path d="M${22 + i * 5.2} 10.5V29.5" stroke="#d3dae2" stroke-width="1.7"/>`).join('')
                + [14, 86].map(x => `<circle cx="${x}" cy="20" r="8.2" fill="${info.edge}"/><circle cx="${x}" cy="20" r="6.6" fill="#59606a"/><circle cx="${x - 1.8}" cy="18.2" r="2.6" fill="#b9c1ca" fill-opacity="0.9"/>`).join('');
            break;
        }
        case 'hedge': {
            body = band('#2f6a2a', info.edge, 7, 26) + [[16, 17, 6.5, '#3f8a36'], [28, 25, 6, '#5aa84a'], [40, 16, 7, '#4f9a3c'], [52, 24, 6.5, '#357a2e'], [64, 17, 6.5, '#5aa84a'], [76, 24, 6, '#3f8a36'], [86, 18, 5.5, '#4f9a3c']].map(([x, y, r, fill]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`).join('') + '<circle cx="46" cy="22" r="1.5" fill="#c0392b"/><circle cx="72" cy="20" r="1.5" fill="#c0392b"/>';
            break;
        }
        default: body = band(info.color, '#1c1c1c', 16, 8);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" aria-hidden="true">${body}</svg>`;
}

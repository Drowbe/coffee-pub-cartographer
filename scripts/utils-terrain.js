// ==================================================================
// ===== TERRAIN PATHS ==============================================
// ==================================================================
//
// Paths for quick maps -- dirt, gravel, sand, cobbles, mud, a boardwalk, a stream -- as geometry,
// in the same primitives as the stamps (utils-stamps.js), so they are drawn on the canvas, shown
// as the small pictures in the window, and written to the scene as Drawings by the same code. No
// Foundry and no PIXI here.
//
// A path is a stroke the user drags: it is smoothed, then made a ribbon -- an edge, the ground, a
// worn middle -- with the ground's own texture scattered over it. Unlike a stamp its primitives
// are in scene pixels, not a unit square, so they are drawn with a size of 1.

import { makeRng, primsSvg } from './utils-stamps.js';

const TAU = Math.PI * 2;
const between = (rng, low, high) => low + (high - low) * rng();

/**
 * The kinds of path. `texture` is what is scattered over the ribbon, `grain` is how big each
 * piece is against the path's width, and `spread` is how far apart the pieces are against it.
 */
export const TERRAINS = [
    { id: 'dirt', icon: 'fa-solid fa-shoe-prints', labelKey: 'terrainDirt', texture: 'grain', grain: 0.035, spread: 0.07,
        palette: { dark: '#6e5233', base: '#8f6d47', light: '#b08d63', accent: '#5a4128', accent2: '#c4a77c' } },
    { id: 'gravel', icon: 'fa-solid fa-ellipsis', labelKey: 'terrainGravel', texture: 'pebble', grain: 0.05, spread: 0.1,
        palette: { dark: '#77726a', base: '#9a958c', light: '#c4c0b8', accent: '#5f5b55', accent2: '#aca79e' } },
    { id: 'sand', icon: 'fa-solid fa-sun', labelKey: 'terrainSand', texture: 'dust', grain: 0.022, spread: 0.06,
        palette: { dark: '#bba873', base: '#dccb94', light: '#efe3b8', accent: '#a8945c', accent2: '#e6d7a4' } },
    { id: 'cobble', icon: 'fa-solid fa-border-all', labelKey: 'terrainCobble', texture: 'cobble', grain: 0.11, spread: 0.24,
        palette: { dark: '#5f5f5f', base: '#848484', light: '#a9a9a9', accent: '#4c4c4c', accent2: '#979797' } },
    { id: 'mud', icon: 'fa-solid fa-droplet-slash', labelKey: 'terrainMud', texture: 'grain', grain: 0.04, spread: 0.09,
        palette: { dark: '#3f3022', base: '#5e4a35', light: '#7a6249', accent: '#2e2218', accent2: '#8a7152' } },
    { id: 'boardwalk', icon: 'fa-solid fa-grip-lines-vertical', labelKey: 'terrainBoardwalk', texture: 'plank', grain: 0.02, spread: 0.3,
        palette: { dark: '#4f3620', base: '#8a6238', light: '#b58a58', accent: '#3b2814', accent2: '#a07646' } },
    { id: 'stream', icon: 'fa-solid fa-water', labelKey: 'terrainStream', texture: 'ripple', grain: 0.02, spread: 0.35,
        palette: { dark: '#8a7a55', base: '#4a86c4', light: '#a6d4f2', accent: '#3a6ea8', accent2: '#cfe9fb' } }
];

// A path is over the ground patches and under everything that grows or stands on it; a boardwalk lies over what it crosses, as a stream.
for (const terrain of TERRAINS) terrain.layer = terrain.id === 'boardwalk' ? 'ankle' : 'path';

const BY_ID = new Map(TERRAINS.map(terrain => [terrain.id, terrain]));
export const terrainById = id => BY_ID.get(id) ?? null;
export const isTerrain = id => BY_ID.has(id);

/** The colour of each tone for a kind of path. */
export const terrainPalette = kind => ({ ...(BY_ID.get(kind) ?? BY_ID.get('dirt')).palette });

/** How many pieces of texture a path may have at most, on the canvas and written to the scene. */
export const MAX_TEXTURE = { canvas: 160, scene: 50 };

// ------------------------------------------------------------------
// ----- The line ---------------------------------------------------
// ------------------------------------------------------------------

/**
 * A hand-drawn run of points as a smooth, evenly spaced line: resampled every `spacing` pixels, then
 * rounded off, with both ends kept where they were. Flat [x, y, ...] out.
 * @param {number[][]} points  [[x, y], ...] in scene pixels.
 */
export function smoothPath(points, { spacing = 8, rounds = 2, precision = 10 } = {}) {
    if (!Array.isArray(points) || points.length < 2) return [];
    let path = [points[0].slice(0, 2)];
    let carried = 0;
    for (let i = 1; i < points.length; i++) {
        let [ax, ay] = path[path.length - 1];
        const [bx, by] = points[i];
        let remaining = Math.hypot(bx - ax, by - ay);
        while (carried + remaining >= spacing) {
            const t = (spacing - carried) / remaining;
            ax += (bx - ax) * t;
            ay += (by - ay) * t;
            path.push([ax, ay]);
            remaining = Math.hypot(bx - ax, by - ay);
            carried = 0;
        }
        carried += remaining;
    }
    const last = points[points.length - 1];
    if (Math.hypot(last[0] - path[path.length - 1][0], last[1] - path[path.length - 1][1]) > 0.5) path.push(last.slice(0, 2));
    if (path.length < 2) return [];
    // Corner cutting, which keeps the ends and rounds every bend between them.
    for (let round = 0; round < rounds && path.length > 2; round++) {
        const next = [path[0]];
        for (let i = 0; i < path.length - 1; i++) {
            const [ax, ay] = path[i];
            const [bx, by] = path[i + 1];
            next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
        }
        next.push(path[path.length - 1]);
        path = next;
    }
    return path.flatMap(([x, y]) => [Math.round(x * precision) / precision, Math.round(y * precision) / precision]);
}

/** The distance along a flat path to each of its points, and the whole length. */
function lengths(path) {
    const cumulative = [0];
    for (let i = 2; i < path.length; i += 2) {
        cumulative.push(cumulative[cumulative.length - 1] + Math.hypot(path[i] - path[i - 2], path[i + 1] - path[i - 1]));
    }
    return { cumulative, total: cumulative[cumulative.length - 1] };
}

/** The point a distance along the path, and the unit normal to it there. */
function along(path, cumulative, distance) {
    let index = 1;
    while (index < cumulative.length - 1 && cumulative[index] < distance) index++;
    const span = cumulative[index] - cumulative[index - 1] || 1;
    const t = Math.max(0, Math.min(1, (distance - cumulative[index - 1]) / span));
    const ax = path[(index - 1) * 2];
    const ay = path[(index - 1) * 2 + 1];
    const bx = path[index * 2];
    const by = path[index * 2 + 1];
    const length = Math.hypot(bx - ax, by - ay) || 1;
    return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, nx: -(by - ay) / length, ny: (bx - ax) / length };
}

// ------------------------------------------------------------------
// ----- The ribbon -------------------------------------------------
// ------------------------------------------------------------------

const ngon = (cx, cy, radius, n, rng) => {
    const pts = [];
    const phase = rng() * TAU;
    for (let i = 0; i < n; i++) {
        const r = radius * (0.75 + 0.25 * rng());
        pts.push(cx + Math.cos(phase + (i / n) * TAU) * r, cy + Math.sin(phase + (i / n) * TAU) * r);
    }
    return pts;
};

/** A round end: a polygon of points round a centre. */
const circle = (cx, cy, radius, n = 20) => Array.from({ length: n * 2 }, (_, i) => (i % 2 ? cy + Math.sin(Math.floor(i / 2) / n * TAU) * radius : cx + Math.cos(Math.floor(i / 2) / n * TAU) * radius));

/**
 * A path as primitives in scene pixels: the edge, the ground, a worn middle, and the ground's
 * texture over it. The same path, width and seed always give the same primitives.
 *
 * @param {string} kind  A terrain id.
 * @param {number[]} path  A smoothed path, flat [x, y, ...], from smoothPath.
 * @param {{ width: number, seed?: number, maxTexture?: number }} options  The width is in pixels.
 */
export function buildTerrain(kind, path, { width, seed = 1, maxTexture = MAX_TEXTURE.canvas } = {}) {
    const terrain = BY_ID.get(kind);
    if (!terrain || !Array.isArray(path) || path.length < 4 || !(width > 0)) return [];
    const rng = makeRng(seed);
    const edge = width * 0.08;
    // A line stops dead, so each end is closed: a rounded end for a track, a board across it for a boardwalk.
    const ends = [{ x: path[0], y: path[1], from: [path[2], path[3]] }, { x: path[path.length - 2], y: path[path.length - 1], from: [path[path.length - 4], path[path.length - 3]] }];
    const caps = (radius, tone, extra = {}) => ends.map(end => ({ k: 'poly', pts: circle(end.x, end.y, radius), tone, ...extra }));
    const prims = kind === 'boardwalk'
        ? [
            { k: 'line', pts: path, width: width + edge * 2, tone: 'dark' },
            { k: 'line', pts: path, width, tone: 'base' },
            { k: 'line', pts: path, width: width * 0.55, tone: 'light', alpha: 0.3 },
            ...ends.map(end => {
                const length = Math.hypot(end.x - end.from[0], end.y - end.from[1]) || 1;
                const nx = -(end.y - end.from[1]) / length;
                const ny = (end.x - end.from[0]) / length;
                const half = (width / 2) * 1.05;
                return { k: 'line', width: width * 0.05, tone: 'dark', alpha: 0.8, pts: [end.x + nx * half, end.y + ny * half, end.x - nx * half, end.y - ny * half] };
            })
        ]
        : [
            { k: 'line', pts: path, width: width + edge * 2, tone: 'dark' },
            ...caps(width / 2 + edge, 'dark'),
            { k: 'line', pts: path, width, tone: 'base' },
            ...caps(width / 2, 'base'),
            { k: 'line', pts: path, width: width * 0.55, tone: 'light', alpha: 0.3 },
            ...caps(width * 0.275, 'light', { alpha: 0.3 })
        ];
    const { cumulative, total } = lengths(path);
    if (!(total > 0) || maxTexture <= 0) return prims;

    const piece = width * terrain.grain;
    const room = width * 0.46;

    if (terrain.texture === 'plank') {
        // Boards across the path, evenly spaced, the count held to the allowance.
        const step = Math.max(width * terrain.spread, total / maxTexture);
        for (let d = step / 2; d < total; d += step) {
            const at = along(path, cumulative, d);
            prims.push({
                k: 'line', width: width * 0.025, tone: 'dark', alpha: 0.55,
                pts: [at.x + at.nx * room * 1.05, at.y + at.ny * room * 1.05, at.x - at.nx * room * 1.05, at.y - at.ny * room * 1.05]
            });
        }
        return prims;
    }

    const count = Math.min(maxTexture, Math.floor((total * width) / Math.pow(width * terrain.spread, 2)));
    for (let i = 0; i < count; i++) {
        const at = along(path, cumulative, rng() * total);
        const offset = (rng() * 2 - 1) * room;
        const x = at.x + at.nx * offset;
        const y = at.y + at.ny * offset;
        if (terrain.texture === 'ripple') {
            const reach = width * between(rng, 0.12, 0.26);
            const tx = -at.ny * reach;
            const ty = at.nx * reach;
            prims.push({ k: 'line', width: width * 0.025, tone: rng() < 0.5 ? 'light' : 'accent2', alpha: 0.7, pts: [x - tx, y - ty, x + tx * 0.2 + at.nx * reach * 0.3, y + ty * 0.2 + at.ny * reach * 0.3, x + tx, y + ty] });
        } else if (terrain.texture === 'cobble') {
            prims.push({ k: 'poly', pts: ngon(x, y, piece * between(rng, 0.8, 1.1), 7, rng), tone: rng() < 0.5 ? 'base' : 'light', outline: 'dark', alpha: 0.9 });
        } else if (terrain.texture === 'pebble') {
            prims.push({ k: 'poly', pts: ngon(x, y, piece * between(rng, 0.6, 1.3), 6, rng), tone: ['light', 'dark', 'accent2'][Math.floor(rng() * 3)], alpha: 0.85 });
        } else {
            // Grain and dust: small marks in a darker or lighter ground.
            prims.push({ k: 'poly', pts: ngon(x, y, piece * between(rng, 0.5, 1.2), 5, rng), tone: rng() < 0.6 ? 'accent' : 'light', alpha: terrain.texture === 'dust' ? 0.55 : 0.6 });
        }
    }
    return prims;
}

/** A bend through the unit square that shows off a kind of path, for the picture in the window. */
const SAMPLE = [[-0.5, 0.32], [-0.2, 0.3], [0.0, 0.0], [0.2, -0.28], [0.5, -0.3]];

/** A kind of path as a small SVG: a short bend of it, at the same texture it is laid with. */
export function terrainSvg(kind, { seed = 5 } = {}) {
    const path = smoothPath(SAMPLE, { spacing: 0.03, precision: 10000 });
    const prims = buildTerrain(kind, path, { width: 0.34, seed, maxTexture: 40 });
    return primsSvg(prims, terrainPalette(kind));
}

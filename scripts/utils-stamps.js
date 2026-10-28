// ==================================================================
// ===== STAMPS =====================================================
// ==================================================================
//
// The stamps of the drawing tool -- trees, shrubs, grass, rocks and so on -- as geometry.
// Nothing here touches Foundry or PIXI, so the same shapes are drawn on the canvas, drawn as
// the small pictures in the Stamps tab, and written to the scene as Drawings, and a test can
// run all of it in node.
//
// A stamp is a list of primitives in a unit square centred on (0, 0): a polygon is flat
// [x, y, ...] points, a line is an open or closed run of them. A primitive names a tone, not
// a colour -- dark, base, light, accent, accent2 -- and a palette says what each tone is, so one
// shape is drawn in its natural colours or in the colour of the brush. Every stamp is made
// from a seed, so a stamp sent to another client is the same stamp there.

import { polygonShape } from './utils-drawing.js';

const TAU = Math.PI * 2;

/** The tones a primitive may name. */
export const TONES = ['dark', 'base', 'light', 'accent', 'accent2'];

// ------------------------------------------------------------------
// ----- Randomness and shapes --------------------------------------
// ------------------------------------------------------------------

/** A seeded random number generator: the same seed, the same run of numbers. */
export function makeRng(seed = 1) {
    let state = (Number(seed) || 1) >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const poly = (pts, tone, extra = {}) => ({ k: 'poly', pts, tone, ...extra });
const line = (pts, width, tone, extra = {}) => ({ k: 'line', pts, width, tone, ...extra });

/** A rounded shape: an ellipse of n points. */
function ngon(cx, cy, rx, ry = rx, n = 14, rotation = 0) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        const angle = rotation + (i / n) * TAU;
        pts.push(cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry);
    }
    return pts;
}

/** A star: points alternately at the outer and the inner radius. */
function star(cx, cy, outer, inner, points, rotation = 0) {
    const pts = [];
    for (let i = 0; i < points * 2; i++) {
        const angle = rotation + (i / (points * 2)) * TAU;
        const r = i % 2 === 0 ? outer : inner;
        pts.push(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
    }
    return pts;
}

/** A leafy outline: a ring of rounded lobes, each a little different. */
function canopy(rng, cx, cy, radius, lobes) {
    const pts = [];
    const phase = rng() * TAU;
    const perLobe = 4;
    for (let i = 0; i < lobes; i++) {
        for (let j = 0; j < perLobe; j++) {
            const t = j / perLobe;
            const angle = phase + ((i + t) / lobes) * TAU;
            const r = radius * (0.84 + 0.16 * Math.sin(t * Math.PI)) * (1 + (rng() - 0.5) * 0.08);
            pts.push(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
        }
    }
    return pts;
}

/** An irregular stone. */
function stone(rng, cx, cy, radius, vertices = 8, stretch = 1.12) {
    const pts = [];
    const phase = rng() * TAU;
    for (let i = 0; i < vertices; i++) {
        const angle = phase + ((i + (rng() - 0.5) * 0.45) / vertices) * TAU;
        const r = radius * (0.78 + 0.22 * rng());
        pts.push(cx + Math.cos(angle) * r * stretch, cy + Math.sin(angle) * r / stretch);
    }
    return pts;
}

/** A bar with round ends, lying along x. */
function bar(cx, cy, half, thick) {
    const pts = [];
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
        const angle = -Math.PI / 2 + (i / steps) * Math.PI;
        pts.push(cx + half + Math.cos(angle) * thick, cy + Math.sin(angle) * thick);
    }
    for (let i = 0; i <= steps; i++) {
        const angle = Math.PI / 2 + (i / steps) * Math.PI;
        pts.push(cx - half + Math.cos(angle) * thick, cy + Math.sin(angle) * thick);
    }
    return pts;
}

/** A blade of grass: a curved sliver from its root to its tip. */
function blade(rootX, rootY, angle, length, bend, width) {
    const dx = Math.sin(angle);
    const dy = -Math.cos(angle);
    const nx = -dy;
    const ny = dx;
    const midX = rootX + dx * length * 0.5 + nx * bend;
    const midY = rootY + dy * length * 0.5 + ny * bend;
    const tipX = rootX + dx * length + nx * bend * 2;
    const tipY = rootY + dy * length + ny * bend * 2;
    return [
        rootX - nx * width, rootY - ny * width,
        midX - nx * width * 0.6, midY - ny * width * 0.6,
        tipX, tipY,
        midX + nx * width * 0.6, midY + ny * width * 0.6,
        rootX + nx * width, rootY + ny * width
    ];
}

/** Points moved, scaled and turned about (0, 0): scale and turn first, then move. */
function place(pts, { dx = 0, dy = 0, scale = 1, turn = 0 } = {}) {
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const out = [];
    for (let i = 0; i < pts.length; i += 2) {
        const x = pts[i] * scale;
        const y = pts[i + 1] * scale;
        out.push(x * cos - y * sin + dx, x * sin + y * cos + dy);
    }
    return out;
}

const between = (rng, low, high) => low + (high - low) * rng();

// ------------------------------------------------------------------
// ----- The stamps -------------------------------------------------
// ------------------------------------------------------------------

function tree(rng) {
    const lobes = 8 + Math.floor(rng() * 4);
    const prims = [
        poly(canopy(rng, 0, 0, 0.46, lobes), 'dark', { shadow: true }),
        poly(canopy(rng, -0.015, -0.025, 0.42, lobes), 'base'),
        poly(canopy(rng, -0.08, -0.09, 0.26, Math.max(5, lobes - 3)), 'light', { alpha: 0.85 })
    ];
    for (let i = 0; i < 3; i++) {
        const angle = rng() * TAU;
        const reach = between(rng, 0.12, 0.28);
        prims.push(poly(ngon(Math.cos(angle) * reach, Math.sin(angle) * reach, between(rng, 0.05, 0.09), undefined, 8), 'light', { alpha: 0.55 }));
    }
    return prims;
}

function pine(rng) {
    const points = 9 + Math.floor(rng() * 4);
    const step = Math.PI / points;
    const turn = rng() * TAU;
    return [
        poly(star(0, 0, 0.48, 0.2, points, turn), 'dark', { shadow: true }),
        poly(star(0, 0, 0.37, 0.15, points, turn + step), 'base'),
        poly(star(-0.02, -0.02, 0.22, 0.09, points, turn), 'light', { alpha: 0.85 }),
        poly(ngon(0, 0, 0.04, 0.04, 8), 'accent')
    ];
}

function shrub(rng) {
    const count = 4 + Math.floor(rng() * 2);
    const clumps = [];
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * TAU + rng() * 0.8;
        const reach = between(rng, 0.1, 0.2);
        clumps.push({ x: Math.cos(angle) * reach, y: Math.sin(angle) * reach, r: between(rng, 0.2, 0.28) });
    }
    const prims = [];
    for (const c of clumps) prims.push(poly(canopy(rng, c.x + 0.02, c.y + 0.03, c.r, 5), 'dark', { shadow: true }));
    for (const c of clumps) prims.push(poly(canopy(rng, c.x, c.y, c.r * 0.92, 5), 'base'));
    for (const c of clumps) prims.push(poly(canopy(rng, c.x - c.r * 0.25, c.y - c.r * 0.25, c.r * 0.5, 5), 'light', { alpha: 0.8 }));
    if (rng() < 0.5) {
        for (let i = 0; i < 4; i++) {
            const c = clumps[Math.floor(rng() * clumps.length)];
            prims.push(poly(ngon(c.x + (rng() - 0.5) * c.r, c.y + (rng() - 0.5) * c.r, 0.035, 0.035, 8), 'accent2'));
        }
    }
    return prims;
}

function grass(rng) {
    const count = 6 + Math.floor(rng() * 4);
    const prims = [];
    const tones = ['dark', 'base', 'light', 'base'];
    for (let i = 0; i < count; i++) {
        const spread = (i / (count - 1) - 0.5) * 1.5 + (rng() - 0.5) * 0.25;
        prims.push(poly(blade((rng() - 0.5) * 0.14, 0.28, spread, between(rng, 0.38, 0.58), (rng() - 0.5) * 0.08, 0.035), tones[i % tones.length]));
    }
    return prims;
}

function flowers(rng) {
    const prims = [];
    for (let i = 0; i < 5; i++) {
        const spread = (i / 4 - 0.5) * 1.3 + (rng() - 0.5) * 0.2;
        prims.push(poly(blade((rng() - 0.5) * 0.12, 0.26, spread, between(rng, 0.3, 0.46), (rng() - 0.5) * 0.06, 0.03), i % 2 ? 'base' : 'dark'));
    }
    const blooms = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < blooms; i++) {
        const x = (rng() - 0.5) * 0.7;
        const y = between(rng, -0.3, 0.1);
        const tone = rng() < 0.6 ? 'accent' : 'accent2';
        prims.push(poly(ngon(x, y, 0.075, 0.075, 8), tone, { shadow: true }));
        prims.push(poly(ngon(x, y, 0.028, 0.028, 6), 'dark', { alpha: 0.6 }));
    }
    return prims;
}

function rock(rng) {
    const base = stone(rng, 0, 0, 0.46, 7 + Math.floor(rng() * 3));
    return [
        poly(base, 'dark', { shadow: true }),
        poly(place(base, { dx: -0.015, dy: -0.02, scale: 0.88 }), 'base'),
        poly(place(base, { dx: -0.09, dy: -0.1, scale: 0.5, turn: 0.3 }), 'light', { alpha: 0.8 }),
        line([-0.02, 0.0, 0.07, 0.1, 0.05, 0.2], 0.02, 'dark', { alpha: 0.7 })
    ];
}

function boulders(rng) {
    const prims = [];
    const group = [
        { x: -0.18, y: 0.12, r: 0.27 },
        { x: 0.2, y: 0.16, r: 0.22 },
        { x: 0.0, y: -0.2, r: 0.3 }
    ];
    for (const g of group) {
        const base = stone(rng, g.x + (rng() - 0.5) * 0.04, g.y + (rng() - 0.5) * 0.04, g.r, 7 + Math.floor(rng() * 2));
        prims.push(poly(base, 'dark', { shadow: true }));
        prims.push(poly(place(base, { dx: -0.01, dy: -0.015, scale: 0.88 }), 'base'));
        prims.push(poly(place(base, { dx: -g.r * 0.22, dy: -g.r * 0.24, scale: 0.5 }), 'light', { alpha: 0.8 }));
    }
    return prims;
}

function stump(rng) {
    const turn = rng() * TAU;
    return [
        poly(ngon(0, 0, 0.4, 0.4, 18, turn), 'dark', { shadow: true }),
        poly(ngon(0, 0, 0.34, 0.34, 18, turn), 'accent'),
        line(ngon(0, 0, 0.22, 0.22, 16, turn), 0.018, 'dark', { closed: true, alpha: 0.7 }),
        line(ngon(0, 0, 0.11, 0.11, 12, turn), 0.018, 'dark', { closed: true, alpha: 0.7 }),
        line([0, 0, 0.17 * Math.cos(turn), 0.17 * Math.sin(turn)], 0.015, 'dark', { alpha: 0.6 })
    ];
}

function log() {
    return [
        poly(bar(0, 0, 0.32, 0.14), 'dark', { shadow: true }),
        poly(bar(-0.01, -0.01, 0.31, 0.12), 'base'),
        line([-0.3, -0.04, 0.2, -0.04], 0.014, 'dark', { alpha: 0.6 }),
        line([-0.26, 0.05, 0.22, 0.05], 0.014, 'dark', { alpha: 0.6 }),
        poly(ngon(0.32, 0, 0.12, 0.12, 14), 'accent'),
        line(ngon(0.32, 0, 0.07, 0.07, 10), 0.014, 'dark', { closed: true, alpha: 0.7 })
    ];
}

function pond(rng) {
    const shore = canopy(rng, 0, 0, 0.47, 6);
    return [
        poly(shore, 'dark'),
        poly(place(shore, { scale: 0.88 }), 'base'),
        poly(place(shore, { dx: -0.1, dy: -0.1, scale: 0.4, turn: 0.6 }), 'light', { alpha: 0.55 }),
        line(ngon(0.12, 0.1, 0.12, 0.07, 12), 0.012, 'light', { closed: true, alpha: 0.7 }),
        poly(ngon(0.22, -0.12, 0.06, 0.06, 10), 'accent')
    ];
}

function campfire(rng) {
    const prims = [poly(ngon(0, 0, 0.26, 0.26, 14), 'dark', { shadow: true })];
    for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * TAU + rng() * 0.3;
        const stoneAt = stone(rng, Math.cos(angle) * 0.33, Math.sin(angle) * 0.33, 0.085, 6);
        prims.push(poly(stoneAt, 'base', { outline: 'dark', shadow: true }));
    }
    const turn = rng() * TAU;
    prims.push(poly(place(bar(0, 0, 0.17, 0.045), { turn }), 'dark', { outline: 'dark' }));
    prims.push(poly(place(bar(0, 0, 0.17, 0.045), { turn: turn + 1.2 }), 'dark', { outline: 'dark' }));
    prims.push(poly(star(0, -0.02, 0.17, 0.07, 6, rng() * TAU), 'accent2'));
    prims.push(poly(star(0, -0.02, 0.09, 0.04, 6, rng() * TAU), 'accent'));
    return prims;
}

/**
 * A soft patch of ground: a loose blob laid down in layers, each smaller and more solid than the
 * last, so the edge fades out and the middle is ground. It hints at dirt or sand rather than
 * filling a space with it. `texture` is what is scattered over the middle.
 */
function patch(texture) {
    return rng => {
        const a = rng() * TAU;
        const b = rng() * TAU;
        const c = rng() * TAU;
        const blob = [];
        const steps = 28;
        for (let i = 0; i < steps; i++) {
            const angle = (i / steps) * TAU;
            const r = 0.46 * (0.8 + 0.09 * Math.sin(2 * angle + a) + 0.07 * Math.sin(3 * angle + b) + 0.05 * Math.sin(5 * angle + c));
            blob.push(Math.cos(angle) * r, Math.sin(angle) * r);
        }
        const prims = [];
        for (const [scale, alpha] of [[1, 0.1], [0.88, 0.15], [0.76, 0.22], [0.64, 0.3], [0.52, 0.4]]) {
            prims.push(poly(place(blob, { scale }), 'base', { alpha }));
        }
        prims.push(poly(place(blob, { scale: 0.4, dx: -0.03, dy: -0.03 }), 'light', { alpha: 0.18 }));
        const count = { grain: 16, pebble: 12, dust: 20, flake: 18 }[texture] ?? 14;
        const size = { grain: [0.012, 0.026], pebble: [0.022, 0.045], dust: [0.008, 0.016], flake: [0.01, 0.022] }[texture] ?? [0.012, 0.026];
        for (let i = 0; i < count; i++) {
            const angle = rng() * TAU;
            const reach = Math.sqrt(rng()) * 0.3;
            const r = between(rng, size[0], size[1]);
            const tone = texture === 'pebble' ? ['light', 'dark', 'accent2'][Math.floor(rng() * 3)] : (rng() < 0.6 ? 'accent' : 'light');
            prims.push(poly(ngon(Math.cos(angle) * reach, Math.sin(angle) * reach, r, r, 6, rng() * TAU), tone, { alpha: texture === 'pebble' ? 0.85 : 0.55, speck: true }));
        }
        return prims;
    };
}

// ------------------------------------------------------------------
// ----- Clutter ----------------------------------------------------
// ------------------------------------------------------------------

/** A rectangle with rounded corners, centred, as flat points. */
function rrect(cx, cy, w, h, r = 0.03) {
    const pts = [];
    const corners = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
    corners.forEach(([sx, sy], index) => {
        const ox = cx + sx * (w / 2 - r);
        const oy = cy + sy * (h / 2 - r);
        for (let i = 0; i <= 3; i++) {
            const angle = (index * Math.PI) / 2 - Math.PI / 2 + (i / 3) * (Math.PI / 2);
            pts.push(ox + Math.cos(angle) * r, oy + Math.sin(angle) * r);
        }
    });
    return pts;
}

const seam = (x1, y1, x2, y2, width = 0.012, alpha = 0.35, tone = 'dark') => line([x1, y1, x2, y2], width, tone, { alpha });

function table(rng) {
    const prims = [poly(rrect(0, 0, 0.94, 0.6, 0.04), 'dark', { shadow: true }), poly(rrect(0, 0, 0.88, 0.54, 0.03), 'base')];
    for (const y of [-0.13, 0.0, 0.13]) prims.push(seam(-0.42, y + (rng() - 0.5) * 0.02, 0.42, y + (rng() - 0.5) * 0.02));
    prims.push(poly(rrect(-0.2, -0.17, 0.4, 0.1, 0.03), 'light', { alpha: 0.22 }));
    return prims;
}

function roundTable() {
    return [
        poly(ngon(0, 0, 0.45, 0.45, 28), 'dark', { shadow: true }),
        poly(ngon(0, 0, 0.4, 0.4, 28), 'base'),
        line(ngon(0, 0, 0.28, 0.28, 24), 0.012, 'dark', { closed: true, alpha: 0.3 }),
        poly(ngon(-0.1, -0.12, 0.16, 0.12, 12), 'light', { alpha: 0.22 })
    ];
}

function chair() {
    return [
        poly(rrect(0, 0.05, 0.52, 0.5, 0.05), 'dark', { shadow: true }),
        poly(rrect(0, 0.06, 0.46, 0.42, 0.04), 'base'),
        poly(rrect(0, -0.24, 0.56, 0.12, 0.04), 'dark', { outline: 'dark' }),
        seam(-0.2, -0.24, 0.2, -0.24, 0.012, 0.5, 'light')
    ];
}

function bed() {
    return [
        poly(rrect(0, 0, 0.58, 0.96, 0.04), 'dark', { shadow: true }),
        poly(rrect(0, 0.01, 0.5, 0.88, 0.03), 'light'),
        poly(rrect(0, -0.32, 0.4, 0.17, 0.05), 'accent2', { outline: 'dark' }),
        poly(rrect(0, 0.17, 0.5, 0.56, 0.03), 'accent'),
        seam(-0.25, -0.08, 0.25, -0.08, 0.014, 0.35),
        seam(-0.2, 0.2, 0.2, 0.2, 0.01, 0.2, 'light')
    ];
}

function cabinet() {
    return [
        poly(rrect(0, 0, 0.9, 0.52, 0.03), 'dark', { shadow: true }),
        poly(rrect(0, 0, 0.84, 0.46, 0.025), 'base'),
        seam(0, -0.23, 0, 0.23, 0.014, 0.5),
        poly(ngon(-0.06, 0, 0.026, 0.026, 8), 'light'),
        poly(ngon(0.06, 0, 0.026, 0.026, 8), 'light'),
        poly(rrect(-0.2, -0.12, 0.34, 0.08, 0.02), 'light', { alpha: 0.2 })
    ];
}

function workbench() {
    return [
        poly(rrect(0, 0, 0.96, 0.52, 0.03), 'dark', { shadow: true }),
        poly(rrect(0, 0, 0.9, 0.46, 0.025), 'base'),
        seam(-0.4, -0.07, 0.4, -0.07), seam(-0.4, 0.08, 0.4, 0.08),
        poly(rrect(-0.36, 0.0, 0.1, 0.22, 0.015), 'accent', { outline: 'dark' }),
        line([-0.1, 0.1, 0.12, 0.1], 0.03, 'dark', { alpha: 0.8 }),
        poly(rrect(0.14, 0.1, 0.1, 0.05, 0.01), 'accent', { outline: 'dark' }),
        poly(ngon(0.3, -0.1, 0.045, 0.045, 10), 'light', { outline: 'dark' })
    ];
}

function stove() {
    const prims = [poly(rrect(0, 0, 0.8, 0.8, 0.05), 'dark', { shadow: true }), poly(rrect(0, 0, 0.74, 0.74, 0.04), 'base')];
    for (const [x, y] of [[-0.2, -0.16], [0.2, -0.16], [-0.2, 0.2], [0.2, 0.2]]) {
        prims.push(poly(ngon(x, y, 0.12, 0.12, 16), 'dark', { alpha: 0.85 }));
        prims.push(line(ngon(x, y, 0.07, 0.07, 12), 0.016, 'light', { closed: true, alpha: 0.55 }));
    }
    prims.push(poly(ngon(0.31, -0.31, 0.055, 0.055, 12), 'light', { outline: 'dark' }));
    return prims;
}

function box() {
    return [
        poly(rrect(0, 0, 0.66, 0.66, 0.03), 'dark', { shadow: true }),
        poly(rrect(0, 0, 0.6, 0.6, 0.025), 'base'),
        seam(-0.3, -0.3, 0.3, 0.3, 0.012, 0.3), seam(0.3, -0.3, -0.3, 0.3, 0.012, 0.3),
        poly(rrect(0, 0, 0.1, 0.62, 0.01), 'light', { alpha: 0.5 }),
        poly(rrect(0, 0, 0.62, 0.1, 0.01), 'light', { alpha: 0.5 })
    ];
}

function crateFrame(size) {
    const half = size / 2;
    return [
        poly(rrect(0, 0, size + 0.04, size + 0.04, 0.03), 'dark', { shadow: true }),
        poly(rrect(0, 0, size - 0.04, size - 0.04, 0.025), 'base'),
        line([-half + 0.02, -half + 0.02, half - 0.02, -half + 0.02, half - 0.02, half - 0.02, -half + 0.02, half - 0.02], 0.045, 'dark', { closed: true, alpha: 0.85 })
    ];
}

function crate() {
    const prims = crateFrame(0.74);
    for (const y of [-0.14, 0, 0.14]) prims.push(seam(-0.32, y, 0.32, y, 0.012, 0.4));
    prims.push(line([-0.3, 0.3, 0.3, -0.3], 0.04, 'dark', { alpha: 0.7 }));
    return prims;
}

function barrel(rng) {
    const prims = [poly(ngon(0, 0, 0.45, 0.45, 28), 'dark', { shadow: true }), poly(ngon(0, 0, 0.4, 0.4, 28), 'base')];
    const turn = rng() * TAU;
    for (let i = 0; i < 5; i++) {
        const angle = turn + (i / 5) * Math.PI;
        prims.push(seam(Math.cos(angle) * 0.38, Math.sin(angle) * 0.38, -Math.cos(angle) * 0.38, -Math.sin(angle) * 0.38, 0.01, 0.3));
    }
    prims.push(line(ngon(0, 0, 0.31, 0.31, 24), 0.03, 'accent', { closed: true, alpha: 0.9 }));
    prims.push(line(ngon(0, 0, 0.19, 0.19, 20), 0.02, 'accent', { closed: true, alpha: 0.6 }));
    prims.push(poly(ngon(0, 0, 0.035, 0.035, 8), 'dark'));
    return prims;
}

function chest() {
    return [
        poly(rrect(0, 0, 0.88, 0.6, 0.05), 'dark', { shadow: true }),
        poly(rrect(0, 0, 0.82, 0.54, 0.045), 'base'),
        seam(-0.4, -0.1, 0.4, -0.1, 0.016, 0.55),
        poly(rrect(-0.27, 0, 0.07, 0.54, 0.01), 'accent', { outline: 'dark' }),
        poly(rrect(0.27, 0, 0.07, 0.54, 0.01), 'accent', { outline: 'dark' }),
        poly(rrect(0, -0.1, 0.1, 0.12, 0.015), 'light', { outline: 'dark' }),
        poly(rrect(-0.2, -0.2, 0.3, 0.06, 0.02), 'light', { alpha: 0.18 })
    ];
}

function appleCrate(rng) {
    const prims = crateFrame(0.74);
    prims.push(poly(rrect(0, 0, 0.58, 0.58, 0.02), 'accent'));
    const spots = [];
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) spots.push([-0.18 + col * 0.18 + (rng() - 0.5) * 0.04, -0.18 + row * 0.18 + (rng() - 0.5) * 0.04]);
    for (const [x, y] of spots) {
        prims.push(poly(ngon(x, y, 0.095, 0.095, 12), 'accent2', { outline: 'dark', shadow: true }));
        prims.push(poly(ngon(x - 0.03, y - 0.03, 0.03, 0.03, 8), 'light', { alpha: 0.7 }));
    }
    return prims;
}

function cauldron(rng) {
    const prims = [
        poly(rrect(-0.44, 0, 0.1, 0.1, 0.03), 'base', { outline: 'dark' }),
        poly(rrect(0.44, 0, 0.1, 0.1, 0.03), 'base', { outline: 'dark' }),
        poly(ngon(0, 0, 0.4, 0.4, 28), 'dark', { shadow: true }),
        poly(ngon(0, 0, 0.36, 0.36, 28), 'base'),
        poly(ngon(0, 0, 0.29, 0.29, 24), 'accent'),
        poly(ngon(-0.08, -0.08, 0.14, 0.1, 10), 'light', { alpha: 0.25 })
    ];
    for (let i = 0; i < 6; i++) {
        const angle = rng() * TAU;
        const reach = Math.sqrt(rng()) * 0.22;
        prims.push(poly(ngon(Math.cos(angle) * reach, Math.sin(angle) * reach, between(rng, 0.025, 0.055), undefined, 8), 'accent2', { alpha: 0.85 }));
    }
    return prims;
}

function pumpkin(cx, cy, r) {
    return [
        poly(ngon(cx, cy, r, r * 0.88, 20), 'base', { outline: 'dark', shadow: true }),
        line(ngon(cx, cy, r * 0.5, r * 0.86, 14), r * 0.05, 'dark', { closed: true, alpha: 0.4 }),
        line(ngon(cx, cy, r * 0.82, r * 0.86, 16), r * 0.04, 'dark', { closed: true, alpha: 0.3 }),
        poly(ngon(cx - r * 0.3, cy - r * 0.3, r * 0.22, r * 0.14, 8), 'light', { alpha: 0.4 }),
        poly(rrect(cx, cy - r * 0.05, r * 0.14, r * 0.26, r * 0.04), 'accent', { outline: 'dark' })
    ];
}

function pumpkins(rng) {
    const prims = [];
    for (const [x, y, r] of [[-0.2, 0.14, 0.26], [0.22, 0.17, 0.23], [0.0, -0.2, 0.28]]) prims.push(...pumpkin(x + (rng() - 0.5) * 0.04, y + (rng() - 0.5) * 0.04, r));
    return prims;
}

function melon(cx, cy, rx, ry, turn) {
    const move = pts => place(pts, { dx: cx, dy: cy, turn });
    return [
        poly(move(ngon(0, 0, rx, ry, 20)), 'base', { outline: 'dark', shadow: true }),
        line(move(ngon(0, 0, rx * 0.55, ry, 16)), 0.014, 'light', { closed: true, alpha: 0.55 }),
        line(move(ngon(0, 0, rx * 0.85, ry, 16)), 0.014, 'dark', { closed: true, alpha: 0.4 }),
        poly(move(ngon(-rx * 0.3, -ry * 0.35, rx * 0.25, ry * 0.15, 8)), 'light', { alpha: 0.3 })
    ];
}

function melons(rng) {
    const prims = [...melon(-0.2, -0.17, 0.3, 0.22, 0.3 + (rng() - 0.5) * 0.3), ...melon(0.2, 0.22, 0.3, 0.22, -0.2 + (rng() - 0.5) * 0.3)];
    // One cut open.
    const cx = -0.12;
    const cy = 0.24;
    prims.push(poly(ngon(cx, cy, 0.28, 0.2, 20), 'dark', { shadow: true }));
    prims.push(poly(ngon(cx, cy, 0.24, 0.16, 20), 'light'));
    prims.push(poly(ngon(cx, cy, 0.2, 0.12, 20), 'accent2'));
    for (let i = 0; i < 7; i++) prims.push(poly(ngon(cx + (rng() - 0.5) * 0.3, cy + (rng() - 0.5) * 0.14, 0.015, 0.025, 6), 'dark'));
    return prims;
}

// ------------------------------------------------------------------
// ----- Crops ------------------------------------------------------
// ------------------------------------------------------------------

/**
 * One plant of a field, and the soil it stands in. A field is a lattice of these -- a stamp that sits on
 * grid points half a square or so apart (`lattice` in the catalogue) -- so a drag lays rows.
 */
function field(plant) {
    return rng => [
        poly(ngon(0, 0, 0.5, 0.5, 18), 'dark', { alpha: 0.18 }),
        poly(ngon(0, 0, 0.42, 0.42, 18), 'base', { alpha: 0.55 }),
        ...plant(rng)
    ];
}

const corn = rng => {
    const turn = rng() * TAU;
    return [
        poly(star(0, 0, 0.4, 0.07, 7, turn), 'accent', { outline: 'dark' }),
        poly(star(0, 0, 0.26, 0.05, 7, turn + 0.2), 'light', { alpha: 0.85 }),
        poly(ngon(0, 0, 0.085, 0.085, 10), 'accent2', { outline: 'dark' })
    ];
};

const wheat = rng => {
    const prims = [];
    const turn = rng() * TAU;
    for (let i = 0; i < 9; i++) {
        const angle = turn + (i / 9) * TAU;
        prims.push(poly(blade(Math.cos(angle) * 0.04, Math.sin(angle) * 0.04, angle + Math.PI / 2, 0.32, 0.01, 0.028), i % 2 ? 'accent2' : 'accent'));
    }
    prims.push(poly(ngon(0, 0, 0.07, 0.07, 8), 'light', { alpha: 0.9 }));
    return prims;
};

const cabbage = rng => [
    poly(canopy(rng, 0, 0, 0.38, 6), 'accent', { outline: 'dark' }),
    poly(canopy(rng, 0, 0, 0.27, 6), 'light', { outline: 'dark' }),
    poly(canopy(rng, 0, 0, 0.15, 5), 'accent', { alpha: 0.6 }),
    line([0, -0.34, 0, -0.1, 0.3, 0.17, 0.08, 0.04], 0.012, 'dark', { alpha: 0.25 })
];

const pumpkinPlant = rng => [
    poly(canopy(rng, -0.05, -0.05, 0.4, 5), 'accent', { outline: 'dark' }),
    // The pumpkin's orange is the plant's fruit colour, not the soil's.
    ...pumpkin(0.1, 0.08, 0.2).map(prim => ({ ...prim, shadow: false, tone: prim.tone === 'base' ? 'accent2' : prim.tone }))
];

const carrots = rng => {
    const prims = [];
    const turn = rng() * TAU;
    for (let i = 0; i < 8; i++) {
        const angle = turn + (i / 8) * TAU;
        prims.push(poly(blade(0, 0, angle + Math.PI / 2, 0.36, 0.015, 0.03), i % 2 ? 'light' : 'accent'));
    }
    prims.push(poly(ngon(0, 0, 0.06, 0.06, 8), 'accent2', { outline: 'dark' }));
    return prims;
};

// The tidy markers the tool has always had. They are drawn by the drawing tool's own code; the
// geometry here is only for the pictures in the window.
const markerPlus = () => [line([-0.32, 0, 0.32, 0], 0.16, 'base'), line([0, -0.32, 0, 0.32], 0.16, 'base')];
const markerX = () => [line([-0.26, -0.26, 0.26, 0.26], 0.16, 'base'), line([0.26, -0.26, -0.26, 0.26], 0.16, 'base')];
const markerDot = () => [poly(ngon(0, 0, 0.36, 0.36, 20), 'base')];
const markerArrow = turn => () => [poly(place([-0.32, -0.32, -0.16, 0, -0.32, 0.32, 0.34, 0], { turn }), 'base')];
const markerSquare = () => [poly(place([-0.32, -0.32, 0.32, -0.32, 0.32, 0.32, -0.32, 0.32], {}), 'base')];

/** How big Small and Large are against Medium: a tree is 1, 3 and 6 squares across. */
export const SIZE_FACTORS = { small: 1 / 3, medium: 1, large: 2 };

/**
 * How many grid squares across a stamp is at a size, or null for a marker, which is sized in pixels.
 * A stamp of a fixed size is the same at every size: a crate is a crate.
 */
export function stampSquares(kind, size = 'medium') {
    const stamp = BY_ID.get(kind);
    if (!stamp || stamp.legacy) return null;
    return stamp.squares * (stamp.size === 'fixed' ? 1 : (SIZE_FACTORS[size] ?? 1));
}

/** The groups the Stamps tab shows, in order. */
export const STAMP_CATEGORIES = [
    { id: 'trees', labelKey: 'categoryTrees' },
    { id: 'plants', labelKey: 'categoryPlants' },
    { id: 'ground', labelKey: 'categoryGround' },
    { id: 'fields', labelKey: 'categoryFields' },
    { id: 'rocks', labelKey: 'categoryRocks' },
    { id: 'features', labelKey: 'categoryFeatures' },
    { id: 'furniture', labelKey: 'categoryFurniture' },
    { id: 'storage', labelKey: 'categoryStorage' },
    { id: 'kitchen', labelKey: 'categoryKitchen' },
    { id: 'markers', labelKey: 'categoryMarkers' }
];

/**
 * Every stamp. `squares` is how many grid squares across the stamp is at Medium, so a Medium tree is a
 * tree and a Medium tuft of grass is a tuft, on any grid; Small and Large are a third and double of it
 * (see SIZE_FACTORS). The markers the tool has always had keep a size in pixels of their own, and have a
 * `scale` of 1 instead. `palette` is its natural colours.
 * `legacy` marks the markers drawn by the drawing tool's own code.
 */
export const STAMPS = [
    { id: 'tree', category: 'trees', icon: 'fa-solid fa-tree', labelKey: 'stampTree', squares: 3, build: tree,
        palette: { dark: '#2c5a28', base: '#3f7d36', light: '#7bb85c', accent: '#8b5e34', accent2: '#c0452f' } },
    { id: 'pine', category: 'trees', icon: 'fa-solid fa-tree-christmas', labelKey: 'stampPine', squares: 3, build: pine,
        palette: { dark: '#1d4a30', base: '#2d6a45', light: '#5a9a6a', accent: '#6b4a2b', accent2: '#c0452f' } },
    { id: 'shrub', category: 'plants', icon: 'fa-solid fa-seedling', labelKey: 'stampShrub', squares: 1.5, build: shrub,
        palette: { dark: '#3a6a2c', base: '#528a3a', light: '#8cc063', accent: '#8b5e34', accent2: '#c0452f' } },
    { id: 'grass', category: 'plants', icon: 'fa-solid fa-leaf', labelKey: 'stampGrass', squares: 1, build: grass,
        palette: { dark: '#4a7a2e', base: '#6a9c3c', light: '#9acb5a', accent: '#8b5e34', accent2: '#c0452f' } },
    { id: 'flowers', category: 'plants', icon: 'fa-solid fa-flower', labelKey: 'stampFlowers', squares: 1, build: flowers,
        palette: { dark: '#3f6e2a', base: '#5d9238', light: '#8cc063', accent: '#f2d04a', accent2: '#e8739a' } },
    { id: 'patch-dirt', category: 'ground', icon: 'fa-solid fa-circle', labelKey: 'stampPatchDirt', squares: 3, build: patch('grain'),
        palette: { dark: '#6e5233', base: '#8f6d47', light: '#b08d63', accent: '#5a4128', accent2: '#c4a77c' } },
    { id: 'patch-gravel', category: 'ground', icon: 'fa-solid fa-circle', labelKey: 'stampPatchGravel', squares: 3, build: patch('pebble'),
        palette: { dark: '#77726a', base: '#9a958c', light: '#c4c0b8', accent: '#5f5b55', accent2: '#aca79e' } },
    { id: 'patch-sand', category: 'ground', icon: 'fa-solid fa-circle', labelKey: 'stampPatchSand', squares: 3, build: patch('dust'),
        palette: { dark: '#bba873', base: '#dccb94', light: '#efe3b8', accent: '#a8945c', accent2: '#e6d7a4' } },
    { id: 'patch-mud', category: 'ground', icon: 'fa-solid fa-circle', labelKey: 'stampPatchMud', squares: 3, build: patch('grain'),
        palette: { dark: '#3f3022', base: '#5e4a35', light: '#7a6249', accent: '#2e2218', accent2: '#8a7152' } },
    { id: 'patch-snow', category: 'ground', icon: 'fa-solid fa-circle', labelKey: 'stampPatchSnow', squares: 3, build: patch('flake'),
        palette: { dark: '#c5d0d8', base: '#e9eef2', light: '#ffffff', accent: '#b8c6d1', accent2: '#d6e0e7' } },
    { id: 'rock', category: 'rocks', icon: 'fa-solid fa-gem', labelKey: 'stampRock', squares: 1, build: rock,
        palette: { dark: '#575757', base: '#7d7d7d', light: '#b0b0b0', accent: '#8b5e34', accent2: '#c0452f' } },
    { id: 'boulders', category: 'rocks', icon: 'fa-solid fa-mountain', labelKey: 'stampBoulders', squares: 2, build: boulders,
        palette: { dark: '#555555', base: '#7a7a7a', light: '#adadad', accent: '#8b5e34', accent2: '#c0452f' } },
    { id: 'stump', category: 'features', icon: 'fa-solid fa-circle-dot', labelKey: 'stampStump', squares: 1, build: stump,
        palette: { dark: '#5b3f22', base: '#8b5e34', light: '#c89a64', accent: '#c9995e', accent2: '#c0452f' } },
    { id: 'log', category: 'features', icon: 'fa-solid fa-grip-lines', labelKey: 'stampLog', squares: 2, build: log,
        palette: { dark: '#4f3620', base: '#7a5230', light: '#b58a58', accent: '#c9995e', accent2: '#c0452f' } },
    { id: 'pond', category: 'features', icon: 'fa-solid fa-droplet', labelKey: 'stampPond', squares: 4, build: pond,
        palette: { dark: '#8a7a55', base: '#3f7fbf', light: '#9acff0', accent: '#5aa04a', accent2: '#c0452f' } },
    { id: 'campfire', category: 'features', icon: 'fa-solid fa-fire', labelKey: 'stampCampfire', squares: 1.5, build: campfire,
        palette: { dark: '#3b2e25', base: '#8a8a8a', light: '#b5b5b5', accent: '#f5c542', accent2: '#e8742a' } },
    { id: 'table', category: 'furniture', icon: 'fa-solid fa-table', labelKey: 'stampTable', squares: 2, build: table, palette: { dark: '#4f3620', base: '#8a6238', light: '#b58a58', accent: '#c9995e', accent2: '#c0452f' } },
    { id: 'round-table', category: 'furniture', icon: 'fa-solid fa-circle', labelKey: 'stampRoundTable', squares: 1.5, build: roundTable, palette: { dark: '#4f3620', base: '#8a6238', light: '#b58a58', accent: '#c9995e', accent2: '#c0452f' } },
    { id: 'chair', category: 'furniture', icon: 'fa-solid fa-chair', labelKey: 'stampChair', squares: 0.7, build: chair, palette: { dark: '#4f3620', base: '#8a6238', light: '#b58a58', accent: '#c9995e', accent2: '#c0452f' } },
    { id: 'bed', category: 'furniture', icon: 'fa-solid fa-bed', labelKey: 'stampBed', squares: 2, build: bed,
        palette: { dark: '#4f3620', base: '#8a6238', light: '#ddd6c2', accent: '#a63d3d', accent2: '#f2eee2' } },
    { id: 'cabinet', category: 'furniture', icon: 'fa-solid fa-box-archive', labelKey: 'stampCabinet', squares: 1.2, build: cabinet, palette: { dark: '#4f3620', base: '#8a6238', light: '#b58a58', accent: '#c9995e', accent2: '#c0452f' } },
    { id: 'workbench', category: 'furniture', icon: 'fa-solid fa-hammer', labelKey: 'stampWorkbench', squares: 2, build: workbench,
        palette: { dark: '#4f3620', base: '#8a6238', light: '#b9b9b9', accent: '#808080', accent2: '#c0452f' } },
    { id: 'box', category: 'storage', icon: 'fa-solid fa-box', labelKey: 'stampBox', squares: 0.7, build: box,
        palette: { dark: '#6b4a2b', base: '#a67c4a', light: '#d2a972', accent: '#8a8a8a', accent2: '#c0452f' } },
    { id: 'crate', category: 'storage', icon: 'fa-solid fa-boxes-stacked', labelKey: 'stampCrate', squares: 0.9, build: crate, palette: { dark: '#4f3620', base: '#8a6238', light: '#b58a58', accent: '#c9995e', accent2: '#c0452f' } },
    { id: 'barrel', category: 'storage', icon: 'fa-solid fa-circle-notch', labelKey: 'stampBarrel', squares: 0.7, build: barrel,
        palette: { dark: '#4f3620', base: '#8a6238', light: '#b58a58', accent: '#6a6a6a', accent2: '#c0452f' } },
    { id: 'chest', category: 'storage', icon: 'fa-solid fa-treasure-chest', labelKey: 'stampChest', squares: 1, build: chest,
        palette: { dark: '#4f3620', base: '#8a6238', light: '#d8b45a', accent: '#b8923a', accent2: '#c0452f' } },
    { id: 'apple-crate', category: 'storage', icon: 'fa-solid fa-apple-whole', labelKey: 'stampAppleCrate', squares: 0.9, build: appleCrate,
        palette: { dark: '#4f3620', base: '#8a6238', light: '#f19090', accent: '#d9c27a', accent2: '#c0392b' } },
    { id: 'stove', category: 'kitchen', icon: 'fa-solid fa-fire-burner', labelKey: 'stampStove', squares: 1.2, build: stove,
        palette: { dark: '#2a2a2a', base: '#555555', light: '#8d8d8d', accent: '#c0452f', accent2: '#e8742a' } },
    { id: 'cauldron', category: 'kitchen', icon: 'fa-solid fa-flask', labelKey: 'stampCauldron', squares: 1, build: cauldron,
        palette: { dark: '#222222', base: '#3a3a3a', light: '#8a8a8a', accent: '#5fbf4a', accent2: '#a6ef8a' } },
    { id: 'pumpkins', category: 'kitchen', icon: 'fa-solid fa-jack-o-lantern', labelKey: 'stampPumpkins', squares: 1.2, build: pumpkins,
        palette: { dark: '#8f4a0d', base: '#e07a1f', light: '#f2a24a', accent: '#5a7a2a', accent2: '#c0452f' } },
    { id: 'melons', category: 'kitchen', icon: 'fa-solid fa-circle', labelKey: 'stampMelons', squares: 1.2, build: melons,
        palette: { dark: '#2f6a26', base: '#4f9a3c', light: '#9ad08a', accent: '#d8d8a8', accent2: '#d94a4a' } },
    { id: 'crop-corn', category: 'fields', icon: 'fa-solid fa-wheat-awn', labelKey: 'stampCropCorn', squares: 0.75, lattice: true, build: field(corn),
        palette: { dark: '#5a4128', base: '#7a5a3a', light: '#9ed36a', accent: '#4f9a2c', accent2: '#e8c340' } },
    { id: 'crop-wheat', category: 'fields', icon: 'fa-solid fa-wheat-awn', labelKey: 'stampCropWheat', squares: 0.75, lattice: true, build: field(wheat),
        palette: { dark: '#5a4128', base: '#7a5a3a', light: '#f0d878', accent: '#a8963c', accent2: '#d9b84a' } },
    { id: 'crop-cabbage', category: 'fields', icon: 'fa-solid fa-leaf', labelKey: 'stampCropCabbage', squares: 0.75, lattice: true, build: field(cabbage),
        palette: { dark: '#5a4128', base: '#7a5a3a', light: '#b8e07a', accent: '#5aa03c', accent2: '#8a3a8a' } },
    { id: 'crop-pumpkin', category: 'fields', icon: 'fa-solid fa-jack-o-lantern', labelKey: 'stampCropPumpkin', squares: 0.75, lattice: true, build: field(pumpkinPlant),
        palette: { dark: '#5a4128', base: '#7a5a3a', light: '#8fc060', accent: '#4f8a2c', accent2: '#e07a1f' } },
    { id: 'crop-carrots', category: 'fields', icon: 'fa-solid fa-carrot', labelKey: 'stampCropCarrots', squares: 0.75, lattice: true, build: field(carrots),
        palette: { dark: '#5a4128', base: '#7a5a3a', light: '#9ed36a', accent: '#4a9a2c', accent2: '#e8832a' } },
    { id: 'plus', category: 'markers', icon: 'fa-solid fa-plus', labelKey: 'stampPlus', scale: 1, legacy: true, build: markerPlus },
    { id: 'x', category: 'markers', icon: 'fa-solid fa-xmark', labelKey: 'stampX', scale: 1, legacy: true, build: markerX },
    { id: 'dot', category: 'markers', icon: 'fa-solid fa-circle', labelKey: 'stampDot', scale: 1, legacy: true, build: markerDot },
    { id: 'arrow', category: 'markers', icon: 'fa-solid fa-arrow-right', labelKey: 'stampArrow', scale: 1, legacy: true, build: markerArrow(0) },
    { id: 'arrow-up', category: 'markers', icon: 'fa-solid fa-arrow-up', labelKey: 'stampArrowUp', scale: 1, legacy: true, build: markerArrow(-Math.PI / 2) },
    { id: 'arrow-down', category: 'markers', icon: 'fa-solid fa-arrow-down', labelKey: 'stampArrowDown', scale: 1, legacy: true, build: markerArrow(Math.PI / 2) },
    { id: 'arrow-left', category: 'markers', icon: 'fa-solid fa-arrow-left', labelKey: 'stampArrowLeft', scale: 1, legacy: true, build: markerArrow(Math.PI) },
    { id: 'square', category: 'markers', icon: 'fa-solid fa-square', labelKey: 'stampSquare', scale: 1, legacy: true, build: markerSquare }
];

/**
 * How each kind of stamp behaves, by what it is. A stamp is one of three things, and says so in `paint`,
 * `size`, `turn` and `layer`:
 *   - `paint`: 'scatter' -- dragging puts many down, as grass, trees, a pond -- or 'single': one to a click,
 *     as a crate or a bed, which must never run together.
 *   - `size`: 'scale' -- small, medium or large by the Size control, and a little different each time --
 *     or 'fixed': the size of the thing itself, which the Size control does not change.
 *   - `turn`: 'free' -- any way round, and flipped, if the option is on -- 'steps' -- stands as it was
 *     put, turned a quarter at a time by the Turn control -- or 'none'.
 *   - `layer`: where it is drawn (utils-layers.js).
 *   - `blocks`: a thing that gets in the way -- a tree's trunk, a shrub, a boulder -- is the radius of the ring of
 *     terrain walls that can be put round it, as a part of the stamp's size. Most things have none.
 */
const RULES = {
    trees: { paint: 'scatter', size: 'scale', turn: 'free', layer: 'above' },
    plants: { paint: 'scatter', size: 'scale', turn: 'free', layer: 'ankle' },
    ground: { paint: 'scatter', size: 'scale', turn: 'free', layer: 'ground' },
    fields: { paint: 'scatter', size: 'fixed', turn: 'none', layer: 'ankle' },
    rocks: { paint: 'scatter', size: 'scale', turn: 'free', layer: 'ankle' },
    features: { paint: 'single', size: 'fixed', turn: 'free', layer: 'ankle' },
    furniture: { paint: 'single', size: 'fixed', turn: 'steps', layer: 'waist' },
    storage: { paint: 'single', size: 'fixed', turn: 'steps', layer: 'waist' },
    kitchen: { paint: 'single', size: 'fixed', turn: 'steps', layer: 'waist' },
    markers: { paint: 'single', size: 'scale', turn: 'none', layer: 'above' }
};
// What differs from the rest of its kind.
const EXCEPTIONS = {
    tree: { blocks: 0.12 },
    pine: { blocks: 0.1 },
    shrub: { layer: 'waist', blocks: 0.3 },
    boulders: { paint: 'single', layer: 'waist', blocks: 0.3 },
    // Water is a thing on the ground, so it is over every patch and path, which are terrain.
    pond: { paint: 'scatter', size: 'scale', layer: 'ankle' },
    stump: { layer: 'waist', blocks: 0.3 },
    log: { layer: 'waist' },
    cabinet: { layer: 'eye' },
    pumpkins: { turn: 'free', layer: 'ankle' },
    melons: { turn: 'free', layer: 'ankle' }
};
for (const stamp of STAMPS) Object.assign(stamp, { ...RULES[stamp.category], ...EXCEPTIONS[stamp.id] });

const BY_ID = new Map(STAMPS.map(stamp => [stamp.id, stamp]));

/** Whether dragging puts down more of this stamp, or a click puts down one. A field is laid on a lattice, so it is dragged. */
export const isScatterStamp = id => BY_ID.get(id)?.paint === 'scatter';
/** Whether the Size control changes this stamp: a tree grows, a crate is a crate. */
export const isScaledStamp = id => BY_ID.get(id)?.size === 'scale';
/** How this stamp is turned: 'free', 'steps' or 'none'. */
export const stampTurn = id => BY_ID.get(id)?.turn ?? 'none';
/** How far round this stamp the terrain walls go, as a part of its size, or 0 for a thing that is not in the way. */
export const stampBlocks = id => BY_ID.get(id)?.blocks ?? 0;
/** The layer this stamp is drawn on. */
export const stampLayer = id => BY_ID.get(id)?.layer ?? 'waist';

/**
 * How many whole grid squares across and down a stamp is, turned `turns` quarters, so a thing that
 * stands on the grid can be put with its edges on the lines: a bed 1 by 2, a crate 1 by 1.
 */
export function stampFootprint(kind, turns = 0) {
    const stamp = BY_ID.get(kind);
    if (!stamp || stamp.legacy) return { w: 1, h: 1 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const prim of stamp.build(makeRng(1))) {
        for (let i = 0; i < prim.pts.length; i += 2) {
            minX = Math.min(minX, prim.pts[i]); maxX = Math.max(maxX, prim.pts[i]);
            minY = Math.min(minY, prim.pts[i + 1]); maxY = Math.max(maxY, prim.pts[i + 1]);
        }
    }
    const w = Math.max(1, Math.round((maxX - minX) * stamp.squares));
    const h = Math.max(1, Math.round((maxY - minY) * stamp.squares));
    return Math.abs(turns) % 2 === 1 ? { w: h, h: w } : { w, h };
}

export const stampById = id => BY_ID.get(id) ?? null;
export const isStamp = id => BY_ID.has(id);
/** A stamp drawn by this file's geometry, not by the drawing tool's own marker code. */
export const isProceduralStamp = id => !!BY_ID.get(id) && !BY_ID.get(id).legacy;

/**
 * A stamp as primitives, turned by `rotation` (radians) and flipped if asked.
 * The same kind, seed, rotation and flip always give the same primitives.
 */
export function buildStamp(kind, { seed = 1, rotation = 0, mirror = false } = {}) {
    const stamp = BY_ID.get(kind);
    if (!stamp) return [];
    const rng = makeRng(seed);
    const prims = stamp.build(rng);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const move = pts => {
        const out = [];
        for (let i = 0; i < pts.length; i += 2) {
            const x = mirror ? -pts[i] : pts[i];
            const y = pts[i + 1];
            out.push(x * cos - y * sin, x * sin + y * cos);
        }
        return out;
    };
    return prims.map(prim => ({ ...prim, pts: move(prim.pts) }));
}

// ------------------------------------------------------------------
// ----- Colour -----------------------------------------------------
// ------------------------------------------------------------------

/** "#rgb", "#rrggbb" or "rgba(r, g, b, a)" as [r, g, b], or null. */
export function parseColor(value) {
    if (typeof value === 'number') return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    if (typeof value !== 'string') return null;
    const text = value.trim();
    let match = text.match(/^#([0-9a-f]{6})$/i);
    if (match) return [0, 2, 4].map(i => parseInt(match[1].slice(i, i + 2), 16));
    match = text.match(/^#([0-9a-f]{3})$/i);
    if (match) return [0, 1, 2].map(i => parseInt(match[1][i] + match[1][i], 16));
    match = text.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (match) return [Number(match[1]), Number(match[2]), Number(match[3])];
    return null;
}

const toHex = channels => `#${channels.map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, amount) => a.map((c, i) => c + (b[i] - c) * amount);

/**
 * The colour of each tone, as '#rrggbb'. With no tint, the stamp's natural colours; with one,
 * the tint is the base and the other tones are shades and lights of it.
 */
export function stampPalette(kind, tint = null) {
    const stamp = BY_ID.get(kind);
    const channels = parseColor(tint);
    if (channels) {
        return {
            dark: toHex(mix(channels, [0, 0, 0], 0.4)),
            base: toHex(channels),
            light: toHex(mix(channels, [255, 255, 255], 0.35)),
            accent: toHex(mix(channels, [255, 255, 255], 0.55)),
            accent2: toHex(mix(channels, [0, 0, 0], 0.2))
        };
    }
    return { ...(stamp?.palette ?? { dark: '#333333', base: '#666666', light: '#999999', accent: '#cccccc', accent2: '#aaaaaa' }) };
}

// ------------------------------------------------------------------
// ----- Drawing ----------------------------------------------------
// ------------------------------------------------------------------

const colorInt = hex => parseInt(String(hex).replace('#', ''), 16) || 0;
/** How far, as a fraction of the stamp's size, its shadow falls. */
export const SHADOW_OFFSET = 0.03;
/** How dark its shadow is. */
export const SHADOW_ALPHA = 0.28;

/**
 * Draw primitives onto anything with PIXI.Graphics' calls: lineStyle, beginFill, endFill,
 * drawPolygon, moveTo and lineTo. `size` is the width of the unit square in pixels.
 */
export function drawStamp(graphics, prims, palette, { x, y, size, alpha = 1, shadow = true } = {}) {
    const at = pts => {
        const out = [];
        for (let i = 0; i < pts.length; i += 2) out.push(x + pts[i] * size, y + pts[i + 1] * size);
        return out;
    };
    const lift = size * SHADOW_OFFSET;
    if (shadow) {
        for (const prim of prims) {
            if (prim.k !== 'poly' || !prim.shadow) continue;
            const pts = at(prim.pts).map((value, i) => value + lift * (i % 2 === 0 ? 0.6 : 1));
            graphics.lineStyle(0);
            graphics.beginFill(0x000000, alpha * SHADOW_ALPHA);
            graphics.drawPolygon(pts);
            graphics.endFill();
        }
    }
    for (const prim of prims) {
        const color = colorInt(palette[prim.tone]);
        const opacity = alpha * (prim.alpha ?? 1);
        if (prim.k === 'poly') {
            if (prim.outline) graphics.lineStyle(Math.max(1, size * 0.012), colorInt(palette[prim.outline]), opacity);
            else graphics.lineStyle(0);
            graphics.beginFill(color, opacity);
            graphics.drawPolygon(at(prim.pts));
            graphics.endFill();
        } else {
            const pts = at(prim.pts);
            // Round ends and joins, so a thick line is a ribbon and not a run of slabs.
            graphics.lineStyle({ width: Math.max(1, prim.width * size), color, alpha: opacity, cap: 'round', join: 'round' });
            graphics.moveTo(pts[0], pts[1]);
            for (let i = 2; i < pts.length; i += 2) graphics.lineTo(pts[i], pts[i + 1]);
            if (prim.closed) graphics.lineTo(pts[0], pts[1]);
            graphics.lineStyle(0);
        }
    }
}

/** The stamp as a small SVG, for the Stamps tab. */
export function stampSvg(kind, { seed = 7, tint = null, rotation = 0 } = {}) {
    return primsSvg(buildStamp(kind, { seed, rotation }), stampPalette(kind, tint));
}

/** Primitives in the unit square as a small SVG. */
export function primsSvg(prims, palette) {
    const num = value => Math.round(value * 1000) / 1000;
    const path = pts => {
        let d = '';
        for (let i = 0; i < pts.length; i += 2) d += `${i === 0 ? 'M' : 'L'}${num(pts[i])} ${num(pts[i + 1])}`;
        return d;
    };
    const shapes = [];
    for (const prim of prims) {
        if (prim.k === 'poly' && prim.shadow) {
            shapes.push(`<path d="${path(prim.pts.map((v, i) => v + SHADOW_OFFSET * (i % 2 === 0 ? 0.6 : 1)))}Z" fill="#000" fill-opacity="${SHADOW_ALPHA}"/>`);
        }
    }
    for (const prim of prims) {
        const opacity = prim.alpha ?? 1;
        if (prim.k === 'poly') {
            const outline = prim.outline ? ` stroke="${palette[prim.outline]}" stroke-width="0.012"` : '';
            shapes.push(`<path d="${path(prim.pts)}Z" fill="${palette[prim.tone]}" fill-opacity="${opacity}"${outline}/>`);
        } else {
            shapes.push(`<path d="${path(prim.pts)}${prim.closed ? 'Z' : ''}" fill="none" stroke="${palette[prim.tone]}" stroke-opacity="${opacity}" stroke-width="${num(prim.width)}" stroke-linecap="round" stroke-linejoin="round"/>`);
        }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.56 -0.56 1.12 1.12" aria-hidden="true">${shapes.join('')}</svg>`;
}

// ------------------------------------------------------------------
// ----- On the scene -----------------------------------------------
// ------------------------------------------------------------------

/**
 * A stamp as the data of Foundry Drawings, to put on the scene: one polygon Drawing for each
 * filled shape and one for each line, in order, so what is on top stays on top. Shadows are not
 * written; a Drawing has none. `solid` is CONST.DRAWING_FILL_TYPES.SOLID.
 */
export function stampDrawingData(prims, palette, { x, y, size, alpha = 1, flags = {}, solid = 1, none = 0 } = {}) {
    const docs = [];
    prims.forEach((prim, index) => {
        const abs = [];
        for (let i = 0; i < prim.pts.length; i += 2) abs.push(x + prim.pts[i] * size, y + prim.pts[i + 1] * size);
        if (prim.k === 'line' && prim.closed) abs.push(abs[0], abs[1]);
        const placed = polygonShape(abs);
        const opacity = alpha * (prim.alpha ?? 1);
        const color = palette[prim.tone];
        const doc = { ...placed, bezierFactor: 0, sort: index, flags };
        if (prim.k === 'poly') {
            Object.assign(doc, {
                fillType: solid, fillColor: color, fillAlpha: opacity,
                strokeWidth: prim.outline ? Math.max(1, Math.round(size * 0.012)) : 0,
                strokeColor: palette[prim.outline ?? prim.tone], strokeAlpha: prim.outline ? opacity : 0
            });
        } else {
            Object.assign(doc, {
                fillType: none, fillColor: color, fillAlpha: 0,
                strokeWidth: Math.max(1, Math.round(prim.width * size)), strokeColor: color, strokeAlpha: opacity
            });
        }
        docs.push(doc);
    });
    return docs;
}

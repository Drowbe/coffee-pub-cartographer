// ==================================================================
// ===== AUTO-WALL: FROM A CLICKED WALL TO WALL SEGMENTS ===========
// ==================================================================
//
// "Map this wall": the user clicks a wall on the scene image and everything
// continuously the same material as the click is taken to be that wall. This
// file turns that into straight segments. It is pure -- pixels in, segments
// out -- so it runs under node without Foundry, and a suite can drive it.
//
// The steps, each a function below:
//   1. floodMask      pixels connected to the click and close to its colour
//   2. tidyMask       close texture pinholes so they do not become loops
//   3. thin           reduce the mask to a one-pixel centreline
//   4. tracePaths     walk the centreline into polylines, dropping stubs
//      joinPaths      and join the pieces a staircase step cut apart
//   5. simplify       straight segments within a tolerance
//   6. weld           merge the ends thinning left bunched at a junction,
//      mergeStraight  and the points left on a line that does not turn
//   7. snapSegments   to the grid, and to 45 degrees
//
// A pixel buffer is { data, width, height } with data as RGBA bytes, which is
// what a canvas ImageData is.

// ------------------------------------------------------------------
// Colour
// ------------------------------------------------------------------

function srgbToLinear(value) {
    const v = value / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function labPivot(t) {
    return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
}

/** One pixel as CIE Lab [L, a, b]. Lab so that "close" means close to the eye. */
export function pixelLab(data, index) {
    const r = srgbToLinear(data[index]);
    const g = srgbToLinear(data[index + 1]);
    const b = srgbToLinear(data[index + 2]);
    const x = labPivot((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
    const y = labPivot(0.2126729 * r + 0.7151522 * g + 0.0721750 * b);
    const z = labPivot((0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Every pixel's Lab, once, so the flood does not recompute it per visit. */
export function labBuffer({ data, width, height }) {
    const lab = new Float32Array(width * height * 3);
    for (let i = 0, p = 0; i < width * height; i++, p += 4) {
        const [l, a, b] = pixelLab(data, p);
        lab[i * 3] = l;
        lab[i * 3 + 1] = a;
        lab[i * 3 + 2] = b;
    }
    return lab;
}

// ------------------------------------------------------------------
// 1. Flood
// ------------------------------------------------------------------

/**
 * The pixels connected to the seed whose colour is within tolerance of the
 * seed's and changes by no more than stepTolerance from one pixel to the next.
 * Light and shadow fall across a painted wall, so lightness counts for
 * only lightnessWeight of what colour does.
 *
 * It is capped twice -- by area and by distance from the click -- because the
 * worst thing it can do is leak into the floor and trace the whole map. When a
 * cap is hit the result says so, and the caller should warn rather than draw.
 *
 * @returns {{ mask: Uint8Array, count: number, capped: boolean, seed: number[] }}
 */
export function floodMask(pixels, seedX, seedY, {
    tolerance = 14,
    stepTolerance = tolerance,
    lightnessWeight = 0.35,
    seedRadius = 2,
    maxPixels = 400000,
    maxRadius = Infinity,
    lab = labBuffer(pixels)
} = {}) {
    const { width, height } = pixels;
    seedX = Math.round(seedX);
    seedY = Math.round(seedY);
    const mask = new Uint8Array(width * height);
    if (seedX < 0 || seedY < 0 || seedX >= width || seedY >= height) {
        return { mask, count: 0, capped: false, seed: [0, 0, 0] };
    }

    // The seed colour is the mean of a small patch, so a speck of grain under
    // the click does not become the thing everything is compared with.
    let sl = 0, sa = 0, sb = 0, n = 0;
    for (let y = Math.max(0, seedY - seedRadius); y <= Math.min(height - 1, seedY + seedRadius); y++) {
        for (let x = Math.max(0, seedX - seedRadius); x <= Math.min(width - 1, seedX + seedRadius); x++) {
            const i = (y * width + x) * 3;
            sl += lab[i]; sa += lab[i + 1]; sb += lab[i + 2]; n++;
        }
    }
    const seed = [sl / n, sa / n, sb / n];
    const limit = tolerance * tolerance;
    const stepLimit = stepTolerance * stepTolerance;
    const distanceSq = (index, reference) => {
        const i = index * 3;
        const dl = (lab[i] - reference[0]) * lightnessWeight;
        const da = lab[i + 1] - reference[1];
        const db = lab[i + 2] - reference[2];
        return dl * dl + da * da + db * db;
    };
    const at = index => [lab[index * 3], lab[index * 3 + 1], lab[index * 3 + 2]];
    // Within tolerance of the click, and within stepTolerance of the pixel it was
    // reached from: a shadow that fades in across a wall passes, a hard edge
    // between wall and floor does not.
    const near = (index, from) => distanceSq(index, seed) <= limit && distanceSq(index, at(from)) <= stepLimit;

    const maxRadiusSq = maxRadius * maxRadius;
    const stack = [seedY * width + seedX];
    mask[stack[0]] = 1;
    let count = 1;
    let capped = false;
    while (stack.length) {
        const index = stack.pop();
        const x = index % width;
        const y = (index - x) / width;
        for (let k = 0; k < 4; k++) {
            const nx = k === 0 ? x + 1 : k === 1 ? x - 1 : x;
            const ny = k === 2 ? y + 1 : k === 3 ? y - 1 : y;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const next = ny * width + nx;
            if (mask[next]) continue;
            if ((nx - seedX) ** 2 + (ny - seedY) ** 2 > maxRadiusSq) { capped = true; continue; }
            if (!near(next, index)) continue;
            if (count >= maxPixels) { capped = true; return { mask, count, capped, seed }; }
            mask[next] = 1;
            count++;
            stack.push(next);
        }
    }
    return { mask, count, capped, seed };
}

// ------------------------------------------------------------------
// 2. Tidy
// ------------------------------------------------------------------

/** Dilate (grow=true) or erode a mask by a square of the given radius. */
function morph(mask, width, height, radius, grow) {
    const pass = (source, horizontal) => {
        const out = new Uint8Array(source.length);
        const length = horizontal ? width : height;
        const lines = horizontal ? height : width;
        for (let line = 0; line < lines; line++) {
            for (let at = 0; at < length; at++) {
                let hit = grow ? 0 : 1;
                for (let d = -radius; d <= radius; d++) {
                    const along = at + d;
                    // Off the image counts as empty, so erosion eats at the border
                    // and dilation does not invent wall past it.
                    const value = along < 0 || along >= length ? 0
                        : source[horizontal ? line * width + along : along * width + line];
                    if (grow ? value : !value) { hit = grow ? 1 : 0; break; }
                }
                out[horizontal ? line * width + at : at * width + line] = hit;
            }
        }
        return out;
    };
    return pass(pass(mask, true), false);
}

/**
 * Close the pinholes texture leaves in the mask: a hole in the mask would be a
 * loop in the centreline. The mask is padded first so closing does not erode
 * the part of a wall that runs off the edge of the image.
 */
export function tidyMask(mask, width, height, { closeRadius = 2 } = {}) {
    if (closeRadius <= 0) return mask;
    const pad = closeRadius + 1;
    const w = width + pad * 2;
    const h = height + pad * 2;
    const padded = new Uint8Array(w * h);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) padded[(y + pad) * w + x + pad] = mask[y * width + x];
    }
    const closed = morph(morph(padded, w, h, closeRadius, true), w, h, closeRadius, false);
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) out[y * width + x] = closed[(y + pad) * w + x + pad];
    }
    return out;
}

// ------------------------------------------------------------------
// 3. Thin
// ------------------------------------------------------------------

/**
 * Zhang-Suen thinning: peel the mask down to a one-pixel centreline without
 * breaking it. Returns a new mask; the input is left alone.
 */
export function thin(mask, width, height) {
    const out = Uint8Array.from(mask);
    const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : out[y * width + x]);
    const doomed = [];
    let changed = true;
    while (changed) {
        changed = false;
        for (let step = 0; step < 2; step++) {
            doomed.length = 0;
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    if (!out[y * width + x]) continue;
                    // Neighbours clockwise from north.
                    const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1);
                    const p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1);
                    const neighbours = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
                    if (neighbours < 2 || neighbours > 6) continue;
                    const ring = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
                    let transitions = 0;
                    for (let k = 0; k < 8; k++) if (!ring[k] && ring[k + 1]) transitions++;
                    if (transitions !== 1) continue;
                    if (step === 0 ? (p2 * p4 * p6 || p4 * p6 * p8) : (p2 * p4 * p8 || p2 * p6 * p8)) continue;
                    doomed.push(y * width + x);
                }
            }
            if (doomed.length) changed = true;
            for (const index of doomed) out[index] = 0;
        }
    }
    return out;
}

// ------------------------------------------------------------------
// 4. Trace
// ------------------------------------------------------------------

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Walk a one-pixel centreline into polylines of [x, y]. A polyline starts and
 * ends at an endpoint or a junction. A free end shorter than minBranch is a
 * stub the thinning grew off a rough edge, and is dropped.
 */
export function tracePaths(skeleton, width, height, { minBranch = 6 } = {}) {
    const live = Uint8Array.from(skeleton);
    const neighboursOf = index => {
        const x = index % width;
        const y = (index - x) / width;
        const found = [];
        for (const [dx, dy] of NEIGHBOURS) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < width && ny < height && live[ny * width + nx]) found.push(ny * width + nx);
        }
        return found;
    };

    // Strip stubs: from each free end walk to the first junction, and if that
    // is short, cut it. Repeat, because cutting a stub can leave a new end.
    const stripStubs = () => {
        let cut = false;
        for (let index = 0; index < live.length; index++) {
            if (!live[index] || neighboursOf(index).length !== 1) continue;
            const branch = [index];
            let previous = -1;
            let current = index;
            let reachedJunction = false;
            while (branch.length <= minBranch) {
                const next = neighboursOf(current).filter(n => n !== previous && !branch.includes(n));
                if (next.length === 0) break;
                if (next.length > 1) { reachedJunction = true; break; }
                previous = current;
                current = next[0];
                if (neighboursOf(current).length > 2) { reachedJunction = true; break; }
                branch.push(current);
            }
            // A branch that ran out before a junction is a whole short line, not a
            // stub off a longer one, so it is kept.
            if (reachedJunction && branch.length <= minBranch) {
                for (const pixel of branch) live[pixel] = 0;
                cut = true;
            }
        }
        return cut;
    };
    while (stripStubs());

    const degree = new Map();
    for (let index = 0; index < live.length; index++) {
        if (live[index]) degree.set(index, neighboursOf(index).length);
    }
    const isNode = index => degree.get(index) !== 2;

    const paths = [];
    const used = new Set();
    const edgeKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
    const pointOf = index => [index % width, Math.floor(index / width)];
    const walk = (start, first) => {
        const path = [start, first];
        used.add(edgeKey(start, first));
        let previous = start;
        let current = first;
        while (!isNode(current)) {
            const next = neighboursOf(current).find(n => n !== previous && !used.has(edgeKey(current, n)));
            if (next === undefined) break;
            used.add(edgeKey(current, next));
            path.push(next);
            previous = current;
            current = next;
        }
        return path.map(pointOf);
    };

    for (const [index] of degree) {
        if (!isNode(index)) continue;
        for (const next of neighboursOf(index)) {
            if (!used.has(edgeKey(index, next))) paths.push(walk(index, next));
        }
    }
    // What is left is closed loops with no end or junction on them.
    for (const [index] of degree) {
        for (const next of neighboursOf(index)) {
            if (!used.has(edgeKey(index, next))) paths.push(walk(index, next));
        }
    }
    return paths;
}

/**
 * Thinning leaves a little staircase wherever the wall's edge steps, and a
 * step looks like a junction to the walk, so a straight wall comes back cut in
 * pieces. A real junction has three or more lines meeting; where exactly two
 * do, it is one line, and they are joined.
 */
export function joinPaths(paths) {
    const key = ([x, y]) => `${x},${y}`;
    const live = paths.map(path => path.slice());
    let joined = true;
    while (joined) {
        joined = false;
        const ends = new Map();
        live.forEach((path, index) => {
            if (!path) return;
            for (const end of [path[0], path.at(-1)]) {
                const list = ends.get(key(end)) ?? [];
                list.push(index);
                ends.set(key(end), list);
            }
        });
        for (const [, list] of ends) {
            if (list.length !== 2 || list[0] === list[1]) continue;
            const [a, b] = list.map(index => live[index]);
            const meet = key(a.at(-1)) === key(b[0]) ? 'ab'
                : key(a[0]) === key(b[0]) ? 'a-b'
                : key(a.at(-1)) === key(b.at(-1)) ? 'ab-'
                : 'ba';
            const first = meet === 'ab' || meet === 'ab-' ? a : meet === 'a-b' ? a.slice().reverse() : b;
            const second = meet === 'ab' ? b : meet === 'ab-' ? b.slice().reverse() : meet === 'a-b' ? b : a;
            live[list[0]] = first.concat(second.slice(1));
            live[list[1]] = null;
            joined = true;
            break;
        }
    }
    return live.filter(Boolean);
}

/**
 * The centreline of a bar curls toward a corner at a free end -- the thinning's
 * way of reaching the corner pixel -- and one point off to the side tilts the
 * whole line fitted to it. Cut the curl from each free end, and carry the line
 * on straight, along the wall, for as far as was cut.
 *
 * A free end is one no other line ends at; a junction is left as it is.
 */
export function straightenEnds(paths, curl) {
    if (!(curl >= 1)) return paths;
    const key = ([x, y]) => `${x},${y}`;
    const ends = new Map();
    for (const path of paths) {
        for (const end of [path[0], path.at(-1)]) ends.set(key(end), (ends.get(key(end)) ?? 0) + 1);
    }
    const cut = Math.ceil(curl);
    const along = Math.ceil(curl * 2);
    const trim = path => {
        // Only a free end of a path long enough to have a wall behind the curl.
        if (path.length < cut + along + 2 || ends.get(key(path[0])) !== 1) return path;
        const kept = path.slice(cut);
        const [x, y] = kept[0];
        const [bx, by] = kept[Math.min(kept.length - 1, along)];
        const length = Math.hypot(x - bx, y - by);
        if (!length) return path;
        return [[x + (x - bx) / length * cut, y + (y - by) / length * cut], ...kept];
    };
    return paths.map(path => {
        // The same, from the far end, by turning the path round.
        const front = trim(path);
        const turned = front.slice().reverse();
        const reversed = ends.get(key(path.at(-1))) === 1 ? trim(turned) : turned;
        return reversed.reverse();
    });
}

// ------------------------------------------------------------------
// 5. Simplify
// ------------------------------------------------------------------

function distanceToSegment([px, py], [ax, ay], [bx, by]) {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    if (!lengthSq) return Math.hypot(px - ax, py - ay);
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Douglas-Peucker: the fewest points that keep every original within epsilon. */
export function simplify(points, epsilon = 3) {
    if (points.length < 3) return points;
    let worst = 0;
    let worstAt = 0;
    for (let i = 1; i < points.length - 1; i++) {
        const d = distanceToSegment(points[i], points[0], points[points.length - 1]);
        if (d > worst) { worst = d; worstAt = i; }
    }
    if (worst <= epsilon) return [points[0], points[points.length - 1]];
    const left = simplify(points.slice(0, worstAt + 1), epsilon);
    return left.slice(0, -1).concat(simplify(points.slice(worstAt), epsilon));
}

// ------------------------------------------------------------------
// 6. Weld
// ------------------------------------------------------------------

/**
 * A thick wall meeting another thins to a small knot of junction pixels, which
 * traces to several segment ends a pixel or two apart. Pull every end within
 * distance of another into one point, and drop what that leaves with no length.
 */
export function weld(segments, distance = 4) {
    const ends = segments.flat();
    const parent = ends.map((_, i) => i);
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (let i = 0; i < ends.length; i++) {
        for (let j = i + 1; j < ends.length; j++) {
            if (Math.hypot(ends[i][0] - ends[j][0], ends[i][1] - ends[j][1]) <= distance) parent[find(i)] = find(j);
        }
    }
    const sums = new Map();
    ends.forEach(([x, y], i) => {
        const root = find(i);
        const sum = sums.get(root) ?? [0, 0, 0];
        sum[0] += x; sum[1] += y; sum[2]++;
        sums.set(root, sum);
    });
    const point = i => { const [x, y, n] = sums.get(find(i)); return [x / n, y / n]; };
    return segments
        .map((_, k) => [point(k * 2), point(k * 2 + 1)])
        .filter(([a, b]) => a[0] !== b[0] || a[1] !== b[1]);
}

/**
 * Where exactly two segments meet and the line hardly turns, they are one wall
 * with a point in the middle of it. A real corner, or a third wall arriving,
 * keeps its point.
 */
export function mergeStraight(segments, degrees = 12) {
    const key = ([x, y]) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
    const live = segments.map(([a, b]) => [a, b]);
    let merged = true;
    while (merged) {
        merged = false;
        const at = new Map();
        live.forEach((segment, index) => {
            if (!segment) return;
            for (const end of [0, 1]) {
                const list = at.get(key(segment[end])) ?? [];
                list.push({ index, end });
                at.set(key(segment[end]), list);
            }
        });
        for (const [, list] of at) {
            if (list.length !== 2 || list[0].index === list[1].index) continue;
            // Each segment as pointing away from the shared point.
            const [first, second] = list.map(({ index, end }) => {
                const segment = live[index];
                return { index, near: segment[end], far: segment[1 - end] };
            });
            const turn = Math.abs(((Math.atan2(second.far[1] - first.near[1], second.far[0] - first.near[0])
                - Math.atan2(first.near[1] - first.far[1], first.near[0] - first.far[0])) * 180 / Math.PI + 540) % 360 - 180);
            if (turn > degrees) continue;
            live[first.index] = [first.far, second.far];
            live[second.index] = null;
            merged = true;
            break;
        }
    }
    return live.filter(Boolean);
}

// ------------------------------------------------------------------
// 7. Snap
// ------------------------------------------------------------------

/**
 * Pull a segment's ends onto the grid when one is close, and straighten a
 * segment that is within a few degrees of a multiple of 45 so that rooms close.
 * Ends are snapped to a shared point so neighbouring segments still meet.
 */
export function snapSegments(segments, { grid = 0, snapDistance = 0, angleSnap = 5 } = {}) {
    const cache = new Map();
    const snapPoint = ([x, y]) => {
        if (!grid || !snapDistance) return [x, y];
        const sx = Math.round(x / grid) * grid;
        const sy = Math.round(y / grid) * grid;
        return Math.hypot(x - sx, y - sy) <= snapDistance ? [sx, sy] : [x, y];
    };
    const shared = point => {
        const key = `${Math.round(point[0])},${Math.round(point[1])}`;
        if (!cache.has(key)) cache.set(key, snapPoint(point));
        return cache.get(key);
    };

    return segments.map(([a, b]) => {
        let [ax, ay] = shared(a);
        let [bx, by] = shared(b);
        const dx = bx - ax;
        const dy = by - ay;
        const length = Math.hypot(dx, dy);
        if (length) {
            const degrees = Math.atan2(dy, dx) * 180 / Math.PI;
            const nearest = Math.round(degrees / 45) * 45;
            if (Math.abs(degrees - nearest) <= angleSnap && Math.abs(degrees - nearest) > 0) {
                // Hold the midpoint and rotate to the true angle, unless an end was
                // snapped to the grid, in which case that end is held instead.
                const radians = nearest * Math.PI / 180;
                const ex = Math.cos(radians) * length;
                const ey = Math.sin(radians) * length;
                const midX = (ax + bx) / 2;
                const midY = (ay + by) / 2;
                ax = midX - ex / 2; ay = midY - ey / 2;
                bx = midX + ex / 2; by = midY + ey / 2;
            }
        }
        return [[ax, ay], [bx, by]];
    }).filter(([a, b]) => a[0] !== b[0] || a[1] !== b[1]);
}

// ------------------------------------------------------------------
// The whole of it
// ------------------------------------------------------------------

/**
 * From a click to segments, in the image's own pixels.
 *
 * extraSeeds ([[x, y], ...]) are more clicks on the same wall -- a wall that
 * changes material along its length is mapped by clicking each part. Each is
 * flooded on its own colour and the masks are joined before thinning.
 *
 * maxThickness (pixels) is the widest a wall may be. A mask with a part wider
 * than that comes back with tooThick set and no segments.
 *
 * epsilon and pruneLength (pixels) are floors: the line is simplified to at
 * least the wall's own thickness, and a stub shorter than pruneLength that
 * ends at another wall is dropped.
 *
 * Everything after the flood runs on the box around the mask, so the cost
 * follows the wall and not the map.
 *
 * @returns {{ segments: number[][][], mask: Uint8Array,
 *             bounds: { x: number, y: number, width: number, height: number },
 *             count: number, capped: boolean, tooThick: boolean }}
 */
export function mapWall(pixels, seedX, seedY, options = {}) {
    const { width, height } = pixels;
    const lab = options.lab ?? labBuffer(pixels);
    const joined = new Uint8Array(width * height);
    let count = 0;
    let capped = false;
    for (const [x, y] of [[seedX, seedY], ...(options.extraSeeds ?? [])]) {
        const flood = floodMask(pixels, x, y, { ...options, lab });
        capped ||= flood.capped;
        for (let i = 0; i < joined.length; i++) if (flood.mask[i]) joined[i] = 1;
    }
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!joined[y * width + x]) continue;
            count++;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
        }
    }
    if (!count) {
        return { segments: [], mask: new Uint8Array(0), bounds: { x: 0, y: 0, width: 0, height: 0 }, count, capped, tooThick: false };
    }

    // The box, with room for closing and for the thickness test to see past the edge.
    const margin = (options.closeRadius ?? 2) + Math.ceil((options.maxThickness ?? 0) / 2) + 2;
    x0 = Math.max(0, x0 - margin);
    y0 = Math.max(0, y0 - margin);
    x1 = Math.min(width - 1, x1 + margin);
    y1 = Math.min(height - 1, y1 + margin);
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const crop = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) crop[y * w + x] = joined[(y + y0) * width + x + x0];
    }
    const bounds = { x: x0, y: y0, width: w, height: h };

    const tidy = tidyMask(crop, w, h, options);
    // A wall is thin. Anything with a fat part is a flood that got out into a
    // room or a courtyard, and its centreline would be nonsense: refuse it.
    // Fat walls are for a later pass; they must not be guessed at here.
    const tooThick = options.maxThickness > 0
        && morph(tidy, w, h, Math.ceil(options.maxThickness / 2), false).some(Boolean);
    if (tooThick) return { segments: [], mask: tidy, bounds, count, capped, tooThick };

    const skeleton = thin(tidy, w, h);

    // A painted wall's edge is chipped and uneven, and the centreline follows
    // every chip. How far it wanders is about the wall's thickness, so nothing
    // finer than that is worth a point: the wall's average thickness is its area
    // over its length. What the caller asks for is a floor under that.
    let area = 0;
    let length = 0;
    for (let i = 0; i < tidy.length; i++) {
        area += tidy[i];
        length += skeleton[i];
    }
    const thickness = length ? area / length : 0;
    const epsilon = Math.max(options.epsilon ?? 3, thickness * 0.6);
    const weldDistance = Math.max(options.weldDistance ?? 4, thickness * 0.75);
    const minBranch = Math.max(options.minBranch ?? 6, options.pruneLength ?? 0);

    const paths = straightenEnds(joinPaths(tracePaths(skeleton, w, h, { ...options, minBranch })), thickness * 0.75);
    const segments = [];
    for (const path of paths) {
        const simple = simplify(path, epsilon);
        for (let i = 0; i < simple.length - 1; i++) segments.push([simple[i], simple[i + 1]]);
    }
    // Back into the image's own pixels, and a pixel's centre rather than its corner.
    const placed = mergeStraight(weld(segments, weldDistance))
        .map(([a, b]) => [[a[0] + x0 + 0.5, a[1] + y0 + 0.5], [b[0] + x0 + 0.5, b[1] + y0 + 0.5]]);
    // Straightening turns each segment about its middle, which parts ends that
    // met by a hair; one more weld, much tighter, closes them again.
    return { segments: weld(snapSegments(placed, options), 1), mask: tidy, bounds, count, capped, tooThick };
}

/**
 * A door or window: the clicked art, taken as one piece, and the line down its
 * length. The line is the long axis of the pixels -- found from how they are
 * spread, so a door drawn at any angle works -- and its ends are where the art
 * ends along that axis. Where it is to be fitted between wall ends is for the
 * caller, who knows the walls; this knows only the picture.
 *
 * extraSeeds join more clicks on the same piece, as in mapWall.
 *
 * @returns {{ segment: number[][]|null, length: number, thickness: number, mask: Uint8Array,
 *             bounds: { x: number, y: number, width: number, height: number },
 *             count: number, capped: boolean }}
 */
export function mapOpening(pixels, seedX, seedY, options = {}) {
    const { width, height } = pixels;
    const lab = options.lab ?? labBuffer(pixels);
    const joined = new Uint8Array(width * height);
    let capped = false;
    for (const [x, y] of [[seedX, seedY], ...(options.extraSeeds ?? [])]) {
        const flood = floodMask(pixels, x, y, { ...options, lab });
        capped ||= flood.capped;
        for (let i = 0; i < joined.length; i++) if (flood.mask[i]) joined[i] = 1;
    }
    let x0 = width, y0 = height, x1 = -1, y1 = -1, count = 0;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!joined[y * width + x]) continue;
            count++;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
        }
    }
    const empty = { segment: null, length: 0, thickness: 0, mask: new Uint8Array(0), bounds: { x: 0, y: 0, width: 0, height: 0 }, count, capped };
    if (!count) return empty;

    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const mask = new Uint8Array(w * h);
    let mx = 0, my = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (!joined[(y + y0) * width + x + x0]) continue;
            mask[y * w + x] = 1;
            mx += x;
            my += y;
        }
    }
    mx /= count;
    my /= count;

    // The spread of the pixels about their centre: its long axis is the opening's.
    let sxx = 0, syy = 0, sxy = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (!mask[y * w + x]) continue;
            const dx = x - mx;
            const dy = y - my;
            sxx += dx * dx;
            syy += dy * dy;
            sxy += dx * dy;
        }
    }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);

    // Where it ends along that axis, and how thick it is across it. A stray pixel
    // at either end must not stretch it, so each end is the 0.5th percentile.
    const along = new Float32Array(count);
    const across = new Float32Array(count);
    let n = 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (!mask[y * w + x]) continue;
            along[n] = (x - mx) * ux + (y - my) * uy;
            across[n] = -(x - mx) * uy + (y - my) * ux;
            n++;
        }
    }
    along.sort();
    across.sort();
    const low = Math.floor((count - 1) * 0.005);
    const high = Math.ceil((count - 1) * 0.995);
    const start = along[low];
    const end = along[high];
    // Pixels are squares: the far edge of the last one is a whole pixel on.
    const length = end - start + 1;
    const thickness = across[high] - across[low] + 1;
    const place = t => [x0 + mx + 0.5 + ux * t, y0 + my + 0.5 + uy * t];
    return {
        segment: [place(start + 0.5), place(end + 0.5)],
        length,
        thickness,
        mask,
        bounds: { x: x0, y: y0, width: w, height: h },
        count,
        capped
    };
}

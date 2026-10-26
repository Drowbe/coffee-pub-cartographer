// ==================================================================
// ===== AUTO-WALL: FROM A CLICK TO WALLS, DOORS AND WINDOWS ========
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
// Also here, because they too are pure geometry: mapOpening (a door or window
// read from its art), and what works on walls already on the scene --
// findOpening (the gap two wall ends leave), openingOnWall and splitWallAt (a
// door on a wall that runs through it, and what is left of the wall),
// cleanupEnds and mergeWalls (joining ends, making straight runs one wall),
// mergeStraightAt and splitSegmentAt (editing the walls of a run).
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
export function mergeStraight(segments, degrees = 12, deviation = Infinity) {
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
            // The point that goes must lie near the line that replaces it, or a bend is being flattened.
            if (distanceToSegmentWithT(first.near, first.far, second.far).distance > deviation) continue;
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
    const placed = mergeStraight(weld(segments, weldDistance), 12, epsilon)
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

// ------------------------------------------------------------------
// Working with the walls already on the scene
// ------------------------------------------------------------------

function distanceToSegmentWithT([px, py], [ax, ay], [bx, by]) {
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq ? ((px - ax) * dx + (py - ay) * dy) / lengthSq : 0;
    const clamped = Math.max(0, Math.min(1, t));
    return { distance: Math.hypot(px - (ax + clamped * dx), py - (ay + clamped * dy)), t };
}

/**
 * The gap a click was meant for: the two wall ends that face each other across
 * it, with the click between. Walls drawn from the picture stop at doors and
 * windows, so this finds what is already there, and the line it returns is the
 * door with no guessing from the picture at all.
 *
 * A pair is two ends of two different walls, the walls running away from the
 * gap on either side (so the two ends of one wall are never a pair), a door's
 * length apart, with the click on the line between them. Ends nothing else
 * meets are preferred, since a gap's ends are free ends; of those that fit,
 * the nearest to the click wins.
 *
 * @param {number[][]} walls  Each wall as [x1, y1, x2, y2].
 * @param {number[]} point    The click, [x, y].
 * @param {{ grid: number, minSquares?: number, maxSquares?: number, reachSquares?: number }} options
 * @returns {number[][]|null}  [[x, y], [x, y]] or null.
 */
export function findOpening(walls, point, { grid, minSquares = 0.4, maxSquares = 4, reachSquares = 0.6 } = {}) {
    const ends = [];
    walls.forEach((wall, index) => {
        ends.push({ wall: index, at: [wall[0], wall[1]], away: [wall[2], wall[3]] });
        ends.push({ wall: index, at: [wall[2], wall[3]], away: [wall[0], wall[1]] });
    });
    // Only ends within reach of the click can be part of the gap, which on a big scene
    // is a handful of the thousands: everything after works on those alone.
    const radius = maxSquares * grid + reachSquares * grid;
    const candidates = ends.filter(end => Math.hypot(end.at[0] - point[0], end.at[1] - point[1]) <= radius);
    // How many ends meet at each: one is a free end.
    for (const end of candidates) end.meeting = ends.filter(other => Math.hypot(other.at[0] - end.at[0], other.at[1] - end.at[1]) <= 2).length;

    const unit = (from, to) => {
        const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
        return [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
    };
    let best = null;
    for (const free of [true, false]) {
        for (let i = 0; i < candidates.length; i++) {
            for (let j = i + 1; j < candidates.length; j++) {
                const a = candidates[i];
                const b = candidates[j];
                if (a.wall === b.wall) continue;
                if (free && (a.meeting > 1 || b.meeting > 1)) continue;
                // Something already spans it: a door put there before.
                const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= 2;
                if (walls.some(w => (near([w[0], w[1]], a.at) && near([w[2], w[3]], b.at))
                    || (near([w[0], w[1]], b.at) && near([w[2], w[3]], a.at)))) continue;
                const length = Math.hypot(b.at[0] - a.at[0], b.at[1] - a.at[1]);
                if (length < minSquares * grid || length > maxSquares * grid) continue;
                // Each wall runs away from the gap, not along it.
                const across = unit(a.at, b.at);
                const fromA = unit(a.at, a.away);
                const fromB = unit(b.at, b.away);
                if (fromA[0] * across[0] + fromA[1] * across[1] > 0.2) continue;
                if (-(fromB[0] * across[0] + fromB[1] * across[1]) > 0.2) continue;
                const { distance, t } = distanceToSegmentWithT(point, a.at, b.at);
                if (distance > reachSquares * grid || t < -0.1 || t > 1.1) continue;
                const cost = distance + length * 0.02;
                if (!best || cost < best.cost) best = { cost, a: a.at, b: b.at };
            }
        }
        if (best) break;
    }
    return best ? [[...best.a], [...best.b]] : null;
}

/**
 * Join the wall ends that are close together: every group of ends within
 * distance of one another (a chain of near ends counts) moves to the group's
 * middle. A wall whose two ends would land on one point is left as it is.
 *
 * @param {{ id: string, c: number[] }[]} walls
 * @param {number} distance
 * @returns {{ updates: { id: string, c: number[] }[], joined: number, skipped: number }}
 */
export function cleanupEnds(walls, distance) {
    const points = walls.flatMap(wall => [[wall.c[0], wall.c[1]], [wall.c[2], wall.c[3]]]);
    const parent = points.map((_, i) => i);
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            if (Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]) <= distance) parent[find(i)] = find(j);
        }
    }
    const sums = new Map();
    points.forEach(([x, y], i) => {
        const root = find(i);
        const sum = sums.get(root) ?? [0, 0, 0];
        sum[0] += x; sum[1] += y; sum[2]++;
        sums.set(root, sum);
    });
    const target = i => { const [x, y, n] = sums.get(find(i)); return [Math.round(x / n), Math.round(y / n)]; };

    const updates = [];
    let skipped = 0;
    let joined = 0;
    walls.forEach((wall, k) => {
        const a = target(k * 2);
        const b = target(k * 2 + 1);
        const c = [a[0], a[1], b[0], b[1]];
        if (c[0] === c[2] && c[1] === c[3]) { skipped++; return; }
        if (c.every((value, index) => value === wall.c[index])) return;
        joined += (a[0] !== wall.c[0] || a[1] !== wall.c[1] ? 1 : 0) + (b[0] !== wall.c[2] || b[1] !== wall.c[3] ? 1 : 0);
        updates.push({ id: wall.id, c });
    });
    return { updates, joined, skipped };
}

/**
 * Put a point in a wall: the segment nearest the click, if one is within
 * reach, is cut in two there. Nothing is done at an end, where a point already is.
 *
 * @param {number[][][]} segments  [[[x, y], [x, y]], ...]
 * @param {number[]} point
 * @param {number} reach
 * @returns {{ segments: number[][][], at: number[] }|null}
 */
export function splitSegmentAt(segments, point, reach) {
    let best = null;
    segments.forEach(([a, b], index) => {
        const { distance, t } = distanceToSegmentWithT(point, a, b);
        if (distance <= reach && (!best || distance < best.distance)) best = { index, distance, t };
    });
    if (!best) return null;
    const [a, b] = segments[best.index];
    const t = Math.max(0, Math.min(1, best.t));
    const at = [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t)];
    if (Math.hypot(at[0] - a[0], at[1] - a[1]) <= 2 || Math.hypot(at[0] - b[0], at[1] - b[1]) <= 2) return null;
    const out = segments.slice();
    out.splice(best.index, 1, [a, at], [[...at], b]);
    return { segments: out, at };
}

/** The turn, in degrees, between a line arriving at a point and one leaving it. */
function turnAt(from, at, to) {
    const arriving = Math.atan2(at[1] - from[1], at[0] - from[0]);
    const leaving = Math.atan2(to[1] - at[1], to[0] - at[0]);
    return Math.abs(((leaving - arriving) * 180 / Math.PI + 540) % 360 - 180);
}

/**
 * Where two segments meet at a point and the line carries on straight, they
 * are one wall: merge them. Only at the point asked about, so a point put in a
 * wall on purpose elsewhere is left where it is.
 *
 * @returns {number[][][]|null}  The segments with the two made one, or null if nothing was merged.
 */
export function mergeStraightAt(segments, point, degrees = 8) {
    const meeting = [];
    segments.forEach((segment, index) => {
        segment.forEach((end, which) => {
            if (Math.hypot(end[0] - point[0], end[1] - point[1]) <= 1.5) meeting.push({ index, which });
        });
    });
    // Exactly two different segments: a third arriving makes it a junction, which stays.
    if (meeting.length !== 2 || meeting[0].index === meeting[1].index) return null;
    const [a, b] = meeting.map(({ index, which }) => ({ index, near: segments[index][which], far: segments[index][1 - which] }));
    if (turnAt(a.far, a.near, b.far) > degrees) return null;
    const out = segments.filter((_, index) => index !== a.index && index !== b.index);
    out.push([a.far, b.far]);
    return out;
}

/**
 * Merge the walls of a scene that run on in a straight line into single walls.
 * Two walls merge where exactly two meet at a point, the line does not turn
 * more than the angle given, and they are alike in every other way: each wall
 * carries a `key` naming what it is (sense, door, sound and so on), and walls
 * merge only when keys are equal. A wall whose key is null never merges; that
 * is how doors and windows stay what they are.
 *
 * @param {{ id: string, c: number[], key: string|null }[]} walls
 * @param {number} degrees    The most a joint may turn and still be straight.
 * @param {number} deviation  The furthest a point a wall was made from may lie from the wall it is made into.
 * @returns {{ walls: { id: string, c: number[] }[], removed: string[], merged: number }}
 *   The walls that remain, those that went into others, and how many merges were made.
 */
export function mergeWalls(walls, degrees = 8, deviation = Infinity) {
    // Each wall keeps the points it has been made from, oriented from its first end to its last.
    const live = walls.map(wall => ({
        id: wall.id, c: [...wall.c], key: wall.key,
        path: [[wall.c[0], wall.c[1]], [wall.c[2], wall.c[3]]]
    }));
    const removed = [];
    let merged = 0;
    const keyOf = (x, y) => `${x},${y}`;
    let again = true;
    while (again) {
        again = false;
        const at = new Map();
        const everything = new Map();
        live.forEach((wall, index) => {
            if (!wall) return;
            for (const which of [0, 1]) {
                const k = keyOf(wall.c[which * 2], wall.c[which * 2 + 1]);
                // Every end at a point counts, door ends too: a third wall there means a junction.
                everything.set(k, (everything.get(k) ?? 0) + 1);
                if (wall.key !== null) at.set(k, [...(at.get(k) ?? []), { index, which }]);
            }
        });
        for (const [k, list] of at) {
            if (list.length !== 2 || everything.get(k) !== 2 || list[0].index === list[1].index) continue;
            const [a, b] = list.map(({ index, which }) => ({
                index, which,
                near: [live[index].c[which * 2], live[index].c[which * 2 + 1]],
                far: [live[index].c[(1 - which) * 2], live[index].c[(1 - which) * 2 + 1]]
            }));
            if (live[a.index].key !== live[b.index].key) continue;
            if (turnAt(a.far, a.near, b.far) > degrees) continue;

            // The walls as one line of points, from a's far end to b's far end.
            const first = a.which === 1 ? live[a.index].path : live[a.index].path.slice().reverse();
            const second = b.which === 0 ? live[b.index].path : live[b.index].path.slice().reverse();
            const path = [...first, ...second.slice(1)];
            const start = path[0];
            const end = path[path.length - 1];
            // Each joint may turn only a little, but joints add up: a curve made of gentle turns is
            // not a straight wall. Every point the new wall passes through must still lie on it.
            if (path.slice(1, -1).some(point => distanceToSegmentWithT(point, start, end).distance > deviation)) continue;

            live[a.index].c = [start[0], start[1], end[0], end[1]];
            live[a.index].path = path;
            removed.push(live[b.index].id);
            live[b.index] = null;
            merged++;
            again = true;
            break;
        }
    }
    return { walls: live.filter(Boolean).map(wall => ({ id: wall.id, c: wall.c })), removed, merged };
}

/**
 * How many pairs of wall ends, on different walls, are further apart than
 * `from` and no further than `to`: ends that nearly meet but are not near
 * enough to have been joined, for telling the GM the join distance is short.
 *
 * @param {{ c: number[] }[]} walls
 * @returns {number}
 */
export function countNearEnds(walls, from, to) {
    const ends = walls.flatMap((wall, index) => [{ index, x: wall.c[0], y: wall.c[1] }, { index, x: wall.c[2], y: wall.c[3] }]);
    let count = 0;
    for (let i = 0; i < ends.length; i++) {
        for (let j = i + 1; j < ends.length; j++) {
            if (ends[i].index === ends[j].index) continue;
            const distance = Math.hypot(ends[i].x - ends[j].x, ends[i].y - ends[j].y);
            if (distance > from && distance <= to) count++;
        }
    }
    return count;
}

// ------------------------------------------------------------------
// Doors and windows on a wall that runs through them
// ------------------------------------------------------------------

/**
 * Where a door or window goes on a wall that was drawn straight across it.
 * The click must be on the wall, not at an end of it: a click beside a wall's
 * end is a gap, which findOpening answers. The opening is the length the
 * picture gave, if it ran along this wall, and otherwise one square, centred
 * on the click; either is clamped to the wall.
 *
 * @param {number[][]} walls   Each as [x1, y1, x2, y2].
 * @param {number[]} click
 * @param {number[][]|null} candidate  The opening as the picture found it, [[x, y], [x, y]], or null.
 * @returns {{ wall: number, segment: number[][] }|null}
 */
export function openingOnWall(walls, click, candidate, { grid, reachSquares = 0.6, defaultSquares = 1 } = {}) {
    let best = null;
    walls.forEach((wall, index) => {
        const length = Math.hypot(wall[2] - wall[0], wall[3] - wall[1]);
        if (length < grid * 0.5) return;
        const { distance, t } = distanceToSegmentWithT(click, [wall[0], wall[1]], [wall[2], wall[3]]);
        const foot = t * length;
        if (foot < grid * 0.25 || foot > length - grid * 0.25) return;
        if (distance > reachSquares * grid) return;
        if (!best || distance < best.distance) best = { index, distance, foot, length, wall };
    });
    if (!best) return null;

    const [x1, y1, x2, y2] = best.wall;
    const ux = (x2 - x1) / best.length;
    const uy = (y2 - y1) / best.length;
    const along = ([x, y]) => (x - x1) * ux + (y - y1) * uy;
    const across = ([x, y]) => Math.abs(-(x - x1) * uy + (y - y1) * ux);

    let lo = best.foot - grid * defaultSquares / 2;
    let hi = best.foot + grid * defaultSquares / 2;
    if (candidate) {
        const [a, b] = candidate;
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const parallel = length ? Math.abs((b[0] - a[0]) * ux + (b[1] - a[1]) * uy) / length : 0;
        // Along this wall, and on it: the picture's length is the opening's.
        if (parallel >= Math.cos(30 * Math.PI / 180) && across(a) <= grid * 0.6 && across(b) <= grid * 0.6) {
            lo = Math.min(along(a), along(b));
            hi = Math.max(along(a), along(b));
        }
    }
    lo = Math.max(0, lo);
    hi = Math.min(best.length, hi);
    if (hi - lo < grid * 0.3) return null;
    const point = s => [Math.round(x1 + ux * s), Math.round(y1 + uy * s)];
    return { wall: best.index, segment: [point(lo), point(hi)] };
}

/**
 * What is left of a wall when an opening is cut out of it: the opening must lie
 * along the wall, within tolerance, and inside it. Cut from the middle, two
 * pieces remain; cut from one end, one; and an opening that is the whole wall
 * leaves nothing to cut, so the wall is left alone and null returned.
 *
 * @param {number[]} wall     [x1, y1, x2, y2]
 * @param {number[][]} segment  The opening, [[x, y], [x, y]].
 * @returns {{ pieces: number[][] }|null}  The pieces, each [x1, y1, x2, y2], from the wall's start to its end.
 */
export function splitWallAt(wall, segment, tolerance = 2) {
    const [x1, y1, x2, y2] = wall;
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (!length) return null;
    const ux = (x2 - x1) / length;
    const uy = (y2 - y1) / length;
    const measured = segment.map(([x, y]) => ({
        along: (x - x1) * ux + (y - y1) * uy,
        across: Math.abs(-(x - x1) * uy + (y - y1) * ux)
    }));
    if (measured.some(m => m.across > tolerance)) return null;
    const lo = Math.min(measured[0].along, measured[1].along);
    const hi = Math.max(measured[0].along, measured[1].along);
    if (hi - lo < 1) return null;
    if (lo < -tolerance || hi > length + tolerance) return null;
    const before = lo > tolerance;
    const after = hi < length - tolerance;
    if (!before && !after) return null;
    const point = s => [Math.round(x1 + ux * s), Math.round(y1 + uy * s)];
    const pieces = [];
    if (before) pieces.push([x1, y1, ...point(lo)]);
    if (after) pieces.push([...point(hi), x2, y2]);
    return { pieces };
}

// ------------------------------------------------------------------
// Joined walls
// ------------------------------------------------------------------

/**
 * The option an update carries to say that it is not to be followed: the
 * walls joined to a moved end are moved by the join, and that move must not
 * start another.
 */
export const SKIP_JOIN = 'cartographerSkipJoin';

/**
 * What follows from one end of a wall being moved. Walls that meet at a point
 * are a joint, and a joint moves as one: every wall with an end where the end
 * was has that end moved to where it went. And an end let go near the end of
 * some other wall is that end, so the two are a joint from then on.
 *
 * Only a single moved end is a joint being worked on. Both ends changing is a
 * wall carried or a group moved together, and is left as it is.
 *
 * @param {{ id: string, c: number[] }[]} walls  Every wall, with its coordinates as they are now.
 * @param {string} id                            The wall being moved.
 * @param {number[]} oldC  The wall's coordinates now.
 * @param {number[]} newC  The coordinates it is being given.
 * @param {{ reach?: number, tolerance?: number }} [options]  reach: how near another end an end is let go to be joined to it, in pixels, 0 for never.
 * @returns {{ c: number[], updates: { _id: string, c: number[] }[], deletes: string[], snapped: boolean }|null}
 */
export function planJoinedMove(walls, id, oldC, newC, { reach = 0, tolerance = 1.5 } = {}) {
    const moved0 = newC[0] !== oldC[0] || newC[1] !== oldC[1];
    const moved1 = newC[2] !== oldC[2] || newC[3] !== oldC[3];
    if (moved0 === moved1) return null;
    const end = moved0 ? 0 : 1;
    const from = [oldC[end * 2], oldC[end * 2 + 1]];
    const fixed = [oldC[(1 - end) * 2], oldC[(1 - end) * 2 + 1]];
    const near = (p, q, within) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= within;

    // The walls with an end where this one was. A wall with both ends there has no length to follow.
    const joined = [];
    for (const wall of walls) {
        if (wall.id === id) continue;
        const first = near([wall.c[0], wall.c[1]], from, tolerance);
        const second = near([wall.c[2], wall.c[3]], from, tolerance);
        if (first !== second) joined.push({ id: wall.id, c: wall.c, end: first ? 0 : 1 });
    }
    const moving = new Set([id, ...joined.map(wall => wall.id)]);

    // Let go near another wall's end, it is that end -- unless that would fold the wall on itself.
    let to = [newC[end * 2], newC[end * 2 + 1]];
    let snapped = false;
    if (reach > 0) {
        let best = null;
        for (const wall of walls) {
            if (moving.has(wall.id)) continue;
            for (const which of [0, 1]) {
                const point = [wall.c[which * 2], wall.c[which * 2 + 1]];
                const distance = Math.hypot(point[0] - to[0], point[1] - to[1]);
                if (distance <= reach && !near(point, fixed, tolerance) && (!best || distance < best.distance)) best = { point, distance };
            }
        }
        if (best && (best.point[0] !== to[0] || best.point[1] !== to[1])) {
            to = best.point;
            snapped = true;
        }
    }

    const c = end === 0 ? [to[0], to[1], oldC[2], oldC[3]] : [oldC[0], oldC[1], to[0], to[1]];
    const updates = [];
    const deletes = [];
    for (const wall of joined) {
        const next = wall.end === 0 ? [to[0], to[1], wall.c[2], wall.c[3]] : [wall.c[0], wall.c[1], to[0], to[1]];
        // Carried to its own other end, a wall has nothing left.
        if (next[0] === next[2] && next[1] === next[3]) deletes.push(wall.id);
        else updates.push({ _id: wall.id, c: next });
    }
    return { c, updates, deletes, snapped };
}

/**
 * A wall being drawn: each end that is let go near the end of another wall is
 * that end. Where both ends would land on one point the second keeps its place,
 * so a short wall is not folded flat.
 *
 * @param {{ id: string, c: number[] }[]} walls  The walls already there.
 * @param {number[]} c  The new wall's coordinates.
 * @param {number} reach  How near, in pixels, counts as at the end.
 * @returns {number[]}  The coordinates, with any end that joined moved onto the end it joined.
 */
export function snapNewWall(walls, c, reach) {
    if (!(reach > 0)) return c;
    const result = [...c];
    for (const end of [0, 1]) {
        let best = null;
        for (const wall of walls) {
            for (const which of [0, 1]) {
                const point = [wall.c[which * 2], wall.c[which * 2 + 1]];
                const distance = Math.hypot(point[0] - result[end * 2], point[1] - result[end * 2 + 1]);
                const other = [result[(1 - end) * 2], result[(1 - end) * 2 + 1]];
                if (distance <= reach && !(point[0] === other[0] && point[1] === other[1]) && (!best || distance < best.distance)) best = { point, distance };
            }
        }
        if (best) {
            result[end * 2] = best.point[0];
            result[end * 2 + 1] = best.point[1];
        }
    }
    return result;
}

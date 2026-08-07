// ==================================================================
// ===== SCENE ATLAS ================================================
// ==================================================================
//
// The canonical map of a scene's architecture, built once from the walls
// Foundry already holds.
//
// This exists because the mapper used to work the other way round: it read
// whatever walls happened to be visible from each square the party crossed,
// snapped that fragment to the grid, and tried to reconcile the result with
// everything it had decided on earlier passes. Snapping is a decision, and
// those decisions were being made without enough information to make them --
// which boundary a wall belongs on, how wide a doorway is, whether two
// fragments are one opening, where a corner closes. Seen from somewhere else
// the same wall answered differently, so the record needed a merge layer, a
// retraction layer and per-source attribution purely to argue with itself, and
// the map you ended up with depended on the route you walked.
//
// Some of those questions cannot be answered from a partial view at all. A
// corner needs both of its walls. A run of collinear wall needs the whole run.
// A curve needs the whole fan of chords that drew it.
//
// So the architecture is settled here instead, in one pass, with every wall in
// hand: runs are joined, corners meet, curves stay curved, straight walls snap
// to the grid the way a hand drawn map would, and doorways take their width and
// their kind straight from Foundry. The result is deterministic -- the same
// scene always yields the same map -- and exploration reduces to a mask over
// it. Walking around reveals this map; it no longer computes one.
//
// Nothing here is persisted. It is derived from live scene data and rebuilt
// whenever that changes, so a wall the GM moves is simply correct next render.

import { clipSegmentToCell } from './utils-mapping.js';

/** How far off square a wall may sit and still be drawn on the grid. */
const AXIS_TOLERANCE_DEGREES = 15;
/**
 * Turn at a joint, in degrees, above which it is a corner rather than a curve.
 *
 * This is what separates an arc from an angular room, and it has to, because
 * chord length cannot: a GM sweeping a long corridor lays down few, long
 * chords, exactly as they would tracing an octagon. But an arc drawn with N
 * chords across a quarter turn bends by 90/N at each joint -- a handful of
 * degrees -- while a cut corner bends by forty-five however it was traced.
 */
const CURVE_MAX_TURN = 35;
/**
 * Longest chord, in squares, that can belong to a curve. Generous, because a
 * wide sweep traced with a few clicks has long chords and is still a curve; it
 * is the turn at each joint that says what the shape is.
 */
const CURVE_MAX_CHORD = 4;
/**
 * How far a run of same-way joints must bend in total to be a curve.
 *
 * This is what tells a deliberate arc from an unsteady hand: an arc keeps
 * turning the same way and adds up, while a wobble turns back on itself and
 * never gets anywhere.
 */
const CURVE_MIN_TOTAL_TURN = 25;
/**
 * How much of a stretch's turning must pull the same way, as a share of all of
 * it. An arc approaches one; an unsteady hand approaches zero.
 */
const CURVE_COHERENCE = 0.6;
/**
 * Joints a curve needs at least. A chamfered corner is two, and a curve is
 * always many, so this is what stops a small room's cut corner being drawn as
 * an arc when its walls happen to be short.
 */
const CURVE_MIN_JOINTS = 3;
/**
 * How deep a stretch must bow away from the straight line between its ends, in
 * squares, to be a curve. A quarter circle strays by about three tenths of its
 * radius; an unsteady hand strays by a fraction of a square.
 */
const CURVE_MIN_BOW = 0.7;
/**
 * How far a stretch may stray from the line between its own ends, in squares,
 * and still be that line.
 *
 * The single dial that decides what counts as noise. Everything a trace does
 * accidentally -- a wobble, a jog, a spur, a slow drift -- is small, and
 * everything it does on purpose -- a corner, a step, an alcove -- is at least
 * a square. Half a square sits between the two.
 */
const FIT_TOLERANCE = 0.5;
/**
 * How far, in degrees, any part of a stretch may point away from the line
 * between its ends and still belong to it. A traced straight wall wanders by a
 * little; a stepped wall turns a right angle at every joint.
 */
const HEADING_TOLERANCE_DEGREES = 35;
/**
 * How finely a curve is redrawn, in squares per span.
 *
 * A curve is only ever traced as a handful of straight chords, and drawing
 * those chords is drawing a polygon. Since the shape is known to be a curve,
 * it is redrawn through the points the trace gave, which is what makes a wide
 * sweep read as a sweep instead of as a few long facets.
 */
const CURVE_SMOOTHING = 0.4;
/** Share of a square a doorway must cover to be drawn as occupying it. */
const OPENING_COVERAGE = 0.6;
/** Features drawn with the doorway glyph rather than as a boundary stroke. */
const DOOR_FEATURES = ['door', 'locked-door'];

const EMPTY_ATLAS = Object.freeze({
    sceneId: null,
    features: Object.freeze({}),
    lines: Object.freeze([]),
    secrets: Object.freeze([]),
    barriers: Object.freeze(new Set()),
    split: Object.freeze(new Set())
});

// ------------------------------------------------------------------
// Wall classification
// ------------------------------------------------------------------

function wallSource(document) {
    return document?._source ?? document;
}

function isSecretDoor(document) {
    const doorTypes = CONST.WALL_DOOR_TYPES ?? {};
    return Number(wallSource(document)?.door) === Number(doorTypes.SECRET);
}

/**
 * What a Foundry wall is, in map terms, or null for something the map does not
 * draw. Door kind and lock state come straight from the wall document, so these
 * were never guesses -- only their placement was.
 */
function classifyWall(document) {
    const source = wallSource(document);
    if (!source) return null;

    const doorTypes = CONST.WALL_DOOR_TYPES ?? {};
    const senseTypes = CONST.WALL_SENSE_TYPES ?? {};
    const movementTypes = CONST.WALL_MOVEMENT_TYPES ?? {};
    const door = Number(source.door ?? doorTypes.NONE ?? 0);
    const move = Number(source.move);
    const sight = Number(source.sight);
    const light = Number(source.light);

    if (door === doorTypes.DOOR) {
        // One-way doors are deliberately not distinguished. Detecting them is
        // trivial (source.dir), but the official glyph is a directional arrow
        // and Foundry's dir is left/right relative to the wall's own vector
        // rather than a compass bearing, so an arrow would point the wrong way
        // half the time -- worse than drawing an ordinary door.
        const doorStates = CONST.WALL_DOOR_STATES ?? {};
        return Number(source.ds) === Number(doorStates.LOCKED) ? 'locked-door' : 'door';
    }
    if (door === doorTypes.SECRET) return 'wall';

    // Terrain walls limit sight rather than stopping it, and are not masonry.
    if (sight === senseTypes.LIMITED && light === senseTypes.LIMITED) return null;

    // A window stops movement while sight passes through it under a threshold.
    // PROXIMITY and DISTANCE are both threshold modes, and light is configured
    // independently of sight, so requiring both missed most real windows.
    const thresholdSenses = [senseTypes.PROXIMITY, senseTypes.DISTANCE];
    if (move === movementTypes.NORMAL
        && (thresholdSenses.includes(sight) || thresholdSenses.includes(light))) {
        return 'window';
    }

    const solid = move === movementTypes.NORMAL
        && (sight === senseTypes.NORMAL || light === senseTypes.NORMAL);
    return solid ? 'wall' : null;
}

// ------------------------------------------------------------------
// Grid geometry
// ------------------------------------------------------------------

function gridSize() {
    return Math.min(canvas.grid.sizeX ?? canvas.grid.size, canvas.grid.sizeY ?? canvas.grid.size);
}

function cellCenter(column, row) {
    if (typeof canvas.grid.getCenterPoint === 'function') {
        const center = canvas.grid.getCenterPoint({ i: row, j: column });
        if (Number.isFinite(center?.x) && Number.isFinite(center?.y)) return center;
    }
    const sizeX = canvas.grid.sizeX ?? canvas.grid.size;
    const sizeY = canvas.grid.sizeY ?? canvas.grid.size;
    return { x: (column + 0.5) * sizeX, y: (row + 0.5) * sizeY };
}

/**
 * A canvas point as a fractional grid position, so column 10.5 is the middle of
 * column 10. Taken from the containing cell rather than by dividing, so a grid
 * whose origin is offset from the canvas origin still lands correctly.
 */
function toGrid(point) {
    const offset = canvas.grid.getOffset({ x: point.x, y: point.y });
    const column = Number(offset.j ?? offset.x);
    const row = Number(offset.i ?? offset.y);
    if (!Number.isInteger(column) || !Number.isInteger(row)) return null;
    const sizeX = canvas.grid.sizeX ?? canvas.grid.size;
    const sizeY = canvas.grid.sizeY ?? canvas.grid.size;
    const center = cellCenter(column, row);
    return {
        column: column + 0.5 + ((point.x - center.x) / sizeX),
        row: row + 0.5 + ((point.y - center.y) / sizeY)
    };
}

/** A hundredth of a square: finer than a foot on a five-foot grid. */
function round(value) {
    return Math.round(value * 100) / 100;
}

function wallSegment(document) {
    const coordinates = document?.c ?? wallSource(document)?.c;
    if (!Array.isArray(coordinates) || coordinates.length < 4) return null;
    const [x1, y1, x2, y2] = coordinates.map(Number);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return null;
    const length = Math.hypot(x2 - x1, y2 - y1);
    if (!length) return null;
    return {
        document,
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        midpoint: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
        length,
        unit: { x: (x2 - x1) / length, y: (y2 - y1) / length }
    };
}

function pointDistance(first, second) {
    return Math.hypot(first.x - second.x, first.y - second.y);
}

/** How far a heading sits from the nearest square axis, in degrees. */
function degreesOffAxis(deltaColumn, deltaRow) {
    if (!deltaColumn && !deltaRow) return 0;
    const angle = Math.abs(Math.atan2(Math.abs(deltaRow), Math.abs(deltaColumn)) * (180 / Math.PI));
    return Math.min(angle, 90 - angle);
}

// ------------------------------------------------------------------
// Connecting walls into runs
// ------------------------------------------------------------------

/**
 * Order wall documents into connected runs, each entry flagged with whether it
 * is walked backwards, so a run reads as one continuous path.
 *
 * A Foundry curve is authored as a fan of short straight segments sharing
 * endpoints. Treating each document alone is what leaves a curve full of holes
 * and makes half its chords look like little straight walls; walking the run as
 * one path is what lets the whole curve be recognised and drawn as a curve.
 *
 * Only documents that genuinely share an endpoint are joined, so two wall runs
 * with an archway between them are never chained across the opening.
 */
function connectedRuns(documents) {
    const tolerance = Math.max(1, gridSize() * 0.08);
    const segments = documents.map(wallSegment).filter(Boolean);

    // Endpoints bucketed on a tolerance-sized lattice: searching for joins by
    // scanning every wall would be quadratic on a wall-heavy scene.
    const buckets = new Map();
    const cellOf = point => [Math.round(point.x / tolerance), Math.round(point.y / tolerance)];
    for (const segment of segments) {
        for (const point of [segment.start, segment.end]) {
            const [x, y] = cellOf(point);
            const key = `${x},${y}`;
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(segment);
        }
    }
    // Two points within tolerance can still quantize into neighbouring buckets.
    const neighbours = point => {
        const [x, y] = cellOf(point);
        const found = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const list = buckets.get(`${x + dx},${y + dy}`);
                if (list) found.push(...list);
            }
        }
        return found;
    };

    const near = (first, second) => pointDistance(first, second) <= tolerance;
    const used = new Set();
    const runs = [];

    for (const seed of segments) {
        if (used.has(seed)) continue;
        used.add(seed);
        const run = [{ segment: seed, reversed: false }];
        let head = seed.start;
        let tail = seed.end;

        for (let extended = true; extended;) {
            extended = false;
            for (const candidate of neighbours(tail)) {
                if (used.has(candidate)) continue;
                if (near(tail, candidate.start)) {
                    run.push({ segment: candidate, reversed: false });
                    tail = candidate.end;
                } else if (near(tail, candidate.end)) {
                    run.push({ segment: candidate, reversed: true });
                    tail = candidate.start;
                } else continue;
                used.add(candidate);
                extended = true;
                break;
            }
            if (extended) continue;
            for (const candidate of neighbours(head)) {
                if (used.has(candidate)) continue;
                if (near(head, candidate.end)) {
                    run.unshift({ segment: candidate, reversed: false });
                    head = candidate.start;
                } else if (near(head, candidate.start)) {
                    run.unshift({ segment: candidate, reversed: true });
                    head = candidate.end;
                } else continue;
                used.add(candidate);
                extended = true;
                break;
            }
        }
        runs.push(run);
    }
    return runs;
}

/** A run as one ordered chain of canvas points, joins already welded. */
function runPolyline(run) {
    const points = [];
    for (const { segment, reversed } of run) {
        const from = reversed ? segment.end : segment.start;
        const to = reversed ? segment.start : segment.end;
        if (!points.length) points.push(from);
        points.push(to);
    }
    return points;
}

// ------------------------------------------------------------------
// Snapping to the grid
// ------------------------------------------------------------------

/**
 * The lattice boundaries between two grid corners on the same row or column.
 */
function latticeEdgesBetween(from, to) {
    const edges = [];
    if (from.row === to.row) {
        for (let column = Math.min(from.column, to.column); column < Math.max(from.column, to.column); column++) {
            edges.push({ key: `${column},${from.row}`, direction: 'north' });
        }
    } else if (from.column === to.column) {
        for (let row = Math.min(from.row, to.row); row < Math.max(from.row, to.row); row++) {
            edges.push({ key: `${from.column},${row}`, direction: 'west' });
        }
    }
    return edges;
}

/**
 * How far a stretch departs from the straight line between its own ends, in
 * squares, and where. The depth of the bow, in other words.
 */
function bowDepth(points, first, last) {
    const from = points[first];
    const to = points[last];
    const dc = to.column - from.column;
    const dr = to.row - from.row;
    const length = Math.hypot(dc, dr);
    let deepest = 0;
    let at = -1;
    for (let vertex = first + 1; vertex < last; vertex++) {
        const point = points[vertex];
        // A stretch returning to where it started has no line to measure
        // against, so measure from the point itself.
        const distance = length
            ? Math.abs(((point.column - from.column) * dr) - ((point.row - from.row) * dc)) / length
            : Math.hypot(point.column - from.column, point.row - from.row);
        if (distance > deepest) {
            deepest = distance;
            at = vertex;
        }
    }
    return { deepest, at };
}

/**
 * Whether a stretch is a deliberate curve.
 *
 * Four things have to hold at once, and each rules out a different impostor. It
 * has to be built from enough short chords, or it is a chamfered corner. No
 * single joint may turn sharply, or it is a corner with clutter around it. The
 * turning has to keep going the same way and add up, or it is an unsteady hand
 * wandering back and forth. And it has to actually stray from the line between
 * its own ends, or it is a wall that merely drifted on its way.
 */
function isCurve(points, first, last) {
    if (last - first < CURVE_MIN_JOINTS + 1) return false;
    let net = 0;
    let total = 0;
    for (let vertex = first + 1; vertex < last; vertex++) {
        const before = {
            dc: points[vertex].column - points[vertex - 1].column,
            dr: points[vertex].row - points[vertex - 1].row
        };
        const after = {
            dc: points[vertex + 1].column - points[vertex].column,
            dr: points[vertex + 1].row - points[vertex].row
        };
        if (Math.hypot(before.dc, before.dr) >= CURVE_MAX_CHORD) return false;
        if (Math.hypot(after.dc, after.dr) >= CURVE_MAX_CHORD) return false;
        const cross = (before.dc * after.dr) - (before.dr * after.dc);
        const dot = (before.dc * after.dc) + (before.dr * after.dr);
        const turn = Math.atan2(cross, dot) * (180 / Math.PI);
        if (Math.abs(turn) >= CURVE_MAX_TURN) return false;
        net += turn;
        total += Math.abs(turn);
    }
    net = Math.abs(net);
    return total > 0
        && net >= CURVE_MIN_TOTAL_TURN
        && (net / total) >= CURVE_COHERENCE
        && bowDepth(points, first, last).deepest >= CURVE_MIN_BOW;
}

/**
 * The worst angle, in degrees, between any segment of a stretch and the line
 * between the stretch's own ends.
 *
 * Straying is not the only way a trace can fail to be a straight wall. A wall
 * that steps -- right a square, down a square, over and over -- never strays
 * far from the diagonal drawn through it, yet every one of its segments is
 * perfectly square and the diagonal is a fiction. Measuring how far it strays
 * cannot see that; measuring where it points can.
 */
function headingSpread(points, first, last) {
    const chordColumn = points[last].column - points[first].column;
    const chordRow = points[last].row - points[first].row;
    const chord = Math.hypot(chordColumn, chordRow);
    if (!chord) return 180;
    let worst = 0;
    for (let vertex = first + 1; vertex <= last; vertex++) {
        const dc = points[vertex].column - points[vertex - 1].column;
        const dr = points[vertex].row - points[vertex - 1].row;
        const length = Math.hypot(dc, dr);
        if (!length) continue;
        const along = ((dc * chordColumn) + (dr * chordRow)) / (length * chord);
        worst = Math.max(worst, Math.acos(Math.min(1, Math.max(-1, along))) * (180 / Math.PI));
    }
    return worst;
}

/**
 * Break a traced run into the pieces it is really made of.
 *
 * This is the heart of normalization, and it replaces judging each traced
 * segment on its own. Judging segments meant every kind of trace noise -- a
 * wobble, a jog, a spur, a slow drift -- needed its own rule to recognise and
 * undo, the rules interacted, and each new shape of sloppiness found the gap
 * between them. Worse, a run was straightened by averaging: a long wall that
 * drifted a square from end to end was flattened onto the mean row, which put
 * half of it a full square from where it belonged.
 *
 * So instead of asking what each segment is, ask where the run stops being
 * straight. A stretch that stays within half a square of the line between its
 * own ends *is* that line, whatever wandering it did on the way -- which
 * disposes of every kind of noise at once, because noise is by definition small.
 * Where a stretch strays further, it is doing something real, so it splits at
 * the point that strays most and each half is asked the same question. Corners,
 * steps and alcoves survive because that is exactly what straying means.
 *
 * Curves are asked about first, since an arc never settles down under splitting
 * -- it would shatter into ever shorter straight pieces, which is precisely the
 * faceting a cave must not have.
 */
function fitRun(points, first, last, pieces) {
    if (last - first < 1) return;
    // A single traced segment is whatever it is; there is nothing to fit.
    if (last - first === 1) {
        pieces.push({ kind: 'line', first, last });
        return;
    }
    if (isCurve(points, first, last)) {
        pieces.push({ kind: 'curve', first, last });
        return;
    }
    const { deepest, at } = bowDepth(points, first, last);
    // Straight means both staying near the line between the ends and pointing
    // along it. A stepped wall satisfies the first and fails the second, and
    // taking it for one line is what drew great diagonals across squared rooms.
    const straight = deepest <= FIT_TOLERANCE
        && headingSpread(points, first, last) <= HEADING_TOLERANCE_DEGREES;
    if (at < 0 || straight) {
        pieces.push({ kind: 'line', first, last });
        return;
    }
    fitRun(points, first, at, pieces);
    fitRun(points, at, last, pieces);
}

/** Which line a straight piece sits on, or that it is angled or curved. */
function classifyPiece(points, piece) {
    if (piece.kind === 'curve') return { ...piece, axis: 'curve' };
    const from = points[piece.first];
    const to = points[piece.last];
    const dc = to.column - from.column;
    const dr = to.row - from.row;
    if (degreesOffAxis(dc, dr) > AXIS_TOLERANCE_DEGREES) return { ...piece, axis: 'angled' };
    const axis = Math.abs(dc) >= Math.abs(dr) ? 'horizontal' : 'vertical';
    let sum = 0;
    for (let vertex = piece.first; vertex <= piece.last; vertex++) {
        sum += axis === 'horizontal' ? points[vertex].row : points[vertex].column;
    }
    return { ...piece, axis, line: Math.round(sum / (piece.last - piece.first + 1)) };
}

/**
 * Split a near-square piece wherever it crosses onto the next row or column,
 * so a long wall that drifts is drawn as a wall that steps.
 */
function stepsOf(points, piece) {
    if (piece.kind === 'curve') return [piece];
    const from = points[piece.first];
    const to = points[piece.last];
    const dc = to.column - from.column;
    const dr = to.row - from.row;
    if (degreesOffAxis(dc, dr) > AXIS_TOLERANCE_DEGREES) return [piece];
    const across = Math.abs(dc) >= Math.abs(dr) ? 'row' : 'column';

    let lowest = Infinity;
    let highest = -Infinity;
    for (let vertex = piece.first; vertex <= piece.last; vertex++) {
        lowest = Math.min(lowest, points[vertex][across]);
        highest = Math.max(highest, points[vertex][across]);
    }
    if (highest - lowest <= FIT_TOLERANCE) return [piece];

    const parts = [];
    let start = piece.first;
    let line = Math.round(points[piece.first][across]);
    for (let vertex = piece.first + 1; vertex <= piece.last; vertex++) {
        const here = Math.round(points[vertex][across]);
        if (here === line) continue;
        if (vertex > start) parts.push({ kind: 'line', first: start, last: vertex });
        start = vertex;
        line = here;
    }
    if (piece.last > start) parts.push({ kind: 'line', first: start, last: piece.last });
    return parts.length ? parts : [piece];
}

/**
 * Redraw a curve smoothly through the points the trace gave.
 *
 * A Catmull-Rom spline, which passes exactly through every control point --
 * so the ends stay where they were pulled onto the grid, and the curve still
 * follows the wall the GM traced rather than an idea of one.
 */
function smoothCurve(points) {
    if (points.length < 3) return points;
    const at = index => points[Math.min(points.length - 1, Math.max(0, index))];
    const smoothed = [points[0]];
    for (let index = 0; index < points.length - 1; index++) {
        const p0 = at(index - 1);
        const p1 = at(index);
        const p2 = at(index + 1);
        const p3 = at(index + 2);
        const span = Math.hypot(p2.column - p1.column, p2.row - p1.row);
        const steps = Math.max(1, Math.min(24, Math.ceil(span / CURVE_SMOOTHING)));
        for (let step = 1; step <= steps; step++) {
            const t = step / steps;
            const t2 = t * t;
            const t3 = t2 * t;
            const blend = (a, b, c, d) => 0.5 * (
                (2 * b)
                + ((-a + c) * t)
                + (((2 * a) - (5 * b) + (4 * c) - d) * t2)
                + ((-a + (3 * b) - (3 * c) + d) * t3)
            );
            smoothed.push({
                column: blend(p0.column, p1.column, p2.column, p3.column),
                row: blend(p0.row, p1.row, p2.row, p3.row)
            });
        }
    }
    return smoothed;
}

/**
 * Redraw one traced wall run as the grid map it was tracing.
 *
 * A Foundry wall is not the architecture -- it is a GM's mouse-trace over a
 * picture of the architecture, laid down without ever seeing the line they were
 * following. So it wanders a couple of degrees off square, overshoots its
 * corners, and carries jogs where a click landed badly. None of that is
 * intentional and none of it should reach the map: nobody in play ever sees it,
 * because all a wall does for them is stop movement and sight.
 *
 * What the artist drew underneath was almost certainly square. So the run is
 * broken into the pieces it is really made of, and each piece is then drawn as
 * what it is: a piece within a few degrees of square becomes exactly square, on
 * one shared row or column; a piece genuinely set at an angle keeps its angle,
 * corner to corner so it still lands on the grid; and a curve keeps its true
 * shape, with only its ends pulled onto the grid to meet what it joins.
 *
 * Where two pieces no longer meet -- a wall that really does step from one line
 * to another -- the step is drawn square rather than as a slanted join.
 */
function normalizeRun(points) {
    if (points.length < 2) return { edges: [], lines: [] };

    const fitted = [];
    fitRun(points, 0, points.length - 1, fitted);
    if (!fitted.length) return { edges: [], lines: [] };

    const pieces = [];
    for (const piece of fitted) {
        // A straight wall a few degrees off square still crosses from one row
        // to the next if it runs far enough, and averaging it onto a single
        // line would put one end a whole square from where it belongs. Where
        // that happens the wall does not lie on one line at all: it steps, and
        // it is split so each part sits on its own.
        for (const part of stepsOf(points, piece)) pieces.push(classifyPiece(points, part));
    }

    // Each piece places its own two ends. A piece fixes the coordinate its own
    // line settles, and takes the other from the piece it joins, so a corner
    // between a horizontal and a vertical closes exactly.
    const ends = pieces.map((piece, index) => {
        const place = (vertex, neighbour) => {
            const point = {
                column: Math.round(points[vertex].column),
                row: Math.round(points[vertex].row)
            };
            for (const source of [neighbour, piece]) {
                if (source?.axis === 'horizontal') point.row = source.line;
                if (source?.axis === 'vertical') point.column = source.line;
            }
            return point;
        };
        return {
            start: place(piece.first, pieces[index - 1]),
            end: place(piece.last, pieces[index + 1])
        };
    });

    // How big a thing is, is a question about the grid it lands on rather than
    // about the trace. Judged beforehand, a nook the artist drew as one square
    // but a hand traced at four fifths of one was erased -- and the party still
    // walked into it, so the map showed floor with no walls round it. Judged
    // afterwards, that nook lands a square across and survives, while a stub
    // too small to draw collapses to nothing on its own.
    const placed = pieces.map((piece, index) => ({ piece, ...ends[index] }));
    const live = placed.filter(entry => entry.piece.kind === 'curve'
        || entry.start.column !== entry.end.column
        || entry.start.row !== entry.end.row);

    // What remains of a click that landed wide is a wall going out and coming
    // straight back, having drawn nothing. An alcove never does that: it has a
    // run between its two returns, so they cannot cancel.
    for (let reducing = true; reducing;) {
        reducing = false;
        for (let index = 0; index + 1 < live.length; index++) {
            const here = live[index];
            const next = live[index + 1];
            if (here.piece.kind === 'curve' || next.piece.kind === 'curve') continue;
            if (here.start.column === next.end.column && here.start.row === next.end.row
                && here.end.column === next.start.column && here.end.row === next.start.row) {
                live.splice(index, 2);
                reducing = true;
                break;
            }
        }
    }

    const edges = [];
    const lines = [];
    const draw = (from, to, curved) => {
        if (from.column === to.column && from.row === to.row) return;
        if (!curved && (from.column === to.column || from.row === to.row)) {
            edges.push(...latticeEdgesBetween(from, to));
            return;
        }
        lines.push([
            [round(from.column), round(from.row)],
            [round(to.column), round(to.row)]
        ]);
    };

    for (const [index, entry] of live.entries()) {
        const { piece, start, end } = entry;
        if (piece.kind !== 'curve') {
            draw(start, end, false);
        } else {
            // Pulling only a curve's ends onto the grid would bend its first
            // and last chord and leave a kink. Every vertex takes a share of
            // the two end shifts instead, by how far along it sits, so the arc
            // keeps its shape and still lands on the grid.
            const head = {
                column: start.column - points[piece.first].column,
                row: start.row - points[piece.first].row
            };
            const tail = {
                column: end.column - points[piece.last].column,
                row: end.row - points[piece.last].row
            };
            const distance = [0];
            let travelled = 0;
            for (let vertex = piece.first + 1; vertex <= piece.last; vertex++) {
                travelled += Math.hypot(
                    points[vertex].column - points[vertex - 1].column,
                    points[vertex].row - points[vertex - 1].row
                );
                distance.push(travelled);
            }
            const carried = [start];
            for (let vertex = piece.first + 1; vertex <= piece.last; vertex++) {
                const along = travelled ? distance[vertex - piece.first] / travelled : 1;
                carried.push(vertex === piece.last ? end : {
                    column: points[vertex].column + (head.column * (1 - along)) + (tail.column * along),
                    row: points[vertex].row + (head.row * (1 - along)) + (tail.row * along)
                });
            }
            const smoothed = smoothCurve(carried);
            for (let index = 1; index < smoothed.length; index++) {
                draw(smoothed[index - 1], smoothed[index], true);
            }
        }

        // Two pieces that no longer meet are a wall stepping from one line to
        // another. Drawn as a right angle, because that is what the artist
        // drew; a straight join between them would slant across the step.
        const following = live[index + 1];
        if (!following) continue;
        const gap = following.start;
        if (gap.column === end.column && gap.row === end.row) continue;
        if (gap.column === end.column || gap.row === end.row) {
            draw(end, gap, false);
            continue;
        }
        const corner = { column: gap.column, row: end.row };
        draw(end, corner, false);
        draw(corner, gap, false);
    }
    return { edges, lines };
}

/**
 * The boundaries an opening occupies.
 *
 * Weighed by how much of each square the opening actually covers, so a
 * one-square doorway authored across a square boundary is recorded at its real
 * width instead of being drawn as a double door. The best covered square always
 * survives, so a narrow opening still lands somewhere.
 */
function openingEdges(from, to) {
    const horizontal = Math.abs(to.column - from.column) >= Math.abs(to.row - from.row);
    const along = horizontal ? [from.column, to.column] : [from.row, to.row];
    const low = Math.min(...along);
    const high = Math.max(...along);
    const across = Math.round(horizontal ? (from.row + to.row) / 2 : (from.column + to.column) / 2);

    const covers = [];
    for (let index = Math.floor(low); index <= Math.floor(high); index++) {
        const overlap = Math.min(high, index + 1) - Math.max(low, index);
        if (overlap > 0) covers.push({ index, overlap });
    }
    if (!covers.length) return [];
    let kept = covers.filter(entry => entry.overlap >= OPENING_COVERAGE);
    if (!kept.length) kept = [covers.reduce((best, entry) => (entry.overlap > best.overlap ? entry : best))];
    return kept.map(entry => (horizontal
        ? { key: `${entry.index},${across}`, direction: 'north' }
        : { key: `${across},${entry.index}`, direction: 'west' }));
}

// ------------------------------------------------------------------
// Clustering opening fragments
// ------------------------------------------------------------------

function farthestEndpointPair(segments) {
    const points = segments.flatMap(segment => [segment.start, segment.end]);
    let pair = [points[0], points[1] ?? points[0]];
    let distance = -1;
    for (let first = 0; first < points.length; first++) {
        for (let second = first + 1; second < points.length; second++) {
            const candidate = pointDistance(points[first], points[second]);
            if (candidate <= distance) continue;
            pair = [points[first], points[second]];
            distance = candidate;
        }
    }
    return { pair, distance: Math.max(0, distance) };
}

/**
 * Scene authors frequently build one doorway from several short wall documents
 * -- a curved jamb, a decorative frame. Collapse those fragments to the extent
 * of the whole cluster so one doorway yields one opening.
 */
function openingClusters(documents) {
    const size = gridSize();
    const joinDistance = size * 0.75;
    const maxSpan = size * 2.6;
    const segments = documents.map(wallSegment).filter(Boolean);
    const clusters = [];

    for (const segment of segments) {
        const cluster = clusters.find(candidate => {
            // Fragments must roughly share a heading before they can be one
            // opening. Without this, two openings meeting at a corner were
            // fused and the result ran diagonally through open space.
            const aligned = candidate.some(existing => (
                Math.abs((existing.unit.x * segment.unit.x) + (existing.unit.y * segment.unit.y)) >= 0.7
            ));
            if (!aligned) return false;
            const connected = candidate.some(existing => Math.min(
                pointDistance(existing.start, segment.start),
                pointDistance(existing.start, segment.end),
                pointDistance(existing.end, segment.start),
                pointDistance(existing.end, segment.end)
            ) <= joinDistance);
            if (!connected) return false;
            return farthestEndpointPair([...candidate, segment]).distance <= maxSpan;
        });
        if (cluster) cluster.push(segment);
        else clusters.push([segment]);
    }

    return clusters.map(cluster => ({
        id: cluster.map(member => member.document.id).sort().join('|'),
        members: cluster,
        extent: farthestEndpointPair(cluster).pair
    }));
}

// ------------------------------------------------------------------
// Building the atlas
// ------------------------------------------------------------------

function addFeature(features, key, code) {
    features[key] ??= [];
    if (!features[key].includes(code)) features[key].push(code);
}

/**
 * Read every wall in the scene and settle the architecture in one pass.
 */
function buildSceneAtlas(scene = canvas?.scene) {
    if (!scene || !canvas?.ready || !canvas.grid) return EMPTY_ATLAS;

    const documents = [...(scene.walls ?? [])];
    const features = {};
    const lines = [];
    const secrets = [];

    const openings = new Map();
    const secretDocuments = [];
    const structural = [];
    for (const document of documents) {
        if (isSecretDoor(document)) {
            secretDocuments.push(document);
            continue;
        }
        const feature = classifyWall(document);
        if (!feature) continue;
        // Openings cluster only with their own kind, so a locked door beside a
        // plain one -- or a window beside a door -- is never collapsed into a
        // single mislabelled symbol.
        if (feature === 'wall') structural.push(document);
        else {
            if (!openings.has(feature)) openings.set(feature, []);
            openings.get(feature).push(document);
        }
    }

    // -- Structural walls -------------------------------------------------
    for (const run of connectedRuns(structural)) {
        const points = runPolyline(run).map(toGrid);
        if (points.some(point => !point)) continue;
        const normalized = normalizeRun(points);
        for (const edge of normalized.edges) addFeature(features, edge.key, `wall:${edge.direction}`);
        lines.push(...normalized.lines);
    }

    // -- Doors and windows ------------------------------------------------
    for (const [feature, group] of openings) {
        for (const cluster of openingClusters(group)) {
            const [from, to] = cluster.extent.map(toGrid);
            if (!from || !to) continue;
            for (const edge of openingEdges(from, to)) {
                addFeature(features, edge.key, `${feature}:${edge.direction}`);
            }
        }
    }

    // -- Secret doors -----------------------------------------------------
    // Drawn as ordinary wall until the party crosses one. The atlas records
    // which boundaries belong to which secret so discovery can swap them for
    // the symbol without re-deriving anything.
    for (const cluster of openingClusters(secretDocuments)) {
        const [from, to] = cluster.extent.map(toGrid);
        if (!from || !to) continue;
        const edges = openingEdges(from, to);
        if (!edges.length) continue;
        for (const edge of edges) addFeature(features, edge.key, `wall:${edge.direction}`);
        secrets.push({
            id: cluster.id,
            edges,
            segments: cluster.members.map(member => ({ start: member.start, end: member.end }))
        });
    }

    return {
        sceneId: scene.id,
        features,
        lines,
        secrets,
        barriers: barriersOf(lines),
        split: splitSquares(lines)
    };
}

/**
 * The squares a wall runs through rather than around.
 *
 * A wall on the lattice bounds whole squares, so a square is either inside it
 * or out. A curve or an angled wall cuts squares in half, and half a square of
 * floor is still floor the party can stand on and see.
 */
function splitSquares(lines) {
    const split = new Set();
    for (const [[x0, y0], [x1, y1]] of lines) {
        for (let row = Math.floor(Math.min(y0, y1)); row <= Math.floor(Math.max(y0, y1)); row++) {
            for (let column = Math.floor(Math.min(x0, x1)); column <= Math.floor(Math.max(x0, x1)); column++) {
                if (clipSegmentToCell(x0, y0, x1, y1, column, row)) split.add(`${column},${row}`);
            }
        }
    }
    return split;
}

/**
 * Which steps between neighbouring squares a wall stands in the way of.
 *
 * The boundary lattice says this for the walls that lie on it, simply by being
 * on it. A curve or an angled wall does not lie on it -- that is the whole
 * point of them -- so nothing recorded that they block anything, and everything
 * reading the lattice walked straight through them. Flooring a room then poured
 * out through the curved wall and filled whatever lay beyond.
 *
 * A step is blocked when the line from one square's middle to the next crosses
 * the wall, which is the same question as whether you could walk it.
 */
function barriersOf(lines) {
    const barriers = new Set();
    for (const [[x0, y0], [x1, y1]] of lines) {
        const from = { x: x0, y: y0 };
        const to = { x: x1, y: y1 };
        const firstColumn = Math.floor(Math.min(x0, x1)) - 1;
        const lastColumn = Math.floor(Math.max(x0, x1));
        const firstRow = Math.floor(Math.min(y0, y1)) - 1;
        const lastRow = Math.floor(Math.max(y0, y1));
        for (let row = firstRow; row <= lastRow; row++) {
            for (let column = firstColumn; column <= lastColumn; column++) {
                const middle = { x: column + 0.5, y: row + 0.5 };
                const east = { x: column + 1.5, y: row + 0.5 };
                const south = { x: column + 0.5, y: row + 1.5 };
                if (segmentsIntersect(middle, east, from, to)) barriers.add(`e:${column},${row}`);
                if (segmentsIntersect(middle, south, from, to)) barriers.add(`s:${column},${row}`);
            }
        }
    }
    return barriers;
}

// ------------------------------------------------------------------
// Crossing a secret door
// ------------------------------------------------------------------

function orientation(a, b, c) {
    return ((b.y - a.y) * (c.x - b.x)) - ((b.x - a.x) * (c.y - b.y));
}

function onSegment(a, b, point, epsilon = 0.001) {
    return point.x <= Math.max(a.x, b.x) + epsilon
        && point.x >= Math.min(a.x, b.x) - epsilon
        && point.y <= Math.max(a.y, b.y) + epsilon
        && point.y >= Math.min(a.y, b.y) - epsilon;
}

function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
    const epsilon = 0.001;
    const o1 = orientation(firstStart, firstEnd, secondStart);
    const o2 = orientation(firstStart, firstEnd, secondEnd);
    const o3 = orientation(secondStart, secondEnd, firstStart);
    const o4 = orientation(secondStart, secondEnd, firstEnd);
    if (((o1 > epsilon && o2 < -epsilon) || (o1 < -epsilon && o2 > epsilon))
        && ((o3 > epsilon && o4 < -epsilon) || (o3 < -epsilon && o4 > epsilon))) return true;
    if (Math.abs(o1) <= epsilon && onSegment(firstStart, firstEnd, secondStart)) return true;
    if (Math.abs(o2) <= epsilon && onSegment(firstStart, firstEnd, secondEnd)) return true;
    if (Math.abs(o3) <= epsilon && onSegment(secondStart, secondEnd, firstStart)) return true;
    if (Math.abs(o4) <= epsilon && onSegment(secondStart, secondEnd, firstEnd)) return true;
    return false;
}

/**
 * The secret doors a move passed through. A secret stays ordinary wall on the
 * map until someone walks it, which is the whole point of finding one.
 */
function secretsCrossedBy(atlas, from, to) {
    if (!atlas?.secrets?.length || !from || !to) return [];
    if (from.x === to.x && from.y === to.y) return [];
    const found = [];
    for (const secret of atlas.secrets) {
        const crossed = secret.segments.some(segment => segmentsIntersect(from, to, segment.start, segment.end));
        if (crossed) found.push(secret.id);
    }
    return found;
}

export {
    AXIS_TOLERANCE_DEGREES,
    buildSceneAtlas,
    classifyWall,
    DOOR_FEATURES,
    EMPTY_ATLAS,
    secretsCrossedBy,
    toGrid
};

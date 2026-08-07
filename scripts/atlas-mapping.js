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

/** How far off square a wall may sit and still be drawn on the grid. */
const AXIS_TOLERANCE_DEGREES = 15;
/** Turn at a joint, in degrees, below which a trace is merely unsteady. */
const CURVE_MIN_TURN = 3;
/** Turn at a joint, in degrees, above which it is a corner rather than a curve. */
const CURVE_MAX_TURN = 55;
/** Longest chord, in squares, that can belong to a curve rather than a wall. */
const CURVE_MAX_CHORD = 1.5;
/** Share of a square a doorway must cover to be drawn as occupying it. */
const OPENING_COVERAGE = 0.6;
/** Features drawn with the doorway glyph rather than as a boundary stroke. */
const DOOR_FEATURES = ['door', 'locked-door'];

const EMPTY_ATLAS = Object.freeze({
    sceneId: null,
    features: Object.freeze({}),
    lines: Object.freeze([]),
    secrets: Object.freeze([])
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
 * Which stretches of a run are a deliberate curve rather than a shaky hand.
 *
 * A curve is authored as a fan of short chords, each turning by a little, in
 * the same direction, over and over. A traced rectangle is long segments
 * meeting at square corners, and a chamfered corner is one short segment
 * between two long ones. Requiring both neighbours of a joint to be short is
 * what tells those apart, and requiring two consecutive such joints is what
 * stops a single wobble in a traced line from being mistaken for an arc.
 */
function curvedSegments(segments) {
    const curved = new Array(segments.length).fill(false);
    const smooth = [];
    for (let index = 1; index < segments.length; index++) {
        const before = segments[index - 1];
        const after = segments[index];
        const cross = (before.dc * after.dr) - (before.dr * after.dc);
        const dot = (before.dc * after.dc) + (before.dr * after.dr);
        const turn = Math.abs(Math.atan2(cross, dot) * (180 / Math.PI));
        smooth[index] = turn > CURVE_MIN_TURN && turn < CURVE_MAX_TURN
            && before.length < CURVE_MAX_CHORD && after.length < CURVE_MAX_CHORD;
    }
    let index = 1;
    while (index < segments.length) {
        if (!smooth[index]) {
            index++;
            continue;
        }
        let last = index;
        while (last + 1 < segments.length && smooth[last + 1]) last++;
        if (last - index + 1 >= 2) {
            for (let segment = index - 1; segment <= last; segment++) curved[segment] = true;
        }
        index = last + 1;
    }
    return curved;
}

/**
 * Redraw one traced wall run as the grid map it was tracing.
 *
 * This is the whole point of the atlas, and it is not the same thing as reading
 * the walls. A Foundry wall is not the architecture -- it is a GM's mouse-trace
 * over a picture of the architecture, laid down without ever seeing the line
 * they were following. So it wanders a couple of degrees off square, overshoots
 * its corners, and carries little jogs where a click landed badly. None of that
 * is intentional and none of it should reach the map: nobody in play ever sees
 * it, because all a wall does for them is stop movement and sight.
 *
 * What the artist drew underneath was almost certainly square. So every corner
 * of the trace is pulled onto the nearest grid intersection, and every stretch
 * that is merely a few degrees off square is made exactly square -- one shared
 * row for a horizontal stretch, one shared column for a vertical one, so
 * corners close by construction rather than by luck. A jog collapses to nothing
 * when both its ends land on the same intersection.
 *
 * Two things survive that treatment, because they are design rather than
 * sloppiness: a wall genuinely set at an angle keeps its angle, drawn corner to
 * corner so it still lands on the grid, and a curve keeps its true shape with
 * only its ends pulled onto the grid to meet whatever it joins.
 */
function normalizeRun(points) {
    if (points.length < 2) return { edges: [], lines: [] };

    const segments = [];
    for (let index = 1; index < points.length; index++) {
        const dc = points[index].column - points[index - 1].column;
        const dr = points[index].row - points[index - 1].row;
        const length = Math.hypot(dc, dr);
        const axis = degreesOffAxis(dc, dr) <= AXIS_TOLERANCE_DEGREES
            ? (Math.abs(dc) >= Math.abs(dr) ? 'horizontal' : 'vertical')
            : 'angled';
        segments.push({ dc, dr, length, axis });
    }
    const curved = curvedSegments(segments);

    // A vertex with curve on both sides belongs to the curve and keeps its true
    // position. Every other vertex is going onto the grid.
    const onCurve = points.map((_, index) => (
        index > 0 && index < points.length - 1 && curved[index - 1] && curved[index]
    ));
    const placed = points.map(point => ({
        column: point.column, row: point.row, hasColumn: false, hasRow: false
    }));

    // Straighten each stretch of near-square segments onto one row or column,
    // a stretch at a time rather than a segment at a time, so a wall the GM
    // traced with several clicks ends up on a single line.
    let index = 0;
    while (index < segments.length) {
        if (curved[index] || segments[index].axis === 'angled') {
            index++;
            continue;
        }
        const axis = segments[index].axis;
        let last = index;
        while (last + 1 < segments.length && !curved[last + 1] && segments[last + 1].axis === axis) last++;
        const span = [];
        for (let vertex = index; vertex <= last + 1; vertex++) span.push(vertex);

        if (axis === 'horizontal') {
            // A stretch meeting one already placed adopts its line, so two
            // stretches sharing a corner cannot pull it two ways.
            const anchored = span.find(vertex => placed[vertex].hasRow);
            const row = anchored !== undefined
                ? placed[anchored].row
                : Math.round(span.reduce((total, vertex) => total + points[vertex].row, 0) / span.length);
            for (const vertex of span) {
                placed[vertex].row = row;
                placed[vertex].hasRow = true;
            }
        } else {
            const anchored = span.find(vertex => placed[vertex].hasColumn);
            const column = anchored !== undefined
                ? placed[anchored].column
                : Math.round(span.reduce((total, vertex) => total + points[vertex].column, 0) / span.length);
            for (const vertex of span) {
                placed[vertex].column = column;
                placed[vertex].hasColumn = true;
            }
        }
        index = last + 1;
    }

    // Everything not already placed goes to its nearest intersection: the ends
    // of angled walls, and the ends of curves.
    for (const [vertex, point] of placed.entries()) {
        if (onCurve[vertex]) continue;
        if (!point.hasColumn) point.column = Math.round(point.column);
        if (!point.hasRow) point.row = Math.round(point.row);
    }

    const edges = [];
    const lines = [];
    for (let segment = 0; segment < segments.length; segment++) {
        const from = placed[segment];
        const to = placed[segment + 1];
        // A jog whose ends met on the same intersection was never architecture.
        if (from.column === to.column && from.row === to.row) continue;
        if (!curved[segment] && (from.column === to.column || from.row === to.row)) {
            edges.push(...latticeEdgesBetween(from, to));
            continue;
        }
        lines.push([
            [round(from.column), round(from.row)],
            [round(to.column), round(to.row)]
        ]);
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

    return { sceneId: scene.id, features, lines, secrets };
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

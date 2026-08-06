// ==================================================================
// ===== MAPPING GEOMETRY AND VISIBILITY ============================
// ==================================================================

const DIRECTIONS = ['north', 'east', 'south', 'west'];

/** Slope ratio at which a wall is treated as diagonal rather than straight. */
const DIAGONAL_WALL_RATIO = 0.4;
/** Features drawn with the doorway glyph rather than as a boundary stroke. */
const DOOR_FEATURES = ['door', 'locked-door'];
/**
 * Features drawn as a symbol on the wall rather than as a boundary stroke.
 * Their fragments are clustered into one opening before snapping.
 */
const GLYPH_FEATURES = [...DOOR_FEATURES, 'secret-door', 'window'];
/**
 * Openings whose symbol should be as wide as the opening itself. These mark
 * every square they cross rather than only their midpoint, so a warehouse door
 * spanning several squares is recorded at its true width -- and so a long
 * opening is still recorded when its midpoint happens to be out of sight. The
 * renderer joins the marks back into one symbol.
 */
const SPANNING_GLYPH_FEATURES = [...DOOR_FEATURES, 'window'];
/** Every feature that may be persisted against a cell edge. */
const EDGE_FEATURES = ['wall', ...GLYPH_FEATURES];
/**
 * Prefixes a persisted feature source may use. A source id is "<kind>:<wall
 * ids>", and normalizeFeatureSources drops anything that does not match, so a
 * new kind must be added here or its observations vanish silently on the way
 * into the record.
 */
const FEATURE_SOURCE_KINDS = ['wall', 'door', 'window'];
const FEATURE_SOURCE_PATTERN = new RegExp(
    `^(?:${FEATURE_SOURCE_KINDS.join('|')}):[A-Za-z0-9_|.-]+$`
);

function isSecretDoor(document) {
    const source = document?._source ?? document;
    const doorTypes = CONST.WALL_DOOR_TYPES ?? {};
    return Number(source?.door) === Number(doorTypes.SECRET);
}

function classifyWall(document) {
    const source = document?._source ?? document;
    if (!source) return null;

    const doorTypes = CONST.WALL_DOOR_TYPES ?? {};
    const senseTypes = CONST.WALL_SENSE_TYPES ?? {};
    const movementTypes = CONST.WALL_MOVEMENT_TYPES ?? {};
    const door = Number(source.door ?? doorTypes.NONE ?? 0);
    const move = Number(source.move);
    const sight = Number(source.sight);
    const light = Number(source.light);

    if (door === doorTypes.DOOR) {
        // Foundry records the lock on the wall itself, so the map can show the
        // official locked glyph without any authoring.
        //
        // One-way doors are deliberately not distinguished yet. Detecting them
        // is trivial (source.dir), but the official glyph is a directional
        // arrow, and Foundry's dir is LEFT/RIGHT relative to the wall's own
        // vector rather than a compass bearing. Until that is mapped through
        // edge snapping, an arrow would point the wrong way half the time,
        // which is worse than drawing an ordinary door.
        const doorStates = CONST.WALL_DOOR_STATES ?? {};
        if (Number(source.ds) === Number(doorStates.LOCKED)) return 'locked-door';
        return 'door';
    }
    if (door === doorTypes.SECRET) return 'wall';

    const isTerrain = sight === senseTypes.LIMITED && light === senseTypes.LIMITED;
    if (isTerrain) return null;

    // A window blocks movement while sight passes through it under a distance
    // threshold. PROXIMITY and DISTANCE are both threshold modes, and light is
    // configured independently of sight -- a window that lets light through
    // normally is ordinary. Requiring sight AND light to both be PROXIMITY
    // missed most real windows and drew them as plain wall.
    const thresholdSenses = [senseTypes.PROXIMITY, senseTypes.DISTANCE];
    const isWindow = move === movementTypes.NORMAL
        && (thresholdSenses.includes(sight) || thresholdSenses.includes(light));
    if (isWindow) return 'window';

    const isPhysicalWall = move === movementTypes.NORMAL
        && (sight === senseTypes.NORMAL || light === senseTypes.NORMAL);
    return isPhysicalWall ? 'wall' : null;
}

function orthogonalPath(start, end) {
    const path = [{ ...start }];
    let current = { ...start };
    const lineDx = end.column - start.column;
    const lineDy = end.row - start.row;
    let preferHorizontal = Math.abs(lineDx) >= Math.abs(lineDy);

    while (current.column !== end.column || current.row !== end.row) {
        const candidates = [];
        if (current.column !== end.column) {
            candidates.push({
                column: current.column + Math.sign(end.column - current.column),
                row: current.row,
                horizontal: true
            });
        }
        if (current.row !== end.row) {
            candidates.push({
                column: current.column,
                row: current.row + Math.sign(end.row - current.row),
                horizontal: false
            });
        }

        if (candidates.length === 1) current = candidates[0];
        else {
            const scored = candidates.map(candidate => ({
                candidate,
                score: Math.abs(
                    (lineDy * (candidate.column - start.column))
                    - (lineDx * (candidate.row - start.row))
                )
            }));
            scored.sort((left, right) => {
                if (left.score !== right.score) return left.score - right.score;
                return left.candidate.horizontal === preferHorizontal ? -1 : 1;
            });
            current = scored[0].candidate;
            preferHorizontal = !preferHorizontal;
        }
        path.push({ column: current.column, row: current.row });
    }
    return path;
}

/**
 * Return every grid square crossed by a straight token move. Foundry often
 * reports a long drag as one destination update, so the mapper must reconstruct
 * the intermediate stops rather than reveal only the final 5x5 neighborhood.
 */
function gridTravelPath(start, end) {
    const columnDelta = end.column - start.column;
    const rowDelta = end.row - start.row;
    const steps = Math.max(Math.abs(columnDelta), Math.abs(rowDelta));
    if (!steps) return [{ column: start.column, row: start.row }];

    const path = [];
    let previousKey = null;
    for (let index = 0; index <= steps; index++) {
        const column = Math.round(start.column + ((columnDelta * index) / steps));
        const row = Math.round(start.row + ((rowDelta * index) / steps));
        const key = `${column},${row}`;
        if (key === previousKey) continue;
        path.push({ column, row });
        previousKey = key;
    }
    return path;
}

function directionBetween(from, to) {
    if (to.column === from.column + 1 && to.row === from.row) return 'east';
    if (to.column === from.column - 1 && to.row === from.row) return 'west';
    if (to.row === from.row + 1 && to.column === from.column) return 'south';
    if (to.row === from.row - 1 && to.column === from.column) return 'north';
    return null;
}

function oppositeDirection(direction) {
    return { north: 'south', east: 'west', south: 'north', west: 'east' }[direction] ?? null;
}

function gridCellAt(point) {
    const offset = canvas.grid.getOffset({ x: point.x, y: point.y });
    const column = Number(offset.j ?? offset.x);
    const row = Number(offset.i ?? offset.y);
    return Number.isInteger(column) && Number.isInteger(row) ? { column, row } : null;
}

/**
 * A canvas point as a fractional grid position, so column 10.5 is the middle of
 * column 10. Recorded geometry is held in these units rather than pixels: they
 * are the same units the rest of the record already speaks, they survive a
 * scene whose grid size changes, and the renderer needs no scale factor to
 * place them.
 *
 * Derived from the containing cell rather than by dividing, so a grid whose
 * origin is offset from the canvas origin still lands correctly.
 */
function gridFractionalPoint(point) {
    const cell = gridCellAt(point);
    if (!cell) return null;
    const sizeX = canvas.grid.sizeX ?? canvas.grid.size;
    const sizeY = canvas.grid.sizeY ?? canvas.grid.size;
    const center = cellCenter(cell);
    return {
        column: cell.column + 0.5 + ((point.x - center.x) / sizeX),
        row: cell.row + 0.5 + ((point.y - center.y) / sizeY)
    };
}

function wallSegment(document) {
    const coordinates = document?.c ?? document?._source?.c;
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

/**
 * The canvas rectangle a set of grid squares covers, grown by a margin.
 *
 * Every sampled step re-examines the scene's walls, and a sample costs a sight
 * raycast, so a wall-heavy scene was paying for its whole wall list at every
 * square the party walked. Nothing outside the detection window can be
 * recorded, so bounding it first is what makes a wider window affordable. The
 * margin keeps connected runs and clustered doorway fragments intact across the
 * edge of the window, where truncating them would change how they snap.
 */
function gridWindowBounds(keys, margin = 0) {
    let minColumn = Infinity;
    let maxColumn = -Infinity;
    let minRow = Infinity;
    let maxRow = -Infinity;
    for (const key of keys) {
        const [column, row] = String(key).split(',').map(Number);
        if (!Number.isInteger(column) || !Number.isInteger(row)) continue;
        minColumn = Math.min(minColumn, column);
        maxColumn = Math.max(maxColumn, column);
        minRow = Math.min(minRow, row);
        maxRow = Math.max(maxRow, row);
    }
    if (!Number.isFinite(minColumn) || !Number.isFinite(minRow)) return null;
    const sizeX = canvas.grid.sizeX ?? canvas.grid.size;
    const sizeY = canvas.grid.sizeY ?? canvas.grid.size;
    const first = cellCenter({ column: minColumn, row: minRow });
    const last = cellCenter({ column: maxColumn, row: maxRow });
    return {
        minX: first.x - (sizeX / 2) - margin,
        maxX: last.x + (sizeX / 2) + margin,
        minY: first.y - (sizeY / 2) - margin,
        maxY: last.y + (sizeY / 2) + margin
    };
}

/** True when a wall's extent overlaps the bounds at all. */
function wallWithinBounds(document, bounds) {
    if (!bounds) return true;
    const coordinates = document?.c ?? document?._source?.c;
    if (!Array.isArray(coordinates) || coordinates.length < 4) return false;
    const [x1, y1, x2, y2] = coordinates.map(Number);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return false;
    return Math.min(x1, x2) <= bounds.maxX
        && Math.max(x1, x2) >= bounds.minX
        && Math.min(y1, y2) <= bounds.maxY
        && Math.max(y1, y2) >= bounds.minY;
}

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
 * Order wall documents into connected runs, each entry flagged with whether it
 * is walked backwards so a run reads as one continuous path.
 *
 * A Foundry curve is authored as a fan of short straight segments that share
 * endpoints. Snapping each document independently is what leaves a curve full
 * of holes: the stair-step connector can only join boundaries it sees in
 * sequence, and a curve's gaps fall on the joins *between* documents. Walking a
 * run as one path puts those joins in sequence.
 *
 * Only documents that actually share an endpoint are joined, so two wall runs
 * with an open archway between them are never chained across the opening.
 */
function connectedWallRuns(documents) {
    const gridSize = Math.min(
        canvas.grid.sizeX ?? canvas.grid.size,
        canvas.grid.sizeY ?? canvas.grid.size
    );
    const tolerance = Math.max(1, gridSize * 0.08);
    const segments = documents.map(wallSegment).filter(Boolean);

    // Bucket endpoints on a tolerance-sized lattice. This runs for every
    // sampled step of a move, so searching for joins by scanning every wall
    // would be quadratic per step on a wall-heavy scene.
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
    // Two points within tolerance can still quantize into neighbouring
    // buckets, so probe the surrounding lattice cells as well.
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
        const run = [{ document: seed.document, reversed: false }];
        let head = seed.start;
        let tail = seed.end;

        for (let extended = true; extended;) {
            extended = false;
            for (const candidate of neighbours(tail)) {
                if (used.has(candidate)) continue;
                if (near(tail, candidate.start)) {
                    run.push({ document: candidate.document, reversed: false });
                    tail = candidate.end;
                } else if (near(tail, candidate.end)) {
                    run.push({ document: candidate.document, reversed: true });
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
                    run.unshift({ document: candidate.document, reversed: false });
                    head = candidate.start;
                } else if (near(head, candidate.start)) {
                    run.unshift({ document: candidate.document, reversed: true });
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

/**
 * Scene authors frequently build one curved or decorative doorway from two
 * short, connected Wall documents. Collapse those fragments to the chain's
 * first/last extent before grid snapping so one doorway yields one glyph.
 */
function normalizedDoorSpans(documents) {
    const segments = documents.map(wallSegment).filter(Boolean).map(segment => ({
        ...segment,
        cell: gridCellAt(segment.midpoint)
    }));
    const gridSize = Math.min(
        canvas.grid.sizeX ?? canvas.grid.size,
        canvas.grid.sizeY ?? canvas.grid.size
    );
    const joinDistance = gridSize * 0.75;
    const maxSpan = gridSize * 2.6;
    const clusters = [];

    for (const segment of segments) {
        const cluster = clusters.find(candidate => {
            // Fragments must at least roughly share a heading before they can
            // be treated as one opening. Without this, two openings meeting at
            // a corner -- one on each face of the same square -- were fused,
            // and the normalized span then ran diagonally through open space
            // instead of along either wall.
            const aligned = candidate.some(existing => (
                Math.abs((existing.unit.x * segment.unit.x) + (existing.unit.y * segment.unit.y)) >= 0.7
            ));
            if (!aligned) return false;

            // A doorway is frequently authored from several short fragments
            // inside one Foundry square. Those fragments may turn slightly at
            // a curve or decorative jamb, so proximity alone is not a useful
            // test. Treat the square as the doorway's footprint and normalize
            // its first/last extrema to one span.
            const sharesDoorCell = segment.cell && candidate.some(existing => (
                existing.cell
                && existing.cell.column === segment.cell.column
                && existing.cell.row === segment.cell.row
            ));
            if (sharesDoorCell) {
                return farthestEndpointPair([...candidate, segment]).distance <= maxSpan;
            }
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

    return clusters.map(cluster => {
        const { pair } = farthestEndpointPair(cluster);
        return {
            document: { c: [pair[0].x, pair[0].y, pair[1].x, pair[1].y] },
            members: cluster
        };
    });
}

/**
 * Return the two cells which share the nearest grid boundary for a sampled
 * wall point. The boundary is derived from scene geometry, not the observer's
 * side, so seeing the same structure from another direction cannot move it to
 * a different map edge.
 */
/**
 * True when a wall runs diagonally enough that snapping it to a single grid
 * boundary per square would leave the stair steps open. A ratio of 0.4 is
 * roughly 22 degrees off the axis; anything flatter reads as a straight wall
 * and keeps the original one-edge-per-square treatment.
 */
function isDiagonalWall(wallDx, wallDy) {
    const longer = Math.max(Math.abs(wallDx), Math.abs(wallDy));
    if (!longer) return false;
    return (Math.min(Math.abs(wallDx), Math.abs(wallDy)) / longer) >= DIAGONAL_WALL_RATIO;
}

/**
 * The two lattice corners a cell boundary runs between. Working in corner
 * coordinates lets steps be joined by geometry rather than by enumerating
 * every direction pairing.
 */
function edgeNodes({ column, row }, direction) {
    return {
        north: [[column, row], [column + 1, row]],
        south: [[column, row + 1], [column + 1, row + 1]],
        west: [[column, row], [column, row + 1]],
        east: [[column + 1, row], [column + 1, row + 1]]
    }[direction] ?? null;
}

/**
 * The boundary that closes the gap between two stair treads, or null when they
 * already meet or sit too far apart to join. Only ever spans a single cell
 * boundary, so this can close a step but cannot invent a wall run.
 */
function connectingBoundary(fromNodes, toNodes) {
    let best = null;
    for (const from of fromNodes) {
        for (const to of toNodes) {
            const distance = Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1]);
            if (!distance) return null;
            if (distance === 1 && !best) best = [from, to];
        }
    }
    if (!best) return null;
    const [[fromX, fromY], [toX, toY]] = best;
    // A horizontal join is the north boundary of the cell below it; a vertical
    // join is the west boundary of the cell to its right.
    return fromY === toY
        ? { column: Math.min(fromX, toX), row: fromY, direction: 'north' }
        : { column: fromX, row: Math.min(fromY, toY), direction: 'west' };
}

/**
 * Restate a cell boundary in its canonical form.
 *
 * A boundary between two squares can be written two ways -- south of the upper
 * square, or north of the lower one -- and they mean the same line. Which one
 * got written used to depend on which side the observer happened to be
 * standing, so the same corridor produced different records depending on the
 * direction it was walked. Storing one canonical form (always north or west)
 * makes the record a function of the geometry alone. The renderer decides
 * which adjacent square actually draws it.
 */
function canonicalBoundary({ column, row, direction }) {
    if (direction === 'south') return { column, row: row + 1, direction: 'north' };
    if (direction === 'east') return { column: column + 1, row, direction: 'west' };
    return { column, row, direction };
}

function boundaryCandidates(wallPoint, wallDx, wallDy) {
    const cell = gridCellAt(wallPoint);
    if (!cell) return [];
    const center = cellCenter(cell);

    if (Math.abs(wallDx) >= Math.abs(wallDy)) {
        const direction = wallPoint.y < center.y ? 'north' : 'south';
        const neighbor = direction === 'north'
            ? { column: cell.column, row: cell.row - 1, direction: 'south' }
            : { column: cell.column, row: cell.row + 1, direction: 'north' };
        return [{ ...cell, direction }, neighbor];
    }

    const direction = wallPoint.x < center.x ? 'west' : 'east';
    const neighbor = direction === 'west'
        ? { column: cell.column - 1, row: cell.row, direction: 'east' }
        : { column: cell.column + 1, row: cell.row, direction: 'west' };
    return [{ ...cell, direction }, neighbor];
}

/**
 * Which grid boundaries a spanning opening really occupies, or null when the
 * feature is not one that spans.
 *
 * An opening is drawn as wide as the squares it marks, so the question is not
 * "does any part of this doorway touch that boundary" but "does enough of it".
 * A boundary carrying less than a bit over half a square of the opening is
 * overspill from an off-grid author, and marking it is what turns one doorway
 * into a double one.
 */
function spanningEdgeCoverage(feature, samples, { wallDx, wallDy, length, gridSize, sampleCount, edgeKeyFor }) {
    if (!SPANNING_GLYPH_FEATURES.includes(feature) || sampleCount < 2 || !length) return null;
    const tally = new Map();
    for (const point of samples) {
        const [candidate] = boundaryCandidates(point, wallDx, wallDy);
        if (!candidate) continue;
        const edgeKey = edgeKeyFor(candidate, candidate.direction);
        if (edgeKey) tally.set(edgeKey, (tally.get(edgeKey) ?? 0) + 1);
    }
    if (!tally.size) return null;
    // Samples are evenly spaced, so a boundary's share of them is its share of
    // the opening's length.
    const minimumSamples = (sampleCount * gridSize * 0.6) / length;
    const occupied = new Set(
        [...tally].filter(([, count]) => count >= minimumSamples).map(([edgeKey]) => edgeKey)
    );
    if (occupied.size) return occupied;
    let best = null;
    for (const [edgeKey, count] of tally) {
        if (!best || count > best[1]) best = [edgeKey, count];
    }
    return new Set([best[0]]);
}

/**
 * Snap a visible Foundry wall segment to stable old-school grid boundaries.
 * Curved walls are sampled into stair steps. Doors deliberately use only their
 * midpoint because the official symbol represents a doorway, not every
 * quarter-grid sample of its wall document.
 */
function wallBoundaryObservations(
    document,
    tokenDocument,
    allowed,
    {
        featureOverride = null,
        requireVisibility = true,
        midpointOnly = false,
        reversed = false,
        carry = null,
        collectGeometry = false
    } = {}
) {
    const empty = { observations: [], segments: [] };
    const feature = featureOverride ?? classifyWall(document);
    if (!feature || !canvas?.grid) return empty;
    const coordinates = document?.c ?? document?._source?.c;
    if (!Array.isArray(coordinates) || coordinates.length < 4) return empty;
    const [x1, y1, x2, y2] = coordinates.map(Number);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return empty;
    const wallDx = x2 - x1;
    const wallDy = y2 - y1;
    const length = Math.hypot(wallDx, wallDy);
    if (!length) return empty;

    const origin = tokenCenter(tokenDocument);
    const gridSize = Math.min(
        canvas.grid.sizeX ?? canvas.grid.size,
        canvas.grid.sizeY ?? canvas.grid.size
    );
    const sampleCount = midpointOnly
        || (GLYPH_FEATURES.includes(feature) && !SPANNING_GLYPH_FEATURES.includes(feature))
        ? 1
        : Math.max(1, Math.ceil(length / (gridSize * 0.25)));
    const observations = [];
    const seen = new Set();
    const diagonal = isDiagonalWall(wallDx, wallDy);
    // Carried across a connected run so the stair-step connector can close the
    // joins between documents, not just the steps within one.
    let previousNodes = carry?.nodes ?? null;

    // Sampled in travel order: a run may walk a document against its own stored
    // direction, and consecutive samples have to stay geometrically adjacent
    // for the stair-step connector to work.
    const samples = [];
    for (let index = 0; index < sampleCount; index++) {
        const step = (index + 0.5) / sampleCount;
        const amount = reversed ? 1 - step : step;
        samples.push({ x: x1 + (wallDx * amount), y: y1 + (wallDy * amount) });
    }

    const edgeKeyFor = (cell, direction) => {
        const canonical = canonicalBoundary({ ...cell, direction });
        return featureEdgeKey(
            `${canonical.column},${canonical.row}`,
            `${feature}:${canonical.direction}`
        );
    };

    // A spanning opening marks every square it crosses. A one-square doorway
    // authored across a square boundary therefore used to be recorded at twice
    // its real width and drawn as a double door. Weigh each boundary by how
    // much of the opening actually lies on it and keep only the ones it
    // genuinely occupies, with the best-covered boundary always surviving so a
    // narrow opening still records somewhere.
    //
    // Measured from the wall geometry alone, never from what happens to be
    // visible, so an opening seen again from a new angle snaps to the same
    // width rather than growing or shrinking with the sightline.
    const occupied = spanningEdgeCoverage(feature, samples, {
        wallDx,
        wallDy,
        length,
        gridSize,
        sampleCount,
        edgeKeyFor
    });

    const record = (cell, direction) => {
        // The square the party had to see is the one that was chosen; the
        // boundary is then stored canonically, which may name its neighbour.
        if (!allowed.has(`${cell.column},${cell.row}`)) return false;
        const canonical = canonicalBoundary({ ...cell, direction });
        const key = `${canonical.column},${canonical.row}`;
        const observationKey = `${key}:${feature}:${canonical.direction}`;
        if (seen.has(observationKey)) return true;
        seen.add(observationKey);
        observations.push({ key, code: `${feature}:${canonical.direction}` });
        return true;
    };

    // Which samples were actually taken into the record. A Foundry wall
    // document is a straight segment, so a contiguous stretch of accepted
    // samples is itself a straight segment and is described exactly by its two
    // ends -- no simplification, and nothing lost. A curve is authored as a fan
    // of such documents, so it comes out as the chain of chords that drew it.
    const accepted = [];

    for (const [sampleIndex, wallPoint] of samples.entries()) {
        // Which squares this sample could be recorded against is a set lookup;
        // whether it can be seen is a raycast. Ask the cheap question first, so
        // a wider detection window does not pay for sightlines to boundaries it
        // was never going to record. A wall is culled to the window plus a
        // margin, and the margin is where most of these land.
        const candidates = boundaryCandidates(wallPoint, wallDx, wallDy)
            .filter(candidate => allowed.has(`${candidate.column},${candidate.row}`));
        if (!candidates.length) continue;
        candidates.sort((left, right) => {
            const leftCenter = cellCenter(left);
            const rightCenter = cellCenter(right);
            return Math.hypot(leftCenter.x - origin.x, leftCenter.y - origin.y)
                - Math.hypot(rightCenter.x - origin.x, rightCenter.y - origin.y);
        });
        const cell = candidates[0];
        if (occupied && !occupied.has(edgeKeyFor(cell, cell.direction))) continue;
        if (requireVisibility && !visibleFromToken(tokenDocument, wallPoint)) continue;
        const nodes = edgeNodes(cell, cell.direction);
        // A diagonal wall snapped to one boundary per square gives a tread with
        // no riser, so consecutive steps never join up. Where this sample's
        // boundary lands one cell away from the previous one, add the boundary
        // that closes the corner between them.
        if (diagonal && previousNodes && nodes) {
            const connector = connectingBoundary(previousNodes, nodes);
            if (connector) record(connector, connector.direction);
        }
        record(cell, cell.direction);
        accepted.push(sampleIndex);
        if (nodes) previousNodes = nodes;
    }
    if (carry) carry.nodes = previousNodes;

    const segments = [];
    if (collectGeometry && accepted.length) {
        // A sample stands for the slice of wall around it, so a run covers its
        // slices end to end rather than stopping at the outermost midpoints.
        // Measuring midpoint to midpoint would leave every stretch an eighth of
        // a square short at each end: a nick at the frontier of what has been
        // seen, and -- worse -- a gap too wide for the merge to close, so a wall
        // discovered in two passes would never join into one line.
        //
        // It also means a run that reaches the first or last slice reaches the
        // wall's own end, which is what makes corners meet.
        const from = reversed ? { x: x2, y: y2 } : { x: x1, y: y1 };
        const to = reversed ? { x: x1, y: y1 } : { x: x2, y: y2 };
        const pointAt = amount => gridFractionalPoint({
            x: from.x + ((to.x - from.x) * amount),
            y: from.y + ((to.y - from.y) * amount)
        });
        const flush = (first, last) => {
            const start = pointAt(first / sampleCount);
            const end = pointAt((last + 1) / sampleCount);
            if (start && end) segments.push([[start.column, start.row], [end.column, end.row]]);
        };
        let runStart = accepted[0];
        let previous = accepted[0];
        for (const index of accepted.slice(1)) {
            if (index !== previous + 1) {
                flush(runStart, previous);
                runStart = index;
            }
            previous = index;
        }
        flush(runStart, previous);
    }
    return { observations, segments };
}

function segmentOrientation(a, b, c) {
    return ((b.y - a.y) * (c.x - b.x)) - ((b.x - a.x) * (c.y - b.y));
}

function pointOnSegment(a, b, point, epsilon = 0.001) {
    return point.x <= Math.max(a.x, b.x) + epsilon
        && point.x >= Math.min(a.x, b.x) - epsilon
        && point.y <= Math.max(a.y, b.y) + epsilon
        && point.y >= Math.min(a.y, b.y) - epsilon;
}

function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
    const epsilon = 0.001;
    const o1 = segmentOrientation(firstStart, firstEnd, secondStart);
    const o2 = segmentOrientation(firstStart, firstEnd, secondEnd);
    const o3 = segmentOrientation(secondStart, secondEnd, firstStart);
    const o4 = segmentOrientation(secondStart, secondEnd, firstEnd);
    if (((o1 > epsilon && o2 < -epsilon) || (o1 < -epsilon && o2 > epsilon))
        && ((o3 > epsilon && o4 < -epsilon) || (o3 < -epsilon && o4 > epsilon))) return true;
    if (Math.abs(o1) <= epsilon && pointOnSegment(firstStart, firstEnd, secondStart)) return true;
    if (Math.abs(o2) <= epsilon && pointOnSegment(firstStart, firstEnd, secondEnd)) return true;
    if (Math.abs(o3) <= epsilon && pointOnSegment(secondStart, secondEnd, firstStart)) return true;
    if (Math.abs(o4) <= epsilon && pointOnSegment(secondStart, secondEnd, firstEnd)) return true;
    return false;
}

/**
 * A secret door remains ordinary wall linework until the tracked token's
 * center actually crosses its Foundry wall segment. Crossing promotes that
 * stable edge to the old-school secret-door symbol permanently.
 */
function observeCrossedSecretDoors(tokenDocument, fromCoordinates, toCoordinates, exploredKeys) {
    if (!fromCoordinates || !toCoordinates || !canvas?.walls) return { features: {}, sources: {} };
    const tokenShape = {
        id: tokenDocument.id,
        width: Number(tokenDocument.width) || 1,
        height: Number(tokenDocument.height) || 1
    };
    const fromToken = { ...tokenShape, x: fromCoordinates.x, y: fromCoordinates.y };
    const toToken = { ...tokenShape, x: toCoordinates.x, y: toCoordinates.y };
    const movementStart = tokenCenter(fromToken);
    const movementEnd = tokenCenter(toToken);
    if (movementStart.x === movementEnd.x && movementStart.y === movementEnd.y) {
        return { features: {}, sources: {} };
    }

    const allowed = exploredKeys instanceof Set ? exploredKeys : new Set(exploredKeys ?? []);
    const observed = {};
    const sources = {};
    // Only a secret door the move could physically have crossed is worth
    // testing, so the leg's own extent bounds the search. The margin is wider
    // than a doorway cluster can span, so no cluster is ever split by the cull
    // -- a split one would be attributed to a different source id and the
    // record would carry the same doorway twice.
    const gridSize = Math.min(
        canvas.grid.sizeX ?? canvas.grid.size,
        canvas.grid.sizeY ?? canvas.grid.size
    );
    const legBounds = {
        minX: Math.min(movementStart.x, movementEnd.x) - (gridSize * 3),
        maxX: Math.max(movementStart.x, movementEnd.x) + (gridSize * 3),
        minY: Math.min(movementStart.y, movementEnd.y) - (gridSize * 3),
        maxY: Math.max(movementStart.y, movementEnd.y) + (gridSize * 3)
    };
    const secretDocuments = (canvas.walls.placeables ?? [])
        .map(wall => wall.document)
        .filter(document => isSecretDoor(document) && wallWithinBounds(document, legBounds));
    for (const span of normalizedDoorSpans(secretDocuments)) {
        const crossed = span.members.some(member => segmentsIntersect(
            movementStart,
            movementEnd,
            member.start,
            member.end
        ));
        if (!crossed) continue;
        const sourceId = `door:${span.members.map(member => member.document.id).sort().join('|')}`;

        for (const observation of wallBoundaryObservations(
            span.document,
            toToken,
            allowed,
            { featureOverride: 'secret-door', requireVisibility: false }
        ).observations) {
            observed[observation.key] ??= [];
            if (!observed[observation.key].includes(observation.code)) {
                observed[observation.key].push(observation.code);
            }
            sources[sourceId] ??= {};
            sources[sourceId][observation.key] ??= [];
            if (!sources[sourceId][observation.key].includes(observation.code)) {
                sources[sourceId][observation.key].push(observation.code);
            }
        }
    }
    return { features: observed, sources };
}

function cellCenter(cell) {
    if (typeof canvas.grid.getCenterPoint === 'function') {
        const center = canvas.grid.getCenterPoint({ i: cell.row, j: cell.column });
        if (Number.isFinite(center?.x) && Number.isFinite(center?.y)) return center;
    }
    const sizeX = canvas.grid.sizeX ?? canvas.grid.size;
    const sizeY = canvas.grid.sizeY ?? canvas.grid.size;
    return {
        x: (cell.column + 0.5) * sizeX,
        y: (cell.row + 0.5) * sizeY
    };
}

function tokenCenter(tokenDocument) {
    const sizeX = canvas.grid.sizeX ?? canvas.grid.size;
    const sizeY = canvas.grid.sizeY ?? canvas.grid.size;
    return {
        x: tokenDocument.x + (((tokenDocument.width ?? 1) * sizeX) / 2),
        y: tokenDocument.y + (((tokenDocument.height ?? 1) * sizeY) / 2)
    };
}

function visibleFromToken(tokenDocument, point, { insetTarget = true } = {}) {
    const origin = tokenCenter(tokenDocument);
    const dx = origin.x - point.x;
    const dy = origin.y - point.y;
    const distance = Math.hypot(dx, dy);
    const inset = insetTarget
        ? Math.min(6, Math.max(2, (canvas.grid.size ?? 100) * 0.04))
        : 0;
    const target = distance > 0
        ? { x: point.x + ((dx / distance) * inset), y: point.y + ((dy / distance) * inset) }
        : point;
    const token = canvas.tokens?.get(tokenDocument.id);
    const vision = token?.vision;

    // Use Foundry's sight collision backend rather than the rendered vision
    // polygon. A GM client may not have another user's vision source active,
    // which made valid nearby walls disappear from the recorded map. The
    // target is inset toward the token so the wall being observed is not
    // mistaken for an occluder; any wall before it still blocks discovery.
    const sight = CONFIG.Canvas?.polygonBackends?.sight;
    if (typeof sight?.testCollision === 'function') {
        const collision = sight.testCollision(origin, target, {
            type: 'sight',
            mode: 'any',
            source: vision,
            useThreshold: true,
            priority: vision?.priority
        });
        return !collision;
    }

    // Fall back to an initialized local vision polygon only if the collision
    // backend is unavailable.
    if (typeof vision?.shape?.contains === 'function') return vision.shape.contains(target.x, target.y);
    if (typeof vision?.los?.contains === 'function') return vision.los.contains(target.x, target.y);
    return true;
}

function visibleRevealKeys(tokenDocument, revealKeys) {
    const candidates = revealKeys instanceof Set ? revealKeys : new Set(revealKeys ?? []);
    const visible = new Set();
    const sizeX = canvas.grid.sizeX ?? canvas.grid.size;
    const sizeY = canvas.grid.sizeY ?? canvas.grid.size;
    for (const key of candidates) {
        const [column, row] = key.split(',').map(Number);
        if (!Number.isInteger(column) || !Number.isInteger(row)) continue;
        const center = cellCenter({ column, row });
        if (!visibleFromToken(tokenDocument, center, { insetTarget: false })) continue;

        // A single ray can graze a shared wall endpoint and make a square
        // behind that corner look visible. Confirm that the token can see a
        // small footprint within the square as well. Cardinal samples are
        // intentionally close to center: requiring two keeps narrow corridors
        // mappable while rejecting the one-ray slivers created at wall joins.
        const insetX = sizeX * 0.18;
        const insetY = sizeY * 0.18;
        const footprint = [
            { x: center.x, y: center.y - insetY },
            { x: center.x + insetX, y: center.y },
            { x: center.x, y: center.y + insetY },
            { x: center.x - insetX, y: center.y }
        ];
        let visibleSamples = 0;
        for (const point of footprint) {
            if (visibleFromToken(tokenDocument, point, { insetTarget: false })) visibleSamples++;
            if (visibleSamples >= 2) break;
        }
        if (visibleSamples >= 2) visible.add(key);
    }
    return visible;
}

function observeVisibleFeatures(tokenDocument, revealKeys) {
    const allowed = revealKeys instanceof Set ? revealKeys : new Set(revealKeys ?? []);
    const observed = {};
    const sources = {};
    const geometry = {};
    // Glyph features cluster only with their own kind, so a locked door beside
    // a plain one -- or a window beside a door -- cannot be collapsed into a
    // single mislabelled symbol.
    const glyphGroups = new Map();
    const secretDocuments = [];
    const structuralDocuments = [];
    const gridSize = Math.min(
        canvas.grid.sizeX ?? canvas.grid.size,
        canvas.grid.sizeY ?? canvas.grid.size
    );
    const bounds = gridWindowBounds(allowed, gridSize * 3);
    for (const wall of canvas.walls?.placeables ?? []) {
        if (!wallWithinBounds(wall.document, bounds)) continue;
        if (isSecretDoor(wall.document)) {
            secretDocuments.push(wall.document);
            continue;
        }
        const feature = classifyWall(wall.document);
        if (GLYPH_FEATURES.includes(feature)) {
            if (!glyphGroups.has(feature)) glyphGroups.set(feature, []);
            glyphGroups.get(feature).push(wall.document);
            continue;
        }
        structuralDocuments.push(wall.document);
    }

    // Walk each connected run as one path so the stair-step connector carries
    // across the joins between documents. Attribution stays per document, so
    // deleting one wall still retracts exactly its own linework.
    for (const run of connectedWallRuns(structuralDocuments)) {
        const carry = {};
        for (const { document, reversed } of run) {
            const result = wallBoundaryObservations(document, tokenDocument, allowed, {
                reversed,
                carry,
                // Only ordinary structure carries true geometry. Doorways and
                // windows are drawn as symbols on an old-school map, not as
                // their real slope, so they stay on the boundary lattice.
                collectGeometry: true
            });
            const sourceId = `wall:${document.id}`;
            for (const observation of result.observations) {
                observed[observation.key] ??= [];
                if (!observed[observation.key].includes(observation.code)) {
                    observed[observation.key].push(observation.code);
                }
                sources[sourceId] ??= {};
                sources[sourceId][observation.key] ??= [];
                if (!sources[sourceId][observation.key].includes(observation.code)) {
                    sources[sourceId][observation.key].push(observation.code);
                }
            }
            if (result.segments.length) {
                geometry[sourceId] = mergeSourceGeometry(geometry[sourceId], result.segments);
            }
        }
    }
    for (const [feature, documents] of glyphGroups) {
        for (const span of normalizedDoorSpans(documents)) {
            // Door variants keep the "door:" prefix so attribution on records
            // written before variants existed still lines up.
            const prefix = DOOR_FEATURES.includes(feature) ? 'door' : feature;
            const sourceId = `${prefix}:${span.members.map(member => member.document.id).sort().join('|')}`;
            for (const observation of wallBoundaryObservations(
                span.document,
                tokenDocument,
                allowed,
                { featureOverride: feature }
            ).observations) {
                observed[observation.key] ??= [];
                if (!observed[observation.key].includes(observation.code)) {
                    observed[observation.key].push(observation.code);
                }
                sources[sourceId] ??= {};
                sources[sourceId][observation.key] ??= [];
                if (!sources[sourceId][observation.key].includes(observation.code)) {
                    sources[sourceId][observation.key].push(observation.code);
                }
            }
        }
    }
    // Until crossed, a secret door is still drawn as an ordinary wall—but it
    // must use the exact same normalized midpoint span that will later carry
    // the S. This lets discovery replace the wall on one canonical edge rather
    // than leaving sampled wall fragments beside the revealed symbol.
    for (const span of normalizedDoorSpans(secretDocuments)) {
        const sourceId = `door:${span.members.map(member => member.document.id).sort().join('|')}`;
        for (const observation of wallBoundaryObservations(
            span.document,
            tokenDocument,
            allowed,
            { featureOverride: 'wall', midpointOnly: true }
        ).observations) {
            observed[observation.key] ??= [];
            if (!observed[observation.key].includes(observation.code)) {
                observed[observation.key].push(observation.code);
            }
            sources[sourceId] ??= {};
            sources[sourceId][observation.key] ??= [];
            if (!sources[sourceId][observation.key].includes(observation.code)) {
                sources[sourceId][observation.key].push(observation.code);
            }
        }
    }
    return { features: observed, sources, geometry };
}

/**
 * The explored squares reachable from a starting square without crossing a
 * recorded boundary — one room, in other words.
 *
 * Every recorded feature blocks, doorways included: a doorway is where one
 * floor surface stops and the next begins, so a room's flooring should not run
 * out into the corridor it opens onto. This reads only the party's own record,
 * never live scene geometry, so it cannot spread through a wall they have not
 * discovered yet.
 */
function contiguousFloorRegion(exploredKeys, features, start, limit = 4000) {
    const explored = exploredKeys instanceof Set ? exploredKeys : new Set(exploredKeys ?? []);
    const startKey = `${start.column},${start.row}`;
    if (!explored.has(startKey)) return [];

    const blocked = (fromKey, from, to) => {
        const direction = directionBetween(from, to);
        if (!direction) return true;
        const opposite = oppositeDirection(direction);
        const here = features?.[fromKey] ?? [];
        const there = features?.[`${to.column},${to.row}`] ?? [];
        return here.some(code => code.endsWith(`:${direction}`))
            || there.some(code => code.endsWith(`:${opposite}`));
    };

    const region = [startKey];
    const seen = new Set([startKey]);
    const queue = [start];
    while (queue.length && region.length < limit) {
        const current = queue.shift();
        const currentKey = `${current.column},${current.row}`;
        for (const [columnOffset, rowOffset] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
            const next = { column: current.column + columnOffset, row: current.row + rowOffset };
            const nextKey = `${next.column},${next.row}`;
            if (seen.has(nextKey) || !explored.has(nextKey)) continue;
            if (blocked(currentKey, current, next)) continue;
            seen.add(nextKey);
            region.push(nextKey);
            queue.push(next);
        }
    }
    return region;
}

/**
 * Extend a floor surface into squares that have just joined its area.
 *
 * Choosing a surface names the area, not the squares that happened to be
 * mapped at the time. When exploration later fills in more of the same room,
 * those squares adopt the surface already chosen for it, so a partly-mapped
 * room does not end up half wood and half blank. It spreads only through
 * openings the party has recorded, which is what stops it running out of a
 * doorway: the next room is a new area and stays default until it is named.
 */
function propagateFloors(exploredKeys, features, floors, addedKeys) {
    const explored = exploredKeys instanceof Set ? exploredKeys : new Set(exploredKeys ?? []);
    const next = { ...(floors ?? {}) };
    const pending = [...new Set(addedKeys ?? [])].filter(key => explored.has(key) && !next[key]);
    if (!pending.length) return next;

    const blocked = (fromKey, from, to) => {
        const direction = directionBetween(from, to);
        if (!direction) return true;
        const opposite = oppositeDirection(direction);
        const here = features?.[fromKey] ?? [];
        const there = features?.[`${to.column},${to.row}`] ?? [];
        return here.some(code => code.endsWith(`:${direction}`))
            || there.some(code => code.endsWith(`:${opposite}`));
    };

    // Repeat until nothing more adopts a surface: a run of new squares has to
    // inherit inward from whichever end touches the already-named area.
    let changed = true;
    while (changed) {
        changed = false;
        for (const key of pending) {
            if (next[key]) continue;
            const [column, row] = key.split(',').map(Number);
            const cell = { column, row };
            for (const [columnOffset, rowOffset] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
                const neighbour = { column: column + columnOffset, row: row + rowOffset };
                const neighbourKey = `${neighbour.column},${neighbour.row}`;
                if (!next[neighbourKey] || !explored.has(neighbourKey)) continue;
                if (blocked(key, cell, neighbour)) continue;
                next[key] = next[neighbourKey];
                changed = true;
                break;
            }
        }
    }
    return next;
}

function normalizeFeatures(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const normalized = {};
    for (const [key, codes] of Object.entries(raw)) {
        if (!/^-?\d+,-?\d+$/.test(key) || !Array.isArray(codes)) continue;
        const valid = [...new Set(codes.filter(code => {
            if (typeof code !== 'string') return false;
            const [feature, direction] = code.split(':');
            return EDGE_FEATURES.includes(feature) && DIRECTIONS.includes(direction);
        }))];
        if (valid.length) normalized[key] = valid;
    }
    return normalized;
}

function normalizeFeatureSources(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const normalized = {};
    for (const [sourceId, features] of Object.entries(raw)) {
        if (typeof sourceId !== 'string' || !FEATURE_SOURCE_PATTERN.test(sourceId)) continue;
        const sourceFeatures = normalizeFeatures(features);
        if (Object.keys(sourceFeatures).length) normalized[sourceId] = sourceFeatures;
    }
    return normalized;
}

function featureEdgeKey(key, code) {
    const [column, row] = key.split(',').map(Number);
    const [, direction] = code.split(':');
    if (!Number.isInteger(column) || !Number.isInteger(row)) return null;
    return {
        north: `h:${column}:${row}`,
        south: `h:${column}:${row + 1}`,
        west: `v:${column}:${row}`,
        east: `v:${column + 1}:${row}`
    }[direction] ?? null;
}

function parsedFeatureEdge(key, code) {
    const edgeKey = featureEdgeKey(key, code);
    if (!edgeKey) return null;
    const [orientation, first, second] = edgeKey.split(':');
    const firstCoordinate = Number(first);
    const secondCoordinate = Number(second);
    if (!['h', 'v'].includes(orientation)
        || !Number.isInteger(firstCoordinate)
        || !Number.isInteger(secondCoordinate)) {
        return null;
    }
    return {
        key: edgeKey,
        orientation,
        // Vertical opposing edges move between columns; horizontal opposing
        // edges move between rows. The span coordinate runs along the edge.
        coordinate: orientation === 'v' ? firstCoordinate : secondCoordinate,
        span: orientation === 'v' ? secondCoordinate : firstCoordinate
    };
}

function isOpposingEdge(first, second) {
    return first.orientation === second.orientation
        && first.span === second.span
        && Math.abs(first.coordinate - second.coordinate) === 1;
}

/** The feature name from a persisted "feature:direction" code. */
function featureOfCode(code) {
    return String(code ?? '').split(':')[0];
}

/** True for any doorway family member, including the locked variant. */
function isDoorwayCode(code) {
    const feature = featureOfCode(code);
    return DOOR_FEATURES.includes(feature) || feature === 'secret-door';
}

/** True only for a discovered secret door. */
function isSecretDoorCode(code) {
    return featureOfCode(code) === 'secret-door';
}

// ==================================================================
// ===== TRUE WALL GEOMETRY =========================================
// ==================================================================
//
// The boundary lattice above answers what the map has to *reason* about --
// which squares a room joins, where a doorway sits, what blocks movement. It
// cannot answer what a wall *looks* like, because it only ever knows which of
// four sides of a square a wall was nearest to, and a wall at 30 degrees is
// near all of them in turn.
//
// So alongside it, and attributed to the same wall sources, the mapper keeps
// the line itself. Nothing new is sampled for this: the snapping pass already
// walks each wall at quarter-square intervals and already knows which of those
// samples the party could see. It simply used to throw the positions away.
//
// A Foundry wall document is a straight segment, so a run of consecutive seen
// samples is exactly described by its two ends. Curves are authored as fans of
// short straight documents, so they arrive as the chain of chords that drew
// them -- angled walls and round walls are the same thing, stored at full
// fidelity, in four numbers per seen stretch.

/** A hundredth of a square: finer than a foot on a five-foot grid. */
function roundCoordinate(value) {
    return Math.round(value * 100) / 100;
}

/** How far off a wall's line stored linework may sit and still be the same wall. */
const GEOMETRY_COLLINEAR_TOLERANCE = 0.15;
/** How wide a gap between two stretches of the same wall is closed up. */
const GEOMETRY_JOIN_TOLERANCE = 0.02;

function normalizeFeatureGeometry(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const normalized = {};
    for (const [sourceId, segments] of Object.entries(raw)) {
        if (typeof sourceId !== 'string' || !FEATURE_SOURCE_PATTERN.test(sourceId)) continue;
        if (!Array.isArray(segments)) continue;
        const valid = [];
        for (const segment of segments) {
            if (!Array.isArray(segment) || segment.length !== 2) continue;
            const points = segment.map(point => (Array.isArray(point) ? point.map(Number) : null));
            if (points.some(point => point?.length !== 2 || !point.every(Number.isFinite))) continue;
            const [[ax, ay], [bx, by]] = points;
            if (ax === bx && ay === by) continue;
            valid.push([
                [roundCoordinate(ax), roundCoordinate(ay)],
                [roundCoordinate(bx), roundCoordinate(by)]
            ]);
        }
        if (valid.length) normalized[sourceId] = valid;
    }
    return normalized;
}

/** A frame for measuring along and away from a segment's line. */
function segmentFrame([[ax, ay], [bx, by]]) {
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (!length) return null;
    const ux = dx / length;
    const uy = dy / length;
    return {
        length,
        origin: [ax, ay],
        along: ([px, py]) => ((px - ax) * ux) + ((py - ay) * uy),
        away: ([px, py]) => Math.abs(((px - ax) * -uy) + ((py - ay) * ux)),
        at: amount => [roundCoordinate(ax + (ux * amount)), roundCoordinate(ay + (uy * amount))]
    };
}

/**
 * Fold newly seen stretches of one wall into what was already recorded of it.
 *
 * Everything here belongs to a single Foundry wall document, so it all lies on
 * one line and the merge collapses to joining intervals along that line. Seeing
 * the far half of a wall you had only seen the near half of yields one stretch,
 * not two, and seeing the same stretch again changes nothing at all.
 *
 * Linework that no longer sits on the line the wall now reports is dropped: a
 * wall has one position at a time, so that is where the GM moved it from.
 */
function mergeSourceGeometry(stored, incoming) {
    if (!incoming?.length) return stored ?? [];
    const frame = segmentFrame(incoming[0]);
    if (!frame) return stored ?? [];

    const intervals = [];
    for (const segment of [...(stored ?? []), ...incoming]) {
        if (segment.some(point => frame.away(point) > GEOMETRY_COLLINEAR_TOLERANCE)) continue;
        const first = frame.along(segment[0]);
        const second = frame.along(segment[1]);
        intervals.push([Math.min(first, second), Math.max(first, second)]);
    }
    if (!intervals.length) return [];

    intervals.sort((left, right) => left[0] - right[0]);
    const merged = [intervals[0]];
    for (const [start, end] of intervals.slice(1)) {
        const last = merged.at(-1);
        if (start <= last[1] + GEOMETRY_JOIN_TOLERANCE) last[1] = Math.max(last[1], end);
        else merged.push([start, end]);
    }
    return merged.map(([start, end]) => [frame.at(start), frame.at(end)]);
}

function mergeFeatureGeometry(left, right) {
    const merged = normalizeFeatureGeometry(left);
    for (const [sourceId, segments] of Object.entries(normalizeFeatureGeometry(right))) {
        const next = mergeSourceGeometry(merged[sourceId], segments);
        if (next.length) merged[sourceId] = next;
        else delete merged[sourceId];
    }
    return merged;
}

/** The two lattice corners a stored boundary runs between, in grid units. */
function edgeEndpoints(edgeKey) {
    const [orientation, first, second] = String(edgeKey).split(':');
    const a = Number(first);
    const b = Number(second);
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    return orientation === 'h' ? [[a, b], [a + 1, b]] : [[a, b], [a, b + 1]];
}

/**
 * Cut out the stretch of a wall that runs along a boundary the party walked
 * through, so the drawn line gains the same gap its boundary record just did.
 *
 * Only walls that lost a boundary here are touched, and such a wall lies along
 * that boundary by construction, so subtracting the boundary's own extent
 * removes exactly the square's worth of line that was disproved -- never a
 * wall that merely happens to meet this one end-on.
 */
function retractGeometryOnBoundaries(geometry, removedBySource) {
    const normalized = normalizeFeatureGeometry(geometry);
    if (!removedBySource?.size) return normalized;
    for (const [sourceId, edgeKeys] of removedBySource) {
        let segments = normalized[sourceId];
        if (!segments?.length) continue;
        for (const edgeKey of edgeKeys) {
            const boundary = edgeEndpoints(edgeKey);
            if (!boundary) continue;
            const remaining = [];
            for (const segment of segments) {
                const frame = segmentFrame(segment);
                if (!frame || boundary.some(point => frame.away(point) > GEOMETRY_COLLINEAR_TOLERANCE)) {
                    remaining.push(segment);
                    continue;
                }
                const first = frame.along(boundary[0]);
                const second = frame.along(boundary[1]);
                const cutStart = Math.min(first, second);
                const cutEnd = Math.max(first, second);
                if (cutEnd <= 0 || cutStart >= frame.length) {
                    remaining.push(segment);
                    continue;
                }
                if (cutStart > GEOMETRY_JOIN_TOLERANCE) remaining.push([frame.at(0), frame.at(cutStart)]);
                if (cutEnd < frame.length - GEOMETRY_JOIN_TOLERANCE) {
                    remaining.push([frame.at(cutEnd), frame.at(frame.length)]);
                }
            }
            segments = remaining;
        }
        if (segments.length) normalized[sourceId] = segments;
        else delete normalized[sourceId];
    }
    return normalized;
}

/**
 * Drop the drawn line for any wall the boundary record no longer carries.
 *
 * The lattice stays the authority on what the party knows. Geometry is how that
 * knowledge is drawn, so a source retracted from the lattice must not keep a
 * line on the map.
 */
function pruneFeatureGeometry(geometry, sources) {
    const normalized = normalizeFeatureGeometry(geometry);
    const known = normalizeFeatureSources(sources);
    for (const sourceId of Object.keys(normalized)) {
        if (!known[sourceId]) delete normalized[sourceId];
    }
    return normalized;
}

/** The two squares a lattice edge separates. */
function edgeFlankingKeys(edgeKey) {
    const [orientation, first, second] = String(edgeKey).split(':');
    const a = Number(first);
    const b = Number(second);
    if (!Number.isInteger(a) || !Number.isInteger(b)) return [];
    return orientation === 'h' ? [`${a},${b}`, `${a},${b - 1}`] : [`${a},${b}`, `${a - 1},${b}`];
}

/**
 * Drop the codes a set of lattice edges carries, keeping everything else.
 * `retractable` decides which feature names may be forgotten, so evidence that
 * disproves solid structure cannot also erase a doorway.
 */
function withoutEdges(rawFeatures, edgeKeys, retractable) {
    const remaining = {};
    let removed = 0;
    for (const [key, codes] of Object.entries(normalizeFeatures(rawFeatures))) {
        const retained = codes.filter(code => {
            const edgeKey = featureEdgeKey(key, code);
            if (!edgeKey || !edgeKeys.has(edgeKey)) return true;
            if (!retractable(featureOfCode(code))) return true;
            removed++;
            return false;
        });
        if (retained.length) remaining[key] = retained;
    }
    return { features: remaining, removed };
}

/** The lattice edge between two orthogonally adjacent squares, or null. */
function boundaryEdgeKey(from, to) {
    const direction = directionBetween(from, to);
    if (!direction) return null;
    return featureEdgeKey(`${from.column},${from.row}`, `wall:${direction}`);
}

/**
 * Forget solid structure on boundaries the party physically walked through.
 *
 * This is the strongest evidence the mapper ever gets, and it was previously
 * spent only on secret doors. A token that steps from one square to the next
 * has proved that nothing solid stands between them, so a wall or window
 * recorded there was a mis-snap and must go rather than sit across the corridor
 * the party just walked down.
 *
 * A boundary any doorway source has claimed is left alone. Doors are walked
 * through by design, and an undiscovered secret door is still held as ordinary
 * wall linework -- forgetting it would quietly delete the only mark showing
 * where the party crossed.
 */
function retractCrossedBoundaries(features, sources, path) {
    const crossed = new Set();
    for (let index = 1; index < (path?.length ?? 0); index++) {
        const edgeKey = boundaryEdgeKey(path[index - 1], path[index]);
        if (edgeKey) crossed.add(edgeKey);
    }
    const normalizedSources = normalizeFeatureSources(sources);
    const unchanged = {
        features: normalizeFeatures(features),
        sources: normalizedSources,
        removedBySource: new Map(),
        removed: 0
    };
    if (!crossed.size) return unchanged;

    for (const [sourceId, sourceFeatures] of Object.entries(normalizedSources)) {
        if (!sourceId.startsWith('door:')) continue;
        for (const [key, codes] of Object.entries(sourceFeatures)) {
            for (const code of codes) crossed.delete(featureEdgeKey(key, code));
        }
    }
    if (!crossed.size) return unchanged;

    const solid = feature => feature === 'wall' || feature === 'window';
    const nextSources = {};
    // Which wall lost which boundary, so the drawn line can be cut to match.
    const removedBySource = new Map();
    for (const [sourceId, sourceFeatures] of Object.entries(normalizedSources)) {
        const lost = new Set();
        for (const [key, codes] of Object.entries(sourceFeatures)) {
            for (const code of codes) {
                const edgeKey = featureEdgeKey(key, code);
                if (edgeKey && crossed.has(edgeKey) && solid(featureOfCode(code))) lost.add(edgeKey);
            }
        }
        if (lost.size) removedBySource.set(sourceId, lost);
        const kept = withoutEdges(sourceFeatures, crossed, solid).features;
        if (Object.keys(kept).length) nextSources[sourceId] = kept;
    }
    const flattened = withoutEdges(features, crossed, solid);
    return {
        features: flattened.features,
        sources: nextSources,
        removedBySource,
        removed: flattened.removed
    };
}

/**
 * Forget geometry a wall no longer puts where the record says it is.
 *
 * A wall is re-read from scratch at every square the party crosses, but until
 * now a stale boundary could only ever be replaced by an observation landing on
 * that exact edge, or on the one parallel boundary beside it. Anything further
 * out -- a doorway that snapped a square along, linework left by a wall the GM
 * has since moved -- stayed on the map for good.
 *
 * So when a wall reports in again, its older boundaries are re-tested. One that
 * sits between two squares the party has just had a clear view of, and which
 * that wall no longer claims, is wrong: they are looking straight at it and it
 * is not there. Boundaries beyond the detection window are untouched, because
 * not seeing something you cannot see is not evidence.
 *
 * Only sources observed on this pass are re-tested, so a wall that has merely
 * gone out of view keeps everything it ever contributed.
 */
function retractStaleSourceEdges(sources, observedSources, observableKeys) {
    const stored = normalizeFeatureSources(sources);
    const observed = normalizeFeatureSources(observedSources);
    const observable = observableKeys instanceof Set ? observableKeys : new Set(observableKeys ?? []);
    const next = {};
    // Which wall lost which boundary, so its drawn line can be cut to match.
    // The two layers describe the same wall and must never disagree about
    // where it is.
    const removedBySource = new Map();
    let removed = 0;

    for (const [sourceId, sourceFeatures] of Object.entries(stored)) {
        const fresh = observed[sourceId];
        if (!fresh) {
            next[sourceId] = sourceFeatures;
            continue;
        }
        const freshEdges = new Set();
        for (const [key, codes] of Object.entries(fresh)) {
            for (const code of codes) {
                const edgeKey = featureEdgeKey(key, code);
                if (edgeKey) freshEdges.add(edgeKey);
            }
        }
        const stale = new Set();
        for (const [key, codes] of Object.entries(sourceFeatures)) {
            for (const code of codes) {
                const edgeKey = featureEdgeKey(key, code);
                if (!edgeKey || freshEdges.has(edgeKey)) continue;
                // Both squares the boundary separates had to be in view. An
                // edge with one side beyond the frontier could simply be
                // occluded, and dropping it would flicker the map's outline.
                if (!edgeFlankingKeys(edgeKey).every(flank => observable.has(flank))) continue;
                stale.add(edgeKey);
            }
        }
        if (!stale.size) {
            next[sourceId] = sourceFeatures;
            continue;
        }
        removedBySource.set(sourceId, stale);
        const result = withoutEdges(sourceFeatures, stale, () => true);
        removed += result.removed;
        if (Object.keys(result.features).length) next[sourceId] = result.features;
    }
    return { sources: next, removedBySource, removed };
}

function mergeFeatures(left, right) {
    const merged = normalizeFeatures(left);
    const incoming = normalizeFeatures(right);
    const observedEdges = new Set();
    const incomingDoorEdges = [];
    for (const [key, codes] of Object.entries(incoming)) {
        for (const code of codes) {
            const edgeKey = featureEdgeKey(key, code);
            if (edgeKey) observedEdges.add(edgeKey);
            if (isDoorwayCode(code)) {
                const edge = parsedFeatureEdge(key, code);
                if (edge) incomingDoorEdges.push(edge);
            }
        }
    }

    // An edge that has been seen again is current information. Replace its
    // former wall/window/door classification instead of accumulating stale
    // classifications forever.
    const incomingSecretEdges = new Set();
    for (const [key, codes] of Object.entries(incoming)) {
        for (const code of codes) {
            if (!isSecretDoorCode(code)) continue;
            const edgeKey = featureEdgeKey(key, code);
            if (edgeKey) incomingSecretEdges.add(edgeKey);
        }
    }
    for (const [key, codes] of Object.entries(merged)) {
        const retained = codes.filter(code => {
            const edgeKey = featureEdgeKey(key, code);
            if (!observedEdges.has(edgeKey)) return true;
            // Discovering a secret door is permanent map knowledge. A later
            // ordinary wall observation must not conceal it again.
            return isSecretDoorCode(code) && !incomingSecretEdges.has(edgeKey);
        });
        if (retained.length) merged[key] = retained;
        else delete merged[key];
    }

    // Earlier mapper builds could snap the fragments of one doorway to the
    // two opposing, parallel edges of a single square. Once the normalized
    // doorway is observed again, discard that stale opposing door edge. A
    // revealed secret door also replaces an old ordinary-wall observation on
    // the opposing edge, while collinear corridor walls remain untouched.
    if (incomingDoorEdges.length) {
        const incomingDoorKeys = new Set(incomingDoorEdges.map(edge => edge.key));
        const incomingSecretDoorEdges = incomingDoorEdges
            .filter(edge => incomingSecretEdges.has(edge.key));
        for (const [key, codes] of Object.entries(merged)) {
            const retained = codes.filter(code => {
                const isDoor = isDoorwayCode(code);
                const isWallBesideRevealedSecret = featureOfCode(code) === 'wall'
                    && incomingSecretDoorEdges.length > 0;
                if (!isDoor && !isWallBesideRevealedSecret) return true;
                const edge = parsedFeatureEdge(key, code);
                // If this opposing edge was also observed now, it is real
                // current structure—not stale doorway residue.
                if (!edge || incomingDoorKeys.has(edge.key) || observedEdges.has(edge.key)) return true;
                const candidates = isWallBesideRevealedSecret
                    ? incomingSecretDoorEdges
                    : incomingDoorEdges;
                return !candidates.some(incomingEdge => isOpposingEdge(edge, incomingEdge));
            });
            if (retained.length) merged[key] = retained;
            else delete merged[key];
        }
    }

    for (const [key, codes] of Object.entries(incoming)) {
        merged[key] = [...new Set([...(merged[key] ?? []), ...codes])];
    }
    return merged;
}

function mergeSourceFeatures(left, right) {
    const merged = normalizeFeatures(left);
    const incoming = normalizeFeatures(right);
    const incomingEdges = [];
    const incomingEdgeKeys = new Set();
    for (const [key, codes] of Object.entries(incoming)) {
        for (const code of codes) {
            const edge = parsedFeatureEdge(key, code);
            if (!edge) continue;
            incomingEdges.push(edge);
            incomingEdgeKeys.add(edge.key);
        }
    }

    // A single Foundry Wall source cannot simultaneously occupy the two
    // opposing parallel boundaries of one abstract map square. When a later
    // view places that source on the other side, replace the provisional edge
    // instead of retaining both and drawing a false box or double doorway.
    for (const [key, codes] of Object.entries(merged)) {
        const retained = codes.filter(code => {
            const edge = parsedFeatureEdge(key, code);
            if (!edge || incomingEdgeKeys.has(edge.key)) return true;
            return !incomingEdges.some(incomingEdge => isOpposingEdge(edge, incomingEdge));
        });
        if (retained.length) merged[key] = retained;
        else delete merged[key];
    }
    return mergeFeatures(merged, incoming);
}

function mergeFeatureSources(left, right) {
    const merged = normalizeFeatureSources(left);
    const incoming = normalizeFeatureSources(right);
    for (const [sourceId, features] of Object.entries(incoming)) {
        merged[sourceId] = mergeSourceFeatures(merged[sourceId], features);
        if (!Object.keys(merged[sourceId]).length) delete merged[sourceId];
    }
    return merged;
}

function flattenFeatureSources(raw) {
    const flattened = {};
    for (const features of Object.values(normalizeFeatureSources(raw))) {
        for (const [key, codes] of Object.entries(features)) {
            flattened[key] ??= [];
            for (const code of codes) {
                if (!flattened[key].includes(code)) flattened[key].push(code);
            }
        }
    }
    return flattened;
}

function subtractFeatureSources(rawFeatures, rawSources) {
    const remaining = normalizeFeatures(rawFeatures);
    for (const features of Object.values(normalizeFeatureSources(rawSources))) {
        for (const [key, codes] of Object.entries(features)) {
            if (!remaining[key]) continue;
            remaining[key] = remaining[key].filter(code => !codes.includes(code));
            if (!remaining[key].length) delete remaining[key];
        }
    }
    return remaining;
}

export {
    classifyWall,
    directionBetween,
    flattenFeatureSources,
    contiguousFloorRegion,
    propagateFloors,
    gridTravelPath,
    mergeFeatureGeometry,
    mergeFeatureSources,
    mergeFeatures,
    mergeSourceFeatures,
    normalizeFeatureGeometry,
    normalizeFeatureSources,
    normalizeFeatures,
    pruneFeatureGeometry,
    retractGeometryOnBoundaries,
    observeCrossedSecretDoors,
    observeVisibleFeatures,
    oppositeDirection,
    orthogonalPath,
    retractCrossedBoundaries,
    retractStaleSourceEdges,
    subtractFeatureSources,
    visibleRevealKeys
};

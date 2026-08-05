// ==================================================================
// ===== MAPPING GEOMETRY AND VISIBILITY ============================
// ==================================================================

const DIRECTIONS = ['north', 'east', 'south', 'west'];

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

    if (door === doorTypes.DOOR) return 'door';
    if (door === doorTypes.SECRET) return 'wall';

    const isTerrain = sight === senseTypes.LIMITED && light === senseTypes.LIMITED;
    if (isTerrain) return null;

    const isWindow = move === movementTypes.NORMAL
        && sight === senseTypes.PROXIMITY
        && light === senseTypes.PROXIMITY;
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
        length,
        unit: { x: (x2 - x1) / length, y: (y2 - y1) / length }
    };
}

function pointDistance(first, second) {
    return Math.hypot(first.x - second.x, first.y - second.y);
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
 * Scene authors frequently build one curved or decorative doorway from two
 * short, connected Wall documents. Collapse those fragments to the chain's
 * first/last extent before grid snapping so one doorway yields one glyph.
 */
function normalizedDoorSpans(documents) {
    const segments = documents.map(wallSegment).filter(Boolean);
    const gridSize = Math.min(
        canvas.grid.sizeX ?? canvas.grid.size,
        canvas.grid.sizeY ?? canvas.grid.size
    );
    const joinDistance = gridSize * 0.25;
    const maxSpan = gridSize * 1.6;
    const clusters = [];

    for (const segment of segments) {
        const cluster = clusters.find(candidate => {
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
 * Snap a visible Foundry wall segment to stable old-school grid boundaries.
 * Curved walls are sampled into stair steps. Doors deliberately use only their
 * midpoint because the official symbol represents a doorway, not every
 * quarter-grid sample of its wall document.
 */
function wallBoundaryObservations(
    document,
    tokenDocument,
    allowed,
    { featureOverride = null, requireVisibility = true } = {}
) {
    const feature = featureOverride ?? classifyWall(document);
    if (!feature || !canvas?.grid) return [];
    const coordinates = document?.c ?? document?._source?.c;
    if (!Array.isArray(coordinates) || coordinates.length < 4) return [];
    const [x1, y1, x2, y2] = coordinates.map(Number);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return [];
    const wallDx = x2 - x1;
    const wallDy = y2 - y1;
    const length = Math.hypot(wallDx, wallDy);
    if (!length) return [];

    const origin = tokenCenter(tokenDocument);
    const gridSize = Math.min(
        canvas.grid.sizeX ?? canvas.grid.size,
        canvas.grid.sizeY ?? canvas.grid.size
    );
    const sampleCount = ['door', 'secret-door'].includes(feature)
        ? 1
        : Math.max(1, Math.ceil(length / (gridSize * 0.25)));
    const observations = [];
    const seen = new Set();

    for (let index = 0; index < sampleCount; index++) {
        const amount = (index + 0.5) / sampleCount;
        const wallPoint = {
            x: x1 + (wallDx * amount),
            y: y1 + (wallDy * amount)
        };
        if (requireVisibility && !visibleFromToken(tokenDocument, wallPoint)) continue;
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
        const key = `${cell.column},${cell.row}`;
        const direction = cell.direction;
        const code = `${feature}:${direction}`;
        const observationKey = `${key}:${code}`;
        if (seen.has(observationKey)) continue;
        seen.add(observationKey);
        observations.push({ key, code });
    }
    return observations;
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
    if (!fromCoordinates || !toCoordinates || !canvas?.walls) return {};
    const tokenShape = {
        id: tokenDocument.id,
        width: Number(tokenDocument.width) || 1,
        height: Number(tokenDocument.height) || 1
    };
    const fromToken = { ...tokenShape, x: fromCoordinates.x, y: fromCoordinates.y };
    const toToken = { ...tokenShape, x: toCoordinates.x, y: toCoordinates.y };
    const movementStart = tokenCenter(fromToken);
    const movementEnd = tokenCenter(toToken);
    if (movementStart.x === movementEnd.x && movementStart.y === movementEnd.y) return {};

    const allowed = exploredKeys instanceof Set ? exploredKeys : new Set(exploredKeys ?? []);
    const observed = {};
    const secretDocuments = (canvas.walls.placeables ?? [])
        .map(wall => wall.document)
        .filter(isSecretDoor);
    for (const span of normalizedDoorSpans(secretDocuments)) {
        const crossed = span.members.some(member => segmentsIntersect(
            movementStart,
            movementEnd,
            member.start,
            member.end
        ));
        if (!crossed) continue;

        for (const observation of wallBoundaryObservations(
            span.document,
            toToken,
            allowed,
            { featureOverride: 'secret-door', requireVisibility: false }
        )) {
            observed[observation.key] ??= [];
            if (!observed[observation.key].includes(observation.code)) {
                observed[observation.key].push(observation.code);
            }
        }
    }
    return observed;
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
    const doorDocuments = [];
    for (const wall of canvas.walls?.placeables ?? []) {
        if (classifyWall(wall.document) === 'door') {
            doorDocuments.push(wall.document);
            continue;
        }
        for (const observation of wallBoundaryObservations(wall.document, tokenDocument, allowed)) {
            observed[observation.key] ??= [];
            if (!observed[observation.key].includes(observation.code)) {
                observed[observation.key].push(observation.code);
            }
        }
    }
    for (const span of normalizedDoorSpans(doorDocuments)) {
        for (const observation of wallBoundaryObservations(
            span.document,
            tokenDocument,
            allowed,
            { featureOverride: 'door' }
        )) {
            observed[observation.key] ??= [];
            if (!observed[observation.key].includes(observation.code)) {
                observed[observation.key].push(observation.code);
            }
        }
    }
    return observed;
}

function normalizeFeatures(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const normalized = {};
    for (const [key, codes] of Object.entries(raw)) {
        if (!/^-?\d+,-?\d+$/.test(key) || !Array.isArray(codes)) continue;
        const valid = [...new Set(codes.filter(code => {
            if (typeof code !== 'string') return false;
            const [feature, direction] = code.split(':');
            return ['wall', 'window', 'door', 'secret-door'].includes(feature) && DIRECTIONS.includes(direction);
        }))];
        if (valid.length) normalized[key] = valid;
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

function mergeFeatures(left, right) {
    const merged = normalizeFeatures(left);
    const incoming = normalizeFeatures(right);
    const observedEdges = new Set();
    for (const [key, codes] of Object.entries(incoming)) {
        for (const code of codes) {
            const edgeKey = featureEdgeKey(key, code);
            if (edgeKey) observedEdges.add(edgeKey);
        }
    }

    // An edge that has been seen again is current information. Replace its
    // former wall/window/door classification instead of accumulating stale
    // classifications forever.
    const incomingSecretEdges = new Set();
    for (const [key, codes] of Object.entries(incoming)) {
        for (const code of codes) {
            if (!code.startsWith('secret-door:')) continue;
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
            return code.startsWith('secret-door:') && !incomingSecretEdges.has(edgeKey);
        });
        if (retained.length) merged[key] = retained;
        else delete merged[key];
    }

    for (const [key, codes] of Object.entries(incoming)) {
        merged[key] = [...new Set([...(merged[key] ?? []), ...codes])];
    }
    return merged;
}

export {
    classifyWall,
    directionBetween,
    gridTravelPath,
    mergeFeatures,
    normalizeFeatures,
    observeCrossedSecretDoors,
    observeVisibleFeatures,
    oppositeDirection,
    orthogonalPath,
    visibleRevealKeys
};

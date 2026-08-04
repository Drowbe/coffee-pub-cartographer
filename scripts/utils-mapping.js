// ==================================================================
// ===== MAPPING GEOMETRY AND VISIBILITY ============================
// ==================================================================

const DIRECTIONS = ['north', 'east', 'south', 'west'];

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

/**
 * Snap the visible side of a Foundry wall segment to edges of explored floor
 * cells. Curved-wall endpoints commonly share grid squares with the token, so
 * routing them through cell centers puts linework directly through the path.
 */
function wallBoundaryObservations(document, tokenDocument, allowed) {
    const feature = classifyWall(document);
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
    const sampleCount = Math.max(1, Math.ceil(length / (gridSize * 0.25)));
    const sideInset = Math.max(3, gridSize * 0.08);
    const observations = [];
    const seen = new Set();

    for (let index = 0; index < sampleCount; index++) {
        const amount = (index + 0.5) / sampleCount;
        const wallPoint = {
            x: x1 + (wallDx * amount),
            y: y1 + (wallDy * amount)
        };
        const towardTokenX = origin.x - wallPoint.x;
        const towardTokenY = origin.y - wallPoint.y;
        const tokenDistance = Math.hypot(towardTokenX, towardTokenY);
        if (!tokenDistance) continue;
        const floorPoint = {
            x: wallPoint.x + ((towardTokenX / tokenDistance) * sideInset),
            y: wallPoint.y + ((towardTokenY / tokenDistance) * sideInset)
        };
        const cell = gridCellAt(floorPoint);
        if (!cell) continue;
        const key = `${cell.column},${cell.row}`;
        if (!allowed.has(key) || !visibleFromToken(tokenDocument, wallPoint)) continue;

        let direction;
        if (Math.abs(wallDx) >= Math.abs(wallDy)) {
            direction = origin.y < wallPoint.y ? 'south' : 'north';
        } else {
            direction = origin.x < wallPoint.x ? 'east' : 'west';
        }
        const code = `${feature}:${direction}`;
        const observationKey = `${key}:${code}`;
        if (seen.has(observationKey)) continue;
        seen.add(observationKey);
        observations.push({ key, code });
    }
    return observations;
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
    for (const key of candidates) {
        const [column, row] = key.split(',').map(Number);
        if (!Number.isInteger(column) || !Number.isInteger(row)) continue;
        const target = cellCenter({ column, row });
        if (visibleFromToken(tokenDocument, target, { insetTarget: false })) visible.add(key);
    }
    return visible;
}

function observeVisibleFeatures(tokenDocument, revealKeys) {
    const allowed = revealKeys instanceof Set ? revealKeys : new Set(revealKeys ?? []);
    const observed = {};
    for (const wall of canvas.walls?.placeables ?? []) {
        for (const observation of wallBoundaryObservations(wall.document, tokenDocument, allowed)) {
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
            return ['wall', 'window', 'door'].includes(feature) && DIRECTIONS.includes(direction);
        }))];
        if (valid.length) normalized[key] = valid;
    }
    return normalized;
}

function mergeFeatures(left, right) {
    const merged = normalizeFeatures(left);
    for (const [key, codes] of Object.entries(normalizeFeatures(right))) {
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
    observeVisibleFeatures,
    oppositeDirection,
    orthogonalPath,
    visibleRevealKeys
};

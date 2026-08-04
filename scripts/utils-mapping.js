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

function wallTileLegs(document) {
    const feature = classifyWall(document);
    if (!feature || !canvas?.grid) return [];
    const coordinates = document?.c ?? document?._source?.c;
    if (!Array.isArray(coordinates) || coordinates.length < 4) return [];
    const [x1, y1, x2, y2] = coordinates.map(Number);
    if (![x1, y1, x2, y2].every(Number.isFinite)) return [];

    const startOffset = canvas.grid.getOffset({ x: x1, y: y1 });
    const endOffset = canvas.grid.getOffset({ x: x2, y: y2 });
    const start = {
        column: Number(startOffset.j ?? startOffset.x),
        row: Number(startOffset.i ?? startOffset.y)
    };
    const end = {
        column: Number(endOffset.j ?? endOffset.x),
        row: Number(endOffset.i ?? endOffset.y)
    };
    if (![start.column, start.row, end.column, end.row].every(Number.isInteger)) return [];

    const path = orthogonalPath(start, end);
    const legs = [];
    const add = (cell, direction) => {
        if (!direction) return;
        legs.push({
            key: `${cell.column},${cell.row}`,
            cell,
            code: `${feature}:${direction}`,
            feature,
            direction,
            wallPoint: closestPointOnSegment(cellCenter(cell), { x: x1, y: y1 }, { x: x2, y: y2 })
        });
    };

    if (path.length === 1) {
        const directions = Math.abs(x2 - x1) >= Math.abs(y2 - y1)
            ? ['west', 'east']
            : ['north', 'south'];
        for (const direction of directions) add(path[0], direction);
        return legs;
    }

    for (let index = 1; index < path.length; index++) {
        const previous = path[index - 1];
        const current = path[index];
        const direction = directionBetween(previous, current);
        add(previous, direction);
        add(current, oppositeDirection(direction));
    }
    return legs;
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

function closestPointOnSegment(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = (dx * dx) + (dy * dy);
    if (!lengthSquared) return { ...start };
    const amount = Math.max(0, Math.min(1,
        (((point.x - start.x) * dx) + ((point.y - start.y) * dy)) / lengthSquared
    ));
    return { x: start.x + (amount * dx), y: start.y + (amount * dy) };
}

function tokenCenter(tokenDocument) {
    const sizeX = canvas.grid.sizeX ?? canvas.grid.size;
    const sizeY = canvas.grid.sizeY ?? canvas.grid.size;
    return {
        x: tokenDocument.x + (((tokenDocument.width ?? 1) * sizeX) / 2),
        y: tokenDocument.y + (((tokenDocument.height ?? 1) * sizeY) / 2)
    };
}

function visibleFromToken(tokenDocument, wallPoint) {
    const origin = tokenCenter(tokenDocument);
    const dx = origin.x - wallPoint.x;
    const dy = origin.y - wallPoint.y;
    const distance = Math.hypot(dx, dy);
    const inset = Math.min(6, Math.max(2, (canvas.grid.size ?? 100) * 0.04));
    const target = distance > 0
        ? { x: wallPoint.x + ((dx / distance) * inset), y: wallPoint.y + ((dy / distance) * inset) }
        : wallPoint;
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

function observeVisibleFeatures(tokenDocument, revealKeys) {
    const allowed = revealKeys instanceof Set ? revealKeys : new Set(revealKeys ?? []);
    const observed = {};
    for (const wall of canvas.walls?.placeables ?? []) {
        for (const leg of wallTileLegs(wall.document)) {
            if (!allowed.has(leg.key) || !visibleFromToken(tokenDocument, leg.wallPoint)) continue;
            observed[leg.key] ??= [];
            if (!observed[leg.key].includes(leg.code)) observed[leg.key].push(leg.code);
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
    orthogonalPath
};

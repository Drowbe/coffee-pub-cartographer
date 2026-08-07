// ==================================================================
// ===== MAPPING VISIBILITY AND REGIONS =============================
// ==================================================================
//
// What the party can see, and what that joins up into.
//
// The architecture itself is settled once per scene in atlas-mapping.js. This
// file no longer derives any of it: everything here is about which squares have
// been seen, and about reading the atlas to answer questions that depend on the
// party's own knowledge rather than on the scene.
//
// The merge, retraction and source-attribution layers that used to live here
// are gone with the incremental snapping that needed them. Exploration is a
// mask now, so there is nothing left to reconcile.

const DIRECTIONS = ['north', 'east', 'south', 'west'];
/** Every feature the atlas may put on a cell boundary. */
const EDGE_FEATURES = ['wall', 'door', 'locked-door', 'secret-door', 'window'];

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

/**
 * Every grid square crossed by a straight token move. Foundry often reports a
 * long drag as one destination update, so the intermediate stops have to be
 * reconstructed rather than revealing only the final neighbourhood.
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

/**
 * The stretch of a segment lying inside one square, as a pair of positions
 * along it, or null when it misses the square.
 *
 * Liang-Barsky: each of the square's four sides trims the run of the line that
 * survives, and the moment nothing survives the square is rejected. Used by the
 * renderer to cut a wall into per-square pieces.
 */
function clipSegmentToCell(x0, y0, x1, y1, column, row) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    let enter = 0;
    let exit = 1;
    const limits = [
        [-dx, x0 - column],
        [dx, column + 1 - x0],
        [-dy, y0 - row],
        [dy, row + 1 - y0]
    ];
    for (const [edge, distance] of limits) {
        if (edge === 0) {
            if (distance < 0) return null;
            continue;
        }
        const crossing = distance / edge;
        if (edge < 0) {
            if (crossing > exit) return null;
            if (crossing > enter) enter = crossing;
        } else {
            if (crossing < enter) return null;
            if (crossing < exit) exit = crossing;
        }
    }
    // A line that only grazes a corner contributes nothing worth drawing.
    return exit - enter > 0.0001 ? [enter, exit] : null;
}

function cellCenter(cell) {
    if (typeof canvas.grid.getCenterPoint === 'function') {
        const center = canvas.grid.getCenterPoint({ i: cell.row, j: cell.column });
        if (Number.isFinite(center?.x) && Number.isFinite(center?.y)) return center;
    }
    const sizeX = canvas.grid.sizeX ?? canvas.grid.size;
    const sizeY = canvas.grid.sizeY ?? canvas.grid.size;
    return { x: (cell.column + 0.5) * sizeX, y: (cell.row + 0.5) * sizeY };
}

function tokenCenter(tokenDocument) {
    const sizeX = canvas.grid.sizeX ?? canvas.grid.size;
    const sizeY = canvas.grid.sizeY ?? canvas.grid.size;
    return {
        x: tokenDocument.x + (((tokenDocument.width ?? 1) * sizeX) / 2),
        y: tokenDocument.y + (((tokenDocument.height ?? 1) * sizeY) / 2)
    };
}

function visibleFromToken(tokenDocument, point) {
    const origin = tokenCenter(tokenDocument);
    const token = canvas.tokens?.get(tokenDocument.id);
    const vision = token?.vision;

    // Foundry's sight collision backend rather than the rendered vision
    // polygon: a GM client may not have another user's vision source active,
    // which made valid nearby squares disappear from the recorded map.
    const sight = CONFIG.Canvas?.polygonBackends?.sight;
    if (typeof sight?.testCollision === 'function') {
        return !sight.testCollision(origin, point, {
            type: 'sight',
            mode: 'any',
            source: vision,
            useThreshold: true,
            priority: vision?.priority
        });
    }

    // Fall back to an initialized local vision polygon only if the collision
    // backend is unavailable.
    if (typeof vision?.shape?.contains === 'function') return vision.shape.contains(point.x, point.y);
    if (typeof vision?.los?.contains === 'function') return vision.los.contains(point.x, point.y);
    return true;
}

/**
 * Which of the candidate squares the token can actually see.
 *
 * A single ray can graze a shared wall endpoint and make a square behind that
 * corner look visible, so a small footprint inside the square must be visible
 * too. The cardinal samples sit close to centre deliberately: requiring two of
 * them keeps narrow corridors mappable while rejecting the one-ray slivers
 * created at wall joins.
 */
function visibleRevealKeys(tokenDocument, revealKeys) {
    const candidates = revealKeys instanceof Set ? revealKeys : new Set(revealKeys ?? []);
    const visible = new Set();
    const sizeX = canvas.grid.sizeX ?? canvas.grid.size;
    const sizeY = canvas.grid.sizeY ?? canvas.grid.size;
    const insetX = sizeX * 0.18;
    const insetY = sizeY * 0.18;

    for (const key of candidates) {
        const [column, row] = key.split(',').map(Number);
        if (!Number.isInteger(column) || !Number.isInteger(row)) continue;
        const center = cellCenter({ column, row });
        if (!visibleFromToken(tokenDocument, center)) continue;

        const footprint = [
            { x: center.x, y: center.y - insetY },
            { x: center.x + insetX, y: center.y },
            { x: center.x, y: center.y + insetY },
            { x: center.x - insetX, y: center.y }
        ];
        let seen = 0;
        for (const point of footprint) {
            if (visibleFromToken(tokenDocument, point)) seen++;
            if (seen >= 2) break;
        }
        if (seen >= 2) visible.add(key);
    }
    return visible;
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

/**
 * The floor around the party, out to as far as they can see, bounded by the
 * walls of the room they are standing in.
 *
 * Sampling each square's middle for a clear line to the party answers the wrong
 * question. Walk into a square room and nobody checks each flagstone: the walls
 * are plainly there, and the floor they enclose is plainly floor. But a square
 * that a wall clips a corner off has its middle inside that wall, so the
 * sampling threw it away -- and a curved corridor, where nearly every square is
 * clipped, came out as a chequerboard of holes in ground the party had walked
 * straight down.
 *
 * So the floor is taken from the walls instead. Everything reachable from the
 * party's own square without crossing one is the space they are in, and they
 * can see it. Doorways count as walls here, exactly as they do for flooring, so
 * this stops at the threshold and never spills into the next room.
 */
function enclosedRegion(atlas, start, reach, limit = 4000) {
    const within = reach instanceof Set ? reach : new Set(reach ?? []);
    const startKey = `${start.column},${start.row}`;
    const region = new Set([startKey]);
    const queue = [start];
    while (queue.length && region.size < limit) {
        const current = queue.shift();
        const currentKey = `${current.column},${current.row}`;
        for (const [columnOffset, rowOffset] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
            const next = { column: current.column + columnOffset, row: current.row + rowOffset };
            const nextKey = `${next.column},${next.row}`;
            if (region.has(nextKey) || !within.has(nextKey)) continue;
            if (boundaryBlocks(atlas, currentKey, current, next)) continue;
            region.add(nextKey);
            queue.push(next);
        }
    }
    return region;
}

/**
 * The explored squares reachable from a starting square without crossing a
 * recorded boundary — one room, in other words.
 *
 * Every feature blocks, doorways included: a doorway is where one floor surface
 * stops and the next begins, so a room's flooring should not run out into the
 * corridor it opens onto. Reads the atlas only where the party has explored, so
 * flooring can never spread through a wall they have not discovered yet.
 */
function contiguousFloorRegion(exploredKeys, atlas, start, limit = 4000) {
    const explored = exploredKeys instanceof Set ? exploredKeys : new Set(exploredKeys ?? []);
    const startKey = `${start.column},${start.row}`;
    if (!explored.has(startKey)) return [];

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
            if (boundaryBlocks(atlas, currentKey, current, next)) continue;
            seen.add(nextKey);
            region.push(nextKey);
            queue.push(next);
        }
    }
    return region;
}

function boundaryBlocks(atlas, fromKey, from, to) {
    const direction = directionBetween(from, to);
    if (!direction) return true;
    const features = atlas?.features;
    const opposite = oppositeDirection(direction);
    const here = features?.[fromKey] ?? [];
    const there = features?.[`${to.column},${to.row}`] ?? [];
    if (here.some(code => code.endsWith(`:${direction}`))) return true;
    if (there.some(code => code.endsWith(`:${opposite}`))) return true;
    // Curves and angled walls do not sit on the lattice, so they say they are
    // in the way separately. Without this a room's flooring ran out through
    // every curved wall it had.
    const step = {
        east: `e:${from.column},${from.row}`,
        west: `e:${to.column},${to.row}`,
        south: `s:${from.column},${from.row}`,
        north: `s:${to.column},${to.row}`
    }[direction];
    return Boolean(atlas?.barriers?.has(step));
}

/**
 * Extend a floor surface into squares that have just joined its area.
 *
 * Choosing a surface names the area, not the squares that happened to be mapped
 * at the time, so when exploration fills in more of the same room those squares
 * adopt the surface already chosen for it. It spreads only through openings the
 * party has recorded, which is what stops it running out of a doorway: the next
 * room is a new area and stays default until it is named.
 */
function propagateFloors(exploredKeys, atlas, floors, addedKeys) {
    const explored = exploredKeys instanceof Set ? exploredKeys : new Set(exploredKeys ?? []);
    const next = { ...(floors ?? {}) };
    const pending = [...new Set(addedKeys ?? [])].filter(key => explored.has(key) && !next[key]);
    if (!pending.length) return next;

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
                if (boundaryBlocks(atlas, key, cell, neighbour)) continue;
                next[key] = next[neighbourKey];
                changed = true;
                break;
            }
        }
    }
    return next;
}

export {
    clipSegmentToCell,
    contiguousFloorRegion,
    enclosedRegion,
    directionBetween,
    gridTravelPath,
    normalizeFeatures,
    oppositeDirection,
    propagateFloors,
    visibleFromToken,
    visibleRevealKeys
};

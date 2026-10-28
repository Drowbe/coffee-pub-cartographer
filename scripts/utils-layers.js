// ==================================================================
// ===== LAYERS =====================================================
// ==================================================================
//
// What is drawn is put on a layer by what it is, not by when it was drawn: dirt is under the cabbages
// that grow in it, a table is over the rug under it, a tree's canopy is over the table beneath it. A
// layer is a band of Foundry's own `sort`, so the order holds for every Drawing written to the scene,
// and an Above or Sky layer can also be raised in `elevation` to be drawn over the tokens. No Foundry
// and no PIXI here: the tool calls it with the data it is about to write.

/**
 * The layers, from the one drawn first to the one drawn last. `band` is the layer's place in the sort
 * and `elevation` is how far it is raised when it is drawn over the tokens (see layerDocs).
 */
export const LAYERS = [
    { id: 'ground', band: 0, icon: 'fa-solid fa-layer-group', labelKey: 'layerGround', elevation: 0 },
    { id: 'ankle', band: 1, icon: 'fa-solid fa-seedling', labelKey: 'layerAnkle', elevation: 0 },
    { id: 'waist', band: 2, icon: 'fa-solid fa-chair', labelKey: 'layerWaist', elevation: 0 },
    { id: 'eye', band: 3, icon: 'fa-solid fa-eye', labelKey: 'layerEye', elevation: 0 },
    { id: 'above', band: 4, icon: 'fa-solid fa-tree', labelKey: 'layerAbove', elevation: 20 },
    { id: 'sky', band: 5, icon: 'fa-solid fa-cloud', labelKey: 'layerSky', elevation: 200 }
];
const BY_ID = new Map(LAYERS.map(layer => [layer.id, layer]));
export const layerById = id => BY_ID.get(id) ?? null;

/** The layer a thing is on when nothing says. */
export const DEFAULT_LAYER = 'waist';

/**
 * How many sort values a layer is given, so one layer never reaches into the next. A layer's order runs
 * on the clock (see reserveOrder), a few decades of it.
 */
export const LAYER_SPAN = 1e14;

/** Where a layer's order starts counting, so it is small enough to fit in the layer. */
const EPOCH = Date.UTC(2026, 0, 1);

let cursor = 0;

/**
 * A place in the order of a layer for something with `span` drawings in it: later than anything reserved
 * before it, and never less than the time, so what is drawn later is on top of what is drawn earlier,
 * also after a reload.
 */
export function reserveOrder(span = 1) {
    cursor = Math.max(cursor, (Date.now() - EPOCH) * 100);
    const at = cursor;
    cursor += Math.max(1, Math.ceil(span));
    return at;
}

/**
 * The `sort` of something at a place in the order of a layer. `top` puts it over everything else on the
 * layer, as a door is over its wall.
 */
export function layerSort(layerId, order, top = false) {
    const layer = BY_ID.get(layerId) ?? BY_ID.get(DEFAULT_LAYER);
    return layer.band * LAYER_SPAN + (top ? LAYER_SPAN / 2 : 0) + order;
}

/**
 * Drawings as data, put on a layer: each `sort` is placed in the layer after everything put on it before,
 * keeping the order the drawings have among themselves, each is told its layer in its flags, and, when
 * the layer is raised over the tokens, given the layer's elevation.
 *
 * @param {object[]} docs  Drawing data; their own `sort` is their order among themselves, from 0.
 * @param {string} layerId
 * @param {{ moduleId: string, top?: boolean, raised?: boolean }} how
 */
export function layerDocs(docs, layerId, { moduleId, top = false, raised = false } = {}) {
    const layer = BY_ID.get(layerId) ?? BY_ID.get(DEFAULT_LAYER);
    const span = docs.reduce((most, doc) => Math.max(most, doc.sort ?? 0), 0) + 1;
    const order = reserveOrder(span);
    return docs.map(doc => ({
        ...doc,
        sort: layerSort(layer.id, order, top) + (doc.sort ?? 0),
        ...(raised && layer.elevation ? { elevation: layer.elevation } : {}),
        flags: { ...doc.flags, [moduleId]: { ...doc.flags?.[moduleId], layer: layer.id } }
    }));
}

/** The layer a Drawing was written on, from its flags, or null for a Drawing this tool did not layer. */
export function drawingLayer(flags, moduleId) {
    const id = flags?.[moduleId]?.layer;
    return BY_ID.has(id) ? id : null;
}

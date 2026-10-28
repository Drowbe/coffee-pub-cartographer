// The layers and the rules each stamp follows, run for real: utils-layers.js and utils-stamps.js
// import as they are, since neither touches Foundry or PIXI.
//
// It shows that what is drawn goes on the layer it belongs on and stays in that order however it is
// drawn -- dirt under the cabbage, the cabbage under the table, the table under the tree -- that a
// door is over its wall, that only the layers meant to be over the tokens are raised, and that each
// stamp is one to a click or many, scales or is its own size, and turns any way, by quarters or not
// at all, as it should be.
//
// It does not show that Foundry draws a Drawing's sort and elevation as the data says: that wants the map.
import {
    LAYERS, layerById, layerSort, reserveOrder, layerDocs, drawingLayer, LAYER_SPAN, DEFAULT_LAYER
} from '../scripts/utils-layers.js';
import { STAMPS, stampById, isScatterStamp, isScaledStamp, stampTurn, stampLayer, stampFootprint, stampSquares } from '../scripts/utils-stamps.js';
import { TERRAINS, terrainById } from '../scripts/utils-terrain.js';
import { WALL_MATERIALS, wallLayer } from '../scripts/utils-drawing.js';

let failures = 0;
const check = (label, ok, detail = '') => {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const ID = 'coffee-pub-cartographer';
const piece = sort => ({ sort, flags: {} });
const pieces = n => Array.from({ length: n }, (_, i) => piece(i));
const lowest = docs => Math.min(...docs.map(d => d.sort));
const highest = docs => Math.max(...docs.map(d => d.sort));

console.log('the layers');
check('there are seven, from the ground up to the sky, the paths over the ground and under all that stands on them', LAYERS.map(l => l.id).join() === 'ground,path,ankle,waist,eye,above,sky');
check('each is a band after the one before it', LAYERS.every((l, i) => l.band === i));
check('each has an icon and a label to show', LAYERS.every(l => l.icon && l.labelKey));
check('only Above and Sky are raised to be over the tokens, and Sky over Above', LAYERS.filter(l => l.elevation > 0).map(l => l.id).join() === 'above,sky' && layerById('sky').elevation > layerById('above').elevation);
check('a layer is found by its id, and an unknown one is not', layerById('eye').band === 4 && layerById('nope') === null);
check('a thing with no layer is at waist height', DEFAULT_LAYER === 'waist' && layerSort('nope', 5) === layerSort('waist', 5));

console.log('\nthe order');
{
    const a = reserveOrder(10);
    const b = reserveOrder(10);
    const c = reserveOrder(1000);
    const d = reserveOrder(1);
    check('what is reserved later is later, and a reservation holds its whole span', b >= a + 10 && c >= b + 10 && d >= c + 1000);
    check('a lower layer sorts under a higher one, whenever each was drawn', layerSort('ground', reserveOrder(1)) > layerSort('ground', 0) && layerSort('ankle', 0) > layerSort('ground', reserveOrder(1e6)));
    check('the whole of a layer is under the whole of the next', LAYERS.slice(1).every((l, i) => layerSort(l.id, 0) > layerSort(LAYERS[i].id, LAYER_SPAN / 2 - 1, true)));
    check('the top of a layer is over its other things, and still under the next layer', layerSort('eye', 0, true) > layerSort('eye', 1e12) && layerSort('eye', 1e12, true) < layerSort('above', 0));
    check('sorts stay whole numbers Foundry can store', LAYERS.every(l => Number.isSafeInteger(layerSort(l.id, reserveOrder(1), true))));
}

console.log('\ndrawings put on a layer');
{
    const dirt = layerDocs(pieces(40), 'ground', { moduleId: ID });
    const cabbage = layerDocs(pieces(12), 'ankle', { moduleId: ID });
    const table = layerDocs(pieces(25), 'waist', { moduleId: ID });
    const tree = layerDocs(pieces(60), 'above', { moduleId: ID });
    check('the ground is under the cabbage, the cabbage under the table, the table under the tree', highest(dirt) < lowest(cabbage) && highest(cabbage) < lowest(table) && highest(table) < lowest(tree));
    const lateDirt = layerDocs(pieces(40), 'ground', { moduleId: ID });
    check('also dirt drawn after all of them', highest(lateDirt) < lowest(cabbage));
    const first = layerDocs(pieces(30), 'waist', { moduleId: ID });
    const second = layerDocs(pieces(30), 'waist', { moduleId: ID });
    check('on one layer, what is drawn later is on top, whole: no piece of it under a piece of the one before', lowest(second) > highest(first));
    check('the pieces of one drawing stay in their order', first.every((doc, i) => i === 0 || doc.sort > first[i - 1].sort));
    check('each is told its layer in its flags', first.every(doc => doc.flags[ID].layer === 'waist') && drawingLayer(first[0].flags, ID) === 'waist');
    check('the flags it had are kept', layerDocs([{ sort: 0, flags: { [ID]: { stamp: { id: 'x' } }, other: 1 } }], 'eye', { moduleId: ID })[0].flags[ID].stamp.id === 'x');
    check('nothing is changed in what it was given', (() => { const input = pieces(3); layerDocs(input, 'eye', { moduleId: ID }); return input.every((d, i) => d.sort === i && !d.flags[ID]); })());
    const door = layerDocs(pieces(8), 'eye', { moduleId: ID, top: true });
    const lateWall = layerDocs(pieces(240), 'eye', { moduleId: ID });
    check('a door is over its wall, also over a wall drawn after it', lowest(door) > highest(lateWall));
    check('and still under the layer above', highest(door) < lowest(tree));
    check('no elevation is written unless asked for', [dirt, tree].every(docs => docs.every(doc => !('elevation' in doc))));
    const raised = layerDocs(pieces(3), 'above', { moduleId: ID, raised: true });
    check('Above is raised over the tokens when asked, and the others are not', raised.every(doc => doc.elevation === layerById('above').elevation) && layerDocs(pieces(3), 'waist', { moduleId: ID, raised: true }).every(doc => !('elevation' in doc)));
    check('a drawing from before there were layers is on none', drawingLayer({ [ID]: { stamp: { id: 'x' } } }, ID) === null && drawingLayer({ [ID]: { layer: 'cellar' } }, ID) === null && drawingLayer(undefined, ID) === null);
}

console.log('\nthe rules of each stamp');
const real = STAMPS.filter(s => !s.legacy);
check('every stamp says how it is painted, sized, turned, and where it goes', STAMPS.every(s => ['scatter', 'single'].includes(s.paint) && ['scale', 'fixed'].includes(s.size) && ['free', 'steps', 'none'].includes(s.turn) && layerById(s.layer)));
check('trees, plants and ground scatter and scale, and turn any way', STAMPS.filter(s => ['trees', 'plants', 'ground'].includes(s.category)).every(s => isScatterStamp(s.id) && isScaledStamp(s.id) && stampTurn(s.id) === 'free'));
check('a pond is painted and scales, like the rest of the water', isScatterStamp('pond') && isScaledStamp('pond'));
check('furniture, storage and kitchen are one to a click, their own size, and turned by quarters', STAMPS.filter(s => ['furniture', 'storage', 'kitchen'].includes(s.category) && !['pumpkins', 'melons'].includes(s.id)).every(s => !isScatterStamp(s.id) && !isScaledStamp(s.id) && stampTurn(s.id) === 'steps'));
check('the crate, the barrel, the chest, the bed and the table never run together', ['crate', 'barrel', 'chest', 'bed', 'table', 'chair', 'box', 'stove', 'cauldron', 'workbench', 'cabinet', 'apple-crate'].every(id => !isScatterStamp(id)));
check('a bed, a table and a crate keep their size at every size', ['bed', 'table', 'crate'].every(id => stampSquares(id, 'small') === stampSquares(id, 'large')));
check('a tree grows with the size', stampSquares('tree', 'large') === 6 * 1 && stampSquares('tree', 'small') === 1);
check('a crop is painted on its lattice, always the same size, and not turned', STAMPS.filter(s => s.category === 'fields').every(s => isScatterStamp(s.id) && !isScaledStamp(s.id) && stampTurn(s.id) === 'none' && s.lattice));
check('a boulder is put down one at a time, but rocks are scattered', !isScatterStamp('boulders') && isScatterStamp('rock'));
check('the markers are one to a click and not turned', STAMPS.filter(s => s.legacy).every(s => !isScatterStamp(s.id) && stampTurn(s.id) === 'none'));
check('an unknown stamp is none of these', !isScatterStamp('nope') && !isScaledStamp('nope') && stampTurn('nope') === 'none' && stampLayer('nope') === 'waist');

console.log('\nthe layer of each stamp');
check('ground patches are on the ground, the very bottom', real.filter(s => s.category === 'ground').every(s => stampLayer(s.id) === 'ground') && layerById('ground').band === 0);
check('a pond is a thing on the ground, over every patch and path, so dirt never covers it', layerById(stampLayer('pond')).band > layerById('path').band && layerById(stampLayer('pond')).band > layerById(stampLayer('patch-dirt')).band);
check('dirt is under what grows in it: crops and grass are over the ground', ['crop-corn', 'crop-cabbage', 'grass', 'flowers'].every(id => layerById(stampLayer(id)).band > layerById(stampLayer('patch-dirt')).band));
check('furniture is over the crops, and the crops are under it', layerById(stampLayer('table')).band > layerById(stampLayer('crop-cabbage')).band);
check('a tree is over the furniture under it', layerById(stampLayer('tree')).band > layerById(stampLayer('table')).band && layerById(stampLayer('pine')).band > layerById(stampLayer('bed')).band);
check('a shrub is waist high, and a cabinet taller than a table', stampLayer('shrub') === 'waist' && layerById(stampLayer('cabinet')).band > layerById(stampLayer('table')).band);
check('a road is over the ground and under what stands on it, a boardwalk over what it crosses', TERRAINS.filter(t => t.id !== 'boardwalk').every(t => terrainById(t.id).layer === 'path') && layerById('path').band > layerById(stampLayer('patch-dirt')).band && layerById('path').band < layerById(stampLayer('crop-corn')).band && terrainById('boardwalk').layer === 'ankle' && layerById(terrainById('boardwalk').layer).band > layerById(terrainById('stream').layer).band);
check('a wall is at eye level, and a fence is waist high', WALL_MATERIALS.filter(m => m.id !== 'fence').every(m => wallLayer(m.id) === 'eye') && wallLayer('fence') === 'waist' && wallLayer('nope') === 'eye');
check('a wall is over a table beside it', layerById(wallLayer('stone')).band > layerById(stampLayer('table')).band);

console.log('\nhow big a thing is on the grid');
{
    const feet = id => stampFootprint(id);
    check('a crate is one square', feet('crate').w === 1 && feet('crate').h === 1);
    check('a bed is longer than it is wide, a table too', (() => { const bed = feet('bed'); const table = feet('table'); return bed.w * bed.h >= 2 && table.w * table.h >= 2; })());
    check('turned a quarter, a thing swaps its width and its length', (() => { const bed = feet('bed'); const turned = stampFootprint('bed', 1); return turned.w === bed.h && turned.h === bed.w && stampFootprint('bed', 2).w === bed.w && stampFootprint('bed', 3).h === bed.w; })());
    check('nothing is less than a square', real.every(s => { const f = feet(s.id); return f.w >= 1 && f.h >= 1; }));
    check('a stamp that is not one has one square', feet('nope').w === 1 && feet('plus').w === 1);
    check('a tree is as wide as its size says', feet('tree').w >= 2);
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);

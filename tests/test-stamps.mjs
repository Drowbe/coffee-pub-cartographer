// The stamps and the wall-stroke planning, run for real: utils-stamps.js and utils-drawing.js import
// as they are, since neither touches Foundry or PIXI.
//
// It shows what the geometry guarantees -- the same seed gives the same stamp, every stamp stays in
// its square, every tone it names has a colour, a stamp is drawn and written to the scene as
// Drawings Foundry will accept -- and that a wall stroke becomes the walls it should.
//
// It does not show how a stamp looks or that Foundry accepts the Drawings: that wants the map.
import {
    STAMPS, STAMP_CATEGORIES, TONES, buildStamp, stampPalette, stampSvg, drawStamp, stampDrawingData,
    isProceduralStamp, isStamp, stampById, parseColor, makeRng, stampSquares
} from '../scripts/utils-stamps.js';
import { wallStrokeSegments, segmentsPath, strokeDrawingData, polygonShape, distanceToPolyline, insidePolygon, drawingHit, keptGroup, WALL_KINDS, wallKindById, wallKindData, wallKindSvg, isDoorKind, fitOpeningToWall } from '../scripts/utils-drawing.js';
import { TERRAINS, terrainById, terrainPalette, smoothPath, buildTerrain, terrainSvg, MAX_TEXTURE } from '../scripts/utils-terrain.js';

let failures = 0;
const check = (label, ok, detail = '') => {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};

console.log('the catalogue');
check('every stamp has an id, a category, an icon, a label and a build', STAMPS.every(s => s.id && s.category && s.icon && s.labelKey && typeof s.build === 'function'));
check('ids are unique', new Set(STAMPS.map(s => s.id)).size === STAMPS.length);
check('every category a stamp names is listed', STAMPS.every(s => STAMP_CATEGORIES.some(c => c.id === s.category)));
check('every listed category has stamps', STAMP_CATEGORIES.every(c => STAMPS.some(s => s.category === c.id)));
check('the nature stamps all have a natural palette of every tone', STAMPS.filter(s => !s.legacy).every(s => TONES.every(t => /^#[0-9a-f]{6}$/i.test(s.palette?.[t] ?? ''))));
check('the markers the tool always had are all there', ['plus', 'x', 'dot', 'arrow', 'arrow-up', 'arrow-down', 'arrow-left', 'square'].every(id => stampById(id)?.legacy));
check('at least the stamps asked for exist', ['tree', 'shrub', 'grass', 'rock'].every(id => isProceduralStamp(id)));
check('markers are stamps but not procedural', isStamp('plus') && !isProceduralStamp('plus') && !isStamp('nonsense'));

console.log('\neach stamp');
for (const stamp of STAMPS) {
    const palette = stampPalette(stamp.id, stamp.legacy ? '#264a8c' : null);
    let bad = '';
    for (let seed = 1; seed <= 40 && !bad; seed++) {
        const prims = buildStamp(stamp.id, { seed, rotation: seed * 0.7, mirror: seed % 2 === 0 });
        if (!prims.length) bad = `seed ${seed}: nothing drawn`;
        for (const prim of prims) {
            if (!['poly', 'line'].includes(prim.k)) bad = `seed ${seed}: unknown primitive ${prim.k}`;
            else if (!palette[prim.tone]) bad = `seed ${seed}: tone ${prim.tone} has no colour`;
            else if (prim.pts.length < 4 || prim.pts.length % 2) bad = `seed ${seed}: ${prim.pts.length} coordinates`;
            else if (prim.pts.some(v => !Number.isFinite(v) || Math.abs(v) > 0.62)) bad = `seed ${seed}: leaves its square`;
            else if (prim.k === 'poly' && prim.pts.length < 6) bad = `seed ${seed}: a polygon of under three points`;
        }
    }
    check(`${stamp.id}: 40 seeds, turned and flipped, stay in the square with colours for every tone`, !bad, bad);
}

console.log('\nseeds');
const same = JSON.stringify(buildStamp('tree', { seed: 42, rotation: 1 })) === JSON.stringify(buildStamp('tree', { seed: 42, rotation: 1 }));
check('the same seed and turn give the same stamp', same);
check('another seed gives another stamp', JSON.stringify(buildStamp('tree', { seed: 1 })) !== JSON.stringify(buildStamp('tree', { seed: 2 })));
check('the generator is deterministic', (() => { const a = makeRng(7); const b = makeRng(7); return [1, 2, 3].every(() => a() === b()); })());
check('the generator stays in [0, 1)', (() => { const r = makeRng(3); for (let i = 0; i < 1000; i++) { const v = r(); if (v < 0 || v >= 1) return false; } return true; })());
check('an unknown stamp builds nothing', buildStamp('nonsense').length === 0);
{
    const a = buildStamp('rock', { seed: 5 });
    const b = buildStamp('rock', { seed: 5, mirror: true });
    check('a flip mirrors x', a[0].pts[0] === -b[0].pts[0] && a[0].pts[1] === b[0].pts[1]);
    const c = buildStamp('rock', { seed: 5, rotation: Math.PI });
    check('a half turn negates both', Math.abs(a[0].pts[0] + c[0].pts[0]) < 1e-9 && Math.abs(a[0].pts[1] + c[0].pts[1]) < 1e-9);
}

console.log('\ncolour');
check('colour parses hex, short hex and rgba', parseColor('#ff8000').join() === '255,128,0' && parseColor('#f80').join() === '255,136,0' && parseColor('rgba(10, 20, 30, 0.7)').join() === '10,20,30');
check('colour refuses what it cannot read', parseColor('banana') === null && parseColor(null) === null);
{
    const natural = stampPalette('tree');
    const tinted = stampPalette('tree', 'rgba(200, 40, 40, 0.7)');
    check('a stamp with no tint keeps its own colours', natural.base === '#3f7d36');
    check('a tint becomes the base, with a darker dark and a lighter light', tinted.base === '#c82828' && parseColor(tinted.dark)[0] < 200 && parseColor(tinted.light)[1] > 40);
    check('every tone is a colour in a tint', TONES.every(t => /^#[0-9a-f]{6}$/.test(tinted[t])));
}

console.log('\ndrawing on the canvas');
{
    const calls = [];
    const graphics = new Proxy({}, { get: (_t, name) => (...args) => calls.push([name, ...args]) });
    drawStamp(graphics, buildStamp('tree', { seed: 3 }), stampPalette('tree'), { x: 500, y: 400, size: 100 });
    const polygons = calls.filter(c => c[0] === 'drawPolygon');
    const fills = calls.filter(c => c[0] === 'beginFill').length;
    check('every filled shape is begun, drawn and ended', fills === polygons.length && calls.filter(c => c[0] === 'endFill').length === fills);
    check('the shapes land around the point asked for', polygons.every(c => c[1].every((v, i) => i % 2 === 0 ? Math.abs(v - 500) < 70 : Math.abs(v - 400) < 70)));
    check('a shadow is drawn first, black and faint', calls.find(c => c[0] === 'beginFill')[1] === 0x000000 && calls.find(c => c[0] === 'beginFill')[2] < 0.5);
    const none = [];
    const quiet = new Proxy({}, { get: (_t, name) => (...args) => none.push([name, ...args]) });
    drawStamp(quiet, buildStamp('tree', { seed: 3 }), stampPalette('tree'), { x: 0, y: 0, size: 100, shadow: false });
    check('with shadow off there is none', none.filter(c => c[0] === 'beginFill' && c[1] === 0).length === 0);
    const lines = [];
    const drawn = new Proxy({}, { get: (_t, name) => (...args) => lines.push([name, ...args]) });
    drawStamp(drawn, buildStamp('stump', { seed: 2 }), stampPalette('stump'), { x: 0, y: 0, size: 100 });
    check('a line is moved to and drawn along', lines.some(c => c[0] === 'moveTo') && lines.some(c => c[0] === 'lineTo'));
}

console.log('\nthe picture in the window');
for (const stamp of STAMPS) {
    const svg = stampSvg(stamp.id, { tint: stamp.legacy ? '#264a8c' : null });
    check(`${stamp.id}: an SVG with shapes, no undefined or NaN`, svg.startsWith('<svg') && svg.includes('<path') && !/undefined|NaN/.test(svg));
}

console.log('\nwritten to the scene');
{
    const prims = buildStamp('tree', { seed: 9 });
    const docs = stampDrawingData(prims, stampPalette('tree'), { x: 1000, y: 800, size: 120, flags: { m: { stamp: { id: 'g' } } } });
    check('there is a Drawing for every shape, and none for a shadow', docs.length === prims.length);
    check('each is a polygon with enough points and a size', docs.every(d => d.shape.type === 'p' && d.shape.points.length >= 4 && d.shape.width >= 1 && d.shape.height >= 1));
    check('its size is a whole number, as the schema requires', docs.every(d => Number.isInteger(d.shape.width) && Number.isInteger(d.shape.height) && Number.isInteger(d.strokeWidth)));
    check('its points are measured from where the Drawing sits', docs.every(d => d.shape.points.every(v => v >= -0.0001)));
    check('it sits where the stamp was put', docs.every(d => Math.abs(d.x - 1000) < 100 && Math.abs(d.y - 800) < 100));
    check('a filled shape has a solid fill and a visible fill', docs.every(d => d.fillType === 1 && d.fillAlpha > 0));
    check('every Drawing has something to show', docs.every(d => (d.fillType !== 0 && d.fillAlpha > 0) || (d.strokeWidth > 0 && d.strokeAlpha > 0)));
    check('every Drawing carries the flag', docs.every(d => d.flags.m.stamp.id === 'g'));
    check('colours are #rrggbb', docs.every(d => /^#[0-9a-f]{6}$/i.test(d.fillColor) && /^#[0-9a-f]{6}$/i.test(d.strokeColor)));
    const stump = stampDrawingData(buildStamp('stump', { seed: 2 }), stampPalette('stump'), { x: 0, y: 0, size: 100, none: 0 });
    const ring = stump.find(d => d.fillType === 0);
    check('a line is a Drawing with no fill and a stroke', !!ring && ring.strokeWidth >= 1 && ring.strokeAlpha > 0);
    check('what is on top stays on top: sort follows the order', docs.every((d, i) => d.sort === i));
}

console.log('\nground patches');
{
    const patches = STAMPS.filter(s => s.category === 'ground');
    check('there are ground patches, in their own category', patches.length >= 4 && STAMP_CATEGORIES.some(c => c.id === 'ground'));
    check('they include dirt, gravel and sand', ['patch-dirt', 'patch-gravel', 'patch-sand'].every(id => isProceduralStamp(id)));
    for (const patch of patches) {
        const prims = buildStamp(patch.id, { seed: 4 });
        const layers = prims.filter(p => p.k === 'poly' && p.tone === 'base');
        check(`${patch.id}: layers of the ground, each more solid than the last`, layers.length >= 4 && layers.every((p, i) => i === 0 || p.alpha > layers[i - 1].alpha));
        check(`${patch.id}: the outer edge is faint, so it fades`, layers[0].alpha <= 0.12);
        check(`${patch.id}: each layer is inside the one before it`, layers.every((p, i) => { if (!i) return true; const reach = pts => Math.max(...pts.map(Math.abs)); return reach(p.pts) < reach(layers[i - 1].pts); }));
        check(`${patch.id}: it has texture over the middle`, prims.length > layers.length + 5);
        check(`${patch.id}: it is large against other stamps`, patch.squares >= 3);
        check(`${patch.id}: it has no shadow`, prims.every(p => !p.shadow));
        check(`${patch.id}: its texture stays inside its edge`, prims.filter(p => !layers.includes(p) && p.k === 'poly' && p.alpha !== 0.18).every(p => Math.hypot(p.pts[0], p.pts[1]) < 0.4));
    }
    check('written to the scene, the layers keep their fade as fill alpha', (() => { const docs = stampDrawingData(buildStamp('patch-dirt', { seed: 4 }), stampPalette('patch-dirt'), { x: 500, y: 500, size: 160 }); return docs[0].fillAlpha <= 0.12 && docs[4].fillAlpha >= 0.35 && docs.every(d => d.strokeWidth === 0); })());
}

console.log('\nfinding what is under the eraser');
{
    check('a point is its distance from a line', Math.abs(distanceToPolyline([0, 0, 100, 0], 50, 30) - 30) < 1e-9);
    check('beyond the end of a segment it is the distance to the end', Math.abs(distanceToPolyline([0, 0, 100, 0], 130, 40) - 50) < 1e-9);
    check('from a run of segments it is the nearest one', distanceToPolyline([0, 0, 100, 0, 100, 100], 90, 60) === 10);
    check('from one point it is the distance to it', distanceToPolyline([10, 10], 13, 14) === 5);
    check('from nothing it is infinite', distanceToPolyline([], 0, 0) === Infinity);
    const square = [0, 0, 100, 0, 100, 100, 0, 100];
    check('inside a polygon is inside', insidePolygon(square, 50, 50) && !insidePolygon(square, 150, 50) && !insidePolygon(square, 50, -5));
    const filled = { x: 200, y: 200, shape: { type: 'p', points: square }, fillType: 1, fillAlpha: 0.5, strokeWidth: 0, strokeAlpha: 0 };
    check('the eraser is on a filled shape inside it', drawingHit(filled, 250, 250, 10));
    check('or within its reach of the edge', drawingHit(filled, 195, 250, 10) && !drawingHit(filled, 180, 250, 10));
    const open = { x: 0, y: 0, shape: { type: 'p', points: [0, 0, 400, 0] }, fillType: 0, fillAlpha: 0, strokeWidth: 20, strokeAlpha: 1 };
    check('on an open line it is within its reach and half its width', drawingHit(open, 200, 35, 30) && !drawingHit(open, 200, 45, 30));
    check('a hollow shape is not hit from inside', !drawingHit({ ...filled, fillType: 0, fillAlpha: 0, strokeWidth: 4, strokeAlpha: 1 }, 250, 250, 10));
    check('nothing without a polygon is hit', !drawingHit({ x: 0, y: 0, shape: { type: 'r' } }, 0, 0, 10) && !drawingHit(null, 0, 0, 10));
    const m = 'coffee-pub-cartographer';
    check('a stamp, a path and a wall stroke are each a group', keptGroup({ [m]: { stamp: { id: 'a' } } }, m).key === 'stamp:a' && keptGroup({ [m]: { terrain: { id: 'b' } } }, m).key === 'terrain:b' && keptGroup({ [m]: { drawnWall: { id: 'c' } } }, m).key === 'drawnWall:c');
    check('anything else is not', keptGroup({}, m) === null && keptGroup(undefined, m) === null && keptGroup({ other: { stamp: { id: 'a' } } }, m) === null && keptGroup({ [m]: { autoWall: { run: 1 } } }, m) === null);
}

console.log('\nstamp sizes, in grid squares');
{
    check('a tree is 1, 3 and 6 squares across', stampSquares('tree', 'small') === 1 && stampSquares('tree', 'medium') === 3 && stampSquares('tree', 'large') === 6);
    check('small is a third and large double of medium, for every stamp', STAMPS.filter(s => !s.legacy).every(s => Math.abs(stampSquares(s.id, 'small') * 3 - s.squares) < 1e-9 && stampSquares(s.id, 'large') === s.squares * 2));
    check('medium is the default, and an unknown size is medium', stampSquares('tree') === 3 && stampSquares('tree', 'huge') === 3);
    check('every stamp but the markers has a size in squares', STAMPS.filter(s => !s.legacy).every(s => s.squares > 0) && STAMPS.filter(s => s.legacy).every(s => stampSquares(s.id) === null && s.scale === 1));
    check('a tree is bigger than a shrub, a shrub than a tuft of grass, and a pond bigger than a tree', stampById('tree').squares > stampById('shrub').squares && stampById('shrub').squares > stampById('grass').squares && stampById('pond').squares > stampById('tree').squares);
    check('a small tree is a square, so it is a character\'s size, and nothing is smaller than a third of one', STAMPS.filter(s => !s.legacy).every(s => stampSquares(s.id, 'small') >= 0.3));
}

console.log('\nterrain paths');
{
    const hand = [];
    for (let i = 0; i <= 60; i++) hand.push([100 + i * 7, 200 + 30 * Math.sin(i / 6)]);
    const path = smoothPath(hand, { spacing: 12 });
    check('a hand-drawn line is smoothed to a flat list of pairs', path.length >= 8 && path.length % 2 === 0 && path.every(Number.isFinite));
    check('the ends are kept where they were', path[0] === 100 && Math.abs(path[path.length - 2] - 520) < 1);
    check('too few points make no path', smoothPath([[1, 1]]).length === 0 && smoothPath([]).length === 0 && smoothPath(null).length === 0);
    check('a click with no drag makes no path', smoothPath([[5, 5], [5, 5]]).length === 0);
    check('every kind of path has an id, a label, an icon, a texture and every tone', TERRAINS.every(t => t.id && t.labelKey && t.icon && t.texture && ['dark', 'base', 'light', 'accent', 'accent2'].every(tone => /^#[0-9a-f]{6}$/i.test(t.palette[tone]))));
    check('there is dirt and gravel to lay', !!terrainById('dirt') && !!terrainById('gravel') && !terrainById('lava'));
    for (const terrain of TERRAINS) {
        const prims = buildTerrain(terrain.id, path, { width: 80, seed: 3 });
        const palette = terrainPalette(terrain.id);
        check(`${terrain.id}: an edge, the ground and a worn middle, then texture; every tone has a colour`, prims.length > 3 && prims.slice(0, 3).every(p => p.k === 'line') && prims.every(p => palette[p.tone] && p.pts.every(Number.isFinite)));
        check(`${terrain.id}: the ribbon is the width asked for, with a wider edge beneath`, prims[1].width === 80 && prims[0].width > 80 && prims[0].width < 100);
        check(`${terrain.id}: the same path and seed give the same texture`, JSON.stringify(prims) === JSON.stringify(buildTerrain(terrain.id, path, { width: 80, seed: 3 })));
        check(`${terrain.id}: the texture stays on the path`, prims.slice(3).every(p => { const x = p.pts[0]; const y = p.pts[1]; return x > 100 - 60 && x < 520 + 60 && y > 170 - 70 && y < 230 + 70; }));
        check(`${terrain.id}: the texture is held to the allowance`, buildTerrain(terrain.id, path, { width: 80, seed: 3, maxTexture: 10 }).length <= 3 + 10);
        check(`${terrain.id}: no texture when none is allowed`, buildTerrain(terrain.id, path, { width: 80, maxTexture: 0 }).length === 3);
        const svg = terrainSvg(terrain.id);
        check(`${terrain.id}: its picture is an SVG with a ribbon, no undefined or NaN`, svg.startsWith('<svg') && svg.includes('<path') && !/undefined|NaN/.test(svg));
    }
    check('another seed gives another texture', JSON.stringify(buildTerrain('gravel', path, { width: 80, seed: 1 })) !== JSON.stringify(buildTerrain('gravel', path, { width: 80, seed: 2 })));
    check('an unknown kind, no path or no width builds nothing', buildTerrain('lava', path, { width: 80 }).length === 0 && buildTerrain('dirt', [], { width: 80 }).length === 0 && buildTerrain('dirt', path, { width: 0 }).length === 0);
    const docs = stampDrawingData(buildTerrain('cobble', path, { width: 80, seed: 3, maxTexture: MAX_TEXTURE.scene }), terrainPalette('cobble'), { x: 0, y: 0, size: 1, solid: 1, none: 0 });
    check('written to the scene, a path is lines stroked at its width and the texture over them', docs.length > 3 && docs[1].fillType === 0 && docs[1].strokeWidth === 80 && docs[3].fillType === 1);
    check('and every Drawing has something to show and a whole-number size', docs.every(d => ((d.fillType !== 0 && d.fillAlpha > 0) || (d.strokeWidth > 0 && d.strokeAlpha > 0)) && Number.isInteger(d.shape.width) && Number.isInteger(d.shape.height)));
    check('the scene allowance is smaller than the canvas one', MAX_TEXTURE.scene < MAX_TEXTURE.canvas);
}

console.log('\nfitting an opening onto a wall');
{
    const grid = 100;
    const wall = [0, 0, 1000, 0];
    const fit = (segment, walls = [wall]) => fitOpeningToWall(walls, segment, { grid });
    let r = fit([[300, 10], [400, -8]]);
    check('an opening along a wall is put on it, and the wall is left as two', r.segment.join() === '300,0,400,0' && r.pieces.length === 2 && r.pieces[0].join() === '0,0,300,0' && r.pieces[1].join() === '400,0,1000,0');
    r = fit([[400, 5], [300, -5]]);
    check('whichever way round it was drawn', r.segment.join() === '300,0,400,0');
    r = fit([[0, 4], [100, 4]]);
    check('at the start of a wall one piece is left, after it', r.pieces.length === 1 && r.pieces[0].join() === '100,0,1000,0');
    r = fit([[900, 4], [1000, 4]]);
    check('at the end, one piece, before it', r.pieces.length === 1 && r.pieces[0].join() === '0,0,900,0');
    r = fit([[1, 3], [998, -3]]);
    check('one that all but fills a wall takes the whole of it, and leaves nothing', r.pieces.length === 0 && r.segment.join() === '0,0,1000,0');
    check('one too far from the wall is not fitted', fit([[300, 80], [400, 80]]) === null);
    check('one only just in reach is', fit([[300, 45], [400, 45]]) !== null);
    check('one across the wall is not', fit([[500, -50], [500, 50]]) === null);
    check('one too short is not', fit([[300, 0], [315, 0]]) === null);
    check('one well past the end of a wall is not', fit([[1200, 0], [1300, 0]]) === null);
    check('one that runs a little off the end is clipped to the wall', (() => { const o = fit([[900, 0], [1040, 0]]); return o && o.segment[1].join() === '1000,0'; })());
    check('a wall too short to cut is left alone', fit([[0, 0], [30, 0]], [[0, 0, 40, 0]]) === null);
    r = fit([[300, 40], [400, 40]], [wall, [0, 100, 1000, 100]]);
    check('of two walls the nearer is the one cut', r.wall === 0);
    r = fit([[300, 70], [400, 70]], [wall, [0, 100, 1000, 100]]);
    check('and the other when it is nearer', r.wall === 1 && r.segment.join() === '300,100,400,100');
    r = fit([[100, 100], [100, 300]], [[100, 0, 100, 1000]]);
    check('a wall that runs down the map is cut along it', r.segment.join() === '100,100,100,300' && r.pieces.length === 2 && r.pieces[1].join() === '100,300,100,1000');
    r = fit([[100, 100], [300, 300]], [[0, 0, 1000, 1000]]);
    check('and one that runs on a slant', r.wall === 0 && r.pieces.length === 2);
}

console.log('\nwall strokes');
{
    const grid = point => [Math.round(point[0] / 100) * 100, Math.round(point[1] / 100) * 100];
    const straight = wallStrokeSegments({ shape: 'line', points: [[12, 8], [388, 14]], snap: grid });
    check('a straight stroke is one wall, snapped at both ends', straight.length === 1 && straight[0][0].join() === '0,0' && straight[0][1].join() === '400,0');
    const free = wallStrokeSegments({ shape: 'line', points: [[12, 8], [388, 14]] });
    check('with no snap it is where it was drawn, in whole pixels', free[0][0].join() === '12,8' && free[0][1].join() === '388,14');
    check('a stroke that snaps to nothing makes no wall', wallStrokeSegments({ shape: 'line', points: [[10, 10], [30, 20]], snap: grid }).length === 0);
    check('too few points make no wall', wallStrokeSegments({ shape: 'line', points: [[1, 1]] }).length === 0);
    const hand = [];
    for (let i = 0; i <= 40; i++) hand.push([i * 10, 3 * Math.sin(i)]);
    for (let i = 1; i <= 40; i++) hand.push([400, i * 10 + 2 * Math.sin(i)]);
    const sketch = wallStrokeSegments({ shape: 'sketch', points: hand, epsilon: 12, snap: grid });
    check('a freehand stroke along two sides is simplified to two or three walls', sketch.length >= 2 && sketch.length <= 3, `got ${sketch.length}`);
    check('freehand walls are one after another', sketch.every((seg, i) => i === 0 || seg[0].join() === sketch[i - 1][1].join()));
    check('freehand walls end on the snap grid', sketch.every(seg => seg.flat().every(v => v % 100 === 0)));
    const ring = [];
    for (let i = 0; i < 40; i++) ring.push([200 + 150 * Math.cos((i / 40) * Math.PI * 2), 200 + 150 * Math.sin((i / 40) * Math.PI * 2)]);
    ring.push([352, 202]);
    const closed = wallStrokeSegments({ shape: 'sketch', points: ring, epsilon: 20, closeDistance: 60, snap: grid });
    check('a ring that ends near its start is closed', closed.length >= 3 && closed[0][0].join() === closed[closed.length - 1][1].join());
    const path = segmentsPath(sketch);
    check('the path through the walls has a point for each end, with joins counted once', path.length === (sketch.length + 1) * 2);
    check('the path starts and ends where the walls do', path[0] === sketch[0][0][0] && path[path.length - 1] === sketch[sketch.length - 1][1][1]);
    const drawing = strokeDrawingData(path, { color: '#aa3322', alpha: 0.7, width: 6.4, flags: { f: 1 } });
    check('the line over the walls is an open polygon Drawing with a stroke and no fill', drawing.shape.type === 'p' && drawing.fillType === 0 && drawing.fillAlpha === 0 && drawing.strokeWidth === 6 && drawing.strokeAlpha === 0.7);
    check('and carries the flag', drawing.flags.f === 1);
    const shape = polygonShape([100, 200, 160, 250, 130, 300]);
    check('a polygon sits at the top left of its points, which are measured from there', shape.x === 100 && shape.y === 200 && shape.shape.points.join() === '0,0,60,50,30,100' && shape.shape.width === 60 && shape.shape.height === 100);
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);

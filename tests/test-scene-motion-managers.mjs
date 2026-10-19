// The scene-motion managers as they ship -- manager-parallax.js,
// manager-tilemotion.js and manager-collections.js -- loaded with their imports
// replaced by the real utils files and Foundry stubbed, then driven through
// what a GM does: turn groups on and off, add and duplicate layers, reorder,
// import from another scene, spin a tile, save and apply collections, and
// change scenes with the window open.
//
// Two bugs these caught while the feature was built: a change made before the
// tile state had loaded crashed on a groups list that did not yet exist, and
// the window had no rule for scenes with nothing to run.
import fs from 'node:fs';

let bad = 0;
const fail = (m) => { bad++; console.log('  FAIL  ' + m); };
const ok = (m) => console.log('  ok    ' + m);
const check = (cond, m) => (cond ? ok(m) : fail(m));

// --- load the real files ---------------------------------------------------
// Imports are stripped and their exports inlined: the utils files are
// self-contained, and the managers find each other through globals below.
const strip = file => fs.readFileSync(`scripts/${file}`, 'utf8')
    .replace(/^import[\s\S]*?from '[^']+';\r?$/gm, '')
    .replace(/^export (const|function|class) /gm, '$1 ');
const shared = `${strip('utils-motion.js')}\n${strip('utils-groups.js')}\n${strip('utils-travel.js')}\n`;
const load = async (source) => import('data:text/javascript,' + encodeURIComponent(source));

// --- Foundry, stubbed ------------------------------------------------------
const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
globalThis.PIXI = { UPDATE_PRIORITY: { NORMAL: 0 } };
let ids = 0;
let now = 0;
globalThis.foundry = { utils: {
    randomID: () => `id${++ids}`,
    deepClone: o => structuredClone(o),
    mergeObject: (a, b) => ({ ...a, ...b }),
    hasProperty: () => false,
    setProperty: (o, p, v) => { const k = p.split('.'); let t = o; for (const s of k.slice(0, -1)) t = t[s] ??= {}; t[k.at(-1)] = v; }
} };
globalThis.game = {
    user: { isGM: true },
    time: { get serverTime() { return now; } },
    modules: { get: () => null },
    i18n: { format: (_key, { name }) => `${name} (copy)`, localize: key => key },
    scenes: []
};
const flags = {};
const tileFlags = new Map();
const makeTile = id => ({
    id,
    getFlag: () => tileFlags.get(id),
    setFlag: async (_m, _k, v) => { tileFlags.set(id, structuredClone(v)); },
    unsetFlag: async () => { tileFlags.delete(id); }
});
const tiles = new Map([['a', makeTile('a')], ['b', makeTile('b')]]);
tiles.some = fn => [...tiles.values()].some(fn);
tiles[Symbol.iterator] = function* () { yield* tiles.values(); };
const scene = {
    id: 'here',
    tiles,
    // A 140-pixel square that is 5 feet, as the odometer reads it.
    grid: { size: 140, distance: 5, units: 'ft' },
    getFlag: (_m, k) => flags[k],
    setFlag: async (_m, k, v) => { flags[k] = structuredClone(v); }
};
globalThis.canvas = { ready: true, scene, app: { ticker: { add() {}, remove() {} } }, tiles: { get: () => null } };
globalThis.Hooks = { on: () => 0 };
// A stand-in window that reports its close the way the real one does.
globalThis.fakeWindowModule = { ParallaxWindow: { open: async manager => ({
    rendered: true, render() {}, bringToFront() {},
    async close() { this.rendered = false; manager.onWindowClosed(this); }
}) } };

await load(`const MODULE={ID:'m',NAME:'M'}; const repeatingTexture=t=>t;\n${shared}`
    + strip('manager-tilemotion.js').replace('const tileMotionManager', 'globalThis.tm'));
await load(`const MODULE={ID:'m',NAME:'M'}; const tileMotionManager=globalThis.tm; const releaseRepeatingTextures=()=>{}; const repeatingTexture=t=>t;\n${shared}`
    + strip('manager-parallax.js').replace('const parallaxManager', 'globalThis.pm')
        .replace("await import('./window-parallax.js')", 'globalThis.fakeWindowModule'));
await load(`const MODULE={ID:'m',NAME:'M'}; const parallaxManager=globalThis.pm; const tileMotionManager=globalThis.tm;\n${shared}`
    + strip('manager-collections.js').replace('const collectionsManager', 'globalThis.cm'));
const pm = globalThis.pm;
const tm = globalThis.tm;
const cm = globalThis.cm;
pm._applyState = async () => {};
tm._renderWindow = () => {};
const layersShown = () => pm.state.layers.filter(l => pm.isLayerShown(l)).map(l => l.name).join(',');
const tilesShown = () => [...tm.configs.keys()].filter(id => tm.isTileShown(id)).join(',');
const layer = (id, extra = {}) => ({ id, name: id, src: `${id}.webp`, visible: true, ...extra });

console.log('parallax groups');
flags.parallax = {
    layers: [layer('sky'), layer('hills'), layer('snow')],
    sets: [{ id: 'B', name: 'Base', layers: ['sky', 'hills'] }, { id: 'S', name: 'Snow', layers: ['snow'] }],
    activeSet: 'S'
};
pm.state = pm._readState();
check(JSON.stringify(pm.state.activeSets) === '["S"]' && !('activeSet' in pm.state), 'an older single active group migrates');
await pm.toggleSet('base');
check(layersShown() === 'sky,hills,snow', 'turning a second group on adds it');
await pm.setActiveSet('none');
check(layersShown() === '', 'None hides every layer');
await pm.setActiveSet('all');
check(layersShown() === 'sky,hills,snow', 'All shows every layer');
await pm.setActiveSets(['B', 'S']);
await pm.addLayer('moon.webp');
const moon = pm.state.layers.at(-1).id;
check(pm.state.sets.every(set => set.layers.includes(moon)), 'a layer added with groups on joins all of them');
await pm.removeSet('S');
check(JSON.stringify(pm.state.activeSets) === '["B"]', 'removing a group that is on leaves the others on');
await pm.removeSet('B');
check(pm.state.activeSets === null, 'removing the last group on falls back to All');

console.log('\nduplicating and reordering layers');
flags.parallax = {
    layers: [layer('far'), layer('mid'), layer('near'), layer('cloud', { overhead: true })],
    sets: [{ id: 'G', name: 'Grp', layers: ['mid'] }]
};
pm.state = pm._readState();
await pm.duplicateLayer('mid');
const order = () => pm.state.layers.map(l => l.name).join(',');
check(order() === 'far,mid,mid (copy),near,cloud', 'a copy lands just nearer than its original');
const copyId = pm.state.layers[2].id;
check(pm.state.sets[0].layers.includes(copyId), 'a copy joins its original\'s groups');
await pm.reorderLayer('far', 'near', true);
check(order() === 'mid,mid (copy),near,far,cloud', 'dropped on the near half of a row, a layer lands just nearer');
await pm.reorderLayer('far', 'cloud', true);
check(order() === 'mid,mid (copy),near,cloud,far' && pm.state.layers.at(-1).overhead, 'dropped beside an overhead layer, it crosses the token line');
await pm.setOverhead('far', false);
check(order() === 'mid,mid (copy),near,far,cloud' && !pm.state.layers.find(l => l.name === 'far').overhead,
    'moved back across the line, it is the nearest ground layer');
await pm.duplicateSet('G');
check(pm.state.sets.length === 2 && pm.state.sets[1].name === 'Grp (copy)' && pm.state.sets[1].id !== 'G', 'a group copies with a new id and name');

console.log('\ncopying between scenes');
const exported = pm.exportData();
check(exported.format === 'coffee-pub-cartographer.parallax' && exported.layers.every(l => l.offsetX === 0), 'an export carries its format and no positions');
// Found by id, not position: overhead layers sort after ground ones, so the
// appended layers are not simply the last few in the list.
const existing = new Set(pm.state.layers.map(l => l.id));
await pm.importData(exported, 'append');
const imported = pm.state.layers.filter(l => !existing.has(l.id));
check(imported.length === exported.layers.length && imported.every(l => !exported.layers.some(e => e.id === l.id)),
    'an appended import gets new ids, so nothing collides');
const importedGroup = pm.state.sets.at(-1);
check(importedGroup.layers.every(id => imported.some(l => l.id === id)), 'imported groups point at the imported layers');
await pm.importData({ ...exported, angle: 90 }, 'replace');
check(pm.state.layers.length === exported.layers.length && pm.state.angle === 90 && pm.state.activeSets === null,
    'a replacing import swaps everything out, settings included');
let threw = false;
try { pm.importData({ layers: [] }); } catch { threw = true; }
check(threw, 'a file that is not an export is refused');

console.log('\nthe odometer');
{
    flags.parallax = { layers: [layer('sky', { speed: 10 }), layer('road', { speed: 70 })], sets: [], easeSeconds: 0 };
    pm.state = pm._readState();
    check(pm.referenceLayer()?.name === 'road', 'it measures by the nearest ground layer unless told otherwise');
    await pm.play();
    now += 2000;
    check(Math.abs(pm.travelDistance(now) - 5) < 1e-9, '2 s at 70 px/s on a 140 px, 5 ft grid is 5 ft');
    await pm.setMasterSpeed(2);
    now += 1000;
    check(Math.abs(pm.travelDistance(now) - 10) < 1e-9, 'a speed change carries the distance on without a jump');
    await pm.setTravel({ scale: 60 });
    now += 1000;
    check(Math.abs(pm.travelDistance(now) - (10 + 5 * 60)) < 1e-9, 'the scale multiplies distance from the moment it is set');
    await pm.setMasterSpeed(-1);
    now += 1000;
    check(Math.abs(pm.travelDistance(now) - (310 - 2.5 * 60)) < 1e-9, 'running in reverse backs the odometer up');
    await pm.setTravel({ referenceLayer: pm.state.layers[0].id });
    check(pm.referenceLayer()?.name === 'sky', 'a chosen layer is measured instead');
    await pm.resetOdometer();
    check(pm.travelDistance(now) === 0, 'reset starts from zero');
    await pm.setTravel({ destination: 100, arrived: true });
    check(pm.state.travel.arrived === false, 'a new destination has not been reached yet');
    await pm.arrive();
    check(pm.state.travel.arrived && !pm.state.playing, 'arriving marks it and stops, by default');
}

console.log('\ntile groups and motion');
await tm.setTileMotion('a', 'visible', true);
await tm.setTileMotion('b', 'visible', true);
tm.refresh();
await tm.addGroup('Windmills', ['a']);
tm.refresh();
check(tilesShown() === 'a', 'a new group shows on its own');
const windmills = tm.motion.groups[0].id;
await tm.addGroup('Gates', ['b']);
tm.refresh();
await tm.toggleGroup('windmills');
tm.refresh();
check(tilesShown() === 'a,b', 'tile groups add together');
tiles.set('c', makeTile('c'));
await tm.setTileMotion('c', 'visible', true);
tm.refresh();
check(tm.motion.groups.every(group => group.tiles.includes('c')), 'a tile brought in joins every group on');
await tm.duplicateGroup(windmills);
tm.refresh();
check(tm.motion.groups.at(-1).name === 'Windmills (copy)', 'a tile group copies');
await tm.clearTileMotion('c');
tm.refresh();
check(!tm.configs.has('c') && tm.motion.groups.every(group => !group.tiles.includes('c')), 'a cleared tile leaves every group');
flags.tileMotion = { ...flags.tileMotion, activeGroups: undefined, activeGroup: windmills };
tm.refresh();
check(JSON.stringify(tm.motion.activeGroups) === JSON.stringify([windmills]), 'an older single tile group migrates');

console.log('\na spinning tile carries on through changes');
await tm.setEaseSeconds(0);
await tm.setTileMotion('a', 'rotate.enabled', true);
await tm.setTileMotion('a', 'rotate.speed', 90);
tm.refresh();
const startRot = tm.tilePose('a', now).rot;
await tm.play();
now += 2000;
check(Math.abs(tm.tilePose('a', now).rot - startRot - 180) < 1e-6, '2 s at 90 deg/s turns 180 degrees');
const mid = tm.tilePose('a', now).rot % 360;
await tm.setTileMotion('a', 'rotate.speed', -45);
tm.refresh();
check(Math.abs((tm.tilePose('a', now).rot % 360) - mid) < 1e-6, 'a speed change does not make it jump');
await tm.stop();
const held = tm.tilePose('a', now).rot;
now += 5000;
check(Math.abs(tm.tilePose('a', now).rot - held) < 1e-6, 'stopped, it holds its angle');

console.log('\nthe pivot stays put as a tile turns');
{
    const drawn = { anchor: { set(x, y) { this.x = x; this.y = y; } }, position: { set(x, y) { this.x = x; this.y = y; } }, angle: 0 };
    const tile = { document: { shape: { x: 500, y: 300, width: 200, height: 100, anchorX: 0.5, anchorY: 0.5, rotation: 30 } } };
    const config = { rotate: { enabled: true, pivotX: 0.9, pivotY: 0.2 }, scroll: { enabled: false } };
    const worldOf = (u, v) => {
        const a = drawn.angle * Math.PI / 180;
        const lx = (u - drawn.anchor.x) * 200;
        const ly = (v - drawn.anchor.y) * 100;
        return [drawn.position.x + lx * Math.cos(a) - ly * Math.sin(a), drawn.position.y + lx * Math.sin(a) + ly * Math.cos(a)];
    };
    tm._applyTransform(drawn, tile, config, { rot: 0 });
    const p0 = worldOf(0.9, 0.2);
    const centre = worldOf(0.5, 0.5);
    tm._applyTransform(drawn, tile, config, { rot: 123 });
    const p1 = worldOf(0.9, 0.2);
    check(Math.hypot(p0[0] - p1[0], p0[1] - p1[1]) < 1e-9, 'the pivot point does not move');
    check(Math.hypot(centre[0] - 500, centre[1] - 300) < 1e-9, 'at rest the tile sits where Foundry puts it');
}

console.log('\ncollections');
// The stand-in managers apply a look by assigning it, which is all a
// collection needs from them.
await cm.create('Everything', { layerGroups: null, tileGroups: null });
check(cm.current()?.name === 'Everything', 'a new collection is applied, so it is current');
await cm.create('Windmills Only', { layerGroups: [], tileGroups: [windmills] });
check(pm.state.activeSets.length === 0 && tm.motion.activeGroups[0] === windmills && cm.current()?.name === 'Windmills Only',
    'creating one switches both modes to its look');
await cm.apply('everything');
check(pm.state.activeSets === null && tm.motion.activeGroups === null && cm.current()?.name === 'Everything', 'applying a collection switches both modes');
tm.motion.activeGroups = [];
check(cm.current() === null, 'a change by hand leaves no collection current');
await cm.apply('everything');
await cm.edit(cm.find('Windmills Only').id, { name: 'Windmills', layerGroups: null, tileGroups: [windmills] });
check(cm.current()?.name === 'Everything' && cm.find('windmills')?.layerGroups === null,
    'editing a collection that is not showing changes it without touching the scene');
await cm.edit(cm.find('Everything').id, { name: 'Everything', layerGroups: [], tileGroups: null });
check(Array.isArray(pm.state.activeSets) && pm.state.activeSets.length === 0 && cm.current()?.name === 'Everything',
    'editing the one showing makes the scene follow');
await cm.duplicate(cm.list[0].id);
check(cm.list[1].name === 'Everything (copy)', 'a collection copies just after its original');
await cm.remove(cm.list[1].id);
check(cm.list.map(c => c.name).join(',') === 'Everything,Windmills', 'a collection is removed');
// Two collections with the same look: only one is current, the one last made or applied.
await cm.create('Also Everything', { layerGroups: [], tileGroups: null });
check(cm.current()?.name === 'Also Everything', 'of two identical looks, the one just made is current');
await cm.apply('everything');
check(cm.current()?.name === 'Everything', 'applying the other makes it the current one');

console.log('\nthe window follows the scene');
const configured = flags.parallax;
const empty = { layers: [], sets: [] };
const tileFlagsBackup = new Map(tileFlags);
tileFlags.clear();
pm.window = null;
flags.parallax = configured;
await pm.refresh({ sceneLoaded: true });
check(!pm.window?.rendered, 'it does not open by itself before the GM has opened it');
await pm.openWindow();
flags.parallax = empty;
await pm.refresh({ sceneLoaded: true });
check(!pm.window?.rendered && store.get('m.parallax.windowOpen') === 'true', 'on a scene with nothing to run it closes, and remembers it was open');
flags.parallax = configured;
await pm.refresh({ sceneLoaded: true });
check(!!pm.window?.rendered, 'back on a scene with motion, it reopens');
await pm.window.close();
await pm.refresh({ sceneLoaded: true });
check(!pm.window?.rendered && store.get('m.parallax.windowOpen') === 'false', 'closed by the GM, it stays closed');
for (const [k, v] of tileFlagsBackup) tileFlags.set(k, v);

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);

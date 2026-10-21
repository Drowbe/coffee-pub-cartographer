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
// Blacksmith's toasts and logging (utils-toast.js), as the core notifications the tests watch.
const toastStubs = 'const notify = (m, o = {}) => globalThis.ui?.notifications?.[o.type ?? "info"]?.(m); const log = () => {};\n';
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
globalThis.Hooks = { on: () => 0, callAll: (name, ...args) => { (globalThis.hookCalls ??= []).push([name, ...args]); return true; } };
// A stand-in window that reports its close the way the real one does.
globalThis.fakeWindowModule = { ParallaxWindow: { open: async manager => ({
    rendered: true, render() {}, bringToFront() {},
    async close() { this.rendered = false; manager.onWindowClosed(this); }
}) } };

await load(`const MODULE={ID:'m',NAME:'M'}; const repeatingTexture=t=>t;\n${toastStubs}${shared}`
    + strip('manager-tilemotion.js').replace('const tileMotionManager', 'globalThis.tm'));
// The routes manager is loaded later; parallax reaches it when it gets there.
const lateRoutes = `const routesManager = new Proxy({}, { get: (_, key) => (...args) => globalThis.rm?.[key]?.(...args) ?? null });\n`;
await load(`const MODULE={ID:'m',NAME:'M'}; const tileMotionManager=globalThis.tm; const releaseRepeatingTextures=()=>{}; const repeatingTexture=t=>t;\n${toastStubs}${shared}\n${strip('utils-routes.js')}\n${lateRoutes}`
    + strip('manager-parallax.js').replace('const parallaxManager', 'globalThis.pm')
        .replace("await import('./window-parallax.js')", 'globalThis.fakeWindowModule'));
await load(`const MODULE={ID:'m',NAME:'M'}; const parallaxManager=globalThis.pm; const tileMotionManager=globalThis.tm;\n${toastStubs}${shared}`
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
    await pm.setMasterSpeed(-1);
    now += 1000;
    check(Math.abs(pm.travelDistance(now) - 7.5) < 1e-9, 'running in reverse backs the odometer up');
    await pm.setTravel({ referenceLayer: pm.state.layers[0].id });
    check(pm.referenceLayer()?.name === 'sky', 'a chosen layer is measured instead');
    await pm.resetOdometer();
    check(pm.travelDistance(now) === 0, 'reset starts from zero');
    await pm.setTravel({ destination: 100, arrived: true });
    check(pm.state.travel.arrived === false, 'a new destination has not been reached yet');
    await pm.arrive();
    check(pm.state.travel.arrived && !pm.state.playing, 'arriving marks it and stops, by default');
}

console.log('\nthe pace');
{
    flags.parallax = { layers: [layer('sky', { speed: 10 }), layer('road', { speed: 70 })], sets: [], easeSeconds: 0 };
    pm.state = pm._readState();
    // 70 px/s on a 140 px, 5 ft grid is 2.5 ft/s: 9,000 ft an hour.
    check(Math.abs(pm.groundPace() - 9000) < 1e-9, 'the pace is the ground layer\'s speed on the grid');
    await pm.setGroundPace(3 * 5280);
    const [sky, road] = pm.state.layers;
    check(road.speed === 123.2, 'a pace of 3 mph sets the ground to 123.2 px/s');
    check(sky.speed === 17.6, 'and the other layers scale with it, keeping the depth');
    check(Math.abs(pm.groundPace() - 3 * 5280) < 1e-6, 'reading the pace back gives 3 mph');
    await pm.updateLayer(road.id, { speed: 0 });
    await pm.setGroundPace(9000);
    check(pm.state.layers[1].speed === 70 && pm.state.layers[0].speed === 17.6, 'from a standing start only the ground changes');
}

console.log('\nthe odometer, following the world clock');
{
    flags.parallax = { layers: [layer('road', { speed: 70 })], sets: [], easeSeconds: 0, masterSpeed: 1 };
    pm.state = pm._readState();
    await pm.syncClockRate(60);
    await pm.setFollowClock(true);
    check(pm.state.clockFactor === 4, 'at x60 the scenery runs at most four times its pace');
    await pm.resetOdometer();
    await pm.play();
    now += 60 * 1000;
    // A real minute at x60 is an in-world hour: 9,000 ft at 2.5 ft/s.
    check(Math.abs(pm.travelDistance(now) - 9000) < 1e-6, 'but a real minute at x60 still covers an hour of road');
    await pm.syncClockRate(2);
    check(pm.state.clockFactor === 2, 'under the cap the scenery follows the clock exactly');
    now += 60 * 1000;
    check(Math.abs(pm.travelDistance(now) - (9000 + 300)) < 1e-6, 'and the odometer accrues at the new rate from then');
    await pm.syncClockRate(0);
    const held = pm.travelDistance(now);
    now += 60 * 1000;
    check(pm.travelDistance(now) === held && pm.state.clockFactor === 0, 'a stopped clock stops the odometer and the scenery');
    await pm.setFollowClock(false);
    check(pm.state.clockFactor === 1 && pm.state.travel.clockMotion.playing === false, 'not following, the clock no longer drives anything');
    await pm.stop();

    flags.parallax = { layers: [], sets: [], travel: { source: 'clock', scale: 60, speedPerHour: 100, clockBaseRate: 2 } };
    const migrated = pm._readState().travel;
    check(migrated.followClock && !('scale' in migrated) && !('source' in migrated) && !('speedPerHour' in migrated),
        'an older save that followed the clock still does, without the old settings');
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

console.log('\nroutes: who may change what');
{
    const sent = [];
    const warned = [];
    globalThis.ui = { notifications: { warn: m => warned.push(m), info: () => {} } };
    const gm = { id: 'gm', isGM: true, active: true, isSelf: true, name: 'GM' };
    const ana = { id: 'ana', isGM: false, active: true, name: 'Ana' };
    const bo = { id: 'bo', isGM: false, active: true, name: 'Bo' };
    const users = new Map([[gm.id, gm], [ana.id, ana], [bo.id, bo]]);
    game.users = { get: id => users.get(id), activeGM: gm };
    game.scenes = Object.assign([], { get: id => (id === scene.id ? scene : null), contents: [scene] });
    await load(`const MODULE={ID:'m',NAME:'M'}; const cartographerToolbar={registerTool(){}};`
        + `const socketManager={registerToolHandlers(){}, broadcast: async (...args) => globalThis.routesSent.push(args)};\n`
        + `${toastStubs}${shared}\n${strip('utils-routes.js')}\n`
        + strip('manager-routes.js').replace('const routesManager', 'globalThis.rm'));
    globalThis.routesSent = sent;
    const line = [[0, 0], [140, 0], [140, 280]];

    const theirs = await rm._apply({ action: 'create', sceneId: 'here', route: { name: 'Ana road', points: line } }, ana);
    const mine = await rm._apply({ action: 'create', sceneId: 'here', route: { name: 'GM road', points: line } }, gm);
    check(theirs.userId === 'ana' && mine.userId === 'gm', 'a route belongs to whoever drew it');
    check(Math.abs(rm.measure(theirs).distance - 15) < 1e-9, 'it measures 420 px on a 140 px, 5 ft grid as 15 ft');

    await rm._apply({ action: 'update', sceneId: 'here', id: mine.id, changes: { name: 'Mine now' } }, ana);
    await rm._apply({ action: 'remove', sceneId: 'here', id: mine.id }, bo);
    check(rm.get(mine.id)?.name === 'GM road', 'a player cannot rename or delete a route that is not theirs');
    await rm._apply({ action: 'update', sceneId: 'here', id: theirs.id, changes: { name: 'Ana\'s road', points: [[0, 0], [280, 0]] } }, ana);
    check(rm.get(theirs.id).name === 'Ana\'s road' && rm.get(theirs.id).points.length === 2, 'its maker can rename and reshape it');
    await rm._apply({ action: 'update', sceneId: 'here', id: theirs.id, changes: { points: [[5, 5]] } }, ana);
    check(rm.get(theirs.id).points.length === 2, 'a route cannot be reshaped to fewer than two waypoints');
    await rm._apply({ action: 'update', sceneId: 'here', id: theirs.id, changes: { hidden: true } }, ana);
    const seen = user => rm.visibleRoutes(scene, user).map(r => r.name).join(',');
    check(seen(bo) === 'GM road' && seen(ana) === 'Ana\'s road,GM road' && seen(gm) === 'Ana\'s road,GM road',
        'a hidden route is seen only by its maker and the GM');
    await rm._apply({ action: 'update', sceneId: 'here', id: theirs.id, changes: { color: 'javascript:alert(1)' } }, ana);
    check(rm.get(theirs.id).color !== 'javascript:alert(1)', 'only the palette\'s colours are accepted');

    // Two players' routes arriving together both land.
    await Promise.all([
        rm._apply({ action: 'create', sceneId: 'here', route: { name: 'A', points: line } }, ana),
        rm._apply({ action: 'create', sceneId: 'here', route: { name: 'B', points: line } }, bo)
    ]);
    check(rm.routes().length === 4, 'changes made at the same moment do not overwrite each other');

    const was = game.user;
    game.user = ana;
    await rm.remove(theirs.id);
    check(sent.length === 1 && sent[0][1] === 'request' && sent[0][2].userId === 'ana', 'a player\'s change is sent to the GM, not written');
    game.users.activeGM = null;
    await rm.remove(theirs.id);
    check(sent.length === 1 && warned.length === 1, 'with no GM online the player is told it cannot be saved');
    game.users.activeGM = gm;
    game.user = gm;
    rm._handleRequest({ action: 'remove', sceneId: 'here', id: theirs.id, userId: 'ana' });
    await rm._queue;
    check(!rm.get(theirs.id), 'the GM carries out a player\'s change to their own route');
    game.user = was;

    console.log('\njourneys');
    flags.routes = { list: [], journeys: [] };
    const r1 = await rm._apply({ action: 'create', sceneId: 'here', route: { name: 'One', points: [[0, 0], [140, 0]] } }, gm);
    const r2 = await rm._apply({ action: 'create', sceneId: 'here', route: { name: 'Two', points: [[280, 0], [140, 0]] } }, ana);
    const j = await rm._apply({ action: 'journey-create', sceneId: 'here', journey: { name: 'Trip', routeIds: [r1.id, r2.id, 'nope'] } }, ana);
    check(j.userId === 'ana' && j.routeIds.join() === `${r1.id},${r2.id}`, 'a journey keeps only routes that exist, and belongs to its maker');
    const path = rm.path({ journeyId: j.id });
    check(JSON.stringify(path.points) === '[[0,0],[140,0],[280,0]]' && path.gaps.length === 0, 'a journey runs its routes end to end, the second reversed');
    check(Math.abs(rm.linked({ sceneId: 'here', journeyId: j.id }, 'ft').converted - 10) < 1e-9, 'an odometer can follow a journey: 280 px is 10 ft');
    await rm._apply({ action: 'journey-update', sceneId: 'here', id: j.id, changes: { name: 'Mine' } }, bo);
    check(rm.getJourney(j.id).name === 'Trip', 'only its maker or the GM can change a journey');
    await rm._apply({ action: 'journey-update', sceneId: 'here', id: j.id, changes: { routeIds: [r2.id, r1.id] } }, ana);
    check(rm.getJourney(j.id).routeIds[0] === r2.id, 'its maker can reorder it, using anyone\'s routes');
    await rm._apply({ action: 'update', sceneId: 'here', id: r2.id, changes: { terrain: ['swamp', 'extra'] } }, ana);
    check(rm.get(r2.id).terrain.join() === 'swamp', 'terrain is one per leg');
    await rm._apply({ action: 'remove', sceneId: 'here', id: r1.id }, gm);
    check(rm.getJourney(j.id).routeIds.join() === r2.id, 'a deleted route leaves the journeys it was in');
    await rm._apply({ action: 'journey-remove', sceneId: 'here', id: j.id }, ana);
    check(!rm.getJourney(j.id) && rm.get(r2.id), 'deleting a journey leaves its routes');

    console.log('\nprogress lives on the routes; a journey reads it');
    // 50 ft of road, then 50 ft of forest, on a 140 px, 5 ft grid.
    flags.routes = { list: [], journeys: [] };
    const road = await rm._apply({ action: 'create', sceneId: 'here', route: { name: 'Road', points: [[0, 0], [1400, 0]] } }, gm);
    const wood = await rm._apply({ action: 'create', sceneId: 'here', route: { name: 'Wood', points: [[1400, 0], [2800, 0]], terrain: ['forest'] } }, gm);
    const trip = await rm._apply({ action: 'journey-create', sceneId: 'here', journey: { name: 'Trip', routeIds: [road.id, wood.id] } }, gm);
    const link = { sceneId: 'here', journeyId: trip.id };
    // The ground scrolls 140 px a second: 5 ft a second, 18,000 ft an hour.
    flags.parallax = { layers: [layer('ground', { speed: 140 })], sets: [], easeSeconds: 0, masterSpeed: 1 };
    pm.state = pm._readState();
    pm._pushed = null;
    await pm.setTravel({ route: link, destination: 100 });
    check(rm.get(road.id).travel.pace === 18000 && !rm.getJourney(trip.id).travel, 'the scene\'s pace is written to the journey\'s first route, not the journey');
    await pm.play();
    check(rm.get(road.id).travel.motion.playing === true && rm.settings().active?.journeyId === trip.id && rm.settings().active.routeId === road.id,
        'Play on the scene sets out on the journey: its first route plays, and the map follows the journey');
    now += 5000;
    check(Math.abs(pm.travelDistance(now) - 25) < 1e-6, 'the odometer reads the journey: 5 s on the road is 25 ft');
    now += 10000;
    check(Math.abs(rm.progress({ sceneId: 'here', routeId: road.id }, now).distance - 50) < 1e-6, 'the road ends after 10 s');
    // The GM's watch goes on to the next route; done here by hand, as it would be.
    const roadNow = rm.progress({ sceneId: 'here', routeId: road.id }, now);
    await rm.journeyStep(link, 1, { effort: roadNow.rawEffort - roadNow.totalEffort, steady: true });
    check(rm.settings().active.routeId === wood.id && rm.get(wood.id).travel.motion.playing && !rm.get(road.id).travel.motion.playing,
        'at the end of a route, the party goes on to the next route of the journey');
    // 50 ft of road in 10 s, then 5 s of forest at half pace: 12.5 ft more.
    check(Math.abs(pm.travelDistance(now) - 62.5) < 1e-6, 'carrying on past the junction, at half pace in the forest: 15 s is 62.5 ft');
    const at = rm.progress(link, now);
    check(at.factor === 0.5 && at.terrain === 'forest' && Math.abs(at.point.x - 1750) < 1e-6 && at.journey.index === 1,
        'the journey knows the route, its terrain and the point on the map');
    const { motionSpeed } = await import('../scripts/utils-motion.js');
    check(Math.abs(motionSpeed(pm.state, now) - 1) < 1e-12, 'the scenery keeps its own speed on difficult ground: only the trip slows');
    now += 30000;
    check(Math.abs(pm.travelDistance(now) - 100) < 1e-6, 'it stops counting at the journey\'s end');
    await pm.setTravel({ route: null });
    const kept = rm.progress(link, now + 60000);
    check(kept.travel.motion.playing === false && Math.abs(kept.distance - 100) < 1e-6, 'unlinked, the journey stops and keeps its progress');
    check((pm.state.terrainFactor ?? 1) === 1, 'and the scenery runs at its own pace again');
    await pm.setTravel({ route: link });
    await pm.resetOdometer();
    check(rm.progress(link, now).distance === 0 && rm.settings().active.routeId === road.id, 'resetting the odometer takes the journey back to its first route');
    await pm.stop();

    console.log('\nthe party\'s marker');
    // A stand-in for Blacksmith's pins API: placed pins, and the live positions it is given.
    const stored = new Map();
    const live = new Map();
    const pinsApi = {
        isAvailable: () => true,
        registerPinType() {},
        exists: id => stored.has(id),
        get: id => structuredClone(stored.get(id) ?? null),
        create: async (data, { sceneId }) => { stored.set(data.id, { ...structuredClone(data), sceneId }); return data; },
        update: async (id, patch) => { stored.set(id, { ...stored.get(id), ...structuredClone(patch) }); return stored.get(id); },
        delete: async id => { stored.delete(id); },
        setLivePosition: (id, point) => live.set(id, { ...point }),
        clearLivePosition: id => live.delete(id),
        getLivePosition: id => live.get(id) ?? null
    };
    game.modules = { get: id => (id === 'coffee-pub-blacksmith' ? { api: { pins: pinsApi } } : null) };
    globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OBSERVER: 2 } };
    await load(`const MODULE={ID:'m',NAME:'M'}; const routesManager=globalThis.rm;\n`
        + strip('manager-travelpins.js').replace('const travelPinsManager', 'globalThis.tp').replace(/^export \{[^}]*\};?$/m, ''));
    const pinId = 'm-party-here';
    const wait = () => new Promise(resolve => setTimeout(resolve, 20));
    const tick = async () => { tp._lastSave = -Infinity; tp._tick(); await wait(); };
    await pm.setTravel({ route: link });
    await rm.setSettings({ active: { journeyId: trip.id } });
    await tick();
    check(stored.get(pinId)?.x === 0 && stored.get(pinId)?.type === 'journey', 'the map gets one party marker, at the start of the road it runs');
    await pm.play();
    now += 5000;
    await tick();
    check(live.get(pinId)?.x === 700 && stored.get(pinId).x === 0, 'while the party travels, the marker moves live and nothing is saved');
    await pm.stop();
    await tick();
    check(stored.get(pinId).x === 700, 'at rest, the GM saves where it stopped');
    await tick();
    check(!live.has(pinId), 'and each client lets go of the live position once the saved one has caught up');
    // A live position left over from the trip the party was on -- one this client
    // has forgotten setting, as when the GM picks the marker up -- must not go on
    // drawing the marker there.
    live.set(pinId, { x: 0, y: 0 });
    await tick();
    check(!live.has(pinId), 'a live position left over is let go once the marker is where the party is');
    await rm.setSettings({ offRoute: true });
    live.set(pinId, { x: 0, y: 0 });
    await tick();
    check(!live.has(pinId), 'and set down off every route, the marker is drawn where it was put, not where the last trip left it');
    await rm.setSettings({ offRoute: false });
    await tp.setShown('here', false);
    check(stored.get(pinId).config.blacksmithVisibility === 'hidden' && !tp.isShown('here'), 'the marker can be hidden from players');
    const configured = [];
    pinsApi.configure = async (id, options) => { configured.push([id, options?.sceneId]); };
    await tp.configure('here');
    check(configured.at(-1)?.[0] === pinId && configured.at(-1)?.[1] === 'here', 'Change look opens Blacksmith\'s Configure Pin for the marker');
    const keptPin = stored.get(pinId);
    stored.delete(pinId);
    await tp.configure('here');
    check(stored.has(pinId) && configured.length === 2, 'before there is a marker, Change look makes one to style');
    stored.set(pinId, keptPin);
    const withoutLive = pinsApi.setLivePosition;
    delete pinsApi.setLivePosition;
    await pm.play();
    now += 2000;
    await tick();
    check(!live.has(pinId) && stored.get(pinId).x === 700, 'without Blacksmith\'s live position, the marker waits to be saved at rest');
    pinsApi.setLivePosition = withoutLive;
    await pm.stop();
    stored.set(`m-travel-j-${trip.id}`, { id: `m-travel-j-${trip.id}` });
    await tp._removeOldPins();
    check(!stored.has(`m-travel-j-${trip.id}`) && stored.has(pinId), 'markers from the version with one per journey are removed; the party marker stays');
    game.modules = { get: () => null };

    console.log('\nrunning a journey from the map');
    const settle = () => new Promise(resolve => setTimeout(resolve, 20));
    const warnings = [];
    ui.notifications.warn = m => warnings.push(m);
    await load(`const MODULE={ID:'m',NAME:'M'}; const cartographerToolbar={registerTool(){}}; const routesManager=globalThis.rm; const parallaxManager=globalThis.pm;`
        + `const travelManager={ constructor: { clockApi: () => null } };\n${toastStubs}${shared}\n${strip('utils-routes.js')}\n`
        + strip('manager-journeys.js').replace('const journeysManager', 'globalThis.jm').replace(/^export \{[^}]*\};?$/m, ''));
    // The map: 50 ft of road and 50 ft of forest, as before.
    flags.routes = { list: [], journeys: [] };
    const m1 = await rm._apply({ action: 'create', sceneId: 'here', route: { name: 'Road', points: [[0, 0], [1400, 0]] } }, gm);
    const m2 = await rm._apply({ action: 'create', sceneId: 'here', route: { name: 'Wood', points: [[1400, 0], [2800, 0]], terrain: ['forest'] } }, gm);
    const walk = await rm._apply({ action: 'journey-create', sceneId: 'here', journey: { name: 'Walk', routeIds: [m1.id, m2.id] } }, gm);
    const go = { sceneId: 'here', journeyId: walk.id };
    flags.parallax = { layers: [], sets: [] };
    pm.state = pm._readState();
    await jm.play(go);
    check(warnings.length === 0 && jm.isPlaying(go) && rm.progress(go).travel.pace === 3 * 5280, 'a journey with no pace chosen sets out at the normal pace: walking, 3 mph');
    await jm.stop(go);
    await rm.setPathTravel(go, { pace: 0 });
    await jm.play(go, 18000);
    check(jm.isPlaying(go) && rm.progress(go).travel.pace === 18000 && rm.progress(go).travel.motion.easeSeconds === 2,
        'played from the map, it sets out at the pace chosen, easing up');
    check(jm.activeLink()?.journeyId === walk.id, 'and becomes the journey the map\'s Play button runs');
    now += 2000 + 5000;
    // 2 s of ease (smoothstep averages half speed: 5 ft), then 5 s at 5 ft/s.
    check(Math.abs(rm.progress(go).distance - 30) < 1e-6, 'it travels on the map with no animated scene: 30 ft after the ease and 5 s');
    await jm.stop(go);
    check(!jm.isPlaying(go), 'Stop stops it');
    await jm.reset(go);
    check(rm.progress(go).distance === 0, 'reset takes it back to the start');

    // An animated scene, not on the canvas, that follows the journey.
    const animFlags = { parallax: { layers: [layer('ground', { speed: 140 })], sets: [], easeSeconds: 0, masterSpeed: 1, travel: { route: go } } };
    const anim = {
        id: 'anim', name: 'The Road', grid: { size: 140, distance: 5, units: 'ft' },
        getFlag: (_m, k) => animFlags[k],
        setFlag: async (_m, k, v) => { animFlags[k] = structuredClone(v); }
    };
    game.scenes = Object.assign([scene, anim], { get: id => [scene, anim].find(s => s.id === id) ?? null, contents: [scene, anim] });
    check(jm.linkedScenes(go).map(s => s.id).join() === 'anim', 'the map knows which animated scenes follow the journey');
    await jm.setPace(go, 9000);
    check(animFlags.parallax.layers[0].speed === 140 && rm.progress(go).travel.pace === 9000,
        'the pace is the trip\'s, set on the map; the following scene keeps its scenery\'s speed');
    await jm.play(go);
    check(animFlags.parallax.playing === true && jm.isPlaying(go), 'Play on the map plays the scene that follows it, though it is not on the canvas');
    now += 25000;
    // 25 s at 2.5 ft/s: 50 ft of road, into the forest.
    jm._lastWatch = -Infinity;
    jm._watch();
    await settle();
    check((animFlags.parallax.terrainFactor ?? 1) === 1, 'reaching the forest slows the trip, not that scene\'s scenery');
    now += 60000;
    jm._lastWatch = -Infinity;
    jm._watch();
    await settle();
    check(!jm.isPlaying(go) && rm.progress(go).travel.arrived && animFlags.parallax.playing === false && animFlags.parallax.travel.arrived,
        'at the end, the GM\'s client stops the journey and the scene, and marks them arrived');
    await jm.play(go);
    check(jm.isPlaying(go) && rm.progress(go).distance === 0, 'playing an arrived journey sets out again from the start');
    await jm.setSpeed(go, 600);
    check(rm.progress(go).travel.motion.masterSpeed === 600 && animFlags.parallax.masterSpeed === 1,
        'the time rate is the trip\'s; the following scene\'s scenery keeps its own speed');
    await jm.setSpeed(go, -10);
    check(rm.progress(go).travel.motion.masterSpeed === 10, 'time only runs onward: which way is the trip\'s direction');
    await jm.stop(go);
    game.scenes = Object.assign([scene], { get: id => (id === scene.id ? scene : null), contents: [scene] });

    console.log('\nrunning a single route, and what is drawn meanwhile');
    const lone = await rm._apply({ action: 'create', sceneId: 'here', route: { name: 'Lone', points: [[0, 500], [1400, 500]] } }, gm);
    const one = { sceneId: 'here', routeId: lone.id };
    now += 3000; // past the ease to a stop
    check(rm.travellingRouteIds() === null, 'with nothing moving, every route is drawn');
    await jm.play(one, 18000);
    check(jm.isPlaying(one) && jm.activeLink()?.routeId === lone.id, 'a single route can be run, and becomes the one the map\'s bar runs');
    check([...rm.travellingRouteIds()].join() === lone.id, 'while it runs, only it is drawn');
    await jm.stop(one);
    await jm.setSpeed(go, 1);
    await jm.play(go);
    const shown = rm.travellingRouteIds();
    check(shown.size === 2 && shown.has(m1.id) && shown.has(m2.id) && !shown.has(lone.id), 'while a journey runs, only its routes are drawn');
    await jm.stop(go);

    console.log('\nfollowing the world clock: place goes with the date and time');
    let world = 100000;
    Object.defineProperty(game.time, 'worldTime', { get: () => world, configurable: true });
    await jm.reset(one);
    await jm.setPace(one, 3600);
    await jm.setFollowClock(one, true);
    check(rm.progress(one).travel.followClock === true, 'a route run from the map can follow the world clock');
    await jm.play(one);
    world += 25;
    // 1 ft each in-world second, whatever real time does.
    now += 999999;
    check(Math.abs(rm.progress(one).distance - 25) < 1e-6, 'it travels with in-world time, not real time');
    world += 3600;
    check(Math.abs(rm.progress(one).distance - 50) < 1e-6, 'scrubbing time forward moves the party on, to the end');
    check(rm.progress(one).moving === false && rm.travellingRouteIds() === null, 'at the end of the way they are not moving, and every route is drawn');
    world -= 3600 - 10;
    check(Math.abs(rm.progress(one).distance - 35) < 1e-6, 'scrubbing back moves them back to where they were then');
    check(rm.progress(one).moving === true && [...rm.travellingRouteIds()].join() === lone.id,
        'and shows them travelling again: only their route is drawn');
    await jm.stop(one);
    world += 600;
    check(Math.abs(rm.progress(one).distance - 35) < 1e-6, 'stopped, time passing does not move them');
    world -= 615;
    check(Math.abs(rm.progress(one).distance - 20) < 1e-6, 'but scrubbing back past the stop puts them where they were');
    check(rm.progress(one).moving === true, 'scrubbed back to before the stop, they are shown travelling');
    world += 15;
    check(rm.progress(one).moving === false, 'and after the stop, they are not moving');
    await jm.play(go);
    await jm.play(one);
    check(jm.isPlaying(one) && !jm.isPlaying(go), 'one party: setting out on one route stops the journey that was moving');
    await jm.stop(one);
    await jm.setFollowClock(one, false);
    now += 5000;
    check(!rm.progress(one).travel.followClock && rm.progress(one).travel.timeline.length === 0, 'off the clock, the timeline is dropped and real time drives it again');

    console.log('\nthe world clock is the map\'s setting');
    await jm.setMapClock(scene, true);
    check(rm.settings().followClock === true, 'the map follows the clock');
    check(rm.progress(one).travel.followClock && rm.progress(go).travel.followClock, 'and so does every route and journey on it that has set out');
    await jm.reset(one);
    await jm.setSpeed(one, 10);
    await jm.play(one);
    const startWorld = world;
    world += 20;
    check(Math.abs(rm.progress(one).distance - 20) < 1e-6, 'with the clock, the party goes at its pace, whatever the rate set');
    await jm.setDirection(one, true);
    world += 5;
    // Turned round 20 ft along a 50 ft route: 30 ft from the far end, then 5 more back.
    check(Math.abs(rm.progress(one).distance - 35) < 1e-6 && Math.abs(rm.progress(one).point.x - 15 * 28) < 1e-6,
        'turned round, back along the way at the same pace');
    await jm.setDirection(one, false);
    await jm.stop(one);
    world = startWorld + 25;
    const scenery = pm._readState();
    check(JSON.stringify(pm._journeyMotion(scenery)) === JSON.stringify({ playing: !!scenery.playing }),
        'a following scene tells the trip only Play and Stop');
    const late = await rm._apply({ action: 'create', sceneId: 'here', route: { name: 'Late', points: [[0, 900], [1400, 900]] } }, gm);
    await jm.play({ sceneId: 'here', routeId: late.id }, 3600);
    check(rm.progress({ sceneId: 'here', routeId: late.id }).travel.followClock === true, 'a route setting out later takes up the map\'s setting');
    await jm.stop({ sceneId: 'here', routeId: late.id });
    // The clock at x240, its last update a second ago: the estimate runs 240 s ahead of it.
    const lateHere = { sceneId: 'here', routeId: late.id };
    const modulesBefore = game.modules;
    game.modules = { get: id => (id === 'coffee-pub-blacksmith' ? { api: { worldClock: { running: true, rate: 240 } } } : null) };
    rm._worldSeenAt = performance.now() - 1000;
    await rm.setPathTravel(lateHere, { effort: 30 });
    check(Math.abs(rm.progress(lateHere, now, world).distance - 30) < 1e-6,
        'a change is stamped with the clock\'s own time, so when the clock catches up the party is still where it was put');
    game.modules = modulesBefore;
    rm._worldSeenAt = undefined;
    await jm.setMapClock(scene, false);
    check(!rm.settings().followClock && !rm.progress(one).travel.followClock, 'turned off, every route runs in real time again');
    await rm._apply({ action: 'update', sceneId: 'here', id: late.id, changes: { color: '#3A7BD5' } }, gm);
    check(rm.get(late.id).color === '#3a7bd5', 'any colour from the picker is kept');
    await rm._apply({ action: 'update', sceneId: 'here', id: late.id, changes: { color: 'red; background: url(x)' } }, gm);
    check(rm.get(late.id).color === '#3a7bd5', 'anything that is not a colour is refused');

    console.log('\nPlay at 0x');
    const lateLink = { sceneId: 'here', routeId: late.id };
    await jm.setSpeed(lateLink, 0);
    await jm.play(lateLink);
    check(rm.progress(lateLink).travel.motion.masterSpeed === 1, 'Play on a route at 0x sets out at 1x, rather than standing still');
    await jm.stop(lateLink);
    await pm.setMasterSpeed(0);
    await pm.play();
    check(pm.state.masterSpeed === 1 && pm.state.playing, 'and so does Play on an animated scene');
    await pm.stop();

    console.log('\nan animated scene playing a journey: the map shows it');
    await jm.play(lateLink, 3600);
    check(rm.settings().active?.routeId === late.id && jm.isPlaying(lateLink), 'the map shows the route its bar played');
    await pm.setTravel({ route: go });
    await pm.play();
    check(rm.settings().active?.journeyId === go.journeyId, 'played from an animated scene, the journey becomes the one its map shows: bar, odometer, marker');
    check(!jm.isPlaying(lateLink) && jm.isPlaying(go), 'and the route that was moving there stops: one party');
    await pm.stop();
    await pm.setTravel({ route: null });
    // A route set moving without its map hearing of it (before this was handled,
    // or by a macro): the map still shows what is moving, not the stale choice.
    await rm.setSettings({ active: { journeyId: go.journeyId } });
    await rm.setPathTravel(lateLink, { playing: true, pace: 3600, masterSpeed: 1 });
    check(rm.shownPath()?.routeId === late.id, 'the map shows the route that is moving, over the journey last played there');
    await rm.setPathTravel(lateLink, { playing: false });
    check(rm.shownPath()?.journeyId === go.journeyId, 'with nothing moving, it shows the one last played there');
    await rm.setSettings({ active: null });
    check(rm.shownPath() === null, 'with no route chosen there, it shows none, however far the party had come on one');
    await rm.setSettings({ active: { journeyId: go.journeyId } });
    // A route set going behind the map's back, while the journey is the active one.
    await rm.setPathTravel(lateLink, { playing: true, pace: 3600, masterSpeed: 1 });
    jm._lastWatch = -Infinity;
    jm._watch();
    await new Promise(resolve => setTimeout(resolve, 20));
    check(rm.settings().active?.routeId === late.id, 'a moving trip becomes the one its map shows, however it was set going');
    await jm.stop(lateLink);
    now += 3000;
    check(rm.shownPath()?.routeId === late.id, 'so stopping it leaves the map on it, not on the journey played before');
    await rm.setSettings({ active: { journeyId: go.journeyId } });

    console.log('\nputting the party down');
    const placed = new Map();
    let partyName = 'The Fellowship';
    game.modules = { get: id => (id === 'coffee-pub-blacksmith' ? { api: { pins: {
        isAvailable: () => true, registerPinType() {}, on() {},
        exists: pid => placed.has(pid), get: pid => placed.get(pid) ?? null,
        create: async data => { placed.set(data.id, { ...data }); },
        update: async (pid, patch) => { placed.set(pid, { ...placed.get(pid), ...patch }); }
    }, party: { actor: () => (partyName ? { name: partyName } : null) } } } : null) };
    await load(`const MODULE={ID:'m',NAME:'M'}; const routesManager=globalThis.rm; const journeysManager=globalThis.jm;\n${toastStubs}${shared}\n${strip('utils-routes.js')}\n`
        + strip('manager-travelpins.js').replace('const travelPinsManager', 'globalThis.tp2').replace(/^export \{[^}]*\};?$/m, ''));
    placed.set('m-party-here', { id: 'm-party-here', x: 0, y: 0 });
    await rm.setSettings({ active: { routeId: late.id } });
    await jm.play(lateLink, 3600);
    const onRoute = await tp2.placeParty(scene, { x: 700, y: 905 }, 24);
    check(onRoute.onRoute && onRoute.link.routeId === late.id && !jm.isPlaying(lateLink), 'dropped by a route, the party lands on it, stopped');
    check(Math.abs(rm.progress(lateLink).distance - 25) < 1e-6 && placed.get('m-party-here').y === 900,
        'its progress is where it landed, halfway along, and the marker sits on the line');
    await rm.setSettings({ active: { journeyId: go.journeyId } });
    const onJourney = await tp2.placeParty(scene, { x: 2100, y: 3 }, 24);
    check(onJourney.link.routeId === m2.id && Math.abs(rm.progress(onJourney.link).distance - 25) < 1e-6
        && rm.settings().active.journeyId === go.journeyId && Math.abs(rm.progress(go).distance - 75) < 1e-6,
        'dropped on a route of the journey the map follows, it lands on that route, 25 ft along, still on the journey: 75 ft of it');
    const offRoute = await tp2.placeParty(scene, { x: 5000, y: 5000 }, 24);
    check(!offRoute.onRoute && rm.settings().offRoute && rm.shownPath() === null, 'dropped off every route, the party is on none');
    check(rm.progress(go).distance === 0, 'and the trip it was on is cancelled: its odometer back to the start');
    const warnedBefore = warnings.length;
    await jm.play(go);
    check(!jm.isPlaying(go) && warnings.length === warnedBefore + 1, 'and Play says to put it on a route first');
    await rm.setSettings({ active: { routeId: late.id } });
    check(!rm.settings().offRoute, 'choosing a route in the bar puts the party back on one');
    await tp2.placeParty(scene, { x: 700, y: 900 }, 24);
    check(Math.abs(rm.progress(lateLink).distance - 25) < 1e-6, 'the party back on its route, 25 ft along');
    await tp2.placeParty(scene, { x: 1050, y: 902 }, 24);
    check(Math.abs(rm.progress(lateLink).distance - 37.5) < 1e-6, 'dropped further along the same route, it just moves along it');
    const moved = await tp2.placeParty(scene, { x: 350, y: 498 }, 24);
    check(moved.link.routeId === lone.id && Math.abs(rm.progress(one).distance - 12.5) < 1e-6 && rm.progress(lateLink).distance === 0,
        'dropped on a different route, the last trip is cancelled and the party starts the new one where it landed');

    // A route still carried along by the clock's timeline though its Play flag is off
    // (left so by an earlier version): a drop elsewhere must stop it too, or the map
    // would go on showing it, and the marker would sit on it.
    await rm.setPathTravel(lateLink, { followClock: true, playing: true, pace: 3600 });
    flags.routes.list.find(r => r.id === late.id).travel.motion.playing = false;
    check(rm.progress(lateLink).moving, '(a route moving on the timeline with Play off)');
    const elsewhere = await tp2.placeParty(scene, { x: 700, y: 500 }, 24);
    check(elsewhere.link.routeId === lone.id && !rm.progress(lateLink).moving && rm.shownPath()?.routeId === lone.id,
        'dropped on another route, that one stops too, and the map shows where the party was put');
    await rm.setPathTravel(lateLink, { followClock: false });

    console.log('\nends and directions');
    await tp2.placeParty(scene, { x: 1390, y: 903 }, 24);
    const atEnd = rm.progress(lateLink);
    check(atEnd.distance === 0 && atEnd.path.reversed && Math.abs(atEnd.point.x - 1400) < 1e-6,
        'dropped near the end of a route, the party is at its end exactly, turned round to set out from there');
    await tp2.placeParty(scene, { x: 15, y: 897 }, 24);
    const atStart = rm.progress(lateLink);
    check(atStart.distance === 0 && !atStart.path.reversed && atStart.point.x === 0,
        'and near its start -- the end it now heads for -- turned back, at its start');
    await tp2.placeParty(scene, { x: 15, y: 897 }, 24);
    check(rm.progress(lateLink).distance === 0 && !rm.progress(lateLink).path.reversed, 'dropped at the end it sets out from, it is left as it is');
    await tp2.placeParty(scene, { x: 280, y: 900 }, 24);
    check(Math.abs(rm.progress(lateLink).distance - 10) < 1e-6, 'anywhere else along it, exactly where it was put');
    await jm.setDirection(lateLink, true);
    const turned = rm.progress(lateLink);
    check(Math.abs(turned.distance - 40) < 1e-6 && Math.abs(turned.point.x - 280) < 1e-6 && turned.path.reversed,
        'turned round, the party stands where it was, now 40 ft from the far end it starts from');
    await jm.play(lateLink, 3600);
    now += 10000;
    check(rm.progress(lateLink).point.x < 280, 'and travels back towards the start the route was drawn from');
    await jm.stop(lateLink);
    now += 3000;
    await jm.setDirection(lateLink, false);
    check(!rm.progress(lateLink).path.reversed, 'and can be turned back');

    console.log('\nstop ends the trip');
    await tp2.placeParty(scene, { x: 700, y: 900 }, 24);
    await jm.play(lateLink, 3600);
    now += 5000;
    const pinBefore = { ...placed.get('m-party-here') };
    await jm.end(lateLink);
    check(!jm.isPlaying(lateLink) && rm.progress(lateLink).distance === 0, 'Stop halts the trip and puts its odometer back to the start');
    check(rm.settings().active == null && rm.settings().offRoute && rm.shownPath() === null, 'and the map has no trip: the party is on no route');
    check(placed.get('m-party-here').x === pinBefore.x && placed.get('m-party-here').y === pinBefore.y, 'the marker stays where the party stopped');
    await rm.setSettings({ active: { routeId: late.id } });

    console.log('\nthe GM loading pauses a trip');
    const savedUsers = game.users;
    const savedSettings = game.settings;
    let seenAt = 0;
    const infos = [];
    ui.notifications.info = m => infos.push(m);
    game.settings = { get: () => seenAt, set: async (_m, _k, value) => { seenAt = value; } };
    game.users = { ...savedUsers, some: () => false };
    await rm.setPathTravel(lateLink, { easeSeconds: 0 });
    await jm.play(lateLink, 3600);
    now += 5000;
    jm._noteSeen();
    const left = rm.progress(lateLink).distance;
    now += 6 * 3600 * 1000;
    await jm._pauseOnLoad();
    check(!jm.isPlaying(lateLink) && Math.abs(rm.progress(lateLink).distance - left) < 1e-6,
        'after the world sat closed, the trip is paused where the party was when the GM last saw it');
    now += 10000;
    check(Math.abs(rm.progress(lateLink).distance - left) < 1e-6, 'and stays there, with no ease down');
    check(infos.length === 1, 'the GM is told it was paused');
    await jm.play(lateLink);
    now += 2000;
    jm._noteSeen();
    now += 30000;
    const quick = rm.progress(lateLink).distance;
    await jm._pauseOnLoad();
    check(!jm.isPlaying(lateLink) && Math.abs(rm.progress(lateLink).distance - quick) < 1e-6,
        'a quick reload pauses it where it is now');
    await jm.play(lateLink);
    game.users = { ...savedUsers, some: () => true };
    await jm._pauseOnLoad();
    check(jm.isPlaying(lateLink), 'with another GM already on, trips go on');
    await jm.stop(lateLink);
    game.users = savedUsers;
    game.settings = savedSettings;

    console.log('\ntaking the party off a route');
    await jm.choose(lateLink, scene);
    await tp2.placeParty(scene, { x: 700, y: 900 }, 24);
    // A frame drawn part way through the drop, as the ticker would, while the map still shows the route.
    const realSetPathTravel = rm.setPathTravel;
    rm.setPathTravel = async (...args) => {
        const result = await realSetPathTravel.apply(rm, args);
        tp2._lastSave = -Infinity;
        tp2._tick();
        await settle();
        return result;
    };
    placed.set('m-party-here', { ...placed.get('m-party-here'), x: 5000, y: 5000 });
    tp2._dragging = true;
    await tp2._onDragEnd({ pinId: 'm-party-here', pin: { x: 5000, y: 5000 } });
    rm.setPathTravel = realSetPathTravel;
    check(rm.settings().offRoute && placed.get('m-party-here').x === 5000 && placed.get('m-party-here').y === 5000,
        'pulled off a route, the marker stays where it was put, not saved back on to the route it left');
    await jm.choose(lateLink, scene);

    console.log('\na journey is a run of routes');
    const roadLink = { sceneId: 'here', routeId: m1.id };
    await jm.choose(null, scene);
    check(rm.settings().active === null && rm.shownPath() === null, 'choosing no route: the map runs nothing and shows nothing');
    await jm.choose(go, scene);
    check(rm.settings().active?.journeyId === walk.id && rm.settings().active.routeId === m1.id && rm.progress(go).distance === 0,
        'choosing a journey puts the party at its start, on its first route');
    await jm.play(go, 18000);
    await rm.setPathTravel(roadLink, { easeSeconds: 0, masterSpeed: 1, pace: 18000 });
    now += 12000;
    jm._lastWatch = -Infinity;
    jm._watch();
    await settle();
    // 10 s of road at 5 ft/s; the 2 s over, in the wood at half pace: 5 ft.
    check(rm.settings().active.routeId === m2.id && jm.isPlaying(go) && Math.abs(rm.progress(go).distance - 55) < 1e-6,
        'at the end of the road the party goes on into the wood, losing none of the way');
    now += 2000;
    check(Math.abs(rm.progress(go).distance - 60) < 1e-6, 'and carries on at its pace');
    await jm.setDirection(go, true);
    const runBack = rm.progress(go);
    check(runBack.path.reversed && Math.abs(runBack.distance - 40) < 1e-6 && Math.abs(runBack.point.x - 1680) < 1e-6,
        'turned round, the journey runs back: 40 ft to its start, from where the party stands');
    now += 6000;
    jm._lastWatch = -Infinity;
    jm._watch();
    await settle();
    const home = rm.progress(go);
    check(rm.settings().active.routeId === m1.id && rm.progress(roadLink).path.reversed && Math.abs(home.distance - 60) < 1e-6 && Math.abs(home.point.x - 1120) < 1e-6,
        'and back out of the wood on to the road, run back towards its start');
    now += 60000;
    jm._lastWatch = -Infinity;
    jm._watch();
    await settle();
    check(!jm.isPlaying(go) && rm.progress(go).travel.arrived && rm.progress(go).point.x === 0,
        'at the journey\'s start -- its end, run back -- the party arrives');
    await jm.setDirection(go, false);
    const junction = await tp2.placeParty(scene, { x: 1390, y: 3 }, 24);
    check(junction.link.routeId === m2.id && rm.settings().active.journeyId === walk.id && Math.abs(rm.progress(go).distance - 50) < 1e-6,
        'dropped at the end of a route of the journey, the party goes on to the next route, ready to set out');
    await jm.choose(lateLink, scene);
    check(rm.settings().active?.routeId === late.id && !rm.settings().active.journeyId, 'choosing a route leaves the journey');

    console.log('\njourneys\' own progress, from before, moves onto their routes');
    flags.routes.journeys.find(j => j.id === walk.id).travel = {
        effort: 100, pace: 18000, followClock: false, reversed: false, arrived: false, timeline: [],
        motion: { playing: false, masterSpeed: 1, easeSeconds: 0, anchorAt: now, rampFrom: null, clockFactor: 1 }
    };
    flags.routes.settings = { ...flags.routes.settings, active: { journeyId: walk.id } };
    await rm.migrateJourneys(scene);
    check(!rm.getJourney(walk.id).travel && rm.settings().active.routeId === m2.id
        && Math.abs(rm.progress({ sceneId: 'here', routeId: m2.id }).distance - 25) < 1e-6 && Math.abs(rm.progress(go).distance - 75) < 1e-6,
        'a journey 75 ft along becomes its second route 25 ft along, and the map follows the journey there');

    console.log('\nan animated scene following the party\'s trip');
    const partyTrip = { sceneId: 'here', party: true };
    await jm.choose(go, scene);
    check(!!rm.progress(partyTrip)?.journey && rm.progress(partyTrip).distance === rm.progress(go).distance,
        'the party\'s trip on a map is whatever the map runs: here, the journey');
    await jm.choose(lateLink, scene);
    check(rm.progress(partyTrip)?.path.name === 'Late' && rm.routeLinkOf(partyTrip)?.routeId === late.id,
        'and it follows when the GM chooses another');
    await jm.choose(null, scene);
    check(rm.progress(partyTrip) === null && rm.partyMap() === null, 'with nothing chosen there is none, and no map for a scene to follow');
    await jm.choose(lateLink, scene);
    check(rm.partyMap()?.id === 'here', 'a map with a trip chosen is the one a scene follows the party on');

    console.log('\nthe Routes window follows the scene');
    const openedBefore = rm.openWindow;
    let reopened = 0;
    rm.openWindow = async () => { reopened++; };
    const routesKept = flags.routes;
    rm.window = { rendered: true, close: async () => rm.onWindowClosed(rm.window) };
    store.set('m.routes.windowOpen', 'true');
    flags.routes = { list: [], journeys: [] };
    await rm._syncWindowToScene();
    check(!rm.window && store.get('m.routes.windowOpen') === 'true', 'on a scene with no routes it closes, and remembers it was open');
    flags.routes = routesKept;
    await rm._syncWindowToScene();
    check(reopened === 1, 'back on a scene with routes, it reopens');
    store.set('m.routes.windowOpen', 'false');
    await rm._syncWindowToScene();
    check(reopened === 1, 'closed by its user, it stays closed');
    rm.openWindow = openedBefore;

    console.log('\nthe marker is the party\'s');
    placed.delete('m-party-here');
    await tp2._ensurePin(one);
    check(placed.get('m-party-here')?.text === 'The Fellowship', 'a new marker is labelled with the party\'s name, from Blacksmith');
    tp2._partyName = 'The Fellowship';
    partyName = 'The Company';
    await tp2._renameMarker();
    check(placed.get('m-party-here').text === 'The Company', 'renaming the party renames its marker');
    placed.get('m-party-here').text = 'Wagon train';
    partyName = 'The Band';
    await tp2._renameMarker();
    check(placed.get('m-party-here').text === 'Wagon train', 'but a label the GM chose stays');
    partyName = null;
    placed.delete('m-party-here');
    await tp2._ensurePin(one);
    check(placed.get('m-party-here')?.text === 'm.routes.partyMarker', 'with no party set in the world, it is simply "The party"');

    console.log('\nwhat a drop says');
    const realFormat = game.i18n.format;
    game.i18n.format = (key, data) => `${key} ${JSON.stringify(data)}`;
    partyName = 'The Company';
    await tp2.placeParty(scene, { x: 700, y: 900 }, 24);
    const onMsg = tp2.dropMessage({ onRoute: true, link: lateLink }, null, scene);
    check(onMsg.startsWith('m.routes.partyMovedOn') && onMsg.includes('"party":"The Company"') && onMsg.includes('"name":"Late"') && onMsg.includes('atDistance'),
        'put on a route: "The Company has moved on to Late at 25 ft along"');
    await tp2.placeParty(scene, { x: 5, y: 900 }, 24);
    check(tp2.dropMessage({ onRoute: true, link: lateLink }, null, scene).includes('m.routes.atStart'), 'at its start, it says so');
    const offMsg = tp2.dropMessage({ onRoute: false }, 'Late', scene);
    check(offMsg.startsWith('m.routes.partyMovedOff') && offMsg.includes('"name":"Late"'), 'moved off a route: "The Company has moved off of Late"');
    check(tp2.dropMessage({ onRoute: false }, null, scene) === null, 'moved from off every route to elsewhere off every route: nothing said');
    game.i18n.format = realFormat;

    console.log('\ndeleting the marker');
    const styled = { ...placed.get('m-party-here'), image: 'wagon.webp', text: 'Caravan' };
    placed.delete('m-party-here');
    await tp2._onPinDeleted({ pinId: 'm-party-here', sceneId: 'here', pin: styled });
    check(rm.settings().marker?.removed === true && rm.settings().marker.look.image === 'wagon.webp' && !('x' in rm.settings().marker.look),
        'deleted by the GM, the marker is remembered as deleted, with its look but not its place');
    tp2._tick();
    await new Promise(resolve => setTimeout(resolve, 20));
    check(!placed.has('m-party-here'), 'and it is not put back on its own');
    await tp2.addMarker('here');
    const back = placed.get('m-party-here');
    check(back?.image === 'wagon.webp' && back.text === 'Caravan' && back.type === 'journey' && !rm.settings().marker.removed,
        'Add marker puts it back as it looked');
    const party = rm.progress(rm.shownPath()).point;
    check(back.x === party.x && back.y === party.y, 'and where the party is now');
    game.modules = { get: () => null };
}

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);

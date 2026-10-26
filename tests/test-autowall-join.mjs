// What happens when a wall is dragged in Foundry: the real hook class from
// manager-walljoin.js, driven the way Foundry drives it -- the preUpdate that may change
// the update, then the update that follows -- against a stand-in scene.
//
// It shows that walls joined to a moved end follow it, that an end let go near another
// joins it, that the follow-up is not itself followed, and that a setting turns it off.
// It does not show that Foundry calls the hooks as this does.
import fs from 'node:fs';
import { planJoinedMove, snapNewWall, splitSegmentAt, SKIP_JOIN } from '../scripts/utils-autowall.js';

const src = fs.readFileSync('scripts/manager-walljoin.js', 'utf8');
// The constants above the class, read from the source so the test uses the module's own numbers.
const constants = src.slice(0, src.indexOf('class WallJoinManager')).match(/^const [A-Z_]+ = [\d.]+;$/gm)?.join('\n') ?? '';
const body = constants + '\n' + src.slice(src.indexOf('class WallJoinManager'), src.indexOf('export const wallJoinManager')).replace(/^export /gm, '');
const MODULE = { ID: 'coffee-pub-cartographer', NAME: 'CARTOGRAPHER' };

let failures = 0;
const check = (label, ok, detail = '') => {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};

/** A scene whose walls change, and which runs Foundry's two hooks around every update it is given. */
function world({ joinEnds = true, joinDistance = 0.3, isGM = true, shift = false, wallsLayer = true } = {}) {
    const hooks = {};
    const log = [];
    const settings = { 'walls.joinEnds': joinEnds, 'walls.joinDistance': joinDistance };
    const game = {
        user: { isGM, id: 'gm' },
        i18n: { localize: key => key },
        settings: { get: (_module, key) => settings[key] },
        keyboard: { downKeys: new Set(shift ? ['ShiftLeft'] : []) }
    };
    const scene = { grid: { size: 100 }, list: [], calls: [] };
    scene.walls = { get contents() { return scene.list; } };
    const make = (id, c) => { const doc = { id, c: [...c], parent: scene, flags: {}, toObject() { return { _id: this.id, c: [...this.c], door: this.door ?? 0, flags: { ...this.flags } }; } }; return doc; };
    let created = 0;
    // Foundry's own sequence for one wall update: preUpdate, apply, update.
    scene.updateEmbeddedDocuments = async (_type, updates, options = {}) => {
        log.push(['update', updates.map(u => u._id), options[SKIP_JOIN] ? 'skip' : 'plain']);
        for (const update of updates) {
            const doc = scene.list.find(w => w.id === update._id);
            const changes = { _id: update._id, c: [...update.c] };
            hooks.preUpdateWall?.(doc, changes, options, 'gm');
            doc.c = [...changes.c];
            await hooks.updateWall?.(doc, changes, options, 'gm');
        }
    };
    scene.createEmbeddedDocuments = async (_type, data, options = {}) => {
        log.push(['create', data.map(d => d.c.join(',')), options[SKIP_JOIN] ? 'skip' : 'plain']);
        for (const item of data) { const doc = make(`n${++created}`, item.c); doc.door = item.door ?? 0; scene.list.push(doc); }
    };
    scene.deleteEmbeddedDocuments = async (_type, ids) => { log.push(['delete', ids]); scene.list = scene.list.filter(w => !ids.includes(w.id)); };
    const Hooks = { on: (name, fn) => { hooks[name] = fn; } };
    const view = { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
    const canvas = { scene, walls: { active: wallsLayer }, app: { view, stage: { toLocal: p => p } }, stage: { scale: { x: 1 } } };
    const ui = { notifications: { info() {} } };
    const PIXI = { Point: function (x, y) { return { x, y }; } };
    const manager = new Function('game', 'Hooks', 'MODULE', 'planJoinedMove', 'snapNewWall', 'splitSegmentAt', 'SKIP_JOIN', 'canvas', 'ui', 'PIXI', `${body}\nreturn new WallJoinManager();`)(game, Hooks, MODULE, planJoinedMove, snapNewWall, splitSegmentAt, SKIP_JOIN, canvas, ui, PIXI);
    manager.initialize();
    // Drawing a wall: preCreate, which may change what is made, then it is there.
    const draw = (id, c, options = {}) => {
        const doc = { id, c: [...c], parent: scene, updateSource(changes) { if (changes.c) this.c = [...changes.c]; } };
        hooks.preCreateWall?.(doc, { c: [...c] }, options, 'gm');
        scene.list.push(doc);
        return doc;
    };
    return { scene, log, make, draw, manager, coords: () => Object.fromEntries(scene.list.map(w => [w.id, w.c.join(',')])) };
}

console.log('dragging a wall end in Foundry');
{
    const w = world();
    w.scene.list.push(w.make('a', [0, 0, 100, 0]), w.make('b', [100, 0, 200, 0]));
    await w.scene.updateEmbeddedDocuments('Wall', [{ _id: 'a', c: [0, 0, 100, 60] }]);
    check('the wall joined to it follows', JSON.stringify(w.coords()) === JSON.stringify({ a: '0,0,100,60', b: '100,60,200,0' }), JSON.stringify(w.coords()));
    check('and the follow-up is not itself followed', w.log.filter(l => l[0] === 'update').length === 2 && w.log[1][2] === 'skip', JSON.stringify(w.log));
}
{
    const w = world();
    w.scene.list.push(w.make('a', [0, 0, 100, 0]), w.make('b', [130, 0, 300, 0]));
    await w.scene.updateEmbeddedDocuments('Wall', [{ _id: 'a', c: [0, 0, 112, 0] }]);
    check('an end let go near another is joined to it', w.coords().a === '0,0,130,0', JSON.stringify(w.coords()));
    check('and it is the update itself that was changed, not a second one', w.log.length === 1, JSON.stringify(w.log));
    await w.scene.updateEmbeddedDocuments('Wall', [{ _id: 'b', c: [130, -90, 300, 0] }]);
    check('joined, moving that joint moves both walls', w.coords().a === '0,0,130,-90' && w.coords().b === '130,-90,300,0', JSON.stringify(w.coords()));
}
{
    // The picture in the request: an arch.
    const w = world();
    w.scene.list.push(w.make('a', [0, 300, 200, 300]), w.make('b', [200, 300, 400, 300]));
    await w.scene.updateEmbeddedDocuments('Wall', [{ _id: 'a', c: [0, 300, 200, 100] }]);
    check('lifting the middle of two joined walls raises both sides of it', w.coords().a === '0,300,200,100' && w.coords().b === '200,100,400,300', JSON.stringify(w.coords()));
}
{
    const w = world();
    w.scene.list.push(w.make('a', [0, 0, 100, 0]), w.make('b', [100, 0, 200, 0]));
    await w.scene.updateEmbeddedDocuments('Wall', [{ _id: 'a', c: [20, 0, 120, 0] }]);
    check('a wall carried by both ends leaves the others where they are', w.coords().b === '100,0,200,0', JSON.stringify(w.coords()));
}

console.log('\ndrawing a new wall');
{
    const w = world();
    w.scene.list.push(w.make('a', [0, 0, 100, 0]));
    const drawn = w.draw('n', [112, 8, 300, 200]);
    check('a wall drawn from near the end of another starts at that end', drawn.c.join() === '100,0,300,200', drawn.c.join());
    const free = world();
    free.scene.list.push(free.make('a', [0, 0, 100, 0]));
    check('far from any end, it is left alone', free.draw('n', [500, 500, 600, 600]).c.join() === '500,500,600,600');
    const off = world({ joinEnds: false });
    off.scene.list.push(off.make('a', [0, 0, 100, 0]));
    check('with the setting off, it is left alone', off.draw('n', [112, 8, 300, 200]).c.join() === '112,8,300,200');
    const own = world();
    own.scene.list.push(own.make('a', [0, 0, 100, 0]));
    check('walls the walls tool makes are exactly where it put them', own.draw('n', [112, 8, 300, 200], { [SKIP_JOIN]: true }).c.join() === '112,8,300,200');
}

console.log('\nCtrl-click cuts a wall in two');
{
    const ctrlClick = async (w, x, y, extra = {}) => {
        w.manager._onDown({ button: 0, ctrlKey: true, clientX: x, clientY: y, ...extra.down });
        return w.manager._onUp({ button: 0, clientX: x, clientY: y, ...extra.up });
    };
    const w = world();
    w.scene.list.push(w.make('a', [0, 0, 1000, 0]));
    check('a Ctrl-click on a wall cuts it where it was clicked', await ctrlClick(w, 400, 4) === true && w.coords().a === '0,0,400,0', JSON.stringify(w.coords()));
    check('what is after the cut is a wall of its own', Object.values(w.coords()).includes('400,0,1000,0'), JSON.stringify(w.coords()));
    check('and neither is followed as a joint', w.log.every(l => l[2] === 'skip'), JSON.stringify(w.log));

    const door = world();
    door.scene.list.push(door.make('d', [0, 0, 1000, 0]));
    door.scene.list[0].door = 1;
    await ctrlClick(door, 500, 0);
    check('a door is cut like any wall, and the copy is a door too', door.scene.list.length === 2 && door.scene.list.every(x => x.door === 1));

    const miss = world();
    miss.scene.list.push(miss.make('a', [0, 0, 1000, 0]));
    check('a click off the wall cuts nothing', await ctrlClick(miss, 400, 80) === false && miss.scene.list.length === 1);
    check('a click at an end cuts nothing, a point is already there', await ctrlClick(miss, 2, 0) === false && miss.scene.list.length === 1);

    const plain = world();
    plain.scene.list.push(plain.make('a', [0, 0, 1000, 0]));
    plain.manager._onDown({ button: 0, ctrlKey: false, clientX: 400, clientY: 0 });
    check('without Ctrl a click is only a click', plain.manager._onUp({ button: 0, clientX: 400, clientY: 0 }) === null && plain.scene.list.length === 1);

    const dragged = world();
    dragged.scene.list.push(dragged.make('a', [0, 0, 1000, 0]));
    check('a Ctrl-drag, which draws a chain in Foundry, is not a click', await ctrlClick(dragged, 400, 0, { up: { clientX: 460 } }) === null && dragged.scene.list.length === 1);

    const elsewhere = world({ wallsLayer: false });
    elsewhere.scene.list.push(elsewhere.make('a', [0, 0, 1000, 0]));
    check('off the Walls layer, Ctrl-click is Foundry\'s own', await ctrlClick(elsewhere, 400, 0) === null && elsewhere.scene.list.length === 1);

    const busy = world();
    busy.scene.list.push(busy.make('a', [0, 0, 1000, 0]));
    busy.manager.suspended = true;
    check('while the walls tool has a run, it cuts its own walls and this stands aside', await ctrlClick(busy, 400, 0) === null && busy.scene.list.length === 1);

    const player = world({ isGM: false });
    player.scene.list.push(player.make('a', [0, 0, 1000, 0]));
    check('for a player there is nothing', player.scene.list.length === 1);
}

console.log('\nwhen it does nothing');
{
    const off = world({ joinEnds: false });
    off.scene.list.push(off.make('a', [0, 0, 100, 0]), off.make('b', [100, 0, 200, 0]));
    await off.scene.updateEmbeddedDocuments('Wall', [{ _id: 'a', c: [0, 0, 100, 60] }]);
    check('with the setting off, only the wall moved is moved', off.coords().b === '100,0,200,0');

    const shift = world({ shift: true });
    shift.scene.list.push(shift.make('a', [0, 0, 100, 0]), shift.make('b', [130, 0, 300, 0]));
    await shift.scene.updateEmbeddedDocuments('Wall', [{ _id: 'a', c: [0, 0, 112, 0] }]);
    check('holding Shift places an end where it is let go', shift.coords().a === '0,0,112,0', JSON.stringify(shift.coords()));

    const player = world({ isGM: false });
    player.scene.list.push(player.make('a', [0, 0, 100, 0]), player.make('b', [100, 0, 200, 0]));
    await player.scene.updateEmbeddedDocuments('Wall', [{ _id: 'a', c: [0, 0, 100, 60] }]);
    check('it is the GM\'s: for anyone else it is not set up at all', player.coords().b === '100,0,200,0');

    const own = world();
    own.scene.list.push(own.make('a', [0, 0, 100, 0]), own.make('b', [100, 0, 200, 0]));
    await own.scene.updateEmbeddedDocuments('Wall', [{ _id: 'a', c: [0, 0, 100, 60] }], { [SKIP_JOIN]: true });
    check('an update marked as the walls tool\'s own is left alone', own.coords().b === '100,0,200,0');
}

console.log('\nwhat it removes');
{
    const w = world();
    w.scene.list.push(w.make('a', [0, 0, 100, 0]), w.make('b', [100, 0, 150, 0]));
    await w.scene.updateEmbeddedDocuments('Wall', [{ _id: 'a', c: [0, 0, 150, 0] }]);
    check('a wall carried onto its own other end is removed', JSON.stringify(Object.keys(w.coords())) === JSON.stringify(['a']), JSON.stringify(w.coords()));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);

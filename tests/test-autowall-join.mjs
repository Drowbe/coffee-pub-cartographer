// What happens when a wall is dragged in Foundry: the real hook class from
// manager-walljoin.js, driven the way Foundry drives it -- the preUpdate that may change
// the update, then the update that follows -- against a stand-in scene.
//
// It shows that walls joined to a moved end follow it, that an end let go near another
// joins it, that the follow-up is not itself followed, and that a setting turns it off.
// It does not show that Foundry calls the hooks as this does.
import fs from 'node:fs';
import { planJoinedMove, snapNewWall, SKIP_JOIN } from '../scripts/utils-autowall.js';

const src = fs.readFileSync('scripts/manager-walljoin.js', 'utf8');
const body = src.slice(src.indexOf('class WallJoinManager'), src.indexOf('export const wallJoinManager')).replace(/^export /gm, '');
const MODULE = { ID: 'coffee-pub-cartographer', NAME: 'CARTOGRAPHER' };

let failures = 0;
const check = (label, ok, detail = '') => {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};

/** A scene whose walls change, and which runs Foundry's two hooks around every update it is given. */
function world({ joinEnds = true, joinDistance = 0.3, isGM = true, shift = false } = {}) {
    const hooks = {};
    const log = [];
    const settings = { 'walls.joinEnds': joinEnds, 'walls.joinDistance': joinDistance };
    const game = {
        user: { isGM, id: 'gm' },
        settings: { get: (_module, key) => settings[key] },
        keyboard: { downKeys: new Set(shift ? ['ShiftLeft'] : []) }
    };
    const scene = { grid: { size: 100 }, list: [] };
    scene.walls = { get contents() { return scene.list; } };
    const make = (id, c) => { const doc = { id, c: [...c], parent: scene }; return doc; };
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
    scene.deleteEmbeddedDocuments = async (_type, ids) => { log.push(['delete', ids]); scene.list = scene.list.filter(w => !ids.includes(w.id)); };
    const Hooks = { on: (name, fn) => { hooks[name] = fn; } };
    const manager = new Function('game', 'Hooks', 'MODULE', 'planJoinedMove', 'snapNewWall', 'SKIP_JOIN', `${body}\nreturn new WallJoinManager();`)(game, Hooks, MODULE, planJoinedMove, snapNewWall, SKIP_JOIN);
    manager.initialize();
    // Drawing a wall: preCreate, which may change what is made, then it is there.
    const draw = (id, c, options = {}) => {
        const doc = { id, c: [...c], parent: scene, updateSource(changes) { if (changes.c) this.c = [...changes.c]; } };
        hooks.preCreateWall?.(doc, { c: [...c] }, options, 'gm');
        scene.list.push(doc);
        return doc;
    };
    return { scene, log, make, draw, coords: () => Object.fromEntries(scene.list.map(w => [w.id, w.c.join(',')])) };
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

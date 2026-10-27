// The drawing tools window's HTML, built for both tabs, as a GM and as a player, from the real
// methods in window-drawing.js against a stand-in drawing tool. It shows that nothing builds as
// "undefined" or "[object Object]", that each control is there for who it belongs to, that the
// window is made of Blacksmith's own tool-window components, and that every action a button
// carries is one the window handles, every string it uses exists, and every call it makes on the
// drawing tool is a method the drawing tool has.
//
// It does not show how the window looks or that Blacksmith draws it.
import fs from 'node:fs';
import { STAMPS, STAMP_CATEGORIES, stampSvg, parseColor } from '../scripts/utils-stamps.js';
import { TERRAINS, terrainSvg } from '../scripts/utils-terrain.js';
import { WALL_KINDS, wallKindSvg, isDoorKind, isOpeningKind, WALL_MATERIALS, wallMaterialSvg } from '../scripts/utils-drawing.js';

const src = fs.readFileSync('scripts/window-drawing.js', 'utf8');
const managerSrc = fs.readFileSync('scripts/manager-drawing.js', 'utf8');
const lang = JSON.parse(fs.readFileSync('lang/en.json', 'utf8'))['coffee-pub-cartographer'];
const slice = (from, to) => {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a);
    if (a < 0 || b < 0) throw new Error(`could not locate ${from.trim().slice(0, 40)}`);
    return src.slice(a, b);
};
const tables = slice('/** The tabs, in order. */', 'export class DrawingToolsWindow');
const methods = slice('    _localize(key) {', '    // ==================================================================\n    // ===== LIFECYCLE');

const MODULE = { ID: 'coffee-pub-cartographer' };
let isGM = true;
const game = {
    i18n: { localize: key => lang[key.replace('coffee-pub-cartographer.', '')] ?? `!!${key}` },
    get user() { return { isGM, color: { css: '#aa3322' } }; }
};
const foundry = { utils: { escapeHTML: text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') } };

const Harness = eval(`(() => {
${tables}
return class Harness {
    constructor(manager) { this.manager = manager; this.tab = 'draw'; }
    get id() { return 'window-id'; }
${methods}
};
})()`);

class FakeTool {
    static strColor1 = 'rgba(38, 38, 38, 0.7)';
    static strColor2 = 'rgba(186, 60, 49, 0.7)';
    static strColor3 = 'rgba(76, 147, 204, 0.7)';
    static strColor4 = 'rgba(3, 105, 41, 0.7)';
    static strColor5 = 'rgba(219, 130, 12, 0.7)';
}
const tool = (overrides = {}) => Object.assign(new FakeTool(), {
    state: {
        active: false, drawingMode: 'sketch', stampStyle: 'tree', symbolSize: 'medium', lineStyle: 'solid', timedEraseEnabled: false,
        brushSettings: { size: 6, color: 'rgba(186, 60, 49, 0.7)', type: 'pen' },
        stamp: { natural: true, keep: false, rotate: true, jitter: true, spacing: 1, terrain: 'dirt', pathWidth: 1 }, wallShape: 'line', wallSnap: true, wallKind: 'wall', wallDoor: 'closed', wallMaterial: 'plain'
    },
    canMakeWalls: () => isGM, canKeepOnScene: () => isGM, canUndo: () => true,
    canSetScene: () => isGM, sceneState: () => ({ tokenVision: true, globalLight: false, darkness: 0.25 })
}, overrides);
const build = (manager, tab) => { const w = new Harness(manager); w.tab = tab; return w; };

let failures = 0;
const check = (label, ok, detail = '') => {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const has = (html, text) => html.includes(text);
const count = (html, pattern) => (html.match(pattern) ?? []).length;

console.log('every tab builds, for a GM and a player');
for (const gm of [true, false]) {
    isGM = gm;
    for (const tab of ['draw', 'stamps', 'terrain', 'walls', 'utilities']) {
        const w = build(tool(), tab);
        const body = w._buildBody();
        const all = body + w._buildFooterLeft() + w._buildFooterRight();
        check(`${gm ? 'GM' : 'player'} ${tab}: no undefined, no [object Object], no missing string`, !/undefined|\[object Object\]|!!coffee-pub|NaN/.test(all), (all.match(/.{30}(undefined|\[object Object\]|!!coffee-pub|NaN).{30}/) ?? [''])[0]);
        const tabs = w._buildTabs(w._currentTab());
        check(`${gm ? 'GM' : 'player'} ${tab}: underline tabs, one active`, has(tabs, 'blacksmith-tool-tabs') && count(tabs, /blacksmith-tool-tab is-active/g) === 1);
    }
}

console.log('\nthe Drawing tab');
isGM = true;
{
    const body = build(tool(), 'draw')._buildBody();
    check('the current tool is the one checked', /value="sketch"[^>]*checked/.test(body) && count(body, /name="drawing-mode"[^>]*checked/g) === 1);
    check('weight, style and colour are there', has(body, 'data-action="drawing-weight"') && has(body, 'data-action="drawing-style"') && has(body, 'data-action="drawing-color"'));
    check('the medium weight is checked', /value="6"[^>]*checked/.test(body));
    check('six swatches: the player and five colours', count(body, /cartographer-drawing-swatch[ "]/g) === 6);
    check('exactly one swatch is active', count(body, /cartographer-drawing-swatch is-active/g) === 1);
    check('the active swatch is the red one', /is-active" role="radio" aria-checked="true" data-action="drawing-color" data-color="rgba\(186, 60, 49, 0\.7\)"/.test(body));
}
{
    isGM = false;
    const body = build(tool(), 'draw')._buildBody();
    isGM = true;
}

console.log('\nthe Stamps tab');
{
    const w = build(tool(), 'stamps');
    const body = w._buildBody();
    const terrainStamps = s => s.category === 'ground' || s.category === 'fields';
    check('every stamp but the ground patches and fields has a button here', STAMPS.filter(s => !terrainStamps(s)).every(s => has(body, `data-kind="${s.id}"`)));
    check('the ground patches and fields are not here, they are with the paths', STAMPS.filter(terrainStamps).every(s => !has(body, `data-kind="${s.id}"`)) && !has(body, lang['drawingTools.categoryGround']) && !has(body, lang['drawingTools.categoryFields']));
    check('every other category has a section heading', STAMP_CATEGORIES.filter(c => c.id !== 'ground' && c.id !== 'fields').every(c => has(body, lang[`drawingTools.${c.labelKey}`] ?? `drawingTools.${c.labelKey}`)));
    const shown = STAMPS.filter(s => !terrainStamps(s)).length;
    check('each button has a picture and a name', count(body, /cartographer-stamp-art/g) === shown && count(body, /cartographer-stamp-name/g) === shown);
    check('exactly one stamp is active, the tree, only in stamp mode', count(body, /cartographer-stamp is-active/g) === 0);
    const inStamp = build(tool({ state: { ...tool().state, drawingMode: 'stamp' } }), 'stamps')._buildBody();
    check('in stamp mode the chosen stamp is active', count(inStamp, /cartographer-stamp is-active/g) === 1 && /is-active" data-action="drawing-stamp" data-kind="tree"/.test(inStamp));
    check('size, natural, rotate, jitter, spacing and keep are all there', ['name="drawing-size"', 'name="natural"', 'name="rotate"', 'name="jitter"', 'name="spacing"', 'name="keep"'].every(t => has(body, t)));
    check('the medium size is checked', /value="medium"[^>]*checked/.test(body));
    check('natural, rotate and jitter are on and keep is off by default', /name="natural"[^>]*checked/.test(body) && /name="rotate"[^>]*checked/.test(body) && /name="jitter"[^>]*checked/.test(body) && !/name="keep"[^>]*checked/.test(body));
    check('the spacing slider carries its value and range', /name="spacing" min="0.5" max="3" step="0.25" value="1"/.test(body));
    const kept = build(tool({ state: { ...tool().state, stamp: { ...tool().state.stamp, keep: true } } }), 'stamps')._buildBody();
    check('keep is checked when on', /name="keep"[^>]*checked/.test(kept));
    isGM = false;
    const denied = build(tool({ state: { ...tool().state, stamp: { ...tool().state.stamp, keep: true } } }), 'stamps')._buildBody();
    check('a user who may not create drawings has keep off and disabled, whatever was saved', !/name="keep"[^>]*checked/.test(denied) && /name="keep"[^>]*disabled/.test(denied));
    isGM = true;
    const off = build(tool({ state: { ...tool().state, stamp: { ...tool().state.stamp, natural: false } } }), 'stamps')._buildBody();
    check('with natural colours off a stamp is drawn in the brush colour', off !== body && has(off, '#ba3c31'));
    check('the markers are always in the brush colour', has(body, stampSvg('plus', { tint: 'rgba(186, 60, 49, 0.7)' })));
}

console.log('\nthe Drawing tab has no wall tool, the Walls tab has');
{
    const body = build(tool(), 'draw')._buildBody();
    check('the Drawing tab offers sketch, line, box and ellipse, and not wall', ['sketch', 'line', 'box', 'ellipse'].every(id => has(body, `data-mode="${id}"`)) && !has(body, 'data-mode="wall"') && !has(body, 'name="wallSnap"'));
}

console.log('\nthe tabs stay put, and the controls come first');
{
    isGM = true;
    const w = build(tool(), 'stamps');
    const data = await w.getData();
    check('the tabs are in the window bar, which does not scroll, and not in the body', data.showToolBar === true && has(data.toolBarLeft, 'blacksmith-tool-tabs') && count(data.toolBarLeft, /data-action="drawing-tab"/g) === 5 && !has(data.bodyContent, 'blacksmith-tool-tabs'));
    check('and the other side of the bar is empty', data.toolBarRight === '');
    const body = w._buildBody();
    const at = text => body.indexOf(text);
    check('on the Stamps tab the options are first, above every stamp', at('name="drawing-size"') > 0 && at('name="drawing-size"') < at('data-action="drawing-stamp"') && at('name="keep"') < at('data-action="drawing-stamp"') && at('name="spacing"') < at('data-action="drawing-stamp"'));
    check('the switches are in a grid, all four together', /cartographer-drawing-toggles">(?:(?!<\/div>)[\s\S])*name="natural"(?:(?!<\/div>\s*<label class="cartographer-drawing-row")[\s\S])*name="keep"/.test(body) && count(body, /cartographer-drawing-toggles/g) === 1 && count(body, /blacksmith-toggle-row/g) === 4);
    const walls = build(tool(), 'walls')._buildBody();
    const wat = text => walls.indexOf(text);
    check('on the Walls tab how they are drawn is first, above the kinds and the materials', wat('data-shape="sketch"') > 0 && wat('data-shape="sketch"') < wat('data-action="drawing-wall"') && wat('name="wallSnap"') < wat('data-action="drawing-wall"') && wat('name="drawing-weight"') < wat('data-action="drawing-wall"') && wat('data-action="drawing-wall"') < wat('data-action="drawing-wall-material"'));
    check('the walls are drawn the way drawings are: sketch, line, box and ellipse, in the same order', (() => { const ids = [...walls.matchAll(/name="drawing-wall-shape" value="(\w+)"/g)].map(m => m[1]); return ids.join() === 'sketch,line,box,ellipse'; })());
    check('and the shape chosen is the one checked', /value="box"[^>]*data-shape="box" checked/.test(build(tool({ state: { ...tool().state, wallShape: 'box' } }), 'walls')._buildBody()));
    const door = build(tool({ state: { ...tool().state, wallKind: 'door' } }), 'walls')._buildBody();
    check('a door has no shape to choose, and its state is above the kinds', !has(door, 'name="drawing-wall-shape"') && door.indexOf('data-door="locked"') < door.indexOf('data-action="drawing-wall"'));
    const utilities = build(tool(), 'utilities')._buildBody();
    check('the Utilities switches are in grids too', count(utilities, /cartographer-drawing-toggles/g) === 2 && count(utilities, /blacksmith-toggle-row/g) === 3);
}

console.log('\nthe Walls tab');
{
    isGM = true;
    const body = build(tool(), 'walls')._buildBody();
    check('every kind of wall has a button with its picture and name', WALL_KINDS.every(k => has(body, `data-action="drawing-wall" data-kind="${k.id}"`) && has(body, wallKindSvg(k.id))));
    check('at least a wall, a door, a window and an invisible wall are among them', ['wall', 'door', 'window', 'invisible', 'secret', 'terrain', 'ethereal'].every(id => WALL_KINDS.some(k => k.id === id)));
    check('no kind is active until wall is the tool', count(body, /is-active" data-action="drawing-wall" /g) === 0);
    const drawing = build(tool({ state: { ...tool().state, drawingMode: 'wall', wallKind: 'window' } }), 'walls')._buildBody();
    check('when it is, the kind chosen is active', count(drawing, /cartographer-stamp is-active/g) === 1 && /is-active" data-action="drawing-wall" data-kind="window"/.test(drawing));
    check('the shape, snap and weight are there', has(body, 'data-shape="line"') && has(body, 'data-shape="sketch"') && has(body, 'name="wallSnap"') && has(body, 'data-action="drawing-weight"'));
    for (const kind of ['door', 'secret', 'window']) {
        const opening = build(tool({ state: { ...tool().state, wallKind: kind } }), 'walls')._buildBody();
        check(`${kind}: no shape to choose, since it is two points, and it says so`, !has(opening, 'data-shape=') && has(opening, lang['drawingTools.wallOpeningHint'].slice(0, 30)) && has(opening, 'name="wallSnap"'));
    }
    check('every material has a button with its picture and name', WALL_MATERIALS.every(m => has(body, `data-action="drawing-wall-material" data-material="${m.id}"`) && has(body, wallMaterialSvg(m.id))));
    check('the material chosen is the active one', count(body, /data-action="drawing-wall-material"[^>]*aria-pressed="true"/g) === 1 && /is-active" data-action="drawing-wall-material" data-material="plain"/.test(body));
    check('another is when it is chosen', /is-active" data-action="drawing-wall-material" data-material="brick"/.test(build(tool({ state: { ...tool().state, wallMaterial: 'brick' } }), 'walls')._buildBody()));
    for (const kind of ['door', 'secret', 'window']) {
        check(`${kind}: no material to choose, since it is drawn as itself`, !has(build(tool({ state: { ...tool().state, wallKind: kind } }), 'walls')._buildBody(), 'data-material='));
    }
    for (const kind of ['wall', 'invisible', 'terrain', 'ethereal']) {
        check(`${kind}: the shape is still chosen`, has(build(tool({ state: { ...tool().state, wallKind: kind } }), 'walls')._buildBody(), 'data-shape="sketch"'));
    }
    check('snap is checked when on, and not when off', /name="wallSnap"[^>]*checked/.test(body) && !/name="wallSnap"[^>]*checked/.test(build(tool({ state: { ...tool().state, wallSnap: false } }), 'walls')._buildBody()));
    check('the shape checked is the shape chosen', /data-shape="sketch"[^>]*checked/.test(build(tool({ state: { ...tool().state, wallShape: 'sketch' } }), 'walls')._buildBody()));
    check('a plain wall is offered no door state', !has(body, 'data-door='));
    for (const kind of ['door', 'secret']) {
        const doors = build(tool({ state: { ...tool().state, wallKind: kind, wallDoor: 'locked' } }), 'walls')._buildBody();
        check(`${kind}: the door state is offered, with the one chosen checked`, ['closed', 'open', 'locked'].every(d => has(doors, `data-door="${d}"`)) && /value="locked"[^>]*checked/.test(doors));
    }
    isGM = false;
    const player = build(tool(), 'walls');
    check('a player has no Walls tab', !has(player._buildTabs(player._currentTab()), 'data-tab="walls"'));
    check('and is shown the Drawing tab if they were on it', has(player._buildBody(), 'data-mode="sketch"') && player._currentTab() === 'draw');
    isGM = true;
    check('a GM has the tab', has(build(tool(), 'draw')._buildTabs('draw'), 'data-tab="walls"'));
}

console.log('\nthe Utilities tab');
{
    const body = build(tool(), 'utilities')._buildBody();
    check('the eraser, and erase-all for a GM', has(body, 'data-action="drawing-erase"') && has(body, 'data-action="drawing-erase-all"'));
    check('the eraser is not active until it is the tool', !/is-active" data-action="drawing-erase"/.test(body));
    check('it is active when it is the tool', /is-active" data-action="drawing-erase"/.test(build(tool({ state: { ...tool().state, drawingMode: 'erase' } }), 'utilities')._buildBody()));
    check('both clear buttons for a GM, and timed erase', has(body, 'data-action="drawing-clear"') && has(body, 'data-action="drawing-clear-all"') && has(body, 'name="timedErase"'));
    check('the scene controls for a GM, as the scene is', /name="tokenVision"[^>]*checked/.test(body) && !/name="globalLight"[^>]*checked/.test(body) && /name="darkness" min="0" max="1" step="0.05" value="0.25"/.test(body));
    isGM = false;
    const player = build(tool(), 'utilities')._buildBody();
    check('a player has the eraser and their own clear, and nothing more', has(player, 'data-action="drawing-erase"') && has(player, 'data-action="drawing-clear"') && !has(player, 'data-action="drawing-clear-all"') && !has(player, 'data-action="drawing-erase-all"'));
    check('a player is not offered the scene controls', !has(player, 'name="tokenVision"') && !has(player, 'name="darkness"') && !has(player, 'name="globalLight"'));
    isGM = true;
    check('the Drawing tab no longer carries the tidying', !has(build(tool(), 'draw')._buildBody(), 'data-action="drawing-clear"'));
}

console.log('\nthe Terrain tab');
{
    const body = build(tool(), 'terrain')._buildBody();
    check('every kind of path has a button with a picture and a name', TERRAINS.every(t => has(body, `data-action="drawing-terrain" data-kind="${t.id}"`) && has(body, terrainSvg(t.id))));
    check('none is active until terrain is the tool', count(body, /cartographer-stamp is-active/g) === 0);
    const ground = STAMPS.filter(s => s.category === 'ground');
    check('the ground patches are here, each a stamp button with a picture', ground.length >= 4 && ground.every(s => has(body, `data-action="drawing-stamp" data-kind="${s.id}"`) && has(body, stampSvg(s.id))));
    const crops = STAMPS.filter(s => s.category === 'fields');
    check('the crops are here too, each a stamp button with a picture, under their own heading', crops.length >= 4 && crops.every(s => has(body, `data-action="drawing-stamp" data-kind="${s.id}"`) && has(body, stampSvg(s.id))) && has(body, lang['drawingTools.categoryFields']));
    check('with a heading, and a size for them', has(body, lang['drawingTools.categoryGround']) && has(body, 'name="drawing-size"'));
    const placing = build(tool({ state: { ...tool().state, drawingMode: 'stamp', stampStyle: 'patch-sand' } }), 'terrain')._buildBody();
    check('the patch being placed is the active one', count(placing, /cartographer-stamp is-active/g) === 1 && /is-active" data-action="drawing-stamp" data-kind="patch-sand"/.test(placing));
    const laying = build(tool({ state: { ...tool().state, drawingMode: 'terrain', stamp: { ...tool().state.stamp, terrain: 'gravel' } } }), 'terrain')._buildBody();
    check('when it is, the kind chosen is active', count(laying, /cartographer-stamp is-active/g) === 1 && /is-active" data-action="drawing-terrain" data-kind="gravel"/.test(laying));
    check('three widths, the chosen one checked', count(body, /data-width="/g) === 3 && /value="1"[^>]*checked/.test(body));
    check('keep is offered, off by default', has(body, 'name="keep"') && !/name="keep"[^>]*checked/.test(body));
    const at = text => body.indexOf(text);
    check('keep is first on the tab, before the paths, where it is seen', at('name="keep"') > 0 && at('name="keep"') < at('data-action="drawing-terrain"'));
    check('each control is above what it controls: keep, then the width, then the paths, then the size, then the patches, then the crops', (() => { const order = [at('name="keep"'), at('name="drawing-path-width"'), at('data-action="drawing-terrain"'), at('name="drawing-size"'), at('data-kind="patch-dirt"'), at('data-kind="crop-corn"')]; return order.every(n => n > 0) && order.every((n, i) => !i || n > order[i - 1]); })());
    check('the size is above both the patches and the crops it controls', at('name="drawing-size"') < at('data-kind="patch-dirt"') && at('name="drawing-size"') < at('data-kind="crop-corn"'));
    isGM = false;
    const player = build(tool(), 'terrain')._buildBody();
    check('a user who may not create drawings has keep disabled', /name="keep"[^>]*disabled/.test(player));
    isGM = true;
}

console.log('\nthe footer');
{
    const idle = build(tool(), 'draw');
    check('Start, when nothing is drawing', has(idle._buildFooterRight(), 'drawing-toggle') && has(idle._buildFooterRight(), 'fa-play'));
    const running = build(tool({ state: { ...tool().state, active: true } }), 'draw');
    check('Stop, when it is', has(running._buildFooterRight(), 'fa-stop'));
    check('Undo is enabled when there is something to undo', !/disabled/.test(idle._buildFooterLeft()));
    check('and disabled when there is not', /disabled/.test(build(tool({ canUndo: () => false }), 'draw')._buildFooterLeft()));
}

console.log('\nescaping');
{
    const evil = tool({ state: { ...tool().state, brushSettings: { size: 6, color: 'rgba(1, 2, 3, 1)', type: 'pen' } } });
    const w = build(evil, 'draw');
    check('a label cannot break out of its attribute', !/"><script/.test(w._button({ action: 'x', icon: 'i', label: '"><script>alert(1)</script>' })));
    check('nor a section title', !has(w._section('i', '<b>', ''), '<b>'));
}

console.log('\nthe joins');
{
    const actions = [...src.matchAll(/(?:data-action="|action: ')([\w-]+)/g)].map(m => m[1]);
    const radioGroups = [...src.matchAll(/_segmented\('([\w-]+)'/g)].map(m => m[1]);
    const handlers = new Set([...src.matchAll(/^\s+'([\w-]+)': \(/gm)].map(m => m[1]));
    const used = new Set([...actions, ...radioGroups]);
    check('every action a button carries is handled', [...used].every(a => handlers.has(a)), [...used].filter(a => !handlers.has(a)).join(', '));
    check('every handler is used by a button', [...handlers].every(h => used.has(h)), [...handlers].filter(h => !used.has(h)).join(', '));
    const strings = new Set();
    // A string named in a call to localize, even in a choice between two: localize(active ? 'stop' : 'start')
    for (const call of src.matchAll(/(?:localize|_localize)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
        for (const word of call[1].matchAll(/'(\w+)'/g)) strings.add(word[1]);
    }
    for (const m of src.matchAll(/labelKey: '(\w+)'/g)) strings.add(m[1]);
    for (const stamp of STAMPS) strings.add(stamp.labelKey);
    for (const category of STAMP_CATEGORIES) strings.add(category.labelKey);
    for (const terrain of TERRAINS) strings.add(terrain.labelKey);
    for (const kind of WALL_KINDS) strings.add(kind.labelKey);
    for (const material of WALL_MATERIALS) strings.add(material.labelKey);
    const missing = [...strings].filter(key => !(`drawingTools.${key}` in lang));
    check('every string the window uses exists', missing.length === 0, missing.join(', '));
    const keys = Object.keys(lang).filter(key => key.startsWith('drawingTools.')).map(key => key.slice('drawingTools.'.length));
    const unused = keys.filter(key => key !== 'title' && !strings.has(key));
    check('and none of the window\'s strings goes unused', unused.length === 0, unused.join(', '));
    check('the window title string exists', 'drawingTools.title' in lang && src.includes('drawingTools.title'));
    const calls = new Set([...src.matchAll(/(?:app\.manager|this\.manager|manager)\.(\w+)\(/g)].map(m => m[1]));
    const absent = [...calls].filter(name => !new RegExp(`^    (async )?${name}\\(`, 'm').test(managerSrc));
    check('every call the window makes on the drawing tool is a method it has', absent.length === 0, absent.join(', '));
    const props = new Set([...src.matchAll(/manager\.state\.(\w+)/g)].map(m => m[1]));
    check('and every state it reads is state the tool has', [...props].every(p => new RegExp(`\\b${p}:`).test(managerSrc)), [...props].join(', '));
    check('the window id matches the one the tool looks for', src.includes("`${MODULE.ID}-drawing-tools`") && managerSrc.includes('`${MODULE.ID}-drawing-tools`'));
    check('every class the window builds is styled', ['cartographer-drawing-panel', 'cartographer-drawing-row', 'cartographer-drawing-label', 'cartographer-drawing-buttons', 'cartographer-drawing-swatch', 'cartographer-stamp-grid', 'cartographer-stamp', 'cartographer-stamp-art', 'cartographer-stamp-name', 'cartographer-drawing-toggles']
        .every(name => fs.readFileSync('styles/tool-drawing.css', 'utf8').includes(`.${name}`)));
    check('the menubar button opens it', fs.readFileSync('scripts/manager-drawing.js', 'utf8').includes('onClick: () => self.openWindow()'));
    check('a swatch colour is one the colour parser reads', ['rgba(38, 38, 38, 0.7)'].every(c => parseColor(c)));
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);

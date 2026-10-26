// The window's HTML, built for every mode and both tabs from the real methods in
// window-autowall.js, against a stand-in manager. It shows that nothing builds as
// "undefined" or "[object Object]", that each control the manager acts on is there for the
// mode it belongs to, that the window is made of Blacksmith's own tool-window components,
// and that the buttons carry the actions the window handles.
//
// It does not show how the window looks or that Blacksmith draws it.
import fs from 'node:fs';

const src = fs.readFileSync('scripts/window-autowall.js', 'utf8');
const tables = src.slice(src.indexOf('/** The modes, in the order'), src.indexOf('export class AutoWallWindow'));
const slice = (from, to) => {
    const a = src.indexOf(from);
    const b = src.indexOf(to, a);
    if (a < 0 || b < 0) throw new Error(`could not locate ${from.trim().slice(0, 40)}`);
    return src.slice(a, b);
};
const methods = slice('    _localize(key) {', '    // ==================================================================\n    // ===== LIFECYCLE');

const MODULE = { ID: 'coffee-pub-cartographer' };
const game = { i18n: { localize: key => key.replace('coffee-pub-cartographer.autowall.', '') } };
const foundry = { utils: { escapeHTML: text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') } };

const Harness = eval(`(() => {
${tables}
return class Harness {
    constructor(manager) { this.manager = manager; }
    get id() { return 'window-id'; }
${methods}
};
})()`);

const LIMITS = {
    match: { min: 8, max: 36, step: 1 }, smoothing: { min: 0.05, max: 1, step: 0.05 }, widest: { min: 0.25, max: 3, step: 0.05 },
    windowDistance: { min: 0.5, max: 6, step: 0.5 }, joinDistance: { min: 0.05, max: 1, step: 0.05 }
};
const options = { mode: 'wall', tab: 'map', drawTool: 'point', drawKind: 'wall', joinEnds: true, joinDistance: 0.25, match: 20, smoothing: 0.3, widest: 1, snap: false,
    doorState: 'closed', doorSound: 'wood', doorAnimation: '', windowDistance: 2, windowAttenuation: true };
const manager = (mode, tab, undo = false) => ({
    session: { mode, options: { ...options, mode, tab }, draw: { active: false } },
    limits: name => LIMITS[name],
    doorSoundChoices: () => [['', 'Default'], ['wood', 'Wood'], ['metal', 'Metal']],
    doorAnimationChoices: () => [['', 'Default'], ['slide', 'Slide']],
    canUndoCleanup: () => undo
});

let failures = 0;
const check = (label, ok, detail = '') => {
    if (ok) { console.log(`  ok    ${label}`); return; }
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
};
const has = (html, text) => html.includes(text);
const count = (html, pattern) => (html.match(pattern) ?? []).length;
const names = html => [...html.matchAll(/name="([\w-]+)"/g)].map(m => m[1]).filter(name => !name.startsWith('autowall-')).sort();

console.log('every mode and tab builds');
for (const [mode, tab] of [['wall', 'map'], ['door', 'map'], ['window', 'map'], ['wall', 'draw'], ['door', 'draw'], ['window', 'draw'], ['wall', 'options'], ['door', 'options'], ['window', 'options']]) {
    const window_ = new Harness(manager(mode, tab));
    const body = window_._buildBody(window_.manager.session);
    const left = window_._buildFooterLeft();
    const right = window_._buildFooterRight();
    const all = body + left + right;
    check(`${mode} / ${tab}: nothing is undefined`, !/undefined|\[object|NaN/.test(all), all.match(/.{30}(undefined|\[object|NaN).{30}/)?.[0]);
    check(`${mode} / ${tab}: the tabs come first, three of them, the one showing marked`,
        body.trimStart().startsWith('<nav class="blacksmith-tool-tabs') && count(body, /data-action="autowall-tab"/g) === 3 && count(body, /blacksmith-tool-tab is-active/g) === 1);
    check(`${mode} / ${tab}: Cancel on the left of the footer`, has(left, 'data-action="autowall-cancel"') && has(left, 'blacksmith-window-btn-secondary'));
    if (tab === 'draw') check(`${mode} / ${tab}: no Add, since walls are made as they are drawn`, right === '');
    else check(`${mode} / ${tab}: Add on the right, off to start`, has(right, 'data-action="autowall-add"') && has(right, 'blacksmith-window-btn-primary') && /autowall-add"[^>]*disabled/.test(right));
}

console.log('\nthe mode is chosen on the Map tab, under the tabs');
for (const mode of ['wall', 'door', 'window']) {
    const w = new Harness(manager(mode, 'map'));
    const body = w._buildBody(w.manager.session);
    check(`${mode}: a segmented control of three, the mode in use checked`,
        has(body, 'blacksmith-tool-segmented') && count(body, /type="radio" name="autowall-mode"/g) === 3 && count(body, /data-action="autowall-mode"[^>]* checked/g) === 1 && has(body, `data-mode="${mode}" checked`), body.match(/<div class="blacksmith-tool-segmented[\s\S]*?<\/div>/)?.[0]);
    check(`${mode}: it comes after the tabs`, body.indexOf('blacksmith-tool-tabs') < body.indexOf('blacksmith-tool-segmented'));
}
{
    const w = new Harness(manager('wall', 'options'));
    check('the Options tab is not about one mode, so it has no selector', !has(w._buildBody(w.manager.session), 'blacksmith-tool-segmented'));
}

console.log('\nthe controls each place has');
{
    const map = mode => { const w = new Harness(manager(mode, 'map')); return w._buildBody(w.manager.session); };
    check('walls: match, smoothing, widest', JSON.stringify(names(map('wall'))) === JSON.stringify(['match', 'smoothing', 'widest']), JSON.stringify(names(map('wall'))));
    check('doors: match, state, sound, animation', JSON.stringify(names(map('door'))) === JSON.stringify(['doorAnimation', 'doorSound', 'doorState', 'match']), JSON.stringify(names(map('door'))));
    check('windows: match, see-through, fade', JSON.stringify(names(map('window'))) === JSON.stringify(['match', 'windowAttenuation', 'windowDistance']), JSON.stringify(names(map('window'))));
    check('the status line and the picture are on the Map tab', has(map('wall'), 'data-role="status"') && has(map('wall'), 'cartographer-autowall-thumb'));

    const door = map('door');
    check('the sound chosen is the one selected', /<option value="wood" selected>/.test(door) && !/<option value="metal" selected>/.test(door));
    check('the state chosen is the one selected', /<option value="closed" selected>/.test(door));
    check('every slider carries its limits and is Blacksmith\'s slider', count(map('wall'), /class="blacksmith-slider"><input type="range" name="\w+" min="[\d.]+" max="[\d.]+" step="[\d.]+" value="[\d.]+"/g) === 3);
    check('the sections are Blacksmith\'s', count(map('wall'), /class="blacksmith-tool-section"/g) === 3);

    const options_ = new Harness(manager('wall', 'options'));
    const html = options_._buildBody(options_.manager.session);
    check('Options: join, join distance, snap', JSON.stringify(names(html)) === JSON.stringify(['joinDistance', 'joinEnds', 'snap']), JSON.stringify(names(html)));
    check('Options: the on-or-off settings are Blacksmith\'s toggle, the set ones checked',
        count(html, /class="blacksmith-toggle-input"/g) === 2 && /name="joinEnds" checked/.test(html) && !/name="snap" checked/.test(html));
    check('Options: Clean up, with Undo off when there is nothing to undo', has(html, 'data-action="autowall-cleanup"') && /autowall-cleanup-undo"[^>]*disabled/.test(html));
    check('Options: the buttons are Blacksmith\'s', count(html, /class="blacksmith-tool-btn"/g) === 2);
    check('Options: the clean-up result has a place', has(html, 'data-role="cleanup"'));

    const undo = new Harness(manager('wall', 'options', true));
    check('Options: Undo is on when there is something to undo', !/autowall-cleanup-undo"[^>]*disabled/.test(undo._buildBody(undo.manager.session)));
}

console.log('\nthe Draw tab');
{
    const draw = (kind, tool = 'point', active = false) => {
        const w = new Harness(manager('wall', 'draw'));
        w.manager.session.options.drawKind = kind;
        w.manager.session.options.drawTool = tool;
        w.manager.session.draw.active = active;
        return w._buildBody(w.manager.session);
    };
    const wall = draw('wall');
    check('two segmented controls: how, and what', count(wall, /class="blacksmith-tool-segmented/g) === 2);
    check('how: points or sketch, the one in use checked', count(wall, /name="autowall-draw-tool"/g) === 2 && /data-tool="point" checked/.test(wall) && !/data-tool="sketch" checked/.test(wall));
    check('what: wall, door or window, the one in use checked', count(wall, /name="autowall-draw-kind"/g) === 3 && /data-kind="wall" checked/.test(wall));
    check('a wall has no settings of its own to show', JSON.stringify(names(wall)) === JSON.stringify([]), JSON.stringify(names(wall)));
    check('sketching has smoothing, points do not', JSON.stringify(names(draw('wall', 'sketch'))) === JSON.stringify(['smoothing']) && !has(wall, 'name="smoothing"'));
    check('a door draws with its state, sound and animation', JSON.stringify(names(draw('door'))) === JSON.stringify(['doorAnimation', 'doorSound', 'doorState']), JSON.stringify(names(draw('door'))));
    check('a window draws with its see-through distance and fade', JSON.stringify(names(draw('window'))) === JSON.stringify(['windowAttenuation', 'windowDistance']), JSON.stringify(names(draw('window'))));
    check('Start drawing, off', has(wall, 'data-action="autowall-draw-toggle"') && has(wall, 'fa-play') && !/blacksmith-tool-btn is-active/.test(wall));
    check('and Stop drawing when it is on, lit', has(draw('wall', 'point', true), 'fa-stop') && /blacksmith-tool-btn is-active/.test(draw('wall', 'point', true)));
    check('a button to take back the last wall, and a place for what is happening', has(wall, 'data-action="autowall-draw-undo"') && has(wall, 'data-role="draw-status"'));
}

console.log('\nnothing of the scene-motion window is borrowed');
{
    const w = new Harness(manager('door', 'map'));
    const all = w._buildBody(w.manager.session) + w._buildFooterLeft() + w._buildFooterRight();
    check('no class of the scene-motion window is used', !/cartographer-parallax/.test(all) && !/cartographer-parallax/.test(src.slice(src.indexOf('classes:'), src.indexOf('classes:') + 80)));
}

console.log('\nmarkup is escaped');
{
    const window_ = new Harness({ ...manager('door', 'map'), doorSoundChoices: () => [['', 'Default'], ['a"b', '<b>Loud</b>']] });
    const html = window_._buildBody(window_.manager.session);
    check('a name with markup in it is not markup', !has(html, '<b>Loud</b>') && has(html, '&lt;b>Loud&lt;/b>'));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);

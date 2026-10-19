// The joins in the scene-motion window -- template, control bar, handlers,
// strings and styles -- where a typo produces a button that silently does
// nothing, a label that reads as its own key, or a rule nothing uses.
import fs from 'node:fs';

const hbs = fs.readFileSync('templates/window-parallax.hbs', 'utf8');
const windowJs = fs.readFileSync('scripts/window-parallax.js', 'utf8');
const sources = hbs + windowJs
    + ['manager-parallax.js', 'manager-tilemotion.js', 'manager-collections.js', 'manager-motionbar.js', 'manager-travel.js']
        .map(file => fs.readFileSync(`scripts/${file}`, 'utf8')).join('');
const css = fs.readFileSync('styles/tool-parallax.css', 'utf8');
const lang = JSON.parse(fs.readFileSync('lang/en.json', 'utf8'))['coffee-pub-cartographer'];

let bad = 0;
const fail = (m) => { bad++; console.log('  FAIL  ' + m); };
const ok = (m) => console.log('  ok    ' + m);

console.log('every data-action, in the template or built by the control bar, has a handler');
{
    // The control bar is built as strings in the script: its buttons pass
    // \`action: 'name'\` to _button, and its chips write data-action directly.
    const actions = new Set([
        ...[...hbs.matchAll(/data-action="([a-z-]+)"/g)].map(m => m[1]),
        ...[...windowJs.matchAll(/action: '([a-z-]+)'/g)].map(m => m[1])
    ]);
    // Chips take their action from the partial's arguments.
    for (const m of hbs.matchAll(/(?:allAction|noneAction|toggleAction)="([a-z-]+)"/g)) actions.add(m[1]);
    actions.delete('');
    let missing = 0;
    for (const action of actions) {
        if (!windowJs.includes(`'${action}':`)) { fail(`no ACTION_HANDLERS entry for "${action}"`); missing++; }
    }
    if (!missing) ok(`${actions.size} actions, all handled`);
}

console.log('\nevery data-field the window reads is one it acts on');
{
    const fields = new Set([...(hbs + windowJs).matchAll(/data-field="([A-Za-z]+)"/g)].map(m => m[1]));
    // Layer fields go straight to updateLayer, so any name is acted on; the
    // rest must each be named in _onChange.
    const onChange = windowJs.slice(windowJs.indexOf('    _onChange(event) {'), windowJs.indexOf('\n    }\n', windowJs.indexOf('    _onChange(event) {')));
    const layerFields = new Set([...hbs.matchAll(/data-field="([A-Za-z]+)" data-layer-id/g)].map(m => m[1]));
    let missing = 0;
    for (const field of fields) {
        if (layerFields.has(field)) continue;
        if (!onChange.includes(`'${field}'`)) { fail(`data-field "${field}" is never handled in _onChange`); missing++; }
    }
    if (!missing) ok(`${fields.size} fields, all handled`);
}

console.log('\nevery string used exists in en.json');
{
    const keys = new Set();
    for (const m of hbs.matchAll(/"coffee-pub-cartographer\.(parallax\.[A-Za-z.]+)"/g)) keys.add(m[1]);
    for (const m of sources.matchAll(/\$\{MODULE\.ID\}\.(parallax\.[A-Za-z.]+)[`'"]/g)) keys.add(m[1]);
    for (const m of sources.matchAll(/localize\('([A-Za-z]+)'\)/g)) keys.add(`parallax.${m[1]}`);
    for (const m of sources.matchAll(/labelKey: '([A-Za-z]+)'/g)) keys.add(`parallax.${m[1]}`);
    // Short keys are only looked up under parallax.* in these files; one that
    // belongs to another prefix would show as missing here and be a real bug.
    // Browser-storage keys share the prefix but are not strings.
    for (const m of sources.matchAll(/_KEY = `\$\{MODULE\.ID\}\.(parallax\.[A-Za-z]+)`/g)) keys.delete(m[1]);
    let missing = 0;
    for (const key of keys) if (!(key in lang)) { fail(`missing string ${key}`); missing++; }
    if (!missing) ok(`${keys.size} keys, all present`);
}

console.log('\nno string under parallax.* goes unused');
{
    // A key is used if it appears in full, or as its short name in quotes,
    // or is built from a known prefix (direction.left and friends).
    const dynamic = ['parallax.direction.', 'parallax.pace.', 'parallax.paceGroup.'];
    const unused = Object.keys(lang).filter(key => key.startsWith('parallax.')).filter(key => {
        if (dynamic.some(prefix => key.startsWith(prefix))) return false;
        const short = key.slice('parallax.'.length);
        return !sources.includes(key) && !sources.includes(`'${short}'`) && !sources.includes(`"${short}"`);
    });
    if (unused.length) fail(`unused strings: ${unused.join(', ')}`);
    else ok('every parallax string is referenced');
}

console.log('\nno style in tool-parallax.css goes unused');
{
    const classes = [...new Set([...css.matchAll(/\.(cartographer-parallax-[a-z-]+)/g)].map(m => m[1]))];
    const unused = classes.filter(name => !sources.includes(name));
    if (unused.length) fail(`unused classes: ${unused.join(', ')}`);
    else ok(`${classes.length} classes, all referenced`);
}

console.log('\nthe routes window: actions, strings and styles');
{
    const rhbs = fs.readFileSync('templates/window-routes.hbs', 'utf8');
    const rjs = fs.readFileSync('scripts/window-routes.js', 'utf8');
    const rman = fs.readFileSync('scripts/manager-routes.js', 'utf8');
    const all = rhbs + rjs + rman;
    const actions = new Set([...all.matchAll(/data-action="([a-z-]+)"/g)].map(m => m[1]));
    const unhandled = [...actions].filter(action => !rjs.includes(`'${action}':`));
    if (unhandled.length) fail(`routes actions with no handler: ${unhandled.join(', ')}`);
    else ok(`${actions.size} actions, all handled`);

    // Keys in full in the template; `${MODULE.ID}.routes.x` and localize('x') in the scripts.
    const used = new Set();
    for (const m of rhbs.matchAll(/"coffee-pub-cartographer\.((?:routes|parallax)\.[A-Za-z.]+)"/g)) used.add(m[1]);
    for (const m of (rjs + rman).matchAll(/\$\{MODULE\.ID\}\.((?:routes|parallax)\.[A-Za-z.]+)[`'"]/g)) used.add(m[1]);
    for (const m of (rjs + rman).matchAll(/localize\('([A-Za-z]+)'\)/g)) used.add(`routes.${m[1]}`);
    for (const m of (rjs + rman).matchAll(/localize\(drawing \? '([A-Za-z]+)' : '([A-Za-z]+)'\)/g)) { used.add(`routes.${m[1]}`); used.add(`routes.${m[2]}`); }
    for (const m of rjs.matchAll(/'oneLeg' : 'legs'/g)) { used.add('routes.oneLeg'); used.add('routes.legs'); }
    for (const m of rman.matchAll(/_KEY = `\$\{MODULE\.ID\}\.(routes\.[A-Za-z]+)`/g)) used.delete(m[1]);
    for (const m of rjs.matchAll(/_KEY = `\$\{MODULE\.ID\}\.(routes\.[A-Za-z]+)`/g)) used.delete(m[1]);
    const missing = [...used].filter(key => !(key in lang));
    if (missing.length) fail(`missing strings: ${missing.join(', ')}`);
    else ok(`${used.size} keys, all present`);
    const unusedRoutes = Object.keys(lang).filter(key => key.startsWith('routes.') && !used.has(key));
    if (unusedRoutes.length) fail(`unused routes strings: ${unusedRoutes.join(', ')}`);
    else ok('every routes string is referenced');

    const routeClasses = [...new Set([...css.matchAll(/\.(cartographer-routes-[a-z-]+)/g)].map(m => m[1]))];
    const unusedClasses = routeClasses.filter(name => !all.includes(name));
    if (unusedClasses.length) fail(`unused classes: ${unusedClasses.join(', ')}`);
    else ok(`${routeClasses.length} route classes, all referenced`);

    // Every name the window imports from utils-travel is exported there, and
    // every one it calls is imported: a missing import is a crash on render.
    const travel = fs.readFileSync('scripts/utils-travel.js', 'utf8');
    const exported = new Set([...travel.matchAll(/^export (?:const|function) ([A-Za-z_]+)/gm)].map(m => m[1]));
    for (const [file, source] of [['window-routes.js', rjs], ['window-parallax.js', windowJs], ['manager-routes.js', rman]]) {
        const block = source.match(/import \{([^}]*)\} from '\.\/utils-travel\.js'/);
        const imported = new Set((block?.[1] ?? '').split(',').map(name => name.trim()).filter(Boolean));
        const body = source.replace(/import [\s\S]*?from '[^']+';/g, '');
        const notExported = [...imported].filter(name => !exported.has(name));
        const notImported = [...exported].filter(name => !imported.has(name) && new RegExp(`[^.\\w]${name}\\(`).test(body));
        if (notExported.length || notImported.length) fail(`${file}: imports missing from utils-travel ${notExported.join(', ')}; calls without import ${notImported.join(', ')}`);
        else ok(`${file} imports what it uses from utils-travel`);
    }
}

console.log('\nthe window declares only its own options');
{
    // Copying super's DEFAULT_OPTIONS in duplicates core's v14 window controls;
    // see the comment on DEFAULT_OPTIONS in Blacksmith's window-tool-base.js.
    if (/mergeObject\(\s*foundry\.utils\.mergeObject\(\{\},\s*super\.DEFAULT_OPTIONS/.test(windowJs)) {
        fail('DEFAULT_OPTIONS copies super\'s options in');
    } else ok('DEFAULT_OPTIONS is a plain object');
    if (/position:\s*\{[^}]*height:\s*'auto'/.test(windowJs)) fail('the window height is auto, so every render refits and moves it');
    else ok('the window height is fixed, so renders leave its size and place alone');
}

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);

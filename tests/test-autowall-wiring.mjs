// The joins in Map This Wall where a typo fails silently: a string that is not
// in en.json shows as its key, a class with no rule shows unstyled, a group the
// bar does not know drops the buttons. Reads the real source files.
import fs from 'node:fs';

const managerSource = fs.readFileSync('scripts/manager-autowall.js', 'utf8');
const windowSource = fs.readFileSync('scripts/window-autowall.js', 'utf8');
// The strings and classes are used by both; the group and the wiring are read from each.
const manager = managerSource + '\n' + windowSource;
const css = fs.readFileSync('styles/tool-autowall.css', 'utf8');
const defaultCss = fs.readFileSync('styles/default.css', 'utf8');
const toolbar = fs.readFileSync('scripts/manager-toolbar.js', 'utf8');
const entry = fs.readFileSync('scripts/cartographer.js', 'utf8');
const lang = JSON.parse(fs.readFileSync('lang/en.json', 'utf8'))['coffee-pub-cartographer'];

let failures = 0;
const fail = message => { failures++; console.log(`  FAIL  ${message}`); };
const ok = message => console.log(`  ok    ${message}`);

console.log('every string the tool asks for exists, and every one it has is used');
{
    // Every string a call asks for must exist; every string there is must be asked for somewhere,
    // by a call or by being named in the source (a key chosen from a table is still named).
    const have = Object.keys(lang).filter(key => key.startsWith('autowall.')).map(key => key.slice('autowall.'.length));
    const asked = [...manager.matchAll(/_?localize\(\s*'([A-Za-z]+)'/g)].map(m => m[1]);
    const used = new Set([...asked, ...have.filter(key => manager.includes(`'${key}'`) || manager.includes(`autowall.${key}`))]);
    for (const key of used) if (!have.includes(key)) fail(`missing string autowall.${key}`);
    for (const key of have) if (!used.has(key)) fail(`autowall.${key} is never used`);
    if (!failures) ok(`${used.size} strings, all present and all used`);
}

console.log('\nevery class the panel uses has a rule');
{
    const classes = new Set([...manager.matchAll(/cartographer-autowall-[a-z-]+/g)].map(m => m[0]));
    const before = failures;
    for (const name of classes) if (!css.includes(`.${name}`)) fail(`no rule for .${name}`);
    if (failures === before) ok(`${classes.size} classes styled`);
    if (!defaultCss.includes('tool-autowall.css')) fail('default.css does not import tool-autowall.css');
    else ok('the stylesheet is imported');
}

console.log('\nthe bar knows the group, and the tool is started');
{
    const group = managerSource.match(/const GROUP = '([^']+)'/)?.[1];
    if (!group || !toolbar.includes(`'${group}': {`)) fail(`manager-toolbar.js has no "${group}" group`);
    else ok(`the "${group}" group is registered`);
    if (!entry.includes("import { autoWallManager } from './manager-autowall.js'") || !entry.includes('autoWallManager.initialize()')) {
        fail('cartographer.js does not import and initialise the manager');
    } else ok('cartographer.js initialises the manager');
}

console.log('\nthe window and the manager meet');
{
    const before = failures;
    // Every button in the window has a handler.
    const actions = [...new Set([...windowSource.matchAll(/(?:action: |data-action=")'?(autowall-[a-z-]+)/g)].map(m => m[1]))];
    for (const action of actions) if (!new RegExp(`'${action}':`).test(windowSource)) fail(`no ACTION_HANDLERS entry for "${action}"`);
    // Every manager method the window calls exists.
    const calls = [...new Set([...windowSource.matchAll(/manager\??\.(\w+)\(/g)].map(m => m[1]))];
    for (const name of calls) {
        if (!new RegExp(`^    (?:async )?(?:get )?${name}\\(`, 'm').test(managerSource)) fail(`the window calls manager.${name}(), which does not exist`);
    }
    // Every control the window builds is acted on by the manager's change handler or is a plain setting.
    const names = [...new Set([...windowSource.matchAll(/_(?:slider|select|check)\('(\w+)'/g)].map(m => m[1]))];
    for (const name of names) if (!new RegExp(`\\b${name}:`).test(managerSource.match(/const DEFAULTS = \{[\s\S]*?\n\};/)?.[0] ?? '')) fail(`${name} has a control but no default`);
    if (failures === before) ok(`${actions.length} actions, ${calls.length} manager calls and ${names.length} controls all line up`);
}

console.log('\nthe controls and their limits agree');
{
    const limits = [...manager.matchAll(/^    (\w+): \{ min/gm)].map(m => m[1]);
    const defaults = manager.match(/const DEFAULTS = \{([^}]+)\}/)?.[1] ?? '';
    for (const name of limits) if (!new RegExp(`\\b${name}:`).test(defaults)) fail(`${name} has limits but no default`);
    for (const name of limits) {
        const limit = manager.match(new RegExp(`${name}: \\{ min: ([\\d.]+), max: ([\\d.]+)`));
        const start = Number(defaults.match(new RegExp(`\\b${name}: ([\\d.]+)`))?.[1]);
        if (!(start >= Number(limit[1]) && start <= Number(limit[2]))) fail(`${name} default ${start} is outside ${limit[1]}..${limit[2]}`);
    }
    if (!failures) ok(`${limits.join(', ')} each start inside their limits`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall checks passed');
process.exit(failures ? 1 : 0);

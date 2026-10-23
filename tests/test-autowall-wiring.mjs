// The joins in Map This Wall where a typo fails silently: a string that is not
// in en.json shows as its key, a class with no rule shows unstyled, a group the
// bar does not know drops the buttons. Reads the real source files.
import fs from 'node:fs';

const manager = fs.readFileSync('scripts/manager-autowall.js', 'utf8');
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
    const used = new Set([
        ...[...manager.matchAll(/(?:_localize|localize)\('([A-Za-z]+)'/g)].map(m => m[1]),
        ...[...manager.matchAll(/slider\('[a-z]+', localize\('([A-Za-z]+)'\), localize\('([A-Za-z]+)'\)\)/g)].flatMap(m => [m[1], m[2]]),
        ...[...manager.matchAll(/this\._localize\(count === 1 \? '([A-Za-z]+)' : '([A-Za-z]+)'/g)].flatMap(m => [m[1], m[2]])
    ]);
    const have = Object.keys(lang).filter(key => key.startsWith('autowall.')).map(key => key.slice('autowall.'.length));
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
    const group = manager.match(/const GROUP = '([^']+)'/)?.[1];
    if (!group || !toolbar.includes(`'${group}': {`)) fail(`manager-toolbar.js has no "${group}" group`);
    else ok(`the "${group}" group is registered`);
    if (!entry.includes("import { autoWallManager } from './manager-autowall.js'") || !entry.includes('autoWallManager.initialize()')) {
        fail('cartographer.js does not import and initialise the manager');
    } else ok('cartographer.js initialises the manager');
}

console.log('\nthe controls and their limits agree');
{
    const limits = [...manager.matchAll(/^    (match|smoothing|widest): \{ min/gm)].map(m => m[1]);
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

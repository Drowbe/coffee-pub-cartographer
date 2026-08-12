// The joins between template, handlers and strings -- the places where a typo
// produces a button that silently does nothing rather than an error.
import fs from 'node:fs';

const hbs = fs.readFileSync('templates/window-mapping.hbs', 'utf8');
const js = fs.readFileSync('scripts/window-mapping.js', 'utf8');
const managerJs = fs.readFileSync('scripts/manager-mapping.js', 'utf8');
const lang = JSON.parse(fs.readFileSync('lang/en.json', 'utf8'))['coffee-pub-cartographer'];

let bad = 0;
const fail = (m) => { bad++; console.log('  FAIL  ' + m); };
const ok = (m) => console.log('  ok    ' + m);

console.log('every data-action in the template has a handler');
const actions = [...new Set([...hbs.matchAll(/data-action="([a-z-]+)"/g)].map(m => m[1]))];
for (const action of actions) {
    if (!js.includes(`'${action}':`)) fail(`no ACTION_HANDLERS entry for "${action}"`);
}
ok(`${actions.length} actions wired: ${actions.join(', ')}`);

console.log('\nevery localisation key used exists in en.json');
const source = js + managerJs;
const keys = new Set();
for (const m of source.matchAll(/localize\('(mapping\.[A-Za-z]+)'\)/g)) keys.add(m[1]);
// The terminator matters: a key built by interpolation -- `mapping.mode${key}Hint`
// -- is not a key, and matching its static prefix reports a string that was
// never meant to exist.
for (const m of source.matchAll(/\$\{MODULE\.ID\}\.(mapping\.[A-Za-z]+)[`'"]/g)) keys.add(m[1]);
let missing = 0;
for (const key of keys) if (!(key in lang)) { fail(`missing string ${key}`); missing++; }
if (!missing) ok(`${keys.size} keys, all present`);

console.log('\nevery mutation the client sends is handled GM-side');
const sent = new Set([...managerJs.matchAll(/action: '([a-z-]+)'/g)].map(m => m[1]));
for (const action of sent) {
    const handled = managerJs.includes(`data.action === '${action}'`)
        || managerJs.includes(`ANNOTATION_ACTIONS`) && ['place-symbol', 'remove-symbol'].includes(action);
    if (!handled) fail(`mutation "${action}" is sent but never handled`);
}
ok(`${sent.size} mutations: ${[...sent].join(', ')}`);

console.log('\nthe new record fields survive a round trip through normalisation');
for (const field of ['kind', 'shared', 'officialId', 'contributors']) {
    if (!managerJs.includes(`${field},`) && !managerJs.includes(`${field}:`)) {
        fail(`${field} is not written by _normalizeRecord`);
    }
}
ok('kind, shared, officialId and contributors are all normalised');


console.log('\nthe chrome is built from the model, not from live window state');
{
    // getData awaits the body render between building the model and building the
    // chrome. Anything reading this.viewMode after that await can disagree with
    // the model it is handed -- which is what starting the party map triggered,
    // because it switches the window to the new map while a render is in flight.
    const getData = js.slice(js.indexOf('    async getData()'), js.indexOf('\n    }\n', js.indexOf('    async getData()')));
    const chrome = js.slice(js.indexOf('    _buildStatusIdentity('), js.indexOf('\n    _buildViewControls('));
    for (const [name, body] of [['getData', getData], ['the chrome builders', chrome]]) {
        const strays = [...body.matchAll(/this\.viewMode\s*===\s*'list'/g)].length;
        if (strays) fail(`${name} reads this.viewMode after the await (${strays}x); use model.isListView`);
    }
    ok('getData and the chrome builders read model.isListView');
    // And the model must always carry the flag they now depend on.
    if (!js.includes('isListView: true') || !js.includes('isListView: false')) {
        fail('a model branch does not set isListView');
    } else ok('both model branches set isListView');
}

console.log(bad ? `\n${bad} FAILURE(S)` : '\nall checks passed');
process.exit(bad ? 1 : 0);

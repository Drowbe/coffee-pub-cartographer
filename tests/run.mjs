// Runs every suite. From the module root:  node tests/run.mjs
//
// These are not unit tests of copies. Each suite either imports the real module
// or slices the real function out of its source file and runs that, so a suite
// cannot pass against code that no longer exists. They need nothing installed:
// plain node, no framework, no package.json.
//
// Every suite assumes the working directory is the module root, because that is
// how the sliced files are found.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const root = path.resolve(here, '..');

const suites = fs.readdirSync(here)
    .filter(name => name.startsWith('test-') && name.endsWith('.mjs'))
    .sort();

let failed = 0;
for (const suite of suites) {
    process.stdout.write(`${suite.padEnd(28)} `);
    try {
        execFileSync(process.execPath, [path.join(here, suite)], { cwd: root, stdio: 'pipe' });
        console.log('PASS');
    } catch (error) {
        failed++;
        console.log('FAIL');
        console.log(String(error.stdout ?? '').split('\n').filter(line => /FAIL|Error/.test(line)).join('\n'));
    }
}

console.log(failed ? `\n${failed} of ${suites.length} suites failed` : `\n${suites.length} suites passed`);
process.exit(failed ? 1 : 0);

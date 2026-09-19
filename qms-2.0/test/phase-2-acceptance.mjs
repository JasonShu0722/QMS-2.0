import { execFileSync } from 'node:child_process';
const root = new URL('../', import.meta.url).pathname.replace(/^\/(\w):/, '$1:');
const commands = [
  ['test', ['--dir', 'qms-2.0', 'test']],
  ['contracts', ['--dir', 'qms-2.0', 'contracts:check']],
  ['archive', ['--dir', 'qms-2.0', 'check:archive-isolation']],
  ['build', ['--dir', 'qms-2.0', 'build']],
];
const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
for (const [name, args] of commands) { process.stdout.write(`PHASE2 ${name}...\n`); execFileSync(corepack, ['pnpm', ...args], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }); }
process.stdout.write('PHASE2 acceptance: PASS\n');

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repository = join(root, '..');

function run(command, args) {
  return execFileSync(command, args, { cwd: repository, encoding: 'utf8' });
}

function search(command, args) {
  try {
    return run(command, args).trim();
  } catch (error) {
    if (error.status === 1) return '';
    throw error;
  }
}

function listTrackedFiles() {
  try {
    return run('git', ['ls-files', '--', 'qms-2.0']);
  } catch {
    console.error('archive isolation: FAIL (git checkout required)');
    process.exit(1);
  }
}

const tracked = listTrackedFiles();
const frozenRelease = ['qms', '1.0'].join('-');
const frozenReleasePattern = frozenRelease.replace('.', '\\.');
const archiveSegment = ['archive', frozenRelease].join('/');
const trackedArchive = tracked.match(new RegExp(`(?:^|\\n)(?:.*${archiveSegment.replace('/', '\\/')}.*)(?:\\n|$)`, 'g'));
const files = [
  'package.json',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'packages/contracts/package.json',
  'test/structure.test.mjs',
  'scripts/check-archive-isolation.mjs',
];
const contents = await Promise.all(files.map((file) => readFile(join(root, file), 'utf8')));
const forbidden = new RegExp(`(?:archive[\\/]${frozenReleasePattern}|${frozenReleasePattern})`, 'i');

const rgMatches = search('rg', [
  '--line-number',
  '--no-heading',
  '--glob', '!qms-2.0/scripts/check-archive-isolation.mjs',
  '--glob', '!*.md',
  forbidden.source,
  'qms-2.0',
]).trim();

if (trackedArchive || rgMatches || contents.some((content) => forbidden.test(content))) {
  console.error('archive isolation: FAIL');
  process.exit(1);
}

console.log('archive isolation: PASS');

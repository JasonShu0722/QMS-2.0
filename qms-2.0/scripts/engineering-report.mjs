import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, lstat, realpath, mkdir, writeFile } from 'node:fs/promises';
import { dirname, basename, isAbsolute, relative, resolve, sep } from 'node:path';

export function within(root, file) {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export function parseOptions(args, allowed) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index].replace(/^--/, '');
    assert.ok(args[index].startsWith('--') && allowed.includes(key) && !Object.hasOwn(options, key) && args[index + 1] && !args[index + 1].startsWith('--'), '参数无效、重复或缺少值');
    options[key] = args[index + 1];
  }
  assert.ok(options.output, '必须提供 --output，指定 Git 外尚不存在的目录');
  return options;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

export async function repositoryRoot(root) {
  return realpath(git(root, ['rev-parse', '--show-toplevel']).trim());
}

export async function createOutputDirectory(root, output) {
  assert.ok(isAbsolute(output), '输出必须是 Git 外的绝对路径');
  const repository = await repositoryRoot(root);
  const parent = await realpath(dirname(output));
  const target = resolve(parent, basename(output));
  assert.ok(!within(repository, target), '输出必须位于 Git 外');
  await mkdir(target);
  return target;
}

export async function sourceSnapshot(root) {
  const repository = await repositoryRoot(root);
  const scope = ['qms-2.0', 'docs/superpowers', 'AGENTS.md', 'README.md', '.github/workflows'];
  const commit = git(repository, ['rev-parse', 'HEAD']).trim();
  const branch = git(repository, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const split = (text) => text.split('\0').filter(Boolean);
  const tracked = split(git(repository, ['ls-files', '-z', '--cached', '--', ...scope]));
  const untracked = split(git(repository, ['ls-files', '-z', '--others', '--exclude-standard', '--', ...scope]));
  const changed = new Set([...split(git(repository, ['diff', '--name-only', '-z', 'HEAD', '--', ...scope])), ...untracked]);
  const files = [];
  let excludedCount = 0;
  for (const path of [...new Set([...tracked, ...untracked])].sort()) {
    const segments = path.split('/');
    if (segments.some((part) => ['node_modules', 'dist', 'logs', 'uploads', 'backups', 'archive', 'test-results', 'coverage', '.superpowers'].includes(part))
      || /(?:^|\/)\.env(?:\.|$)/i.test(path) && !path.endsWith('.env.example')
      || /\.(?:log|pem|key|crt|pfx|p12|bak|backup|qmsb|dump|db|sqlite3?)$/i.test(path)) {
      excludedCount++;
      changed.delete(path);
      continue;
    }
    const file = resolve(repository, path);
    assert.ok(within(repository, file), '源码路径超出仓库');
    let information;
    try { information = await lstat(file); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      files.push({ path, sha256: null });
      continue;
    }
    const actual = await realpath(file);
    if (!information.isFile() || !within(repository, actual) || relative(repository, actual).split(sep).includes('archive') || information.isSymbolicLink()) {
      excludedCount++;
      changed.delete(path);
      continue;
    }
    const bytes = await readFile(actual);
    const data = /\.(?:[cm]?[jt]sx?|json|ya?ml|md|css|html|sql|prisma|svg|ps1)$/.test(path) ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes;
    files.push({ path, sha256: createHash('sha256').update(data).digest('hex') });
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({ commit, files })).digest('hex');
  return { commit, branch, fingerprint, scope, excludedCount, fileCount: files.length, changedFiles: [...changed].sort(), files };
}

export async function saveReport(output, name, report, markdown) {
  await writeFile(resolve(output, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(resolve(output, `${name}.md`), markdown, 'utf8');
}

export function sourceSummary(source) {
  if (!source) return '源码快照未取得。\n';
  return `- 源码提交：\`${source.commit}\`\n- 源码指纹：\`${source.fingerprint}\`\n- 覆盖文件：${source.fileCount}；改动文件：${source.changedFiles.length}；排除文件：${source.excludedCount}\n`;
}

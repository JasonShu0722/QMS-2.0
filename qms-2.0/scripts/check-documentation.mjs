import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export function sourceDigest(text) {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}

export async function discoverAgentFiles(root, directory = root) {
  const ignored = new Set(['node_modules', '.git', 'dist', 'generated', 'coverage', 'test-results', 'playwright-report', '.cache', '.superpowers', 'archive']);
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    assert.ok(!entry.isSymbolicLink(), `规则扫描不允许符号链接：${entry.name}`);
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await discoverAgentFiles(root, file));
    else if (entry.name === 'AGENTS.md') paths.push(relative(root, file).split(sep).join('/'));
  }
  return paths.sort();
}

function within(root, file) {
  const path = relative(root, file);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function markdownLinks(text) {
  const prose = text.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, '').replace(/(`+)[^\n]*?\1/g, '');
  const links = [];
  for (const match of prose.matchAll(/!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\s*\)/g)) {
    links.push(match[1] ?? match[2]);
  }
  for (const match of prose.matchAll(/^\s*\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gm)) links.push(match[1] ?? match[2]);
  return links;
}

async function markdownFiles(directory, root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), `文档目录不能包含符号链接：${entry.name}`);
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(file, root));
    else if (entry.name.endsWith('.md') && entry.name !== 'AGENTS.md') files.push(relative(root, file).split(sep).join('/'));
  }
  return files;
}

export async function checkDocumentation(workspace, now = new Date()) {
  const root = await realpath(workspace);
  const repository = await realpath(resolve(root, '..'));
  const index = JSON.parse(await readFile(resolve(root, 'governance/documentation-index.json'), 'utf8'));
  const documents = index.documents;
  assert.ok(Array.isArray(documents) && documents.length > 0, '文档索引不能为空');
  const paths = new Set();
  const topics = new Map();
  const content = new Map();

  async function localFile(path, base, boundary, label) {
    assert.ok(typeof path === 'string' && path.length > 0 && !isAbsolute(path) && !/^[A-Za-z]:|\\/.test(path), `${label}：无效路径 ${path}`);
    const file = resolve(base, path);
    assert.ok(within(boundary, file) && !relative(repository, file).split(sep).includes('archive'), `${label}：路径越界 ${path}`);
    const actual = await realpath(file).catch(() => { throw new Error(`${label}：文件不存在 ${path}`); });
    assert.ok(within(boundary, actual), `${label}：真实路径越界 ${path}`);
    assert.ok((await stat(actual)).isFile(), `${label}：不是文件 ${path}`);
    return actual;
  }

  for (const entry of documents) {
    assert.ok(!paths.has(entry.path), `重复文档路径：${entry.path}`);
    paths.add(entry.path);
    assert.ok(typeof entry.topic === 'string' && entry.topic.trim(), `${entry.path}：缺少主题`);
    assert.ok(typeof entry.canonical === 'boolean', `${entry.path}：canonical 必须为布尔值`);
    assert.ok(['active', 'historical-and-current', 'historical', 'deprecated'].includes(entry.status), `${entry.path}：状态无效`);
    const file = await localFile(entry.path, root, root, entry.path);
    content.set(entry.path, await readFile(file, 'utf8'));
    if (entry.status === 'deprecated') {
      const replacement = documents.find((candidate) => candidate.path === entry.replacedBy);
      assert.ok(!entry.canonical && replacement?.canonical && ['active', 'historical-and-current'].includes(replacement.status), `${entry.path}：废弃文档缺少有效替代来源`);
    } else {
      const canonical = topics.get(entry.topic) ?? [];
      if (entry.canonical) canonical.push(entry.path);
      topics.set(entry.topic, canonical);
    }
  }
  for (const [topic, canonical] of topics) assert.equal(canonical.length, 1, `主题 ${topic} 必须恰好有一个权威来源`);

  const discovered = await markdownFiles(resolve(root, 'docs'), root);
  assert.deepEqual(discovered.sort(), [...paths].filter((path) => path.startsWith('docs/')).sort(), '存在未索引或失效的 docs Markdown');
  const skillsDirectory = resolve(root, '.agents/skills');
  const skillsExist = await stat(skillsDirectory).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
  const skills = skillsExist ? await markdownFiles(skillsDirectory, root) : [];
  assert.deepEqual(skills.sort(), [...paths].filter((path) => path.startsWith('.agents/skills/')).sort(), '专用 Skill 存在漏登或失效记录');

  const navigation = markdownLinks(content.get('docs/README.md') ?? '');
  for (const entry of documents.filter((document) => document.path.startsWith('docs/') && document.path !== 'docs/README.md')) {
    assert.ok(navigation.some((link) => resolve(root, 'docs', link.split('#')[0]) === resolve(root, entry.path)), `导航缺少实际链接：${entry.path}`);
  }

  assert.deepEqual(await discoverAgentFiles(root), (index.agents ?? []).map((entry) => entry.path).sort(), 'AGENTS.md 存在漏登或失效记录');
  for (const entry of index.agents ?? []) {
    const expectedScope = dirname(entry.path).split(sep).join('/');
    assert.equal(entry.scope.replace(/\/$/, ''), expectedScope, `${entry.path}：作用范围与目录不一致`);
    const file = await localFile(entry.path, root, root, entry.path);
    content.set(entry.path, await readFile(file, 'utf8'));
  }
  let links = 0;
  for (const [path, text] of content) {
    for (const link of markdownLinks(text)) {
      if (/^(https?:|mailto:|tel:|#)/i.test(link)) continue;
      const target = decodeURIComponent(link.split(/[?#]/)[0]);
      await localFile(target, dirname(resolve(root, path)), repository, `${path} 的链接 ${link}`);
      links++;
    }
  }

  const protectedTopics = index.reviewPolicy?.freshnessTopics;
  assert.ok(Array.isArray(protectedTopics) && protectedTopics.length > 0, '必须声明需要复核的主题');
  assert.equal(new Set(protectedTopics).size, protectedTopics.length, '复核主题不能重复');
  for (const topic of protectedTopics) {
    const document = documents.find((entry) => entry.topic === topic && entry.canonical && entry.status !== 'deprecated');
    assert.ok(document?.review, `${topic} 缺少权威文档或复核信息`);
  }

  let reviews = 0;
  for (const entry of documents.filter((document) => document.review)) {
    const review = entry.review;
    assert.ok(typeof review.owner === 'string' && review.owner.trim() && typeof review.reason === 'string' && review.reason.trim(), `${entry.path}：缺少复核者或理由`);
    assert.match(review.reviewedOn, /^\d{4}-\d{2}-\d{2}$/, `${entry.path}：复核日期格式无效`);
    const reviewed = new Date(`${review.reviewedOn}T00:00:00Z`);
    assert.ok(Number.isFinite(reviewed.getTime()) && reviewed.toISOString().slice(0, 10) === review.reviewedOn, `${entry.path}：无效日期`);
    assert.ok(reviewed <= now, `${entry.path}：复核日期不能在未来`);
    assert.ok(Number.isInteger(review.maxAgeDays) && review.maxAgeDays >= 1 && review.maxAgeDays <= 365, `${entry.path}：复核期限必须为 1–365 天`);
    assert.ok(now.getTime() < reviewed.getTime() + review.maxAgeDays * 86400000, `${entry.path}：复核已到期，请比较来源并更新记录`);
    assert.ok(Array.isArray(review.sources) && review.sources.length > 0, `${entry.path}：缺少复核来源`);
    const sources = new Set();
    for (const source of review.sources) {
      assert.ok(!sources.has(source.path) && source.path !== entry.path, `${entry.path}：来源重复或自引用 ${source.path}`);
      sources.add(source.path);
      assert.match(source.sha256, /^[a-f0-9]{64}$/, `${entry.path}：来源摘要格式无效`);
      assert.ok(!source.path.startsWith('../') || source.path.startsWith('../docs/superpowers/'), `${entry.path}：来源路径越界 ${source.path}`);
      const file = await localFile(source.path, root, repository, `${entry.path} 来源`);
      const actual = sourceDigest(await readFile(file, 'utf8'));
      assert.equal(source.sha256, actual, `${entry.path}：来源已变化 ${source.path}，请复核；当前 SHA-256=${actual}`);
    }
    reviews++;
  }
  return { documents: documents.length, links, reviews };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await checkDocumentation(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
    console.log(`文档检查 PASS：${result.documents} 份文档，${result.links} 个本地链接，${result.reviews} 份来源复核`);
  } catch (error) {
    console.error(`文档检查 FAIL：${error.message}`);
    process.exitCode = 1;
  }
}

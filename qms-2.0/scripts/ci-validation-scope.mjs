import { execFileSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const shaPattern = /^[0-9a-f]{40}$/;
const businessJobs = ['web-tests (1)', 'web-tests (2)', 'web-tests (3)', 'web-tests (4)', 'api-unit', 'integration'];
const documentationJobs = ['web-tests', 'api-unit', 'integration'];

export function classifyPaths(paths, policy) {
  const rules = policy?.rules?.filter(({ id }) => id === 'documentation');
  if (rules?.length !== 1 || !Array.isArray(paths) || paths.length === 0) return 'full';
  const rule = rules[0];
  return paths.every((path) => typeof path === 'string' && path.endsWith('.md') &&
    !path.split('/').some((part) => part === '..' || part === '.') &&
    (rule.files.includes(path) || rule.prefixes.some((prefix) => path.startsWith(prefix)))) ? 'documentation' : 'full';
}

export function classifyScope({ cwd, eventName, event, policy }) {
  try {
    let before;
    let after;
    let separator;
    if (eventName === 'pull_request') {
      before = event.pull_request.base.sha;
      after = event.pull_request.head.sha;
      separator = '...';
    } else if (eventName === 'push') {
      ({ before, after } = event);
      separator = '..';
    } else return 'full';
    if (![before, after].every((sha) => shaPattern.test(sha) && !/^0+$/.test(sha))) return 'full';
    const git = (args) => execFileSync('git', ['-c', 'diff.relative=false', ...args], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const sha of [before, after]) git(['rev-parse', '--verify', `${sha}^{commit}`]);
    const names = git(['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', '--no-renames', `${before}${separator}${after}`, '--']);
    if (!names || !names.endsWith('\0')) return 'full';
    return classifyPaths(names.slice(0, -1).split('\0'), policy);
  } catch {
    // 无法证明纯文档时保留完整业务门禁。
    return 'full';
  }
}

function requireResult(results, name, expected) {
  if (results?.[name] !== expected) throw new Error(`${name} must be ${expected}`);
}

export function evaluateFoundation(scope, results) {
  if (!['full', 'documentation'].includes(scope)) throw new Error('Unknown validation scope');
  for (const name of ['scope', 'checks']) requireResult(results, name, 'success');
  for (const name of ['web-tests', 'api-unit', 'integration']) requireResult(results, name, scope === 'full' ? 'success' : 'skipped');
  return scope;
}

function validateSource({ headSha, runId, runAttempt }) {
  if (!shaPattern.test(headSha) || ![runId, runAttempt].every((value) => /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value)))) {
    throw new Error('Invalid source run, attempt or SHA');
  }
}

export function evaluateDeployJobs(jobs, source) {
  validateSource(source);
  const documentation = Array.isArray(jobs) && jobs.some(({ name }) => name === 'web-tests');
  const expectedBusiness = documentation ? documentationJobs : businessJobs;
  const expectedJobs = ['scope', 'checks', 'foundation', ...expectedBusiness];
  if (!Array.isArray(jobs) || jobs.length !== expectedJobs.length) throw new Error('Incomplete or duplicate foundation jobs');
  const results = {};
  const ids = new Set();
  for (const job of jobs) {
    if (!expectedJobs.includes(job.name) || Object.hasOwn(results, job.name) || ids.has(job.id)) throw new Error('Unexpected or duplicate foundation job');
    if (job.head_sha !== source.headSha || job.run_id !== Number(source.runId) || job.run_attempt !== Number(source.runAttempt) || job.status !== 'completed') {
      throw new Error('Job does not match the completed source run attempt and SHA');
    }
    results[job.name] = job.conclusion;
    ids.add(job.id);
  }
  for (const name of ['scope', 'checks', 'foundation']) requireResult(results, name, 'success');
  for (const name of expectedBusiness) requireResult(results, name, documentation ? 'skipped' : 'success');
  return documentation ? 'documentation' : 'full';
}

export async function fetchAttemptJobs({ repository, token, apiUrl = 'https://api.github.com', ...source }) {
  validateSource(source);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(repository) || !token) throw new Error('Missing Actions API repository or token');
  const endpoint = new URL(`${apiUrl.replace(/\/$/, '')}/repos/${repository}/actions/runs/${source.runId}/attempts/${source.runAttempt}/jobs`);
  const jobs = [];
  let total;
  for (let page = 1; ; page++) {
    const url = new URL(endpoint);
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Actions jobs API failed: ${response.status}`);
    const body = await response.json();
    if (!Number.isSafeInteger(body.total_count) || body.total_count < 0 || !Array.isArray(body.jobs) || (total !== undefined && total !== body.total_count)) {
      throw new Error('Invalid Actions jobs response');
    }
    total = body.total_count;
    jobs.push(...body.jobs);
    if (jobs.length > total) throw new Error('Inconsistent Actions job count');
    const next = response.headers.get('link')?.split(',').find((link) => /;\s*rel="next"/.test(link));
    if (!next) {
      if (jobs.length !== total) throw new Error('Truncated Actions jobs response');
      return jobs;
    }
    const nextUrl = new URL(next.match(/<([^>]+)>/)?.[1]);
    if (!body.jobs.length || jobs.length >= total || nextUrl.origin !== url.origin || nextUrl.pathname !== url.pathname ||
        nextUrl.searchParams.get('page') !== String(page + 1) || nextUrl.searchParams.get('per_page') !== '100' ||
        [...nextUrl.searchParams.keys()].some((key) => !['page', 'per_page'].includes(key))) {
      throw new Error('Invalid Actions jobs pagination');
    }
  }
}

async function main(command) {
  let scope;
  if (command === 'scope') {
    try {
      const policy = JSON.parse(await readFile(new URL('../governance/validation-impact.json', import.meta.url), 'utf8'));
      const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
      scope = classifyScope({ cwd: process.cwd(), eventName: process.env.GITHUB_EVENT_NAME, event, policy });
    } catch {
      scope = 'full';
    }
  } else if (command === 'gate') {
    const needs = JSON.parse(process.env.NEEDS_JSON);
    scope = evaluateFoundation(process.env.SCOPE, Object.fromEntries(Object.entries(needs).map(([name, value]) => [name, value.result])));
  } else if (command === 'deploy') {
    const source = { runId: process.env.RUN_ID, runAttempt: process.env.RUN_ATTEMPT, headSha: process.env.HEAD_SHA };
    scope = evaluateDeployJobs(await fetchAttemptJobs({ ...source, repository: process.env.GITHUB_REPOSITORY, token: process.env.GITHUB_TOKEN, apiUrl: process.env.GITHUB_API_URL }), source);
  } else throw new Error('Expected scope, gate or deploy command');
  await appendFile(process.env.GITHUB_OUTPUT, `scope=${scope}\n`);
  console.log(scope === 'documentation' ? 'Documentation checks only; business validation is skipped and deployment is not permitted.' : 'Full validation scope.');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const catalogPath = 'apps/api/src/modules/workbench-graph/workbench-catalog.json';
const evidencePath = 'apps/api/src/modules/workbench-graph/workbench-evidence.json';
const graphId = /^[a-z][a-z0-9-]{0,127}$/;
const nonEmpty = value => typeof value === 'string' && value.trim().length > 0;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().startsWith(`${value}T`);
const filledList = value => Array.isArray(value) && value.length > 0 && value.every(nonEmpty);
const pathnameDispatch = source => [...source.matchAll(/(?:location\.pathname|processPath)(?:\s*===\s*|\.startsWith\()(['"])(\/(?:app|supplier)(?:\/[a-z0-9-]+)*\/?)\1/g)]
  .map(([, , route]) => route.replace(/\/$/, ''));

test('detects business and supplier dispatch with either quote style', () => {
  assert.deepEqual(pathnameDispatch(`processPath === "/app/example" || location.pathname.startsWith('/supplier/example/')`), ['/app/example', '/supplier/example']);
  assert.deepEqual(pathnameDispatch(`processPath === '/app/other' || location.pathname.startsWith("/supplier/other/")`), ['/app/other', '/supplier/other']);
});

test('renders each supported API ingestion target as a distinct, directed data relationship', async () => {
  const catalog = JSON.parse(await read(catalogPath));
  const source = await read('apps/api/src/common/integration-master-data.ts');
  const rules = await read('apps/web/src/console/api-ingestion/RuleEditor.tsx');
  const backendTargets = [...source.matchAll(/^export type (?:MasterDataIntegrationTarget|IntegrationTarget) = (.*);$/gm)]
    .flatMap(([, declaration]) => [...declaration.matchAll(/'([A-Z_]+)'/g)].map(([, target]) => target)).sort();
  const editorDeclaration = rules.match(/options=\{\[([^\]]+)\]\.map\(value => \(\{ value, label: label\(value, english\)/);
  const editorTargets = [...(editorDeclaration?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map(([, target]) => target).sort();
  const nodesByTarget = {
    SUPPLIER: 'supplier-profiles', CUSTOMER: 'customer-profiles', MATERIAL: 'material-master',
    COMPONENT: 'component-project-mapping', OPERATION: 'operation-master', PROCESS_DEFECT: 'process-defect-ledger',
  };
  assert.deepEqual(editorTargets, backendTargets, 'Ingestion editor must agree with the server target list');
  assert.deepEqual(Object.keys(nodesByTarget).sort(), backendTargets, 'Update the graph for every supported ingestion target');
  for (const [target, destination] of Object.entries(nodesByTarget)) {
    assert.ok(catalog.relations.some(edge => edge.id === `api-ingestion-to-${destination}` && edge.from === 'api-ingestion'
      && edge.to === destination && edge.kind === 'data' && edge.status !== 'planned'), `Missing direct ingestion relationship for ${target}`);
  }
});

test('workbench catalog covers the declared entry points without duplicating graph IDs', async () => {
  const catalog = JSON.parse(await read(catalogPath));
  const evidence = JSON.parse(await read(evidencePath));
  const internalAndSupplier = await read('apps/web/src/features/navigation/navigation.ts');
  const consoleNavigation = await read('apps/web/src/console/console-navigation.ts');
  const dispatch = await read('apps/web/src/App.tsx');
  const businessDispatch = `${await read('apps/web/src/layouts/InternalLayout.tsx')}\n${await read('apps/web/src/layouts/SupplierLayout.tsx')}`;
  const navigationItems = [...internalAndSupplier.matchAll(/export const (?:internalNavigation|supplierNavigation): NavigationItem\[\] = \[([\s\S]*?)^\];/gm)];
  assert.equal(navigationItems.length, 2);
  const menus = [
    ...navigationItems.flatMap(([, body]) => [...body.matchAll(/^\s*\{ label: '([^']+)', path: '(\/(?:app|supplier)\/[^']+)'/gm)]),
    ...consoleNavigation.matchAll(/\{ path: '(\/console[^']*)', label: '([^']+)'/g),
  ];
  assert.ok(menus.length >= 58, 'Navigation source matcher must cover the three actual menus');
  assert.ok(nonEmpty(catalog.version));
  assert.ok(validDate(catalog.statusBaselineDate));
  assert.equal(evidence.catalogVersion, catalog.version);
  assert.match(evidence.baseline, /^[a-f0-9]{40}$/);
  assert.equal(new Set(catalog.nodes.map(node => node.id)).size, catalog.nodes.length);
  assert.equal(new Set(catalog.relations.map(edge => edge.id)).size, catalog.relations.length);
  assert.deepEqual(Object.keys(evidence.nodes).sort(), catalog.nodes.map(node => node.id).sort());
  assert.deepEqual(Object.keys(evidence.relations).sort(), catalog.relations.map(edge => edge.id).sort());

  const documentedRoutes = new Set(Object.values(evidence.nodes).flatMap(item => item.routes ?? []));
  const consoleDispatch = new Set([
    ...[...dispatch.matchAll(/<Route\s+path="(?!\/|\*)([a-z][a-z0-9/-]*(?:\*)?)"/g)].map(([, route]) => `/console/${route}`),
    ...[...dispatch.matchAll(/^\s*\{\[([^\n]+)\]\.map\(path => <Route key=\{path\} path=\{path\}/gm)].flatMap(([, routes]) => [...routes.matchAll(/'([^']+)'/g)].map(([, route]) => `/console/${route}`)),
  ]);
  const knownEntries = new Set([...menus.map(([, first, second]) => first.startsWith('/') ? first : second), ...consoleDispatch, ...documentedRoutes]);
  for (const [, route] of dispatch.matchAll(/<Route\s+path="([/*][^"]*)"/g)) {
    assert.ok(knownEntries.has(route) || nonEmpty(evidence.excludedRoutes[route]?.reason), `Missing route mapping or exclusion: ${route}`);
  }
  for (const entry of pathnameDispatch(businessDispatch)) {
    assert.ok(knownEntries.has(entry) || [...documentedRoutes].some(path => path.startsWith(`${entry}/:`)), `Missing pathname dispatch: ${entry}`);
  }
  for (const [route, permission] of [
    ['/console/api-integrations', 'integration:read'], ['/console/api-ingestion', 'ingestion:read'],
    ['/console/master-data/operations', 'process-quality:configuration:read'],
  ]) {
    const declaration = consoleNavigation.split('\n').find(line => line.includes(`path: '${route}'`));
    assert.ok(declaration?.match(/permissions: \[([^\]]+)\]/)?.[1].includes(`'${permission}'`), `Missing read permission ${permission} on ${route}`);
  }
  for (const route of consoleDispatch) {
    if (route.endsWith('/*')) {
      const base = route.slice(0, -2);
      assert.ok(catalog.nodes.some(node => node.entry === base) && [...documentedRoutes].some(path => path.startsWith(`${base}/:`)), `Missing console route family: ${route}`);
    } else assert.ok(catalog.nodes.some(node => node.entry === route), `Missing console route: ${route}`);
  }

  const nodeById = new Map(catalog.nodes.map(node => [node.id, node]));
  assert.ok(Array.isArray(evidence.requiredActions) && evidence.requiredActions.length > 0, 'Missing key action inventory');
  const actionEvidence = evidence.requiredActions.map((item, index) => [`requiredActions[${index}]`, item]);
  for (const [id, item] of actionEvidence) {
    assert.ok(filledList(item.capabilityIds) && item.capabilityIds.every(key => nodeById.has(key)), `Missing capability on ${id}`);
    assert.ok(filledList(item.actions) && nonEmpty(item.io), `Missing actions or inputs/outputs on ${id}`);
    for (const field of ['sections', 'deepLinks', 'apiPrefixes']) {
      if (Object.hasOwn(item, field)) assert.ok(filledList(item[field]), `Invalid ${field} on ${id}`);
    }
  }
  for (const [id, item] of [...Object.entries({ ...evidence.nodes, ...evidence.relations, ...evidence.excludedRoutes }), ...actionEvidence]) {
    assert.ok(Array.isArray(item.sources) && item.sources.length > 0, `Missing sources on ${id}`);
    for (const path of item.sources) assert.match(path, /^(?:qms-2\.0|docs)\/(?:[\w.-]+\/)*[\w.-]+$/, `Invalid source on ${id}`);
  }
  const sources = new Set([...Object.values(evidence.nodes), ...Object.values(evidence.relations), ...Object.values(evidence.excludedRoutes), ...evidence.requiredActions].flatMap(item => item.sources));
  await Promise.all([...sources].map(async path => {
    await assert.doesNotReject(access(new URL(`../../${path}`, import.meta.url)), `Missing evidence file ${path}`);
  }));

  for (const node of catalog.nodes) {
    assert.match(node.id, graphId);
    assert.ok(['idea', 'development', 'live'].includes(node.status), node.id);
    assert.ok(validDate(node.statusUpdatedOn ?? catalog.statusBaselineDate), `Invalid status review date on ${node.id}`);
    assert.ok([node.name, node.domain, node.summary, node.plan].every(nonEmpty), node.id);
    assert.ok(Array.isArray(node.aliases) && node.aliases.every(nonEmpty), node.id);
    assert.ok(node.entry === '' || /^\/(?:app|console|supplier)(?:\/[a-z0-9-]+)*$/.test(node.entry), `Unsafe entry on ${node.id}`);
    assert.ok(node.entry === '' || knownEntries.has(node.entry), `Undocumented entry on ${node.id}: ${node.entry}`);
    if (node.status === 'live') {
      const proof = evidence.nodes[node.id];
      assert.ok([proof.approval, proof.release, proof.runtimeVerification].every(nonEmpty), `Missing acceptance, release or runtime evidence on ${node.id}`);
    }
    const { title, version, role, prerequisites, steps, result, exceptions } = node.guide;
    assert.ok([title, version, role, prerequisites, result, exceptions].every(nonEmpty), `Missing guide information on ${node.id}`);
    assert.ok(Array.isArray(steps) && steps.length > 0 && steps.every(nonEmpty), `Missing guide steps on ${node.id}`);
  }
  for (const [, first, second] of menus) {
    const [entry, name] = first.startsWith('/') ? [first, second] : [second, first];
    assert.ok(catalog.nodes.some(node => node.entry === entry && (node.name === name || node.aliases.includes(name))), `Missing ${name}: ${entry}`);
  }
  assert.ok(catalog.nodes.some(node => node.entry === '/app/workbench'), 'Missing workbench');

  const edges = new Set();
  for (const edge of catalog.relations) {
    assert.match(edge.id, graphId);
    assert.ok(edge.from !== edge.to && nodeById.has(edge.from) && nodeById.has(edge.to), `Invalid endpoints on ${edge.id}`);
    assert.ok(['data', 'configuration', 'handoff'].includes(edge.kind), edge.id);
    assert.ok(['effective', 'configuration', 'planned', 'unverified'].includes(edge.status), edge.id);
    if (edge.status === 'effective') assert.ok(nonEmpty(evidence.relations[edge.id].runtimeVerification), `Missing runtime evidence on ${edge.id}`);
    assert.ok([edge.name, edge.trigger, edge.content, edge.result, edge.exceptions].every(nonEmpty), edge.id);
    const key = JSON.stringify([edge.from, edge.to, edge.name]);
    assert.ok(!edges.has(key), `Duplicate relation ${key}`);
    edges.add(key);
  }
  for (const [from, to] of [
    ['/console/api-integrations', '/console/api-ingestion'],
    ['/console/master-data/operations', '/app/process-quality'],
    ['/app/process-quality', '/app/process-quality/problems'],
    ['/app/supplier-quality', '/supplier/corrections'],
  ]) {
    assert.ok(catalog.relations.some(edge => nodeById.get(edge.from)?.entry === from && nodeById.get(edge.to)?.entry === to && edge.status !== 'planned'), `Missing direct relation ${from} → ${to}`);
  }
  for (const [from, to] of [
    ['process-defect-ledger', 'new-product-eight-d'], ['customer-profiles', 'customer-ledger'], ['portal-corrections', 'supplier-ledger'],
    ['supplier-profiles', 'supplier-barcode-rules'], ['supplier-barcode-rules', 'site-scanning'],
  ]) {
    const id = `${from}-to-${to}`;
    assert.ok(catalog.relations.some(edge => edge.id === id && edge.from === from && edge.to === to && edge.status !== 'planned'), `Missing required relation ${id}`);
  }
});

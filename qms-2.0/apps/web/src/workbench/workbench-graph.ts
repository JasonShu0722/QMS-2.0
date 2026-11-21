import type { components } from '@qms/contracts';

export type WorkbenchGraphDto = components['schemas']['WorkbenchGraphDto'];
export type GraphNode = WorkbenchGraphDto['nodes'][number];
export type GraphRelation = WorkbenchGraphDto['relations'][number];
export type GraphSelection = { type: 'node' | 'relation'; id: string };
export type GraphResult = GraphSelection & { name: string; meta: string; terms: string[]; exact: string[] };
export type GraphText = (zh: string, en: string) => string;

export const nodeStatuses: Record<GraphNode['status'], readonly [string, string]> = {
  idea: ['构想中', 'Idea'], development: ['开发中', 'In development'], live: ['已上线', 'Live'],
};
export const nodeStatusColors = {
  idea: '#8293ac', development: '#eba14d', live: '#22aa87',
} as const satisfies Record<GraphNode['status'], string>;
export const relationKinds: Record<GraphRelation['kind'], readonly [string, string]> = {
  data: ['数据', 'Data'], configuration: ['配置', 'Configuration'], handoff: ['交接', 'Handoff'],
};
export const relationStatuses: Record<GraphRelation['status'], readonly [string, string]> = {
  effective: ['已生效', 'Effective'], configuration: ['需配置', 'Requires configuration'],
  planned: ['规划中', 'Planned'], unverified: ['待核验', 'Unverified'],
};

const normalize = (value: string) => value.normalize('NFKC').toLowerCase().trim();

export function buildGraphSearch(graph: WorkbenchGraphDto, text: GraphText) {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const relations = new Map(graph.relations.map(relation => [relation.id, relation]));
  const results: GraphResult[] = [
    ...graph.nodes.map(node => ({
      type: 'node' as const, id: node.id, name: node.name, meta: `${node.domain} · ${text(...nodeStatuses[node.status])}`,
      exact: [node.name, ...node.aliases], terms: [node.id, node.domain, node.entry, node.summary, node.plan,
        node.guide.title, node.guide.version, node.guide.role, node.guide.prerequisites, ...node.guide.steps,
        node.guide.result, node.guide.exceptions, text('使用指南 适用岗位 配置前置 操作步骤 操作结果 常见异常', 'guide role prerequisites steps result exceptions')],
    })),
    ...graph.relations.map(relation => ({
      type: 'relation' as const, id: relation.id, name: relation.name,
      meta: `${nodes.get(relation.from)?.name ?? relation.from} → ${nodes.get(relation.to)?.name ?? relation.to}`,
      exact: [relation.name], terms: [relation.id, relation.trigger, relation.content, relation.result,
        relation.exceptions, text(...relationKinds[relation.kind]), text(...relationStatuses[relation.status])],
    })),
  ];
  return { nodes, relations, results: results.map(result => ({ ...result,
    exact: result.exact.map(normalize), terms: [...result.exact, result.meta, ...result.terms].map(normalize),
  })) };
}

export function rankGraphResults(results: GraphResult[], input: string) {
  const query = normalize(input);
  if (!query) return results;
  const words = query.split(/\s+/);
  return results.flatMap(result => {
    const score = result.exact.includes(query) ? 0 : result.exact.some(term => term.startsWith(query)) ? 1
      : words.every(word => result.terms.some(term => term.includes(word))) ? 2 : -1;
    return score < 0 ? [] : [{ result, score }];
  }).sort((first, second) => first.score - second.score).map(match => match.result);
}

export function graphVisibility(results: GraphResult[], relations: GraphRelation[], selection: GraphSelection | null, depth: 0 | 1 | 2, relationKind?: string) {
  const visibleNodeIds = new Set<string>();
  const visibleRelationIds = new Set<string>();
  const relationIds = new Map(relations.map(relation => [relation.id, relation]));
  const includeRelation = (relation: GraphRelation) => {
    visibleRelationIds.add(relation.id);
    visibleNodeIds.add(relation.from); visibleNodeIds.add(relation.to);
  };
  for (const result of results) {
    if (result.type === 'node') visibleNodeIds.add(result.id);
    else {
      const relation = relationIds.get(result.id);
      if (relation) includeRelation(relation);
    }
  }
  const focused = new Set<string>();
  if (selection?.type === 'node') {
    focused.add(selection.id);
    visibleNodeIds.add(selection.id);
  } else if (selection?.type === 'relation') {
    const relation = relationIds.get(selection.id);
    if (relation) { focused.add(relation.from); focused.add(relation.to); includeRelation(relation); }
  }
  const traversable = relations.filter(relation => relation.status !== 'planned' && (!relationKind || relation.kind === relationKind));
  for (let hop = 0; hop < depth && focused.size; hop += 1) {
    const current = new Set(focused);
    for (const relation of traversable) {
      if (current.has(relation.from) || current.has(relation.to)) {
        includeRelation(relation);
        focused.add(relation.from); focused.add(relation.to);
      }
    }
  }
  return { visibleNodeIds, visibleRelationIds };
}

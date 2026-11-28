import { Alert, Button, Input } from 'antd';
import type { components } from '@qms/contracts';
import { GitBranch, Network, RotateCcw, Search } from 'lucide-react';
import { lazy, Suspense, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError, apiRequest, csrfToken } from '../api/client';
import { QmsLoading } from '../components/QmsLoading';
import { sessionSignalVersion } from '../features/auth/session-invalidation';
import { useLanguage } from '../i18n/Language';
import { WorkbenchGraphDetail } from './WorkbenchGraphDetail';
import { WorkbenchGraphBoundary } from './WorkbenchGraphBoundary';
import { WorkbenchGraphStatus, type StatusSaveResult } from './WorkbenchGraphStatus';
import { buildGraphSearch, graphVisibility, nodeStatusColors, nodeStatuses, rankGraphResults, relationKinds, type GraphNode, type GraphSelection, type GraphText, type WorkbenchGraphDto } from './workbench-graph';
import './workbench-graph.css';

const GraphScene = lazy(() => import('./WorkbenchGraphScene').then(module => ({ default: module.WorkbenchGraphScene })));

type SaveStatus = (id: string, payload: components['schemas']['UpdateWorkbenchGraphStatusDto']) => Promise<StatusSaveResult | undefined>;

async function loadGraph(signal: AbortSignal) {
  const graph = await apiRequest<WorkbenchGraphDto>('/api/v1/workbench/graph', { signal });
  if (!graph || typeof graph.version !== 'string' || !Array.isArray(graph.nodes) || !Array.isArray(graph.relations)) {
    throw new Error('Invalid workbench graph response');
  }
  return graph;
}

export function WorkbenchGraph({ sessionScope, keepOpen, onSavingChange }: {
  sessionScope: string; keepOpen: () => void; onSavingChange: (saving: boolean) => void;
}) {
  const { locale } = useLanguage();
  const text: GraphText = locale === 'en-US' ? (_zh, en) => en : (zh) => zh;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ graph: WorkbenchGraphDto } | { error: 'denied' | 'network' }>();
  const pending = useRef(new Map<string, AbortController>());
  const [savingNodes, setSavingNodes] = useState<string[]>([]);

  useLayoutEffect(() => {
    const requests = pending.current;
    return () => {
      if (!requests.size) return;
      requests.forEach(controller => controller.abort());
      requests.clear();
      onSavingChange(false);
    };
  }, [onSavingChange]);

  useEffect(() => {
    const controller = new AbortController();
    void loadGraph(controller.signal).then(graph => {
      if (controller.signal.aborted) return;
      setState({ graph });
    }).catch(error => {
      if (!controller.signal.aborted) setState({ error: error instanceof ApiError && [401, 403].includes(error.status ?? 0) ? 'denied' : 'network' });
    });
    return () => controller.abort();
  }, [attempt, sessionScope]);

  const saveStatus: SaveStatus = async (id, payload) => {
    if (!state || !('graph' in state) || !state.graph.canEditStatus || pending.current.has(id)) return;
    const controller = new AbortController();
    const { signal } = controller;
    const sessionVersion = sessionSignalVersion();
    const obsolete = () => signal.aborted || sessionVersion !== sessionSignalVersion();
    pending.current.set(id, controller);
    setSavingNodes([...pending.current.keys()]);
    onSavingChange(true);
    try {
      const token = await csrfToken(signal);
      if (obsolete()) return;
      const updated = await apiRequest<GraphNode>(`/api/v1/workbench/graph/nodes/${encodeURIComponent(id)}/status`, {
        method: 'PATCH', signal, headers: { 'x-csrf-token': token }, body: JSON.stringify(payload),
      });
      if (obsolete()) return;
      setState(current => current && 'graph' in current ? { graph: { ...current.graph,
        nodes: current.graph.nodes.map(node => node.id === updated.id && node.statusVersion < updated.statusVersion ? updated : node),
      } } : current);
      return 'saved';
    } catch (error) {
      if (obsolete()) return;
      if (error instanceof ApiError && error.status === 409) {
        try {
          const graph = await loadGraph(signal);
          if (obsolete()) return;
          setState(current => current && 'graph' in current ? { graph: { ...current.graph, canEditStatus: graph.canEditStatus,
            nodes: current.graph.nodes.map(node => graph.nodes.find(latest => latest.id === node.id && latest.statusVersion > node.statusVersion) ?? node),
          } } : current);
          return 'stale';
        } catch {
          if (!obsolete()) return 'unavailable';
        }
      } else if (error instanceof ApiError && [401, 403].includes(error.status ?? 0)) return 'denied';
      else return 'save';
    } finally {
      if (!signal.aborted) {
        pending.current.delete(id);
        setSavingNodes([...pending.current.keys()]);
        onSavingChange(pending.current.size > 0);
      }
    }
  };

  if (!state) return <QmsLoading label={text('正在加载功能图谱…', 'Loading capability graph…')} />;
  if ('error' in state) return <Alert type="error" showIcon title={state.error === 'denied'
    ? text('当前会话无法读取功能图谱', 'This session cannot read the capability graph')
    : text('功能图谱加载失败', 'Could not load the capability graph')}
    action={state.error === 'network' && <Button onClick={() => { setState(undefined); setAttempt(value => value + 1); }}>{text('重试', 'Retry')}</Button>} />;
  if (!state.graph.nodes.length) return <p role="status">{text('图谱暂无内容', 'The capability graph is empty')}</p>;
  return <GraphExplorer graph={state.graph} sessionScope={sessionScope} keepOpen={keepOpen} locale={locale}
    saveStatus={saveStatus} savingNodes={savingNodes} />;
}

function GraphExplorer({ graph, sessionScope, keepOpen, locale, saveStatus, savingNodes }: {
  graph: WorkbenchGraphDto; sessionScope: string; keepOpen: () => void; locale: string;
  saveStatus: SaveStatus; savingNodes: string[];
}) {
  const text: GraphText = locale === 'en-US' ? (_zh, en) => en : (zh) => zh;
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState('');
  const [nodeStatus, setNodeStatus] = useState('');
  const [relationKind, setRelationKind] = useState('');
  const [resultsOpen, setResultsOpen] = useState(false);
  const [expandedNode, setExpandedNode] = useState<string>();
  const [resetKey, setResetKey] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const search = useRef<React.ComponentRef<typeof Input>>(null);
  const list = useRef<HTMLUListElement>(null);
  const resultsId = useId();
  const index = useMemo(() => buildGraphSearch(graph, locale === 'en-US' ? (_zh, en) => en : (zh) => zh), [graph, locale]);
  const domains = useMemo(() => [...new Set(graph.nodes.map(node => node.domain))], [graph]);

  const nodeParam = params.get('graphNode');
  const relationParam = params.get('graphRelation');
  const node = nodeParam ? index.nodes.get(nodeParam) : undefined;
  const relation = !node && relationParam ? index.relations.get(relationParam) : undefined;
  const selectionType = node ? 'node' : relation ? 'relation' : undefined;
  const selectionId = node?.id ?? relation?.id;
  const selection = useMemo<GraphSelection | null>(() => selectionType && selectionId ? { type: selectionType, id: selectionId } : null, [selectionType, selectionId]);
  const depth = !selection ? 0 : node && expandedNode === node.id ? 2 : 1;
  const results = useMemo(() => rankGraphResults(index.results.filter(result => {
    if (result.type === 'node') {
      const item = index.nodes.get(result.id);
      return !relationKind && (!domain || item?.domain === domain) && (!nodeStatus || item?.status === nodeStatus);
    }
    const item = index.relations.get(result.id);
    return item && (!relationKind || item.kind === relationKind)
      && (!domain && !nodeStatus || [item.from, item.to].some(id => {
        const endpoint = index.nodes.get(id);
        return endpoint && (!domain || endpoint.domain === domain) && (!nodeStatus || endpoint.status === nodeStatus);
      }));
  }), query), [index, query, domain, nodeStatus, relationKind]);
  const filtering = !!(query.trim() || domain || nodeStatus || relationKind);
  const visibility = useMemo(() => filtering ? graphVisibility(results, graph.relations, selection, depth, relationKind || undefined) : undefined,
    [filtering, results, graph.relations, selection, depth, relationKind]);
  const sceneFallback = <div className="qms-workbench-graph__scene-fallback">
    <span role="status">{text('三维视图不可用', 'The 3D view is unavailable')}</span>
    <Button aria-expanded={resultsOpen} aria-controls={resultsOpen ? resultsId : undefined} onClick={() => {
      search.current?.focus();
      setResultsOpen(true);
    }}>{text('浏览功能与联动', 'Browse capabilities and relations')}</Button>
  </div>;

  useLayoutEffect(() => {
    if (selection) heading.current?.focus();
  }, [selection]);

  function select(next: GraphSelection | null) {
    keepOpen();
    setResultsOpen(false);
    setExpandedNode(undefined);
    const updated = new URLSearchParams(params);
    updated.delete('graphNode'); updated.delete('graphRelation');
    if (next) updated.set(next.type === 'node' ? 'graphNode' : 'graphRelation', next.id);
    if (updated.toString() !== params.toString()) setParams(updated, { replace: !next, preventScrollReset: true });
    else if (next) heading.current?.focus();
  }

  function reset() {
    search.current?.focus();
    setQuery(''); setDomain(''); setNodeStatus(''); setRelationKind('');
    select(null); setResetKey(key => key + 1);
  }

  function searchKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && resultsOpen && results[0]) { event.preventDefault(); select(results[0]); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const buttons = list.current?.querySelectorAll('button');
      const button = buttons?.[event.key === 'ArrowDown' ? 0 : buttons.length - 1];
      if (button) { event.preventDefault(); button.focus(); }
      else if (filtering && !resultsOpen) { event.preventDefault(); setResultsOpen(true); }
    }
  }

  function resultKeys(event: KeyboardEvent<HTMLUListElement>) {
    const buttons = [...event.currentTarget.querySelectorAll('button')];
    const current = buttons.findIndex(button => button === event.target);
    if (current === -1) return;
    if (event.key === 'ArrowUp' && current === 0) { event.preventDefault(); search.current?.focus(); return; }
    const next = event.key === 'ArrowDown' ? current + 1 : event.key === 'ArrowUp' ? current - 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : -1;
    if (buttons[next]) { event.preventDefault(); buttons[next].focus(); }
  }

  return <div className="qms-workbench-graph">
    <div className="qms-workbench-graph__toolbar" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setResultsOpen(false);
    }} onKeyDown={event => {
      if (event.key !== 'Escape' || event.nativeEvent.isComposing || !resultsOpen) return;
      event.preventDefault();
      search.current?.focus();
      setResultsOpen(false);
    }}>
      <div className="qms-workbench-graph__query">
        <Input ref={search} type="search" prefix={<Search size={16} aria-hidden="true" />} value={query}
          aria-label={text('搜索功能与联动', 'Search capabilities and relations')}
          placeholder={text('搜索功能与联动', 'Search capabilities and relations')}
          aria-controls={resultsOpen ? resultsId : undefined}
          onFocus={() => { if (filtering) setResultsOpen(true); }}
          onClick={() => { if (filtering) setResultsOpen(true); }}
          onChange={event => { setQuery(event.target.value); setResultsOpen(!!event.target.value.trim()); }} onKeyDown={searchKeys} />
      </div>
      <fieldset aria-label={text('图谱筛选', 'Filter graph')}>
        <select aria-label={text('领域', 'Domain')} value={domain} onChange={event => {
          setDomain(event.target.value); setResultsOpen(!!(event.target.value || nodeStatus || relationKind || query.trim()));
        }}>
          <option value="">{text('全部领域', 'All domains')}</option>
          {domains.map(item => <option key={item}>{item}</option>)}
        </select>
        <select aria-label={text('功能状态', 'Capability status')} value={nodeStatus} onChange={event => {
          setNodeStatus(event.target.value); setResultsOpen(!!(domain || event.target.value || relationKind || query.trim()));
        }}>
          <option value="">{text('全部状态', 'All statuses')}</option>
          {Object.entries(nodeStatuses).map(([key, label]) => <option key={key} value={key}>{text(...label)}</option>)}
        </select>
        <select aria-label={text('联动类型', 'Relation type')} value={relationKind} onChange={event => {
          setRelationKind(event.target.value); setResultsOpen(!!(domain || nodeStatus || event.target.value || query.trim()));
        }}>
          <option value="">{text('全部类型', 'All types')}</option>
          {Object.entries(relationKinds).map(([key, label]) => <option key={key} value={key}>{text(...label)}</option>)}
        </select>
      </fieldset>
      <Button icon={<RotateCcw size={15} aria-hidden="true" />} onClick={reset}>{text('复位', 'Reset')}</Button>
      {resultsOpen && <div className="qms-workbench-graph__search-popup" id={resultsId}>
        <p role="status">{results.length ? text(`${results.length} 项`, `${results.length} results`) : text('没有匹配项', 'No matching results')}</p>
        {results.length > 0 && <ul ref={list} className="qms-workbench-graph__results" aria-label={text('搜索结果', 'Search results')} onKeyDown={resultKeys}>
          {results.map(item => {
            const Icon = item.type === 'node' ? Network : GitBranch;
            const active = selection?.type === item.type && selection.id === item.id;
            return <li key={`${item.type}:${item.id}`}>
              <button type="button" aria-label={item.name} aria-current={active || undefined} onClick={() => select(item)}>
                <Icon size={16} aria-hidden="true" />
                <span><strong>{item.name}</strong><small>{item.meta}</small></span>
              </button>
            </li>;
          })}
        </ul>}
      </div>}
    </div>
    <ul className="qms-workbench-graph__legend" aria-label={text('功能状态图例', 'Capability status legend')}>
      {(Object.keys(nodeStatuses) as GraphNode['status'][]).map(status => <li key={status}>
        <span aria-hidden="true" style={{ backgroundColor: nodeStatusColors[status] }} />{text(...nodeStatuses[status])}
      </li>)}
    </ul>
    <div className="qms-workbench-graph__body">
      <div className="qms-workbench-graph__scene">
        <WorkbenchGraphBoundary fallback={sceneFallback}>
          <Suspense fallback={<QmsLoading label={text('正在加载三维视图…', 'Loading the 3D view…')} />}>
            <GraphScene graph={graph} selection={selection} depth={depth} resetKey={resetKey}
              relationKind={relationKind || undefined}
              visibleNodeIds={visibility?.visibleNodeIds} visibleRelationIds={visibility?.visibleRelationIds} fallback={sceneFallback}
              onNode={id => select({ type: 'node', id })} onRelation={id => select({ type: 'relation', id })} onBackground={() => { if (selection) select(null); else setResultsOpen(false); }} />
          </Suspense>
        </WorkbenchGraphBoundary>
      </div>
      {selection && <WorkbenchGraphDetail node={node} relation={relation} nodes={index.nodes} relations={graph.relations} sessionScope={sessionScope}
        statusControl={node && graph.canEditStatus && <WorkbenchGraphStatus key={node.id} node={node}
          saving={savingNodes.includes(node.id)} onSave={payload => saveStatus(node.id, payload)} text={text} />}
        depth={depth} headingRef={heading} select={select} setDepth={value => setExpandedNode(value === 2 ? node?.id : undefined)}
        close={() => { search.current?.focus(); select(null); }} text={text} />}
    </div>
    {!selection && (nodeParam !== null || relationParam !== null) && <p role="status">{text('此图谱定位已不可用，请搜索后重新选择。', 'This graph link is unavailable. Search to select another item.')}</p>}
  </div>;
}

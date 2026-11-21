import { Button, Tag } from 'antd';
import type { components } from '@qms/contracts';
import { ArrowRight, ExternalLink, X } from 'lucide-react';
import { useEffect, useState, type Ref } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiRequest } from '../api/client';
import { getConsoleContext } from '../console/console-api';
import { consoleRoute } from '../console/console-navigation';
import { subscribeSessionSignals } from '../features/auth/session-invalidation';
import { internalNavigation, supplierNavigation } from '../features/navigation/navigation';
import { nodeStatuses, relationKinds, relationStatuses, type GraphNode, type GraphRelation, type GraphSelection, type GraphText } from './workbench-graph';

const pagePermissions: Readonly<Record<string, readonly string[] | undefined>> = {
  '/app/process-quality': ['process-quality:defects:read'],
  '/app/customer-quality': ['customer-quality:complaints:read'],
  '/app/site-scanning': ['supplier-barcode:read', 'supplier-barcode:scan'],
  '/app/supplier-quality/new': ['supplier-quality:problems:write'],
};

function GraphEntry({ node, sessionScope, text }: { node: GraphNode; sessionScope: string; text: GraphText }) {
  const { entry } = node;
  const isConsole = /^\/console(?:\/[a-z-]+)*$/.test(entry);
  const requiredPermissions = pagePermissions[entry];
  const isBusiness = entry === '/app/workbench' || entry === '/app' || Boolean(requiredPermissions) || internalNavigation.some(item => item.path === entry);
  const isSupplier = supplierNavigation.some(item => item.path === entry);
  const isPlaceholder = entry === '/app/documents' || entry === '/app/risk-dashboard';
  const verifiesAccess = isConsole || Boolean(requiredPermissions);
  const accessCheckedByDestination = isBusiness && !isPlaceholder && !requiredPermissions
    && entry !== '/app' && entry !== '/app/workbench' && entry !== '/app/account';
  const [access, setAccess] = useState<'loading' | 'allowed' | 'denied' | 'unavailable'>('loading');
  useEffect(() => {
    if (!verifiesAccess) return;
    const controller = new AbortController();
    const unsubscribe = subscribeSessionSignals(() => { controller.abort(); setAccess('unavailable'); });
    const check = isConsole ? getConsoleContext(undefined, controller.signal).then(context => {
      const route = consoleRoute(entry, context);
      const sameSession = sessionScope === `INTERNAL:${context.actor.homeOrganization.id}:${context.actor.id}`;
      return sameSession && route.status === 'allowed' && route.item?.path === entry;
    }) : apiRequest<components['schemas']['PermissionsResponseDto']>('/api/v1/system/my-permissions', { signal: controller.signal }).then(granted =>
      !!requiredPermissions && granted.organizationId === sessionScope.split(':')[1]
        && requiredPermissions.every(permission => granted.permissions.includes(permission)));
    void check.then(allowed => {
      if (!controller.signal.aborted) setAccess(allowed ? 'allowed' : 'denied');
    }).catch(error => {
      if (!controller.signal.aborted) setAccess(error instanceof ApiError && (error.status === 401 || error.status === 403) ? 'denied' : 'unavailable');
    });
    return () => { unsubscribe(); controller.abort(); };
  }, [entry, isConsole, requiredPermissions, sessionScope, verifiesAccess]);

  const allowed = verifiesAccess ? access === 'allowed' : isBusiness && !isPlaceholder;
  const explanation = isSupplier ? text('供应商门户入口，须使用供应商账号', 'Supplier portal entry; a supplier account is required')
    : verifiesAccess && access === 'loading' ? text('正在核验入口权限…', 'Checking entry access…')
    : verifiesAccess && access === 'denied' ? text('当前账号无此入口权限', 'Your account cannot access this entry')
    : verifiesAccess && access === 'unavailable' ? text('暂时无法核验入口权限', 'Entry access could not be verified')
    : text('暂无可打开的入口', 'No entry is available');
  return <div className="qms-workbench-graph__entry">
    {(isConsole || isBusiness || isSupplier) && <code>{entry}</code>}
    {allowed ? <Link to={entry}>{accessCheckedByDestination ? text('前往业务页', 'Go to business page') : text('打开入口', 'Open entry')} <ExternalLink size={14} aria-hidden="true" /></Link> : <span>{explanation}</span>}
    {accessCheckedByDestination && <span>{text('访问权限由业务页核验', 'Access is checked on the destination page')}</span>}
    {(accessCheckedByDestination || verifiesAccess && access === 'denied') && <span>{text('访问岗位：', 'Applicable roles: ')}{node.guide.role}</span>}
  </div>;
}

type DetailProps = {
  node?: GraphNode;
  relation?: GraphRelation;
  nodes: Map<string, GraphNode>;
  relations: GraphRelation[];
  sessionScope: string;
  depth: 0 | 1 | 2;
  headingRef: Ref<HTMLHeadingElement>;
  select: (selection: GraphSelection) => void;
  setDepth: (depth: 1 | 2) => void;
  close: () => void;
  text: GraphText;
};

export function WorkbenchGraphDetail({ node, relation, nodes, relations, sessionScope, depth, headingRef, select, setDepth, close, text }: DetailProps) {
  const nodeName = (id: string) => nodes.get(id)?.name ?? id;
  const relatedGuideNodes = relation ? [nodes.get(relation.from), nodes.get(relation.to)].filter(item => item !== undefined) : [];
  const upstream = node ? relations.filter(item => item.to === node.id) : [];
  const downstream = node ? relations.filter(item => item.from === node.id) : [];
  const neighbors = new Set([...upstream.map(item => item.from), ...downstream.map(item => item.to)]);
  const secondHop = node ? relations.filter(item => item.from !== node.id && item.to !== node.id && (neighbors.has(item.from) || neighbors.has(item.to))) : [];
  const renderRelations = (heading: string, items: GraphRelation[]) => <section>
    <h4>{heading}</h4>
    {items.length === 0 ? <p>{text('暂无联动', 'No relations')}</p> : <ul className="qms-workbench-graph__linked" aria-label={heading}>
      {items.map(item => <li key={item.id}>
        <button type="button" aria-label={item.name} onClick={() => select({ type: 'relation', id: item.id })}>
          <strong>{item.name}</strong>
          <small>{nodeName(item.from)} → {nodeName(item.to)}</small>
        </button>
      </li>)}
    </ul>}
  </section>;

  return <aside className="qms-workbench-graph__detail" aria-labelledby="workbench-graph-detail-heading">
    <header>
      <div>
        <small>{node ? node.domain : relation && text(...relationKinds[relation.kind])}</small>
        <h3 id="workbench-graph-detail-heading" tabIndex={-1} ref={headingRef}>{node?.name ?? relation?.name}</h3>
      </div>
      <Button type="text" icon={<X size={16} aria-hidden="true" />} aria-label={text('关闭详情', 'Close details')} onClick={close} />
    </header>
    {node && <>
      <Tag color={node.status === 'live' ? 'success' : node.status === 'development' ? 'processing' : 'default'}>{text(...nodeStatuses[node.status])}</Tag>
      <small>{text('状态更新日期：', 'Status updated: ')}<time dateTime={node.statusUpdatedOn}>{node.statusUpdatedOn}</time></small>
      <p>{node.summary}</p>
      <GraphEntry key={node.id} node={node} sessionScope={sessionScope} text={text} />
      <section>
        <h4>{text('功能策划', 'Plan')}</h4>
        <p>{node.plan}</p>
      </section>
      <section>
        <h4>{text('使用指南', 'Guide')}</h4>
        <strong>{node.guide.title}</strong>
        <dl>
          <dt>{text('适用版本', 'Version')}</dt><dd>{node.guide.version}</dd>
          <dt>{text('适用岗位', 'Role')}</dt><dd>{node.guide.role}</dd>
          {node.guide.prerequisites && <><dt>{text('配置前置', 'Prerequisites')}</dt><dd>{node.guide.prerequisites}</dd></>}
          {!!node.guide.steps.length && <><dt>{text('操作步骤', 'Steps')}</dt><dd><ol>{node.guide.steps.map((item, index) => <li key={index}>{item}</li>)}</ol></dd></>}
          <dt>{text('操作结果', 'Result')}</dt><dd>{node.guide.result}</dd>
          {node.guide.exceptions && <><dt>{text('常见异常', 'Exceptions')}</dt><dd>{node.guide.exceptions}</dd></>}
        </dl>
      </section>
      {renderRelations(text('直接上游', 'Direct upstream'), upstream)}
      {renderRelations(text('直接下游', 'Direct downstream'), downstream)}
      {(upstream.length > 0 || downstream.length > 0) && <Button aria-expanded={depth === 2} onClick={() => setDepth(depth === 2 ? 1 : 2)}>
        {depth === 2 ? text('收起第二跳', 'Collapse second hop') : text('展开第二跳', 'Expand second hop')}
      </Button>}
      {depth === 2 && renderRelations(text('第二跳联动', 'Second-hop relations'), secondHop)}
    </>}
    {relation && <>
      <Tag color={relation.status === 'effective' ? 'success' : relation.status === 'configuration' ? 'warning' : 'default'}>{text(...relationStatuses[relation.status])}</Tag>
      <div className="qms-workbench-graph__endpoints">
        <Button type="link" onClick={() => select({ type: 'node', id: relation.from })}>{nodeName(relation.from)}</Button>
        <ArrowRight size={16} aria-label={text('流向', 'Flows to')} role="img" />
        <Button type="link" onClick={() => select({ type: 'node', id: relation.to })}>{nodeName(relation.to)}</Button>
      </div>
      <dl>
        <dt>{text('触发方式', 'Trigger')}</dt><dd>{relation.trigger}</dd>
        <dt>{text('传递内容', 'Content')}</dt><dd>{relation.content}</dd>
        <dt>{text('目标结果', 'Outcome')}</dt><dd>{relation.result}</dd>
        {relation.exceptions && <><dt>{text('异常及未启用', 'Exceptions and inactive cases')}</dt><dd>{relation.exceptions}</dd></>}
      </dl>
      <section>
        <h4>{text('关联使用指南', 'Related guides')}</h4>
        <ul className="qms-workbench-graph__linked">
          {relatedGuideNodes.map(item => <li key={item.id}>
            <button type="button" onClick={() => select({ type: 'node', id: item.id })}>
              <strong>{item.guide.title}</strong><small>{item.name}</small>
            </button>
          </li>)}
        </ul>
      </section>
    </>}
  </aside>;
}

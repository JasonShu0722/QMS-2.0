import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ForceGraph3D, { type ForceGraphMethods, type NodeObject } from 'react-force-graph-3d';
import { theme } from 'antd';
import type { components } from '@qms/contracts';
import { domainCenters, focusFrame, parallelCurvatures, type Position } from './workbench-graph-scene-layout';
import { nodeStatusColors } from './workbench-graph';
import './workbench-graph-scene.css';

type Graph = components['schemas']['WorkbenchGraphDto'];
type LayoutNode = Graph['nodes'][number] & Position & { center: Position };
type LayoutEdge = Graph['relations'][number] & { source: string; target: string; curve: number; crosses: boolean };

export type WorkbenchGraphSceneProps = {
  graph: Graph;
  selection: { type: 'node' | 'relation'; id: string } | null;
  depth: 0 | 1 | 2;
  relationKind?: string;
  resetKey: number;
  visibleNodeIds?: ReadonlySet<string>;
  visibleRelationIds?: ReadonlySet<string>;
  fallback?: ReactNode;
  onNode: (id: string) => void;
  onRelation: (id: string) => void;
  onBackground: () => void;
};

const cameraStart = { x: 120, y: 105, z: 415 };
const origin = { x: 0, y: 0, z: 0 };

function tooltip(text: string) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const nodeLabel = (node: LayoutNode) => tooltip(`${node.domain} · ${node.name}`);
const linkLabel = (edge: LayoutEdge) => tooltip(edge.name);
const linkWidth = (edge: LayoutEdge) => edge.crosses ? .45 : 0;
const linkCurvature = (edge: LayoutEdge) => edge.curve;

function supportsWebGL() {
  try {
    const probe = document.createElement('canvas').getContext('webgl2');
    probe?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(probe);
  } catch {
    return false;
  }
}

function sceneData(graph: Graph) {
  const domains = new Map(graph.nodes.map(node => [node.id, node.domain]));
  const centers = domainCenters([...domains.values()], graph.relations.filter(edge => edge.status !== 'planned').map(edge => ({ from: domains.get(edge.from)!, to: domains.get(edge.to)! })));
  const ordinal = new Map<string, number>();
  const nodes = graph.nodes.map(node => {
    const center = centers.get(node.domain)!;
    const index = ordinal.get(node.domain) ?? 0;
    ordinal.set(node.domain, index + 1);
    const angle = (index + 1) * Math.PI * (3 - Math.sqrt(5));
    const radius = 6 + 4 * Math.cbrt(index + 1);
    return { ...node, center, x: center.x + Math.cos(angle) * radius, y: center.y + (index % 5 - 2) * 7, z: center.z + Math.sin(angle) * radius };
  });
  const curves = parallelCurvatures(graph.relations);
  const links = graph.relations.map(edge => ({ ...edge, source: edge.from, target: edge.to, curve: curves.get(edge.id) ?? 0, crosses: domains.get(edge.from) !== domains.get(edge.to) }));
  return { nodes, links, centers };
}

export function WorkbenchGraphScene({ graph, selection, depth, resetKey, relationKind, visibleNodeIds, visibleRelationIds, fallback, onNode, onRelation, onBackground }: WorkbenchGraphSceneProps) {
  const { token } = theme.useToken();
  const [available, setAvailable] = useState(supportsWebGL);
  const [width, setWidth] = useState(0);
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef(new Map<string, HTMLSpanElement>());
  const renderer = useRef<ForceGraphMethods<LayoutNode, LayoutEdge> | undefined>(undefined);
  const data = useMemo(() => sceneData(graph), [graph]);
  const height = width < 550 ? 350 : 520;
  const wide = width >= 550;
  const hasWidth = width > 0;
  const selectionType = selection?.type;
  const selectionId = selection?.id;
  const nearby = useMemo(() => {
    if (!selectionId) return new Set<string>();
    const edge = selectionType === 'relation' ? data.links.find(link => link.id === selectionId) : undefined;
    const nodes = new Set(edge ? [edge.from, edge.to] : [selectionId]);
    for (let hop = 0; selectionType === 'node' && hop < depth; hop += 1) {
      const current = new Set(nodes);
      for (const link of data.links) {
        if (link.status === 'planned' || relationKind && link.kind !== relationKind) continue;
        if (current.has(link.from) || current.has(link.to)) { nodes.add(link.from); nodes.add(link.to); }
      }
    }
    return nodes;
  }, [data, depth, relationKind, selectionId, selectionType]);
  const aspect = Math.max(.3, Math.round(width / height * 10) / 10);
  const sceneLabels = useMemo(() => {
    if (selection) {
      const focused = data.nodes.filter(node => nearby.has(node.id));
      if (selection.type === 'node') focused.sort((first, second) => Number(second.id === selection.id) - Number(first.id === selection.id));
      return focused.map(node => ({ id: node.id, name: node.name, position: node, offset: 9 }));
    }
    const visibleDomains = visibleNodeIds && new Set(data.nodes.filter(node => visibleNodeIds.has(node.id)).map(node => node.domain));
    return [...data.centers].filter(([name]) => !visibleDomains || visibleDomains.has(name))
      .map(([name, position]) => ({ id: name, name, position, offset: 22 }));
  }, [data, nearby, selection, visibleNodeIds]);

  useEffect(() => {
    const element = host.current;
    if (!element || !available) return;
    const measure = () => setWidth(Math.floor(element.clientWidth));
    const observer = new ResizeObserver(measure);
    const lost = () => setAvailable(false);
    measure();
    observer.observe(element);
    element.addEventListener('webglcontextlost', lost, true);
    return () => { observer.disconnect(); element.removeEventListener('webglcontextlost', lost, true); };
  }, [available]);

  useEffect(() => {
    const view = renderer.current;
    if (!view || !available || !hasWidth) return;
    view.d3Force('charge')?.strength(-40);
    view.d3Force('link')?.distance(34).strength(.055);
    view.d3Force('center', null);
    let nodes: NodeObject<LayoutNode>[] = [];
    const force = Object.assign((alpha: number) => {
      for (const node of nodes) {
        node.vx = (node.vx ?? 0) + (node.center.x - node.x) * alpha * .1;
        node.vy = (node.vy ?? 0) + (node.center.y - node.y) * alpha * .1;
        node.vz = (node.vz ?? 0) + (node.center.z - node.z) * alpha * .1;
      }
    }, { initialize: (points: NodeObject<LayoutNode>[]) => { nodes = points; } });
    view.d3Force('domains', force);
    view.d3ReheatSimulation();
  }, [available, data, hasWidth]);

  useEffect(() => {
    const view = renderer.current;
    if (!view || !available || !hasWidth) return;
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 480;
    const endpoints = data.nodes.filter(node => nearby.has(node.id));
    if (!endpoints.length) {
      const scale = wide ? 1 : 1.55;
      view.cameraPosition({ x: cameraStart.x * scale, y: cameraStart.y * scale, z: cameraStart.z * scale }, origin, duration);
      return;
    }
    const { center, distance } = focusFrame(endpoints, aspect);
    view.cameraPosition({ x: center.x + distance * .42, y: center.y + distance * .3, z: center.z + distance }, center, duration);
  }, [aspect, available, data, hasWidth, resetKey, nearby, wide]);

  useEffect(() => {
    if (!available || !width) return;
    let frame = 0;
    let last = 0;
    const placeLabels = (time: number) => {
      const view = renderer.current;
      if (view && time - last >= 55) {
        last = time;
        const placed: Array<{ x: number; y: number; width: number }> = [];
        for (const { id, name, position, offset } of sceneLabels) {
          const label = labels.current.get(id);
          if (!label) continue;
          const point = view.graph2ScreenCoords(position.x, position.y + offset, position.z);
          const labelWidth = Math.max(60, name.length * 13 + 16);
          const slots = selection ? [point.y, point.y + 24, point.y - 24] : [point.y];
          const labelY = point.x >= labelWidth / 2 && point.x <= width - labelWidth / 2
            ? slots.find(slot => slot >= 18 && slot < height - 20
              && !placed.some(other => Math.abs(other.y - slot) < 23 && Math.abs(other.x - point.x) < (other.width + labelWidth) / 2)) : undefined;
          label.style.visibility = labelY === undefined ? 'hidden' : 'visible';
          if (labelY !== undefined) {
            label.style.transform = `translate(${point.x}px, ${labelY}px) translate(-50%, -50%)`;
            placed.push({ x: point.x, y: labelY, width: labelWidth });
          }
        }
      }
      frame = requestAnimationFrame(placeLabels);
    };
    frame = requestAnimationFrame(placeLabels);
    return () => cancelAnimationFrame(frame);
  }, [available, height, sceneLabels, selection, width]);

  const highlighted = useCallback((edge: LayoutEdge) => selectionType === 'relation' && selectionId === edge.id
    || nearby.has(edge.from) && nearby.has(edge.to), [nearby, selectionId, selectionType]);
  const nodeIsVisible = useCallback((id: string) => nearby.has(id) || !visibleNodeIds || visibleNodeIds.has(id), [nearby, visibleNodeIds]);
  const showNode = useCallback((node: LayoutNode) => nodeIsVisible(node.id), [nodeIsVisible]);
  const showEdge = useCallback((edge: LayoutEdge) => selectionType === 'relation' && selectionId === edge.id
    || edge.status !== 'planned' && (!relationKind || edge.kind === relationKind)
      && (highlighted(edge) || ((!visibleRelationIds || visibleRelationIds.has(edge.id)) && nodeIsVisible(edge.from) && nodeIsVisible(edge.to))),
  [highlighted, nodeIsVisible, relationKind, selectionId, selectionType, visibleRelationIds]);
  const nodeColor = useCallback((node: LayoutNode) => selectionId && !nearby.has(node.id) ? token.colorTextQuaternary : nodeStatusColors[node.status],
    [nearby, selectionId, token.colorTextQuaternary]);
  const nodeVal = useCallback((node: LayoutNode) => selectionType === 'node' && selectionId === node.id ? 2.5 : 1, [selectionId, selectionType]);
  const linkColor = useCallback((edge: LayoutEdge) => highlighted(edge) ? token.colorPrimary
    : edge.crosses && !selectionId ? token.colorTextSecondary : token.colorTextQuaternary,
  [highlighted, selectionId, token.colorPrimary, token.colorTextQuaternary, token.colorTextSecondary]);
  const linkArrowLength = useCallback((edge: LayoutEdge) => highlighted(edge) ? 4 : edge.crosses && !selectionId ? 2.6 : 0, [highlighted, selectionId]);

  if (!available) return fallback ?? null;
  if (!data.nodes.length) return null;
  return <div className="qms-graph-scene" ref={host} style={{ height }} aria-label="三维功能图谱">
    {width > 0 && <ForceGraph3D<LayoutNode, LayoutEdge>
      ref={renderer} graphData={data} width={width} height={height} backgroundColor={token.colorBgLayout}
      numDimensions={3} controlType="orbit" showNavInfo={false} enableNodeDrag={false} nodeResolution={10} nodeRelSize={4} cooldownTicks={112}
      nodeVisibility={showNode} nodeColor={nodeColor} nodeVal={nodeVal} nodeLabel={nodeLabel}
      linkLabel={linkLabel} linkVisibility={showEdge} linkColor={linkColor} linkOpacity={.55} linkWidth={linkWidth}
      linkCurvature={linkCurvature} linkDirectionalArrowRelPos={.78} linkDirectionalArrowLength={linkArrowLength}
      onNodeClick={node => onNode(node.id)} onLinkClick={edge => onRelation(edge.id)} onBackgroundClick={onBackground}
    />}
    <div className="qms-graph-scene__labels" aria-hidden="true">{sceneLabels.map(({ id, name }) => <span key={id} ref={element => { if (element) labels.current.set(id, element); else labels.current.delete(id); }}>{name}</span>)}</div>
  </div>;
}

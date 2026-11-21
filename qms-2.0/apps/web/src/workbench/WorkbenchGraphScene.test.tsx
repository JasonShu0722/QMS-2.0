import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkbenchGraphScene, type WorkbenchGraphSceneProps } from './WorkbenchGraphScene';
import { nodeStatusColors } from './workbench-graph';

type RenderedNode = { id: string };
type RendererProps = {
  graphData: { nodes: RenderedNode[] };
  nodeColor: (node: RenderedNode) => string;
};

const renderer = vi.hoisted(() => ({
  render: vi.fn<(props: RendererProps) => void>(),
  cameraPosition: vi.fn(),
  d3ReheatSimulation: vi.fn(),
}));

vi.mock('react-force-graph-3d', async () => {
  const { forwardRef, useImperativeHandle } = await import('react');
  return { default: forwardRef(function MockForceGraph(props: RendererProps, ref) {
    useImperativeHandle(ref, () => ({
      cameraPosition: renderer.cameraPosition,
      d3Force: () => undefined,
      d3ReheatSimulation: renderer.d3ReheatSimulation,
      graph2ScreenCoords: () => ({ x: 450, y: 260 }),
    }), []);
    renderer.render(props);
    return null;
  }) };
});

const guide = { title: '', version: '', role: '', prerequisites: '', steps: [], result: '', exceptions: '' };
const node = { id: 'ledger', name: '不良品台账', domain: '制程质量', entry: '', aliases: [], status: 'development' as const,
  statusUpdatedOn: '2026-11-21', statusVersion: 0, summary: '', plan: '', guide };
const graph: WorkbenchGraphSceneProps['graph'] = {
  version: 'fixture', canEditStatus: true,
  nodes: [node, { ...node, id: 'ingestion', name: 'API入库衔接', domain: 'API 接入' }],
  relations: [{ id: 'ingestion-ledger', from: 'ingestion', to: 'ledger', name: '直接入库', kind: 'data', status: 'effective',
    trigger: '', content: '', result: '', exceptions: '' }],
};
const props: WorkbenchGraphSceneProps = {
  graph, selection: { type: 'node', id: node.id }, depth: 1, resetKey: 0,
  onNode: () => {}, onRelation: () => {}, onBackground: () => {},
};

const rendered = () => renderer.render.mock.lastCall![0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ getExtension: () => null } as unknown as WebGL2RenderingContext);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
});

afterEach(() => vi.restoreAllMocks());

it('recolors the selected node without replacing graphData, reheating, or moving the camera', () => {
  const { rerender } = render(<WorkbenchGraphScene {...props} />);
  const before = rendered();
  const selected = before.graphData.nodes.find(point => point.id === node.id)!;
  expect(before.nodeColor(selected)).toBe(nodeStatusColors.development);
  expect(renderer.cameraPosition).toHaveBeenCalledTimes(1);
  expect(renderer.d3ReheatSimulation).toHaveBeenCalledTimes(1);

  const updated: WorkbenchGraphSceneProps['graph'] = { ...graph, nodes: [
    { ...node, status: 'live', statusVersion: 1, statusUpdatedOn: '2026-11-22' }, graph.nodes[1],
  ], relations: graph.relations.map(link => ({ ...link })) };
  rerender(<WorkbenchGraphScene {...props} graph={updated} />);

  expect(rendered().graphData).toBe(before.graphData);
  expect(renderer.cameraPosition).toHaveBeenCalledTimes(1);
  expect(renderer.d3ReheatSimulation).toHaveBeenCalledTimes(1);
  expect(rendered().nodeColor(selected)).toBe(nodeStatusColors.live);

  rerender(<WorkbenchGraphScene {...props} graph={updated} resetKey={1} />);
  expect(renderer.cameraPosition).toHaveBeenCalledTimes(2);
  expect(rendered().graphData).toBe(before.graphData);
});

it('refreshes labels and focus when scene metadata changes', () => {
  const { rerender } = render(<WorkbenchGraphScene {...props} />);
  const before = rendered().graphData;
  expect(screen.getByText('API入库衔接')).toBeInTheDocument();

  rerender(<WorkbenchGraphScene {...props} graph={{ ...graph, relations: [{ ...graph.relations[0], status: 'planned' }] }} />);
  expect(rendered().graphData).not.toBe(before);
  expect(screen.queryByText('API入库衔接')).not.toBeInTheDocument();
  expect(renderer.cameraPosition).toHaveBeenCalledTimes(2);
});

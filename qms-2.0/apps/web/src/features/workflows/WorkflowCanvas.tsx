import { Background, Controls, ReactFlow, type Connection, type NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { WorkflowGraph } from './workflow-api';
import { workflowLabel } from './workflow-labels';
import { useLanguage } from '../../i18n/Language';

interface Props { graph: WorkflowGraph; readOnly: boolean; selected: string; onSelect: (id: string) => void; onChange: (graph: WorkflowGraph) => void }
export function WorkflowCanvas({ graph, readOnly, selected, onSelect, onChange }: Props) {
  const { t } = useLanguage();
  const nodes = graph.nodes.map((node, index) => ({ id: node.id, data: { label: node.name }, selected: selected === node.id,
    position: node.config?.editorPosition ?? { x: 40 + (index % 3) * 220, y: 60 + Math.floor(index / 3) * 130 } }));
  const edges = graph.transitions.map((edge) => ({ id: edge.id, source: edge.from, target: edge.to, label: edge.action ? t(workflowLabel(edge.action)) : undefined,
    style: ['RETURN', 'REJECT', 'REOPEN'].includes(edge.action ?? '') ? { strokeDasharray: '5 4' } : undefined }));
  function move(changes: NodeChange[]) {
    if (readOnly) return;
    const positions = changes.filter((change): change is Extract<NodeChange, { type: 'position' }> => change.type === 'position' && !!change.position);
    if (!positions.length) return;
    onChange({ ...graph, nodes: graph.nodes.map((node) => {
      const change = positions.find((entry) => entry.id === node.id);
      return change?.type === 'position' && change.position ? { ...node, config: { ...node.config, editorPosition: change.position } } : node;
    }) });
  }
  function connect(connection: Connection) {
    if (readOnly || !connection.source || !connection.target || connection.source === connection.target) return;
    const source = graph.nodes.find((node) => node.id === connection.source);
    const action = source?.type === 'APPROVAL' ? 'APPROVE' : source?.type === 'VERIFICATION' ? 'VERIFY' : source?.type === 'CLOSE' ? 'REOPEN' : 'SUBMIT';
    onChange({ ...graph, transitions: [...graph.transitions, { id: crypto.randomUUID(), from: connection.source, to: connection.target, action }] });
  }
  return <div className="workflow-canvas"><ReactFlow nodes={nodes} edges={edges} onNodesChange={move} onConnect={connect}
    onNodeClick={(_event, node) => onSelect(node.id)} nodesDraggable={!readOnly} nodesConnectable={!readOnly}
    edgesReconnectable={false} deleteKeyCode={null} fitView minZoom={0.2} maxZoom={2}>
    <Background /><Controls showInteractive={false} />
  </ReactFlow></div>;
}

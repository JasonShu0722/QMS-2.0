import { Background, Controls, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { WorkflowGraph } from './workflow-api';
import { workflowLabel } from './workflow-labels';
import { useLanguage } from '../../i18n/Language';
import './workflows.css';

interface Props { graph: WorkflowGraph; selected: string; onSelect: (id: string) => void }
export function WorkflowCanvas({ graph, selected, onSelect }: Props) {
  const { t } = useLanguage();
  const nodes = graph.nodes.map((node, index) => ({ id: node.id, data: { label: node.name }, selected: selected === node.id,
    position: node.config?.editorPosition ?? { x: 40 + (index % 3) * 220, y: 60 + Math.floor(index / 3) * 130 } }));
  const edges = graph.transitions.map((edge) => ({ id: edge.id, source: edge.from, target: edge.to, label: edge.action ? t(workflowLabel(edge.action)) : undefined,
    style: ['RETURN', 'REJECT', 'REOPEN'].includes(edge.action ?? '') ? { strokeDasharray: '5 4' } : undefined }));
  return <div className="workflow-canvas"><ReactFlow nodes={nodes} edges={edges}
    onNodeClick={(_event, node) => onSelect(node.id)} nodesDraggable={false} nodesConnectable={false}
    edgesReconnectable={false} deleteKeyCode={null} fitView minZoom={0.2} maxZoom={2}>
    <Background /><Controls showInteractive={false} />
  </ReactFlow></div>;
}

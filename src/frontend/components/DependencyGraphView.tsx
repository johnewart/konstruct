/*
 * Copyright 2026 John Ewart <john@johnewart.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use it except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useMemo } from 'react';
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

const NODE_WIDTH = 180;
const NODE_HEIGHT = 36;

export type DepNode = { path: string; name?: string; type?: 'file' | 'module' };
export type DepEdge = { source: string; target: string; type: string };

function getLayoutedElements(nodes: DepNode[], edges: DepEdge[]): { nodes: Node[]; edges: Edge[] } {
  const nodeById = new Map<string, DepNode>();
  nodes.forEach((n) => nodeById.set(n.path, n));
  edges.forEach((e) => {
    if (!nodeById.has(e.source)) nodeById.set(e.source, { path: e.source, name: e.source.split(/[/\\]/).pop() ?? e.source, type: 'module' });
    if (!nodeById.has(e.target)) nodeById.set(e.target, { path: e.target, name: e.target.split(/[/\\]/).pop() ?? e.target, type: 'module' });
  });
  const allNodes = Array.from(nodeById.values());

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 40, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));

  allNodes.forEach((n) => g.setNode(n.path, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  const flowNodes: Node[] = allNodes.map((n) => {
    const node = g.node(n.path);
    return {
      id: n.path,
      type: 'default',
      position: { x: node.x - NODE_WIDTH / 2, y: node.y - NODE_HEIGHT / 2 },
      data: { label: n.name ?? n.path.split(/[/\\]/).pop() ?? n.path },
    };
  });

  const flowEdges: Edge[] = edges.map((e, i) => ({
    id: `${e.source}-${e.target}-${e.type}-${i}`,
    source: e.source,
    target: e.target,
    type: 'smoothstep',
    data: e.type ? { label: e.type } : undefined,
  }));

  return { nodes: flowNodes, edges: flowEdges };
}

interface DependencyGraphViewProps {
  nodes: DepNode[];
  edges: DepEdge[];
  style?: React.CSSProperties;
}

export function DependencyGraphView({ nodes, edges, style }: DependencyGraphViewProps) {
  const { nodes: flowNodes, edges: flowEdges } = useMemo(
    () => getLayoutedElements(nodes, edges),
    [nodes, edges]
  );

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 400, ...style }}>
      <ReactFlowProvider>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls />
        <MiniMap
          nodeColor={() => 'var(--app-accent)'}
          maskColor="var(--app-surface)"
        />
      </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

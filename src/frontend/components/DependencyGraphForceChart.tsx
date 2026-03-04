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

import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

export type DepNode = { path: string; name?: string; type?: 'file' | 'module' };
export type DepEdge = { source: string; target: string; type: string };

type D3Node = DepNode & { x?: number; y?: number; vx?: number; vy?: number };
type D3Link = { source: D3Node; target: D3Node };

function buildGraph(nodes: DepNode[], edges: DepEdge[]): { nodes: D3Node[]; links: D3Link[] } {
  const nodeById = new Map<string, D3Node>();
  nodes.forEach((n) => nodeById.set(n.path, { ...n }));
  edges.forEach((e) => {
    if (!nodeById.has(e.source))
      nodeById.set(e.source, { path: e.source, name: e.source.split(/[/\\]/).pop() ?? e.source, type: 'module' });
    if (!nodeById.has(e.target))
      nodeById.set(e.target, { path: e.target, name: e.target.split(/[/\\]/).pop() ?? e.target, type: 'module' });
  });
  const nodeList = Array.from(nodeById.values());
  const links: D3Link[] = edges.map((e) => ({
    source: nodeById.get(e.source)!,
    target: nodeById.get(e.target)!,
  }));
  return { nodes: nodeList, links };
}

interface DependencyGraphForceChartProps {
  nodes: DepNode[];
  edges: DepEdge[];
  style?: React.CSSProperties;
}

const NODE_RADIUS = 4;
const LINK_STROKE = 1;

export function DependencyGraphForceChart({ nodes, edges, style }: DependencyGraphForceChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [selectedNode, setSelectedNode] = useState<DepNode | null>(null);
  const setSelectedRef = useRef(setSelectedNode);
  setSelectedRef.current = setSelectedNode;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0]?.contentRect ?? { width: 0, height: 0 };
      setSize({ width, height });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || size.width <= 0 || size.height <= 0 || (nodes.length === 0 && edges.length === 0)) return;

    const { nodes: d3Nodes, links } = buildGraph(nodes, edges);
    if (d3Nodes.length === 0) return;

    const width = size.width;
    const height = size.height;

    d3.select(container).selectAll('*').remove();
    const svg = d3
      .select(container)
      .append('svg')
      .attr('width', '100%')
      .attr('height', '100%')
      .attr('viewBox', [0, 0, width, height])
      .attr('preserveAspectRatio', 'xMidYMid meet');

    const g = svg.append('g');

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 20])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoom);
    svg.on('click', (event) => {
      const target = event.target as SVGElement;
      if (target === svg.node() || target === g.node()) setSelectedRef.current(null);
    });

    const link = g
      .append('g')
      .attr('stroke', 'var(--app-border)')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', LINK_STROKE)
      .selectAll('line')
      .data(links)
      .join('line');

    const node = g
      .append('g')
      .attr('fill', 'var(--app-accent)')
      .attr('stroke', 'var(--app-border)')
      .attr('stroke-width', 1)
      .selectAll('circle')
      .data(d3Nodes)
      .join('circle')
      .attr('r', NODE_RADIUS)
      .attr('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation();
        setSelectedRef.current(d);
      });
    node.append('title').text((d) => d.path);

    const padding = 60;
    const simulation = d3
      .forceSimulation<D3Node>(d3Nodes)
      .force(
        'link',
        d3.forceLink<D3Node, D3Link>(links).id((d) => d.path).distance(60)
      )
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(NODE_RADIUS + 2));

    simulation.on('tick', () => {
      link
        .attr('x1', (d) => d.source.x!)
        .attr('y1', (d) => d.source.y!)
        .attr('x2', (d) => d.target.x!)
        .attr('y2', (d) => d.target.y!);
      node.attr('cx', (d) => d.x!).attr('cy', (d) => d.y!);
    });

    simulation.on('end', () => {
      const xs = d3Nodes.map((d) => d.x ?? 0);
      const ys = d3Nodes.map((d) => d.y ?? 0);
      const minX = Math.min(...xs) - padding;
      const minY = Math.min(...ys) - padding;
      const maxX = Math.max(...xs) + padding;
      const maxY = Math.max(...ys) + padding;
      const w = Math.max(maxX - minX, width);
      const h = Math.max(maxY - minY, height);
      svg.attr('viewBox', [minX, minY, w, h]);
    });

    return () => {
      simulation.stop();
      d3.select(container).selectAll('*').remove();
    };
  }, [nodes, edges, size.width, size.height]);

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        minHeight: 400,
        ...style,
      }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {selectedNode && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            padding: '6px 10px',
            backgroundColor: 'var(--app-surface)',
            border: '1px solid var(--app-border)',
            borderRadius: 6,
            fontSize: 12,
            fontFamily: 'monospace',
            color: 'var(--app-text)',
            maxWidth: 'calc(100% - 24px)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px var(--app-shadow)',
          }}
        >
          {selectedNode.path}
        </div>
      )}
    </div>
  );
}

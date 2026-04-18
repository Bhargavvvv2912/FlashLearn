'use client';
import { useRef, useCallback, useEffect, useState } from 'react';
import * as THREE from 'three';
import type { KnowledgeNode, KnowledgeEdge } from '../lib/knowledgeGraph';
import { getConnectionCount } from '../lib/knowledgeGraph';

// react-force-graph-3d is loaded via dynamic() in the parent to avoid SSR issues.
// This file is never executed on the server.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ForceGraph3D = require('react-force-graph-3d').default;

export interface GlobeNode extends KnowledgeNode {
  connections: number;
  // three.js adds these at runtime
  x?: number;
  y?: number;
  z?: number;
}

interface Props {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  onNodeClick: (node: GlobeNode) => void;
}

/** Returns a hex colour based on engagement and connection count */
function nodeColor(connections: number, timesStudied: number): string {
  if (connections === 0) return '#475569';              // isolated  → slate
  if (timesStudied >= 3 || connections >= 4) return '#f59e0b'; // mastered  → gold
  if (connections >= 2) return '#818cf8';              // connected → indigo
  return '#22d3ee';                                    // new       → cyan
}

/** Creates a glowing canvas sprite for a node */
function makeGlowSprite(color: string): THREE.Sprite {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size / 2;

  // Outer glow
  const glow = ctx.createRadialGradient(half, half, 2, half, half, half);
  glow.addColorStop(0, color);
  glow.addColorStop(0.2, color + 'bb');
  glow.addColorStop(0.5, color + '44');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // Hard core
  ctx.beginPath();
  ctx.arc(half, half, 8, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  const mat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas),
    depthWrite: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(22, 22, 1);
  return sprite;
}

export default function KnowledgeGlobe({ nodes, edges, onNodeClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });

  useEffect(() => {
    if (!containerRef.current) return;
    const measure = () => {
      const r = containerRef.current!.getBoundingClientRect();
      setDims({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const graphData = {
    nodes: nodes.map((n) => ({
      ...n,
      connections: getConnectionCount(n.id, edges),
    })),
    links: edges.map((e) => ({ ...e })),
  };

  const nodeThreeObject = useCallback((node: GlobeNode) => {
    return makeGlowSprite(nodeColor(node.connections, node.timesStudied));
  }, []);

  const linkColor = useCallback((link: KnowledgeEdge) => {
    if (link.weight > 0.7) return '#f59e0b';
    if (link.weight > 0.4) return '#818cf8';
    return '#334155';
  }, []);

  const linkWidth = useCallback((link: KnowledgeEdge) => link.weight * 4 + 0.5, []);

  return (
    <div ref={containerRef} className="w-full h-full">
      <ForceGraph3D
        width={dims.w}
        height={dims.h}
        graphData={graphData}
        backgroundColor="#0f172a"
        nodeLabel={(node: GlobeNode) =>
          `<div style="font-family:system-ui;background:#1e293b;color:#f1f5f9;padding:8px 12px;border-radius:8px;font-size:12px;max-width:200px">
            <strong>${node.topic}</strong><br/>
            ${node.connections} connection${node.connections !== 1 ? 's' : ''} · studied ${node.timesStudied}×
          </div>`
        }
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={false}
        linkColor={linkColor}
        linkWidth={linkWidth}
        linkOpacity={0.7}
        linkLabel={(link: KnowledgeEdge) =>
          `<div style="font-family:system-ui;background:#1e293b;color:#94a3b8;padding:6px 10px;border-radius:6px;font-size:11px;max-width:240px">${link.bridge}</div>`
        }
        onNodeClick={onNodeClick}
        onNodeHover={(node: GlobeNode | null) => {
          if (containerRef.current) {
            containerRef.current.style.cursor = node ? 'pointer' : 'default';
          }
        }}
      />
    </div>
  );
}

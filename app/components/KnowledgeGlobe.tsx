'use client';
import { useRef, useCallback, useEffect, useState } from 'react';
import * as THREE from 'three';
import type { KnowledgeNode, KnowledgeEdge } from '../lib/knowledgeGraph';
import { getConnectionCount } from '../lib/knowledgeGraph';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ForceGraph3D = require('react-force-graph-3d').default;

export interface GlobeNode extends KnowledgeNode {
  connections: number;
  x?: number; y?: number; z?: number;
}

interface Props {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  onNodeClick: (node: GlobeNode) => void;
}

type ForceGraphInstance = {
  d3Force: (name: string) =>
    | {
        distance: (fn: (link: KnowledgeEdge) => number) => void;
      }
    | undefined;
  d3ReheatSimulation: () => void;
};

// Color palette by mastery tier
function nodeColor(connections: number, timesStudied: number): string {
  if (connections === 0) return '#334155';
  if (timesStudied >= 3 || connections >= 4) return '#f59e0b'; // gold = mastered
  if (connections >= 2) return '#818cf8';                       // indigo = connected
  return '#22d3ee';                                             // cyan = new
}

function typedNodeColor(node: GlobeNode): string {
  if (node.type === 'review') return '#14b8a6';
  if (node.type === 'review_group') return '#0f766e';
  if (node.type === 'expansion_group') return '#38bdf8';
  if (node.type === 'expansion') return '#22d3ee';
  if (node.type === 'main') return '#818cf8';
  return nodeColor(node.connections, node.timesStudied);
}

// Node sprite size scales with study depth + connections
function spriteSize(connections: number, timesStudied: number): number {
  return Math.min(14 + connections * 4 + timesStudied * 3, 42);
}

function makeGlowSprite(color: string, size: number, mastered: boolean): THREE.Sprite {
  const DIM = 256;
  const canvas = document.createElement('canvas');
  canvas.width = DIM; canvas.height = DIM;
  const ctx = canvas.getContext('2d')!;
  const C = DIM / 2;

  // Soft outer glow
  const glow = ctx.createRadialGradient(C, C, 4, C, C, C);
  glow.addColorStop(0,   color + 'ff');
  glow.addColorStop(0.18, color + 'cc');
  glow.addColorStop(0.45, color + '44');
  glow.addColorStop(1,   'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, DIM, DIM);

  // Mastered: bright outer ring
  if (mastered) {
    ctx.beginPath();
    ctx.arc(C, C, C * 0.42, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 5;
    ctx.globalAlpha = 0.8;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // White inner halo
  const halo = ctx.createRadialGradient(C, C, 0, C, C, C * 0.18);
  halo.addColorStop(0, '#ffffff');
  halo.addColorStop(1, 'transparent');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, DIM, DIM);

  // Solid core
  ctx.beginPath();
  ctx.arc(C, C, C * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(C, C, C * 0.09, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  const mat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas),
    depthWrite: false,
    transparent: true,
    blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size, size, 1);
  return sprite;
}

export default function KnowledgeGlobe({ nodes, edges, onNodeClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraphInstance | null>(null);
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

  // Once the force engine settles, inject custom link-distance force
  // so strongly connected nodes cluster tightly
  const handleEngineStop = useCallback(() => {
    if (!graphRef.current) return;
    const linkForce = graphRef.current.d3Force('link');
    if (linkForce) {
      linkForce.distance((link: KnowledgeEdge) => {
        // strong link (weight close to 1) → short distance (tight cluster)
        // weak link (weight close to 0) → long distance (spread out)
        return Math.round((1 - link.weight) * 220 + 40);
      });
      graphRef.current.d3ReheatSimulation();
    }
  }, []);

  const graphData = {
    nodes: nodes.map((n) => ({
      ...n,
      connections: getConnectionCount(n.id, edges),
    })),
    links: edges.map((e) => ({ ...e })),
  };

  const nodeThreeObject = useCallback((node: GlobeNode) => {
    const mastered = node.timesStudied >= 3 || node.connections >= 4;
    return makeGlowSprite(
      typedNodeColor(node),
      spriteSize(node.connections, node.timesStudied),
      mastered,
    );
  }, []);

  // Link colour: dim blue-gray for weak, violet for medium, bright gold for strong
  const linkColor = useCallback((link: KnowledgeEdge) => {
    if (link.weight > 0.75) return '#fbbf24'; // amber-gold
    if (link.weight > 0.55) return '#a78bfa'; // violet
    if (link.weight > 0.35) return '#6366f1'; // indigo
    return '#1e3a5f';                          // dark slate
  }, []);

  // Dramatic width range: hairline for weak, thick cable for strong
  const linkWidth = useCallback((link: KnowledgeEdge) => {
    if (link.weight > 0.75) return 3.5;
    if (link.weight > 0.55) return 1.8;
    if (link.weight > 0.35) return 0.8;
    return 0.2;
  }, []);

  // Flowing particles on medium-strong and strong links
  const linkParticles = useCallback((link: KnowledgeEdge) => {
    if (link.weight > 0.75) return 6;
    if (link.weight > 0.55) return 3;
    if (link.weight > 0.35) return 1;
    return 0;
  }, []);

  const linkParticleSpeed = useCallback((link: KnowledgeEdge) => link.weight * 0.009 + 0.001, []);

  const linkParticleWidth = useCallback((link: KnowledgeEdge) => {
    if (link.weight > 0.75) return 3;
    if (link.weight > 0.55) return 2;
    return 1.5;
  }, []);

  const linkParticleColor = useCallback((link: KnowledgeEdge) => {
    if (link.weight > 0.75) return '#fde68a'; // warm gold
    if (link.weight > 0.55) return '#ddd6fe'; // lavender
    return '#a5b4fc';                          // soft indigo
  }, []);

  // Curvature adds 3D depth; stronger links arc more
  const linkCurvature = useCallback((link: KnowledgeEdge) => {
    return link.weight * 0.3 + 0.05;
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full">
      <ForceGraph3D
        ref={graphRef}
        width={dims.w}
        height={dims.h}
        graphData={graphData}
        backgroundColor="#040d18"
        nodeLabel={(node: GlobeNode) =>
          `<div style="font-family:system-ui;background:#0f172a;border:1px solid #334155;color:#f1f5f9;padding:10px 14px;border-radius:10px;font-size:12px;max-width:220px;box-shadow:0 4px 24px #0008">
            <strong style="color:#e2e8f0;font-size:13px">${node.topic}</strong><br/>
            ${node.type ? `${node.type}<br/>` : ''}
            <span style="color:#94a3b8">${node.connections} connection${node.connections !== 1 ? 's' : ''} &middot; studied ${node.timesStudied}&times;</span>
          </div>`
        }
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={false}
        linkColor={linkColor}
        linkWidth={linkWidth}
        linkOpacity={0.85}
        linkCurvature={linkCurvature}
        linkCurveRotation={0.4}
        linkDirectionalParticles={linkParticles}
        linkDirectionalParticleSpeed={linkParticleSpeed}
        linkDirectionalParticleWidth={linkParticleWidth}
        linkDirectionalParticleColor={linkParticleColor}
        linkLabel={(link: KnowledgeEdge) =>
          `<div style="font-family:system-ui;background:#0f172a;border:1px solid #334155;color:#94a3b8;padding:8px 12px;border-radius:8px;font-size:11px;max-width:260px;line-height:1.5">${link.label ? `<strong style="color:#e2e8f0">${link.label}</strong><br/>` : ''}${link.bridge}</div>`
        }
        onNodeClick={onNodeClick}
        onNodeHover={(node: GlobeNode | null) => {
          if (containerRef.current) {
            containerRef.current.style.cursor = node ? 'pointer' : 'default';
          }
        }}
        onEngineStop={handleEngineStop}
        d3AlphaDecay={0.015}
        d3VelocityDecay={0.25}
        warmupTicks={60}
        cooldownTicks={200}
      />
    </div>
  );
}

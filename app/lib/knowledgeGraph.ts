export interface KnowledgeNode {
  id: string;
  topic: string;
  summary: string;
  studiedAt: number;
  timesStudied: number;
}

export interface KnowledgeEdge {
  source: string;
  target: string;
  weight: number; // 0–1
  bridge: string; // one-sentence description of the connection
}

export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

const STORAGE_KEY = 'flashlearn_kg_v2';

export function loadGraph(): KnowledgeGraph {
  if (typeof window === 'undefined') return { nodes: [], edges: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { nodes: [], edges: [] };
  } catch {
    return { nodes: [], edges: [] };
  }
}

function persist(g: KnowledgeGraph): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(g));
  } catch { /* storage quota exceeded — fail silently */ }
}

export function topicToId(topic: string): string {
  return topic
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 60);
}

export function upsertNode(
  topic: string,
  summary: string
): { graph: KnowledgeGraph; nodeId: string } {
  const graph = loadGraph();
  const id = topicToId(topic);
  const existing = graph.nodes.find((n) => n.id === id);

  if (existing) {
    existing.timesStudied += 1;
    existing.studiedAt = Date.now();
  } else {
    graph.nodes.push({ id, topic, summary, studiedAt: Date.now(), timesStudied: 1 });
  }

  persist(graph);
  return { graph, nodeId: id };
}

export function mergeEdges(
  sourceId: string,
  connections: Array<{ existingTopic: string; strength: number; bridge: string }>
): KnowledgeGraph {
  const graph = loadGraph();

  for (const conn of connections) {
    const targetId = topicToId(conn.existingTopic);
    if (!graph.nodes.find((n) => n.id === targetId)) continue;
    if (sourceId === targetId) continue;

    const w = Math.min(Math.max(conn.strength / 10, 0), 1);
    const existing = graph.edges.find(
      (e) =>
        (e.source === sourceId && e.target === targetId) ||
        (e.source === targetId && e.target === sourceId)
    );

    if (existing) {
      existing.weight = Math.max(existing.weight, w);
    } else {
      graph.edges.push({ source: sourceId, target: targetId, weight: w, bridge: conn.bridge });
    }
  }

  persist(graph);
  return graph;
}

export function getConnectionCount(nodeId: string, edges: KnowledgeEdge[]): number {
  return edges.filter((e) => e.source === nodeId || e.target === nodeId).length;
}

export function getTopConnectedNodes(
  graph: KnowledgeGraph,
  limit = 5
): Array<KnowledgeNode & { connCount: number }> {
  return graph.nodes
    .map((n) => ({ ...n, connCount: getConnectionCount(n.id, graph.edges) }))
    .sort((a, b) => b.connCount - a.connCount)
    .slice(0, limit);
}

export function getIsolatedNodes(graph: KnowledgeGraph): KnowledgeNode[] {
  return graph.nodes.filter((n) => getConnectionCount(n.id, graph.edges) === 0);
}

export function clearGraph(): void {
  if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY);
}

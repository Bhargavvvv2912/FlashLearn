export type KnowledgeRelation =
  | "simplify"
  | "drill_deeper"
  | "example"
  | "reexplain"
  | "review"
  | "main";

export interface KnowledgeNode {
  id: string;
  topic: string;
  summary: string;
  studiedAt: number;
  timesStudied: number;
  type?: "main" | "expansion_group" | "expansion" | "review_group" | "review";
  relation?: KnowledgeRelation;
  parentId?: string;
  reviewGroupId?: string;
  cardIndex?: number;
}

export interface KnowledgeEdge {
  source: string;
  target: string;
  weight: number; // 0–1
  bridge: string; // one-sentence description of the connection
  label?: string;
  relation?: KnowledgeRelation;
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

export function isTopicNode(node: KnowledgeNode): boolean {
  return !node.type;
}

export function getTopicGraph(graph: KnowledgeGraph): KnowledgeGraph {
  const nodes = graph.nodes.filter(isTopicNode);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter(
    (edge) =>
      !edge.relation &&
      nodeIds.has(edge.source) &&
      nodeIds.has(edge.target),
  );

  return { nodes, edges };
}

export function upsertNode(
  topic: string,
  summary: string
): { graph: KnowledgeGraph; nodeId: string } {
  const graph = loadGraph();
  const id = topicToId(topic);
  const existing = graph.nodes.find((n) => n.id === id);

  if (existing) {
    existing.topic = topic;
    existing.summary = summary;
    existing.timesStudied += 1;
    existing.studiedAt = Date.now();
    delete existing.type;
    delete existing.relation;
    delete existing.parentId;
    delete existing.reviewGroupId;
    delete existing.cardIndex;
  } else {
    graph.nodes.push({ id, topic, summary, studiedAt: Date.now(), timesStudied: 1 });
  }

  persist(graph);
  return { graph, nodeId: id };
}

export function upsertGraphNode(
  node: Omit<KnowledgeNode, "studiedAt" | "timesStudied"> & {
    studiedAt?: number;
    timesStudied?: number;
  },
): KnowledgeGraph {
  const graph = loadGraph();
  const existing = graph.nodes.find((n) => n.id === node.id);

  if (existing) {
    Object.assign(existing, {
      ...node,
      studiedAt: node.studiedAt ?? existing.studiedAt,
      timesStudied: Math.max(existing.timesStudied, node.timesStudied ?? 1),
    });
    if (!node.type && !node.relation) {
      delete existing.type;
      delete existing.relation;
      delete existing.parentId;
      delete existing.reviewGroupId;
      delete existing.cardIndex;
    }
  } else {
    graph.nodes.push({
      ...node,
      studiedAt: node.studiedAt ?? Date.now(),
      timesStudied: node.timesStudied ?? 1,
    });
  }

  persist(graph);
  return graph;
}

export function upsertGraphEdge(edge: KnowledgeEdge): KnowledgeGraph {
  const graph = loadGraph();
  const existing = graph.edges.find(
    (e) =>
      e.source === edge.source &&
      e.target === edge.target &&
      (e.relation || "") === (edge.relation || "") &&
      (e.label || "") === (edge.label || ""),
  );

  if (existing) {
    Object.assign(existing, {
      ...edge,
      weight: Math.max(existing.weight, edge.weight),
    });
  } else {
    graph.edges.push(edge);
  }

  persist(graph);
  return graph;
}

export function mergeEdges(
  sourceId: string,
  connections: Array<{ existingTopic: string; strength: number; bridge: string }>
): KnowledgeGraph {
  const graph = loadGraph();
  const topicGraph = getTopicGraph(graph);
  const topicIds = new Set(topicGraph.nodes.map((node) => node.id));

  for (const conn of connections) {
    if (!conn || typeof conn.existingTopic !== 'string') continue;
    if (typeof conn.strength !== 'number' || conn.strength < 7) continue;
    if (typeof conn.bridge !== 'string' || conn.bridge.trim().length < 20) continue;

    const targetId = topicToId(conn.existingTopic);
    if (!topicIds.has(sourceId) || !topicIds.has(targetId)) continue;
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

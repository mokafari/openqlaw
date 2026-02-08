/**
 * Knowledge Graph - Relationship tracking between semantic facts
 * Part of AGI 2026 TIER 1: Perfect Memory System
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

const DATA_DIR =
  process.env.OPENCLAW_WORKSPACE || path.join(process.env.HOME || "", ".openclaw", "workspace");
const KG_FILE = path.join(DATA_DIR, "data", "knowledge-graph.jsonl");

// In-memory cache
let entities: Map<string, Entity> = new Map();
let edges: Relationship[] = [];
let initialized = false;

// Types
export interface Entity {
  id: string;
  name: string;
  type: string;
  createdAt: number;
}

export interface Relationship {
  id: string;
  subjectId: string;
  predicate: string;
  objectId: string;
  confidence: number;
  createdAt: number;
}

export interface KnowledgeTriple {
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
}

// Generate unique ID
function generateId(): string {
  return `kg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Load knowledge graph from file
async function loadGraph(): Promise<void> {
  if (initialized) return;

  try {
    await fs.mkdir(path.dirname(KG_FILE), { recursive: true });
    const content = await fs.readFile(KG_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.recordType === "entity") {
          entities.set(entry.id, entry);
        } else if (entry.recordType === "edge") {
          edges.push(entry);
        }
      } catch {}
    }
  } catch {
    // File doesn't exist yet
  }

  initialized = true;
}

// Append to file
async function appendToFile(entry: object): Promise<void> {
  await fs.mkdir(path.dirname(KG_FILE), { recursive: true });
  await fs.appendFile(KG_FILE, JSON.stringify(entry) + "\n");
}

// Get or create entity
async function getOrCreateEntity(name: string, type: string = "concept"): Promise<string> {
  await loadGraph();

  const normalized = name.toLowerCase().trim();
  for (const [id, entity] of Array.from(entities.entries())) {
    if (entity.name.toLowerCase() === normalized) {
      return id;
    }
  }

  const id = generateId();
  const entity: Entity = {
    id,
    name,
    type,
    createdAt: Date.now(),
  };

  entities.set(id, entity);
  await appendToFile({ recordType: "entity", ...entity });

  return id;
}

// Add a fact (triple) to the knowledge graph
export async function addFact(
  subject: string,
  predicate: string,
  object: string,
  confidence: number = 1.0,
): Promise<string> {
  await loadGraph();

  const subjectId = await getOrCreateEntity(subject);
  const objectId = await getOrCreateEntity(object);

  const id = generateId();
  const edge: Relationship = {
    id,
    subjectId,
    predicate,
    objectId,
    confidence,
    createdAt: Date.now(),
  };

  edges.push(edge);
  await appendToFile({ recordType: "edge", ...edge });

  return id;
}

// Get all related entities
export async function getRelated(entityName: string): Promise<{
  outgoing: Array<{ predicate: string; object: string; confidence: number }>;
  incoming: Array<{ subject: string; predicate: string; confidence: number }>;
}> {
  await loadGraph();

  const normalized = entityName.toLowerCase().trim();
  let entityId: string | null = null;

  for (const [id, entity] of Array.from(entities.entries())) {
    if (entity.name.toLowerCase() === normalized) {
      entityId = id;
      break;
    }
  }

  if (!entityId) {
    return { outgoing: [], incoming: [] };
  }

  const outgoing = edges
    .filter((e) => e.subjectId === entityId)
    .map((e) => ({
      predicate: e.predicate,
      object: entities.get(e.objectId)?.name || "unknown",
      confidence: e.confidence,
    }));

  const incoming = edges
    .filter((e) => e.objectId === entityId)
    .map((e) => ({
      subject: entities.get(e.subjectId)?.name || "unknown",
      predicate: e.predicate,
      confidence: e.confidence,
    }));

  return { outgoing, incoming };
}

// Find path between two entities (BFS)
export async function getPath(
  fromEntity: string,
  toEntity: string,
  maxDepth: number = 4,
): Promise<Array<{ entity: string; predicate: string }> | null> {
  await loadGraph();

  const fromNorm = fromEntity.toLowerCase().trim();
  const toNorm = toEntity.toLowerCase().trim();

  let fromId: string | null = null;
  let toId: string | null = null;

  for (const [id, entity] of Array.from(entities.entries())) {
    if (entity.name.toLowerCase() === fromNorm) fromId = id;
    if (entity.name.toLowerCase() === toNorm) toId = id;
  }

  if (!fromId || !toId) return null;
  if (fromId === toId) return [{ entity: entities.get(fromId)!.name, predicate: "" }];

  // BFS
  const visited = new Set<string>([fromId]);
  const queue: Array<{ id: string; path: Array<{ entity: string; predicate: string }> }> = [
    { id: fromId, path: [{ entity: entities.get(fromId)!.name, predicate: "" }] },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.path.length > maxDepth) continue;

    // Get neighbors (both directions)
    const neighbors: Array<{ id: string; predicate: string }> = [];

    for (const edge of edges) {
      if (edge.subjectId === current.id && !visited.has(edge.objectId)) {
        neighbors.push({ id: edge.objectId, predicate: edge.predicate });
      }
      if (edge.objectId === current.id && !visited.has(edge.subjectId)) {
        neighbors.push({ id: edge.subjectId, predicate: edge.predicate });
      }
    }

    for (const neighbor of neighbors) {
      visited.add(neighbor.id);
      const entity = entities.get(neighbor.id);
      if (!entity) continue;

      const newPath = [...current.path, { entity: entity.name, predicate: neighbor.predicate }];

      if (neighbor.id === toId) {
        return newPath;
      }

      queue.push({ id: neighbor.id, path: newPath });
    }
  }

  return null;
}

// Get statistics
export async function getStats(): Promise<{
  entityCount: number;
  edgeCount: number;
  predicates: string[];
}> {
  await loadGraph();

  const predicates = Array.from(new Set(edges.map((e) => e.predicate)));

  return {
    entityCount: entities.size,
    edgeCount: edges.length,
    predicates,
  };
}

// Visualize as text
export async function visualize(limit: number = 20): Promise<string> {
  await loadGraph();

  if (edges.length === 0) {
    return "(empty knowledge graph)";
  }

  const recent = edges.slice(-limit).reverse();

  return recent
    .map((e) => {
      const subject = entities.get(e.subjectId)?.name || "?";
      const object = entities.get(e.objectId)?.name || "?";
      return `${subject} --[${e.predicate}]--> ${object} (${e.confidence.toFixed(2)})`;
    })
    .join("\n");
}

// Reset (for testing)
export function reset(): void {
  entities = new Map();
  edges = [];
  initialized = false;
}

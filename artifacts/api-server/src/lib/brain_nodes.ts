import {
  auditEventsTable,
  brainEntitiesTable,
  brainMemoriesTable,
  brainRelationsTable,
  db,
  siDecisionsTable,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, or } from "drizzle-orm";

export type BrainNodeStatus = "READY" | "WATCH" | "BLOCKED" | "STALE" | "SCANNING";

export interface BrainNode {
  symbol: string;
  name: string | null;
  sector: string | null;
  regime: string | null;
  status: BrainNodeStatus;
  confidence_score: number;
  opportunity_score: number;
  urgency_score: number;
  attention_score: number;
  capital_priority_score: number;
  node_health: "live" | "degraded" | "stale";
  last_signal_at: string | null;
  last_updated_at: string;
  risk_flags: string[];
  latest_signal: {
    setup_type: string;
    direction: string;
    approved: boolean;
    win_probability: number;
    final_quality: number;
    edge_score: number;
    kelly_fraction: number;
    confluence_score: number;
    rejection_reason: string | null;
    gate_action: string | null;
    gate_block_reasons: string | null;
  } | null;
}

export interface BrainNodeCluster {
  key: string;
  label: string;
  count: number;
  avg_opportunity: number;
  avg_confidence: number;
  symbols: string[];
}

export interface BrainNodeRelation {
  id: number;
  source_symbol: string;
  target_symbol: string;
  relation_type: string;
  strength: number;
  context_json: string | null;
  created_at: string;
}

export interface BrainNodeDrilldown {
  node: BrainNode;
  memories: Array<{
    id: number;
    memory_type: string;
    title: string;
    content: string;
    confidence: number;
    outcome_score: number | null;
    tags: string | null;
    created_at: string;
  }>;
  relationships: BrainNodeRelation[];
  recent_events: Array<{
    id: number;
    event_type: string;
    decision_state: string | null;
    reason: string | null;
    payload: Record<string, unknown> | null;
    created_at: string;
  }>;
  recent_decisions: Array<{
    id: number;
    setup_type: string;
    direction: string;
    regime: string;
    approved: boolean;
    win_probability: number;
    final_quality: number;
    edge_score: number;
    kelly_fraction: number;
    confluence_score: number;
    gate_action: string | null;
    gate_block_reasons: string | null;
    rejection_reason: string | null;
    created_at: string;
  }>;
  layer_scores: {
    structure: number;
    microstructure: number;
    recall: number;
    intelligence: number;
    risk: number;
  };
}

interface DecisionLite {
  setup_type: string;
  direction: string;
  regime: string;
  approved: boolean;
  win_probability: number;
  final_quality: number;
  edge_score: number;
  kelly_fraction: number;
  confluence_score: number;
  rejection_reason: string | null;
  gate_action: string | null;
  gate_block_reasons: string | null;
  created_at: Date;
}

interface SymbolAuditStats {
  blocked_count: number;
  rejection_count: number;
  has_recent_execution_error: boolean;
  last_event_at: Date | null;
}

function parseDbNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function coerceConfluence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value > 1 ? clamp(value / 100) : clamp(value);
}

function riskFlagsFromDecision(decision: DecisionLite | undefined, audit: SymbolAuditStats): string[] {
  const flags: string[] = [];
  if (decision?.gate_action && decision.gate_action.toUpperCase().includes("BLOCK")) {
    flags.push("GATE_BLOCKED");
  }
  if (!decision?.approved && decision?.rejection_reason) {
    flags.push("SIGNAL_REJECTED");
  }
  if (audit.blocked_count >= 3) {
    flags.push("REPEATED_BLOCKS");
  }
  if (audit.has_recent_execution_error) {
    flags.push("EXECUTION_ALERT");
  }
  return flags;
}

function decisionAgeMinutes(decision?: DecisionLite): number {
  if (!decision) return Number.POSITIVE_INFINITY;
  const createdMs = new Date(decision.created_at).getTime();
  return Math.max(0, (Date.now() - createdMs) / 60_000);
}

function statusFromDecision(decision: DecisionLite | undefined, opportunity: number): BrainNodeStatus {
  if (!decision) return "SCANNING";
  const ageMins = decisionAgeMinutes(decision);
  if (ageMins > 6 * 60) return "STALE";
  if (!decision.approved || (decision.gate_action ?? "").toUpperCase().includes("BLOCK")) {
    return "BLOCKED";
  }
  if (opportunity >= 0.7) return "READY";
  return "WATCH";
}

function healthFromNode(status: BrainNodeStatus, flags: string[]): "live" | "degraded" | "stale" {
  if (status === "STALE") return "stale";
  if (status === "BLOCKED" || flags.length >= 2) return "degraded";
  return "live";
}

async function fetchLatestDecisions(symbols: string[]): Promise<Map<string, DecisionLite>> {
  if (symbols.length === 0) return new Map<string, DecisionLite>();

  const rows = await db
    .select({
      symbol: siDecisionsTable.symbol,
      setup_type: siDecisionsTable.setup_type,
      direction: siDecisionsTable.direction,
      regime: siDecisionsTable.regime,
      approved: siDecisionsTable.approved,
      win_probability: siDecisionsTable.win_probability,
      final_quality: siDecisionsTable.final_quality,
      edge_score: siDecisionsTable.edge_score,
      kelly_fraction: siDecisionsTable.kelly_fraction,
      confluence_score: siDecisionsTable.confluence_score,
      rejection_reason: siDecisionsTable.rejection_reason,
      gate_action: siDecisionsTable.gate_action,
      gate_block_reasons: siDecisionsTable.gate_block_reasons,
      created_at: siDecisionsTable.created_at,
    })
    .from(siDecisionsTable)
    .where(inArray(siDecisionsTable.symbol, symbols))
    .orderBy(desc(siDecisionsTable.created_at))
    .limit(Math.max(200, symbols.length * 8));

  const latest = new Map<string, DecisionLite>();
  for (const row of rows) {
    const key = String(row.symbol ?? "").toUpperCase();
    if (!key || latest.has(key)) continue;
    latest.set(key, {
      setup_type: String(row.setup_type ?? "unknown"),
      direction: String(row.direction ?? "long"),
      regime: String(row.regime ?? "mixed"),
      approved: Boolean(row.approved),
      win_probability: clamp(parseDbNum(row.win_probability)),
      final_quality: clamp(parseDbNum(row.final_quality)),
      edge_score: clamp(parseDbNum(row.edge_score)),
      kelly_fraction: clamp(parseDbNum(row.kelly_fraction), 0, 1.5),
      confluence_score: coerceConfluence(parseDbNum(row.confluence_score)),
      rejection_reason: row.rejection_reason ? String(row.rejection_reason) : null,
      gate_action: row.gate_action ? String(row.gate_action) : null,
      gate_block_reasons: row.gate_block_reasons ? String(row.gate_block_reasons) : null,
      created_at: row.created_at ?? new Date(0),
    });
  }

  return latest;
}

async function fetchAuditStats(symbols: string[]): Promise<Map<string, SymbolAuditStats>> {
  if (symbols.length === 0) return new Map<string, SymbolAuditStats>();

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      symbol: auditEventsTable.symbol,
      event_type: auditEventsTable.event_type,
      reason: auditEventsTable.reason,
      created_at: auditEventsTable.created_at,
    })
    .from(auditEventsTable)
    .where(
      and(
        inArray(auditEventsTable.symbol, symbols),
        gte(auditEventsTable.created_at, since),
      ),
    )
    .orderBy(desc(auditEventsTable.created_at))
    .limit(Math.max(400, symbols.length * 25));

  const map = new Map<string, SymbolAuditStats>();

  function ensure(symbol: string): SymbolAuditStats {
    const existing = map.get(symbol);
    if (existing) return existing;
    const created: SymbolAuditStats = {
      blocked_count: 0,
      rejection_count: 0,
      has_recent_execution_error: false,
      last_event_at: null,
    };
    map.set(symbol, created);
    return created;
  }

  for (const row of rows) {
    const symbol = String(row.symbol ?? "").toUpperCase();
    if (!symbol) continue;
    const stats = ensure(symbol);
    const eventType = String(row.event_type ?? "").toLowerCase();
    const reason = String(row.reason ?? "").toLowerCase();

    if (eventType === "execution_gate_blocked" || eventType === "signal_rejected") {
      stats.blocked_count += 1;
    }
    if (eventType === "signal_rejected") {
      stats.rejection_count += 1;
    }
    if (
      (eventType === "execution_result" || eventType === "execution_idempotency") &&
      (reason.includes("fail") || reason.includes("error") || reason.includes("reject"))
    ) {
      stats.has_recent_execution_error = true;
    }

    if (!stats.last_event_at && row.created_at) {
      stats.last_event_at = row.created_at;
    }
  }

  return map;
}

function buildNodeFromEntity(
  entity: typeof brainEntitiesTable.$inferSelect,
  decision: DecisionLite | undefined,
  audit: SymbolAuditStats | undefined,
): BrainNode {
  const safeAudit: SymbolAuditStats = audit ?? {
    blocked_count: 0,
    rejection_count: 0,
    has_recent_execution_error: false,
    last_event_at: null,
  };

  const confidence = decision
    ? clamp(0.45 * decision.win_probability + 0.35 * decision.final_quality + 0.2 * decision.edge_score)
    : 0.35;

  const baseOpportunity = decision
    ? clamp(0.5 * confidence + 0.25 * decision.kelly_fraction + 0.25 * decision.confluence_score)
    : 0.2;

  const gatePenalty = decision && !decision.approved ? 0.32 : 0;
  const blockPenalty = Math.min(0.2, safeAudit.blocked_count * 0.04);
  const executionPenalty = safeAudit.has_recent_execution_error ? 0.12 : 0;
  const riskPenalty = gatePenalty + blockPenalty + executionPenalty;

  const opportunity = clamp(baseOpportunity - riskPenalty);
  const ageMinutes = decisionAgeMinutes(decision);
  const recency = Number.isFinite(ageMinutes) ? clamp(Math.exp(-ageMinutes / 180)) : 0.15;
  const urgency = clamp(0.7 * opportunity + 0.3 * recency);
  const attention = clamp(0.55 * opportunity + 0.45 * urgency);

  const approvedBoost = decision?.approved ? 1 : 0.35;
  const capitalPriority = clamp(attention * approvedBoost * (1 - Math.min(0.5, riskPenalty)));

  const status = statusFromDecision(decision, opportunity);
  const riskFlags = riskFlagsFromDecision(decision, safeAudit);

  return {
    symbol: String(entity.symbol ?? "").toUpperCase(),
    name: entity.name ? String(entity.name) : null,
    sector: entity.sector ? String(entity.sector) : null,
    regime: decision?.regime ?? (entity.regime ? String(entity.regime) : null),
    status,
    confidence_score: Number(confidence.toFixed(4)),
    opportunity_score: Number(opportunity.toFixed(4)),
    urgency_score: Number(urgency.toFixed(4)),
    attention_score: Number(attention.toFixed(4)),
    capital_priority_score: Number(capitalPriority.toFixed(4)),
    node_health: healthFromNode(status, riskFlags),
    last_signal_at: decision ? new Date(decision.created_at).toISOString() : null,
    last_updated_at: new Date(entity.updated_at ?? entity.created_at ?? new Date()).toISOString(),
    risk_flags: riskFlags,
    latest_signal: decision
      ? {
          setup_type: decision.setup_type,
          direction: decision.direction,
          approved: decision.approved,
          win_probability: Number(decision.win_probability.toFixed(4)),
          final_quality: Number(decision.final_quality.toFixed(4)),
          edge_score: Number(decision.edge_score.toFixed(4)),
          kelly_fraction: Number(decision.kelly_fraction.toFixed(4)),
          confluence_score: Number(decision.confluence_score.toFixed(4)),
          rejection_reason: decision.rejection_reason,
          gate_action: decision.gate_action,
          gate_block_reasons: decision.gate_block_reasons,
        }
      : null,
  };
}

async function loadEntities(limit: number): Promise<Array<typeof brainEntitiesTable.$inferSelect>> {
  const rows = await db
    .select()
    .from(brainEntitiesTable)
    .orderBy(desc(brainEntitiesTable.updated_at))
    .limit(Math.max(1, Math.min(400, limit)));

  if (rows.length > 0) return rows;

  // If brain entities table is empty, build synthetic entities from latest SI decisions.
  const recentDecisions = await db
    .select({
      symbol: siDecisionsTable.symbol,
      regime: siDecisionsTable.regime,
      created_at: siDecisionsTable.created_at,
    })
    .from(siDecisionsTable)
    .orderBy(desc(siDecisionsTable.created_at))
    .limit(200);

  const seen = new Set<string>();
  const synthetic: Array<typeof brainEntitiesTable.$inferSelect> = [];
  for (const row of recentDecisions) {
    const symbol = String(row.symbol ?? "").toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    synthetic.push({
      id: -synthetic.length - 1,
      symbol,
      entity_type: "stock",
      name: null,
      sector: null,
      regime: row.regime ? String(row.regime) : null,
      volatility: null,
      last_price: null,
      state_json: null,
      org_id: null,
      created_at: row.created_at ?? new Date(),
      updated_at: row.created_at ?? new Date(),
    });
    if (synthetic.length >= limit) break;
  }

  return synthetic;
}

export async function listBrainNodes(limit = 120): Promise<BrainNode[]> {
  const entities = await loadEntities(limit);
  const symbols = entities
    .map((entity) => String(entity.symbol ?? "").toUpperCase())
    .filter(Boolean);

  const [decisionMap, auditMap] = await Promise.all([
    fetchLatestDecisions(symbols),
    fetchAuditStats(symbols),
  ]);

  return entities
    .map((entity) => {
      const symbol = String(entity.symbol ?? "").toUpperCase();
      return buildNodeFromEntity(entity, decisionMap.get(symbol), auditMap.get(symbol));
    })
    .sort((a, b) => b.capital_priority_score - a.capital_priority_score)
    .slice(0, limit);
}

export async function getBrainNode(symbolRaw: string): Promise<BrainNode | null> {
  const symbol = String(symbolRaw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!symbol) return null;

  const rows = await db
    .select()
    .from(brainEntitiesTable)
    .where(eq(brainEntitiesTable.symbol, symbol))
    .orderBy(desc(brainEntitiesTable.updated_at))
    .limit(1);

  const entities = rows.length > 0
    ? rows
    : [{
        id: -1,
        symbol,
        entity_type: "stock",
        name: null,
        sector: null,
        regime: null,
        volatility: null,
        last_price: null,
        state_json: null,
        created_at: new Date(),
        updated_at: new Date(),
      }];

  const [decisionMap, auditMap] = await Promise.all([
    fetchLatestDecisions([symbol]),
    fetchAuditStats([symbol]),
  ]);

  return buildNodeFromEntity(entities[0], decisionMap.get(symbol), auditMap.get(symbol));
}

export async function getBrainNodeClusters(limit = 120): Promise<{
  by_sector: BrainNodeCluster[];
  by_regime: BrainNodeCluster[];
  by_status: BrainNodeCluster[];
}> {
  const nodes = await listBrainNodes(limit);

  const build = (items: BrainNode[], keyFn: (node: BrainNode) => string, prefix: string): BrainNodeCluster[] => {
    const map = new Map<string, BrainNode[]>();
    for (const node of items) {
      const key = keyFn(node) || "unknown";
      const arr = map.get(key);
      if (arr) arr.push(node);
      else map.set(key, [node]);
    }

    return Array.from(map.entries())
      .map(([key, arr]) => {
        const avgOpp = arr.reduce((sum, node) => sum + node.opportunity_score, 0) / arr.length;
        const avgConf = arr.reduce((sum, node) => sum + node.confidence_score, 0) / arr.length;
        return {
          key: `${prefix}:${key}`,
          label: key,
          count: arr.length,
          avg_opportunity: Number(avgOpp.toFixed(4)),
          avg_confidence: Number(avgConf.toFixed(4)),
          symbols: arr
            .sort((a, b) => b.capital_priority_score - a.capital_priority_score)
            .slice(0, 12)
            .map((node) => node.symbol),
        } satisfies BrainNodeCluster;
      })
      .sort((a, b) => b.avg_opportunity - a.avg_opportunity);
  };

  return {
    by_sector: build(nodes, (node) => (node.sector ?? "unknown").toLowerCase(), "sector"),
    by_regime: build(nodes, (node) => (node.regime ?? "unknown").toLowerCase(), "regime"),
    by_status: build(nodes, (node) => node.status.toLowerCase(), "status"),
  };
}

export async function getBrainNodeRelationships(symbolRaw?: string, limit = 250): Promise<BrainNodeRelation[]> {
  const normalizedSymbol = String(symbolRaw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  let rows: Array<typeof brainRelationsTable.$inferSelect> = [];

  if (normalizedSymbol) {
    const entityRows = await db
      .select({ id: brainEntitiesTable.id })
      .from(brainEntitiesTable)
      .where(eq(brainEntitiesTable.symbol, normalizedSymbol))
      .orderBy(desc(brainEntitiesTable.updated_at))
      .limit(1);

    if (entityRows.length === 0) return [];

    const entityId = entityRows[0].id;
    rows = await db
      .select()
      .from(brainRelationsTable)
      .where(
        or(
          eq(brainRelationsTable.source_entity_id, entityId),
          eq(brainRelationsTable.target_entity_id, entityId),
        ),
      )
      .orderBy(desc(brainRelationsTable.created_at))
      .limit(limit);
  } else {
    rows = await db
      .select()
      .from(brainRelationsTable)
      .orderBy(desc(brainRelationsTable.created_at))
      .limit(limit);
  }

  if (rows.length === 0) return [];

  const ids = Array.from(
    new Set(rows.flatMap((row) => [row.source_entity_id, row.target_entity_id])),
  );
  const entities = await db
    .select({ id: brainEntitiesTable.id, symbol: brainEntitiesTable.symbol })
    .from(brainEntitiesTable)
    .where(inArray(brainEntitiesTable.id, ids));

  const symbolById = new Map<number, string>();
  for (const entity of entities) {
    symbolById.set(entity.id, String(entity.symbol ?? "").toUpperCase());
  }

  return rows.map((row) => ({
    id: row.id,
    source_symbol: symbolById.get(row.source_entity_id) ?? `ENTITY_${row.source_entity_id}`,
    target_symbol: symbolById.get(row.target_entity_id) ?? `ENTITY_${row.target_entity_id}`,
    relation_type: String(row.relation_type ?? "related"),
    strength: Number(parseDbNum(row.strength, 0.5).toFixed(4)),
    context_json: row.context_json ? String(row.context_json) : null,
    created_at: new Date(row.created_at ?? new Date()).toISOString(),
  }));
}

function safeJsonParse(input: string | null): Record<string, unknown> | null {
  if (!input) return null;
  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getBrainNodeDrilldown(
  symbolRaw: string,
  options?: { memoryLimit?: number; eventLimit?: number; decisionLimit?: number },
): Promise<BrainNodeDrilldown | null> {
  const symbol = String(symbolRaw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!symbol) return null;

  const node = await getBrainNode(symbol);
  if (!node) return null;

  const memoryLimit = Math.max(1, Math.min(200, options?.memoryLimit ?? 25));
  const eventLimit = Math.max(1, Math.min(300, options?.eventLimit ?? 80));
  const decisionLimit = Math.max(1, Math.min(200, options?.decisionLimit ?? 40));

  const entityRows = await db
    .select({ id: brainEntitiesTable.id })
    .from(brainEntitiesTable)
    .where(eq(brainEntitiesTable.symbol, symbol))
    .orderBy(desc(brainEntitiesTable.updated_at))
    .limit(1);

  const entityId = entityRows[0]?.id;

  type MemoryRow = {
    id: number;
    memory_type: string | null;
    title: string | null;
    content: string | null;
    confidence: unknown;
    outcome_score: unknown;
    tags: string | null;
    created_at: Date | null;
  };
  type EventRow = {
    id: number;
    event_type: string | null;
    decision_state: string | null;
    reason: string | null;
    payload_json: string | null;
    created_at: Date | null;
  };
  type DecisionRow = {
    id: number;
    setup_type: string | null;
    direction: string | null;
    regime: string | null;
    approved: boolean;
    win_probability: unknown;
    final_quality: unknown;
    edge_score: unknown;
    kelly_fraction: unknown;
    confluence_score: unknown;
    gate_action: string | null;
    gate_block_reasons: string | null;
    rejection_reason: string | null;
    created_at: Date | null;
  };

  const [memoriesRaw, relationships, eventsRaw, decisionsRaw] = await Promise.all([
    entityId
      ? db
          .select({
            id: brainMemoriesTable.id,
            memory_type: brainMemoriesTable.memory_type,
            title: brainMemoriesTable.title,
            content: brainMemoriesTable.content,
            confidence: brainMemoriesTable.confidence,
            outcome_score: brainMemoriesTable.outcome_score,
            tags: brainMemoriesTable.tags,
            created_at: brainMemoriesTable.created_at,
          })
          .from(brainMemoriesTable)
          .where(eq(brainMemoriesTable.entity_id, entityId))
          .orderBy(desc(brainMemoriesTable.created_at))
          .limit(memoryLimit)
      : Promise.resolve<MemoryRow[]>([]),
    getBrainNodeRelationships(symbol, 120),
    db
      .select({
        id: auditEventsTable.id,
        event_type: auditEventsTable.event_type,
        decision_state: auditEventsTable.decision_state,
        reason: auditEventsTable.reason,
        payload_json: auditEventsTable.payload_json,
        created_at: auditEventsTable.created_at,
      })
      .from(auditEventsTable)
      .where(eq(auditEventsTable.symbol, symbol))
      .orderBy(desc(auditEventsTable.created_at))
      .limit(eventLimit),
    db
      .select({
        id: siDecisionsTable.id,
        setup_type: siDecisionsTable.setup_type,
        direction: siDecisionsTable.direction,
        regime: siDecisionsTable.regime,
        approved: siDecisionsTable.approved,
        win_probability: siDecisionsTable.win_probability,
        final_quality: siDecisionsTable.final_quality,
        edge_score: siDecisionsTable.edge_score,
        kelly_fraction: siDecisionsTable.kelly_fraction,
        confluence_score: siDecisionsTable.confluence_score,
        gate_action: siDecisionsTable.gate_action,
        gate_block_reasons: siDecisionsTable.gate_block_reasons,
        rejection_reason: siDecisionsTable.rejection_reason,
        created_at: siDecisionsTable.created_at,
      })
      .from(siDecisionsTable)
      .where(eq(siDecisionsTable.symbol, symbol))
      .orderBy(desc(siDecisionsTable.created_at))
      .limit(decisionLimit),
  ]) as [MemoryRow[], BrainNodeRelation[], EventRow[], DecisionRow[]];

  const memories = memoriesRaw.map((row: MemoryRow) => ({
    id: row.id,
    memory_type: String(row.memory_type ?? "unknown"),
    title: String(row.title ?? ""),
    content: String(row.content ?? ""),
    confidence: Number(clamp(parseDbNum(row.confidence)).toFixed(4)),
    outcome_score: row.outcome_score == null ? null : Number(parseDbNum(row.outcome_score).toFixed(4)),
    tags: row.tags ? String(row.tags) : null,
    created_at: new Date(row.created_at ?? new Date()).toISOString(),
  }));

  const recent_events = eventsRaw.map((row: EventRow) => ({
    id: row.id,
    event_type: String(row.event_type ?? "unknown"),
    decision_state: row.decision_state ? String(row.decision_state) : null,
    reason: row.reason ? String(row.reason) : null,
    payload: safeJsonParse(row.payload_json ? String(row.payload_json) : null),
    created_at: new Date(row.created_at ?? new Date()).toISOString(),
  }));

  const recent_decisions = decisionsRaw.map((row: DecisionRow) => ({
    id: row.id,
    setup_type: String(row.setup_type ?? "unknown"),
    direction: String(row.direction ?? "long"),
    regime: String(row.regime ?? "mixed"),
    approved: Boolean(row.approved),
    win_probability: Number(clamp(parseDbNum(row.win_probability)).toFixed(4)),
    final_quality: Number(clamp(parseDbNum(row.final_quality)).toFixed(4)),
    edge_score: Number(clamp(parseDbNum(row.edge_score)).toFixed(4)),
    kelly_fraction: Number(clamp(parseDbNum(row.kelly_fraction), 0, 1.5).toFixed(4)),
    confluence_score: Number(coerceConfluence(parseDbNum(row.confluence_score)).toFixed(4)),
    gate_action: row.gate_action ? String(row.gate_action) : null,
    gate_block_reasons: row.gate_block_reasons ? String(row.gate_block_reasons) : null,
    rejection_reason: row.rejection_reason ? String(row.rejection_reason) : null,
    created_at: new Date(row.created_at ?? new Date()).toISOString(),
  }));

  const structure = recent_decisions.length > 0
    ? recent_decisions.reduce((sum: number, row) => sum + row.final_quality, 0) / recent_decisions.length
    : node.confidence_score;
  const microstructure = recent_decisions.length > 0
    ? recent_decisions.reduce((sum: number, row) => sum + row.confluence_score, 0) / recent_decisions.length
    : 0;
  const recall = memories.length > 0
    ? memories.reduce((sum: number, row) => sum + row.confidence, 0) / memories.length
    : 0;
  const intelligence = recent_decisions.length > 0
    ? recent_decisions.reduce((sum: number, row) => sum + row.win_probability, 0) / recent_decisions.length
    : node.confidence_score;
  const blocked = recent_events.filter((event: { event_type: string }) =>
    event.event_type === "signal_rejected" || event.event_type === "execution_gate_blocked",
  ).length;
  const risk = clamp(1 - blocked / Math.max(1, recent_events.length));

  return {
    node,
    memories,
    relationships,
    recent_events,
    recent_decisions,
    layer_scores: {
      structure: Number(clamp(structure).toFixed(4)),
      microstructure: Number(clamp(microstructure).toFixed(4)),
      recall: Number(clamp(recall).toFixed(4)),
      intelligence: Number(clamp(intelligence).toFixed(4)),
      risk: Number(risk.toFixed(4)),
    },
  };
}

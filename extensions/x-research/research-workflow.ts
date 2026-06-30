import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getXaiModel, runXaiText, runXaiWebSearch, runXSearch, type XaiResult } from "./xai.js";

export type ResearchOptions = {
  question: string;
  fromDate?: string;
  toDate?: string;
  angles: number;
  cwd: string;
  signal?: AbortSignal;
  onPhase?: (phase: string) => void;
};

type QuerySpec = { query: string; purpose?: string };
type Plan = { x_queries: QuerySpec[]; web_queries: QuerySpec[]; risks?: string[] };
type EvidenceItem = {
  id: string;
  source_type: "x_search" | "web_search";
  query: string;
  purpose?: string;
  text: string;
  citations: string[];
};

type SavedRun = {
  runId: string;
  runDir: string;
  reportPath: string;
  evidencePath: string;
  rawPath: string;
};

export type ResearchRunResult = SavedRun & {
  question: string;
  report: string;
  plan: Plan;
  evidence: EvidenceItem[];
  skeptic: EvidenceItem[];
};

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // tolerate fenced or explained JSON
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    try {
      return JSON.parse(fenced.trim());
    } catch {
      // fall through
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error(`Expected JSON object, got:\n${text.slice(0, 1000)}`);
}

function normalizePlan(value: unknown, question: string, angles: number): Plan {
  const obj = (value && typeof value === "object" ? value : {}) as Partial<Plan>;
  const xQueries = Array.isArray(obj.x_queries) ? obj.x_queries : [];
  const webQueries = Array.isArray(obj.web_queries) ? obj.web_queries : [];
  const cleanQuery = (q: unknown): QuerySpec | undefined => {
    if (typeof q === "string") return { query: q };
    if (!q || typeof q !== "object") return undefined;
    const o = q as Record<string, unknown>;
    return typeof o.query === "string" ? { query: o.query, purpose: typeof o.purpose === "string" ? o.purpose : undefined } : undefined;
  };

  const x = xQueries.map(cleanQuery).filter((q): q is QuerySpec => Boolean(q)).slice(0, Math.max(1, angles));
  const web = webQueries.map(cleanQuery).filter((q): q is QuerySpec => Boolean(q)).slice(0, Math.max(1, Math.ceil(angles / 2)));
  if (!x.length) x.push({ query: question, purpose: "core X discussion" });
  return { x_queries: x, web_queries: web, risks: Array.isArray(obj.risks) ? obj.risks.filter((r): r is string => typeof r === "string") : [] };
}

async function planQueries(opts: ResearchOptions): Promise<Plan> {
  const date = opts.fromDate || opts.toDate ? `Date range: ${opts.fromDate || "open"} to ${opts.toDate || "open"}` : "No explicit date range.";
  const result = await runXaiText(
    "You are a research planner. Return valid JSON only. Do not search. Produce query plans for X Search and Web Search.",
    `Question: ${opts.question}\n${date}\n\nReturn JSON with keys:\n- x_queries: array of {query, purpose}; ${opts.angles} diverse X searches.\n- web_queries: array of {query, purpose}; 1-3 corroborating web searches.\n- risks: array of likely research pitfalls.\n\nQueries should be specific, neutral, and evidence-seeking.`,
    opts.signal,
  );
  return normalizePlan(extractJsonObject(result.text), opts.question, opts.angles);
}

async function gatherEvidence(opts: ResearchOptions, plan: Plan): Promise<EvidenceItem[]> {
  let id = 0;
  const xTasks = plan.x_queries.map((q) => async (): Promise<EvidenceItem> => {
    const result = await runXSearch(
      {
        query: q.query,
        from_date: opts.fromDate,
        to_date: opts.toDate,
        enable_image_understanding: true,
      },
      opts.signal,
    );
    return toEvidence(++id, "x_search", q, result);
  });

  const webTasks = plan.web_queries.map((q) => async (): Promise<EvidenceItem> => {
    const result = await runXaiWebSearch({ query: q.query, enable_image_understanding: true }, opts.signal);
    return toEvidence(++id, "web_search", q, result);
  });

  return Promise.all([...xTasks, ...webTasks].map((task) => task()));
}

async function gatherSkepticEvidence(opts: ResearchOptions, evidence: EvidenceItem[]): Promise<EvidenceItem[]> {
  const evidenceSummary = evidence.map(({ id, source_type, query, text, citations }) => ({ id, source_type, query, text: text.slice(0, 1800), citations }));
  const skepticQuery =
    `Question: ${opts.question}\n\nExisting evidence JSON:\n${JSON.stringify(evidenceSummary)}\n\n` +
    "Find counter-evidence, missing narratives, contradictions, old/out-of-context claims, or signs that the X narrative is misleading. Return evidence, not generic criticism.";

  const [x, web] = await Promise.all([
    runXSearch({ query: skepticQuery, from_date: opts.fromDate, to_date: opts.toDate, enable_image_understanding: true }, opts.signal),
    runXaiWebSearch({ query: skepticQuery, enable_image_understanding: true }, opts.signal),
  ]);

  return [toEvidence(evidence.length + 1, "x_search", { query: "skeptic X search", purpose: "counter-evidence" }, x), toEvidence(evidence.length + 2, "web_search", { query: "skeptic web search", purpose: "counter-evidence" }, web)];
}

async function synthesize(opts: ResearchOptions, plan: Plan, evidence: EvidenceItem[], skeptic: EvidenceItem[]): Promise<string> {
  const payload = {
    question: opts.question,
    date_range: { from: opts.fromDate, to: opts.toDate },
    plan,
    evidence: evidence.map((e) => ({ ...e, text: e.text.slice(0, 2500) })),
    skeptic: skeptic.map((e) => ({ ...e, text: e.text.slice(0, 2500) })),
  };

  const result = await runXaiText(
    [
      "You are the final research synthesizer.",
      "Use ONLY the provided evidence JSON. Do not introduce facts from memory.",
      "Every concrete claim must cite evidence IDs like [E1] and include source URLs where available.",
      "If X evidence is thin, conflicted, sarcastic, coordinated, old, or unclear, say so plainly.",
    ].join("\n"),
    `Write a concise deep-research report. Include:\n- answer / executive summary\n- what X is saying\n- main narratives and counter-narratives\n- strongest evidence\n- contradictions/caveats\n- source list\n\nEvidence payload JSON:\n${JSON.stringify(payload)}`,
    opts.signal,
  );
  return result.text.trim();
}

function toEvidence(id: number, sourceType: "x_search" | "web_search", query: QuerySpec, result: XaiResult): EvidenceItem {
  return {
    id: `E${id}`,
    source_type: sourceType,
    query: query.query,
    purpose: query.purpose,
    text: result.text,
    citations: result.citations,
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "research";
}

async function saveRun(opts: ResearchOptions, result: Omit<ResearchRunResult, keyof SavedRun>): Promise<SavedRun> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "");
  const runId = `${stamp}-${slugify(opts.question)}`;
  const runDir = join(opts.cwd, ".pi", "x-research", "runs", runId);
  await mkdir(runDir, { recursive: true });

  const reportPath = join(runDir, "report.md");
  const evidencePath = join(runDir, "evidence.jsonl");
  const rawPath = join(runDir, "run.json");

  await writeFile(reportPath, result.report, "utf8");
  await writeFile(evidencePath, [...result.evidence, ...result.skeptic].map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
  await writeFile(rawPath, JSON.stringify({ ...result, model: getXaiModel() }, null, 2), "utf8");
  return { runId, runDir, reportPath, evidencePath, rawPath };
}

export async function runXResearchWorkflow(opts: ResearchOptions): Promise<ResearchRunResult> {
  opts.onPhase?.("plan");
  const plan = await planQueries(opts);

  opts.onPhase?.("gather");
  const evidence = await gatherEvidence(opts, plan);

  opts.onPhase?.("skeptic");
  const skeptic = await gatherSkepticEvidence(opts, evidence);

  opts.onPhase?.("synthesize");
  const report = await synthesize(opts, plan, evidence, skeptic);

  opts.onPhase?.("save");
  const saved = await saveRun(opts, { question: opts.question, report, plan, evidence, skeptic });
  return { ...saved, question: opts.question, report, plan, evidence, skeptic };
}

const XAI_BASE_URL = "https://api.x.ai/v1/responses";
const DEFAULT_MODEL = "grok-4.3";

export type Json = Record<string, unknown>;

export type XSearchParams = {
  query: string;
  from_date?: string;
  to_date?: string;
  allowed_x_handles?: string[];
  excluded_x_handles?: string[];
  enable_image_understanding?: boolean;
  enable_video_understanding?: boolean;
};

export type XaiWebSearchParams = {
  query: string;
  enable_image_understanding?: boolean;
  excluded_domains?: string[];
  allowed_domains?: string[];
};

export type XaiResult = {
  text: string;
  citations: string[];
  raw: Json;
};

export function getXaiApiKey(): string {
  const key = process.env.XAI_API_KEY || process.env.X_AI_API_KEY || process.env.ZAI_API_KEY;
  if (!key) throw new Error("Set XAI_API_KEY (also accepts X_AI_API_KEY or ZAI_API_KEY).");
  return key;
}

export function getXaiModel(): string {
  return process.env.X_RESEARCH_MODEL || process.env.XAI_MODEL || DEFAULT_MODEL;
}

export function cleanObject<T extends Json>(tool: T): T {
  return Object.fromEntries(Object.entries(tool).filter(([, value]) => value !== undefined)) as T;
}

export async function callXaiResponses(body: Json, signal?: AbortSignal): Promise<Json> {
  const res = await fetch(XAI_BASE_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${getXaiApiKey()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`xAI request failed: HTTP ${res.status}${text ? `\n${text}` : ""}`);
  }

  return (await res.json()) as Json;
}

function collectStrings(value: unknown, predicate: (s: string) => boolean, out = new Set<string>()): string[] {
  if (typeof value === "string") {
    if (predicate(value)) out.add(value);
    return [...out];
  }
  if (!value || typeof value !== "object") return [...out];
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, predicate, out);
    return [...out];
  }
  for (const item of Object.values(value as Record<string, unknown>)) collectStrings(item, predicate, out);
  return [...out];
}

export function extractOutputText(json: unknown): string {
  const chunks: string[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const obj = value as Record<string, unknown>;
    if (obj.type === "output_text" && typeof obj.text === "string") chunks.push(obj.text);
    if (obj.type === "message" && Array.isArray(obj.content)) visit(obj.content);
    for (const nested of Object.values(obj)) {
      if (nested && typeof nested === "object") visit(nested);
    }
  };
  visit(json);

  if (chunks.length) return chunks.join("\n\n").trim();
  const direct = (json as { output_text?: unknown } | undefined)?.output_text;
  return typeof direct === "string" ? direct.trim() : "";
}

export function extractCitationUrls(json: unknown): string[] {
  return collectStrings(json, (s) => /^https?:\/\//.test(s));
}

export function assertXSearchEvidence(json: Json, text: string): void {
  const urls = extractCitationUrls(json);
  const blob = JSON.stringify(json).toLowerCase();
  const hasXUrl = [...urls, text].some((s) => /https?:\/\/(x|twitter)\.com\//i.test(s));
  const hasXToolTrace =
    blob.includes("x_search") ||
    blob.includes("x_keyword_search") ||
    blob.includes("x_semantic_search") ||
    blob.includes("x_thread_fetch") ||
    blob.includes("server_side_tool_x_search");

  if (!hasXUrl && !hasXToolTrace) {
    throw new Error("x_search verification failed: no X URL/citation or X-search tool trace was present in the xAI response.");
  }
}

export async function runXaiText(system: string, user: string, signal?: AbortSignal): Promise<XaiResult> {
  const raw = await callXaiResponses(
    {
      model: getXaiModel(),
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
    signal,
  );
  return { raw, text: extractOutputText(raw), citations: extractCitationUrls(raw) };
}

export async function runXSearch(params: XSearchParams, signal?: AbortSignal): Promise<XaiResult> {
  if (params.allowed_x_handles?.length && params.excluded_x_handles?.length) {
    throw new Error("x_search cannot set both allowed_x_handles and excluded_x_handles.");
  }

  const tool = cleanObject({
    type: "x_search",
    from_date: params.from_date,
    to_date: params.to_date,
    allowed_x_handles: params.allowed_x_handles?.slice(0, 20),
    excluded_x_handles: params.excluded_x_handles?.slice(0, 20),
    enable_image_understanding: params.enable_image_understanding ?? true,
    enable_video_understanding: params.enable_video_understanding,
  });

  const raw = await callXaiResponses(
    {
      model: getXaiModel(),
      input: [
        {
          role: "system",
          content:
            "You are an evidence extraction worker. You MUST use X Search. Return concise evidence cards from X only: post/thread URL when available, author/handle when available, date when available, claim/observation, and reliability caveat. Do not answer from memory.",
        },
        { role: "user", content: params.query },
      ],
      tools: [tool],
    },
    signal,
  );

  const text = extractOutputText(raw);
  assertXSearchEvidence(raw, text);
  return { raw, text, citations: extractCitationUrls(raw) };
}

export async function runXaiWebSearch(params: XaiWebSearchParams, signal?: AbortSignal): Promise<XaiResult> {
  const filters = cleanObject({
    excluded_domains: params.excluded_domains,
    allowed_domains: params.allowed_domains,
  });
  const tool = cleanObject({
    type: "web_search",
    enable_image_understanding: params.enable_image_understanding,
    filters: Object.keys(filters).length ? filters : undefined,
  });

  const raw = await callXaiResponses(
    {
      model: getXaiModel(),
      input: [
        {
          role: "system",
          content:
            "You are an evidence extraction worker. You MUST use Web Search. Return concise evidence cards with source URLs, dates when available, concrete claims, and caveats. Do not answer from memory.",
        },
        { role: "user", content: params.query },
      ],
      tools: [tool],
    },
    signal,
  );

  return { raw, text: extractOutputText(raw), citations: extractCitationUrls(raw) };
}

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getXaiModel, runXaiWebSearch, runXSearch, type XaiWebSearchParams, type XSearchParams } from "./xai.js";

function includeRawDetails(): boolean {
  return process.env.X_RESEARCH_INCLUDE_RAW_DETAILS === "1";
}

function minimalDetails(result: { citations: string[]; toolUsage: unknown; raw: unknown }): Record<string, unknown> {
  return includeRawDetails() ? { citations: result.citations, toolUsage: result.toolUsage, raw: result.raw } : { citations: result.citations, toolUsage: result.toolUsage };
}

function formatResult(kind: "x_search" | "xai_web_search", result: { text: string; citations: string[] }): string {
  const citationBlock = result.citations.length
    ? `\n\nCitations discovered in raw response:\n${result.citations.map((u, i) => `${i + 1}. ${u}`).join("\n")}`
    : "";
  return `${kind} result from ${getXaiModel()}\n\n${result.text || "(No output text returned.)"}${citationBlock}`.trim();
}

export function createXSearchTool(): ToolDefinition {
  return defineTool({
    name: "x_search",
    label: "X Search",
    description:
      "Search X/Twitter via xAI native x_search. Use this for current X posts, threads, narratives, accounts, and cited social evidence. Sends the query to xAI.",
    promptSnippet: "Search X/Twitter with xAI native x_search",
    parameters: Type.Object({
      query: Type.String({ description: "Natural-language X research query or keyword search intent." }),
      from_date: Type.Optional(Type.String({ description: "Start date, YYYY-MM-DD." })),
      to_date: Type.Optional(Type.String({ description: "End date, YYYY-MM-DD." })),
      allowed_x_handles: Type.Optional(Type.Array(Type.String(), { description: "Only consider these X handles, max 20." })),
      excluded_x_handles: Type.Optional(Type.Array(Type.String(), { description: "Exclude these X handles, max 20." })),
      enable_image_understanding: Type.Optional(Type.Boolean({ description: "Allow Grok to inspect images in X posts." })),
      enable_video_understanding: Type.Optional(Type.Boolean({ description: "Allow Grok to inspect videos in X posts." })),
    }),
    async execute(_id, params: XSearchParams, signal) {
      const result = await runXSearch(params, signal);
      return { content: [{ type: "text", text: formatResult("x_search", result) }], details: minimalDetails(result) };
    },
  }) as unknown as ToolDefinition;
}

export function createXaiWebSearchTool(): ToolDefinition {
  return defineTool({
    name: "xai_web_search",
    label: "xAI Web Search",
    description:
      "Search the web via xAI native web_search using the same xAI API key. Use for non-X context and corroboration. allowed_domains and excluded_domains are mutually exclusive, max 5 each.",
    promptSnippet: "Search the web with xAI native web_search",
    parameters: Type.Object({
      query: Type.String({ description: "Web research query." }),
      enable_image_understanding: Type.Optional(Type.Boolean({ description: "Allow Grok to inspect images found while browsing." })),
      excluded_domains: Type.Optional(Type.Array(Type.String(), { description: "Domains to exclude; mutually exclusive with allowed_domains; max 5." })),
      allowed_domains: Type.Optional(Type.Array(Type.String(), { description: "Restrict search to these domains; mutually exclusive with excluded_domains; max 5." })),
    }),
    async execute(_id, params: XaiWebSearchParams, signal) {
      const result = await runXaiWebSearch(params, signal);
      return { content: [{ type: "text", text: formatResult("xai_web_search", result) }], details: minimalDetails(result) };
    },
  }) as unknown as ToolDefinition;
}

export function createXResearchTools(): ToolDefinition[] {
  return [createXSearchTool(), createXaiWebSearchTool()];
}

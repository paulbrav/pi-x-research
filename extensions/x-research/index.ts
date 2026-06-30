import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runXResearchWorkflow } from "./research-workflow.js";
import { createXResearchTools } from "./xai-tools.js";

type ParsedArgs =
  | {
      ok: true;
      question: string;
      fromDate?: string;
      toDate?: string;
      angles: number;
    }
  | { ok: false; error: string };

function tokenize(args: string): string[] {
  return args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((t) => t.replace(/^(["'])(.*)\1$/, "$2")) ?? [];
}

function isDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function requireFlagValue(tokens: string[], index: number, flag: string): string | { error: string } {
  const value = tokens[index + 1];
  if (!value || value.startsWith("--")) return { error: `${flag} requires a value.` };
  return value;
}

function parseArgs(args: string): ParsedArgs {
  const tokens = tokenize(args);
  const rest: string[] = [];
  let fromDate: string | undefined;
  let toDate: string | undefined;
  let angles = 4;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--from") {
      const value = requireFlagValue(tokens, i, "--from");
      if (typeof value !== "string") return { ok: false, error: value.error };
      fromDate = value;
      i++;
    } else if (t.startsWith("--from=")) fromDate = t.slice("--from=".length);
    else if (t === "--to") {
      const value = requireFlagValue(tokens, i, "--to");
      if (typeof value !== "string") return { ok: false, error: value.error };
      toDate = value;
      i++;
    } else if (t.startsWith("--to=")) toDate = t.slice("--to=".length);
    else if (t === "--angles") {
      const value = requireFlagValue(tokens, i, "--angles");
      if (typeof value !== "string") return { ok: false, error: value.error };
      angles = Number(value);
      i++;
    } else if (t.startsWith("--angles=")) angles = Number(t.slice("--angles=".length));
    else rest.push(t);
  }

  if (fromDate && !isDateString(fromDate)) return { ok: false, error: `Invalid --from date: ${fromDate}. Use YYYY-MM-DD.` };
  if (toDate && !isDateString(toDate)) return { ok: false, error: `Invalid --to date: ${toDate}. Use YYYY-MM-DD.` };
  if (fromDate && toDate && fromDate > toDate) return { ok: false, error: `--from (${fromDate}) must be on or before --to (${toDate}).` };
  if (!Number.isFinite(angles) || angles < 1 || angles > 8) return { ok: false, error: "--angles must be an integer from 1 to 8." };

  return { ok: true, question: rest.join(" ").trim(), fromDate, toDate, angles: Math.floor(angles) };
}

function reportIntro(result: { runId: string; reportPath: string; evidencePath: string; rawPath: string; report: string }): string {
  return [`# X Research`, ``, `Run: ${result.runId}`, `Report: ${result.reportPath}`, `Evidence: ${result.evidencePath}`, `Run JSON: ${result.rawPath}`, ``, result.report].join("\n");
}

export default function (pi: ExtensionAPI) {
  if (process.env.X_RESEARCH_REGISTER_TOOLS === "1") {
    for (const tool of createXResearchTools()) pi.registerTool(tool);
  }

  pi.registerCommand("x-research", {
    description: "Deep research using xAI native X Search plus xAI Web Search. Usage: /x-research [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--angles N] <question>",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const parsed = parseArgs(args);
      if (!parsed.ok) {
        ctx.ui.notify(parsed.error, "warning");
        return;
      }
      if (!parsed.question) {
        ctx.ui.notify("Usage: /x-research [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--angles N] <question>", "warning");
        return;
      }

      ctx.ui.notify("Running X research with xAI x_search…", "info");
      try {
        const result = await runXResearchWorkflow({
          question: parsed.question,
          fromDate: parsed.fromDate,
          toDate: parsed.toDate,
          angles: parsed.angles,
          cwd: (ctx as { cwd?: string }).cwd ?? process.cwd(),
          onPhase: (phase) => ctx.ui.setStatus("x-research", phase),
        });
        ctx.ui.setStatus("x-research", undefined);
        void pi.sendMessage({ customType: "x-research", content: reportIntro(result), display: true });
      } catch (error) {
        ctx.ui.setStatus("x-research", undefined);
        ctx.ui.notify(`x-research failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.on("session_start", (_event, ctx) => {
    if (!ctx?.hasUI) return;
    const hasKey = Boolean(process.env.XAI_API_KEY || process.env.X_AI_API_KEY);
    const tools = process.env.X_RESEARCH_REGISTER_TOOLS === "1" ? "+tools" : "command-only";
    ctx.ui.setStatus("x-research", hasKey ? `𝕏 XAI_API_KEY set (${tools})` : "𝕏 set XAI_API_KEY");
  });
}

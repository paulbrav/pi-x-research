import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { runXResearchWorkflow } from "./research-workflow.js";
import { createXResearchTools } from "./xai-tools.js";

type ParsedArgs = {
  question: string;
  fromDate?: string;
  toDate?: string;
  angles: number;
};

function parseArgs(args: string): ParsedArgs {
  const tokens = args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((t) => t.replace(/^(["'])(.*)\1$/, "$2")) ?? [];
  const rest: string[] = [];
  let fromDate: string | undefined;
  let toDate: string | undefined;
  let angles = 4;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--from") fromDate = tokens[++i];
    else if (t.startsWith("--from=")) fromDate = t.slice("--from=".length);
    else if (t === "--to") toDate = tokens[++i];
    else if (t.startsWith("--to=")) toDate = t.slice("--to=".length);
    else if (t === "--angles") angles = Number(tokens[++i] ?? angles);
    else if (t.startsWith("--angles=")) angles = Number(t.slice("--angles=".length));
    else rest.push(t);
  }

  if (!Number.isFinite(angles) || angles < 1) angles = 4;
  angles = Math.min(Math.max(Math.floor(angles), 1), 8);
  return { question: rest.join(" ").trim(), fromDate, toDate, angles };
}

function reportIntro(result: { runId: string; reportPath: string; evidencePath: string; rawPath: string; report: string }): string {
  return [`# X Research`, ``, `Run: ${result.runId}`, `Report: ${result.reportPath}`, `Evidence: ${result.evidencePath}`, `Raw: ${result.rawPath}`, ``, result.report].join("\n");
}

export default function (pi: ExtensionAPI) {
  for (const tool of createXResearchTools()) pi.registerTool(tool);

  pi.registerCommand("x-research", {
    description: "Deep research using xAI native X Search plus xAI Web Search. Usage: /x-research [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--angles N] <question>",
    async handler(args: string, ctx: ExtensionCommandContext) {
      const parsed = parseArgs(args);
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
          cwd: process.cwd(),
          onPhase: (phase) => ctx.ui.setStatus("x-research", phase),
        });
        ctx.ui.setStatus("x-research", undefined);
        await pi.sendMessage({ customType: "x-research", content: reportIntro(result), display: true });
      } catch (error) {
        ctx.ui.setStatus("x-research", undefined);
        ctx.ui.notify(`x-research failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.on("session_start" as any, ((_event: unknown, ctx: any) => {
    if (!ctx?.hasUI) return;
    const hasKey = Boolean(process.env.XAI_API_KEY || process.env.X_AI_API_KEY || process.env.ZAI_API_KEY);
    ctx.ui.setStatus("x-research", hasKey ? "𝕏 x_search ready" : "𝕏 set XAI_API_KEY");
  }) as any);
}

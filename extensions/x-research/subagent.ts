import { join } from "node:path";
import type { AssistantMessage, Model, TextContent } from "@earendil-works/pi-ai";
import {
  AuthStorage,
  type CreateAgentSessionOptions,
  createAgentSession,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { Static, TSchema } from "typebox";
import { Check, Convert } from "typebox/value";
import { getXaiModel } from "./xai.js";

export type SubagentOptions<TSchemaDef extends TSchema | undefined = undefined> = {
  label: string;
  cwd: string;
  prompt: string;
  tools?: ToolDefinition[];
  schema?: TSchemaDef;
  signal?: AbortSignal;
  instructions?: string;
  model?: string;
  session?: Partial<CreateAgentSessionOptions>;
};

export type SubagentResult<TSchemaDef extends TSchema | undefined = undefined> = TSchemaDef extends TSchema ? Static<TSchemaDef> : string;

type StructuredCapture<T> = { called: boolean; value: T | undefined };

function defaultAgentModelSpec(): string {
  return process.env.X_RESEARCH_AGENT_MODEL || `xai/${getXaiModel()}`;
}

function createStructuredOutputTool<TSchemaDef extends TSchema>(schema: TSchemaDef, capture: StructuredCapture<Static<TSchemaDef>>): ToolDefinition<TSchemaDef, Static<TSchemaDef>> {
  return defineTool({
    name: "structured_output",
    label: "Structured Output",
    description: "Return the final machine-readable result for this subagent task.",
    promptSnippet: "Return final machine-readable output",
    promptGuidelines: [
      "structured_output is the final answer channel for this task; call it exactly once when done.",
      "Do not write a prose final answer after calling structured_output.",
    ],
    parameters: schema,
    async execute(_toolCallId, params) {
      capture.called = true;
      capture.value = params;
      return { content: [{ type: "text", text: "Structured output received." }], details: params, terminate: true };
    },
  });
}

function findJsonBlock(text: string): string | undefined {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  const start = text.search(/[{[]/);
  if (start === -1) return undefined;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return text.slice(start, i + 1);
  }
  return undefined;
}

function extractValidated<T>(text: string, schema: TSchema): T | undefined {
  const json = findJsonBlock(text);
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json);
    const converted = Convert(schema, parsed);
    return Check(schema, converted) ? (converted as T) : undefined;
  } catch {
    return undefined;
  }
}

function lastAssistantText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i] as Partial<AssistantMessage> | undefined;
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    const text = message.content
      .filter((part): part is TextContent => part.type === "text")
      .map((part) => part.text)
      .join("");
    if (text.trim()) return text;
  }
  return "";
}

function buildPrompt(opts: SubagentOptions<TSchema | undefined>, structured: boolean): string {
  const parts = [
    "You are a subagent inside a deterministic deep-research workflow. The orchestrator does not see this conversation — only your final result is returned. Do the work with the tools provided, return concise evidence-grounded findings, do not ask the user questions, and do not assume parent context not included in this prompt.",
    opts.instructions,
    `Task label: ${opts.label}`,
    opts.prompt,
  ].filter(Boolean);

  if (structured) {
    parts.push(
      [
        "Final output contract:",
        "- Your final action MUST be a structured_output tool call.",
        "- The structured_output arguments are the return value of this subagent.",
        "- Do not emit a prose final answer instead of structured_output.",
        "- If you need to use search tools first, do so, then call structured_output exactly once.",
      ].join("\n"),
    );
  }

  return parts.join("\n\n");
}

class ModelResolver {
  private registry?: ModelRegistry;

  constructor(private readonly agentDir: string) {}

  private getRegistry(): ModelRegistry {
    if (!this.registry) {
      const auth = AuthStorage.create(join(this.agentDir, "auth.json"));
      this.registry = ModelRegistry.create(auth, join(this.agentDir, "models.json"));
    }
    return this.registry;
  }

  resolve(spec: string): Model<any> | undefined {
    const registry = this.getRegistry();
    const slash = spec.indexOf("/");
    if (slash > 0) return registry.find(spec.slice(0, slash), spec.slice(slash + 1));
    return registry.getAvailable().find((m) => m.id === spec) ?? registry.getAll().find((m) => m.id === spec);
  }
}

export class ResearchSubagentRunner {
  private readonly agentDir = getAgentDir();
  private readonly resolver = new ModelResolver(this.agentDir);

  async run<TSchemaDef extends TSchema | undefined = undefined>(opts: SubagentOptions<TSchemaDef>): Promise<SubagentResult<TSchemaDef>> {
    const capture: StructuredCapture<unknown> = { called: false, value: undefined };
    const customTools = [...(opts.tools ?? [])];
    if (opts.schema) customTools.push(createStructuredOutputTool(opts.schema, capture as StructuredCapture<any>) as unknown as ToolDefinition);

    const requestedModel = opts.model || defaultAgentModelSpec();
    const resolvedModel = this.resolver.resolve(requestedModel);
    if (!resolvedModel && process.env.X_RESEARCH_REQUIRE_AGENT_MODEL === "1") {
      throw new Error(`Could not resolve Pi model ${requestedModel}. Configure xAI in Pi or set X_RESEARCH_AGENT_MODEL.`);
    }

    const { session } = await createAgentSession({
      cwd: opts.cwd,
      agentDir: this.agentDir,
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.create(opts.cwd, this.agentDir),
      customTools,
      ...opts.session,
      ...(resolvedModel ? { model: resolvedModel } : {}),
    });

    let removeAbortListener: (() => void) | undefined;
    try {
      if (opts.signal?.aborted) throw new Error("Subagent was aborted");
      if (opts.signal) {
        const onAbort = () => void session.abort();
        opts.signal.addEventListener("abort", onAbort, { once: true });
        removeAbortListener = () => opts.signal?.removeEventListener("abort", onAbort);
      }

      await session.prompt(buildPrompt(opts as SubagentOptions<TSchema | undefined>, Boolean(opts.schema)));
      if (opts.signal?.aborted) throw new Error("Subagent was aborted");

      if (opts.schema) {
        if (capture.called) return capture.value as SubagentResult<TSchemaDef>;
        const text = lastAssistantText(session.messages);
        const extracted = extractValidated<Static<NonNullable<TSchemaDef>>>(text, opts.schema);
        if (extracted !== undefined) return extracted as SubagentResult<TSchemaDef>;
        throw new Error(`Subagent ${opts.label} did not return valid structured_output.`);
      }

      const text = lastAssistantText(session.messages);
      if (!text.trim()) throw new Error(`Subagent ${opts.label} produced no assistant output.`);
      return text as SubagentResult<TSchemaDef>;
    } finally {
      removeAbortListener?.();
      session.dispose();
    }
  }
}

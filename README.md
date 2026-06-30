# pi-x-research

Standalone [Pi](https://pi.dev) extension for deep research over X and the web using xAI's native `x_search` and `web_search` tools.

It adds one command:

```text
/x-research [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--angles N] <question>
```

## Research workflow

```mermaid
flowchart TD
  A[User runs /x-research question] --> B[Validate flags and date range]
  B --> C[Planner subagent<br/>create X, web, and skeptic queries]
  C --> D1[Parallel X research subagents<br/>must call x_search]
  C --> D2[Parallel web research subagents<br/>must call xai_web_search]
  D1 --> E[Evidence cards<br/>IDs, query, citations, caveats]
  D2 --> E
  E --> F[Skeptic subagents<br/>counter-narrative and contradiction searches]
  F --> G[Final synthesis]
  E --> G
  G --> H[Report citing evidence IDs only]
  H --> I[Private local artifacts<br/>.pi/x-research/runs/run_id]
```

The command runs an evidence-first workflow using full Pi subagents:

1. validates input and date flags;
2. spawns a planner subagent to plan X/web/skeptic queries;
3. spawns parallel research subagents; X workers must call the `x_search` tool;
4. spawns parallel web corroboration subagents; web workers must call `xai_web_search`;
5. spawns skeptic subagents for counter-evidence and contradictions;
6. spawns a synthesis subagent that writes only from returned evidence cards;
7. saves artifacts under `.pi/x-research/runs/<run_id>/` with private file permissions.

Search failures are recorded as failed evidence items where possible instead of aborting the whole run.

## Install

From GitHub:

```bash
pi install git:github.com/paulbrav/pi-x-research
```

Or test without installing permanently:

```bash
pi -e git:github.com/paulbrav/pi-x-research
```

## Configuration

Set an xAI API key:

```bash
export XAI_API_KEY=...
```

Optional aliases/settings:

```bash
# accepted key alias
export X_AI_API_KEY=...

# search model used inside the x_search/xai_web_search tools
export X_RESEARCH_MODEL=grok-4.3

# Pi subagent model; defaults to xai/$X_RESEARCH_MODEL
export X_RESEARCH_AGENT_MODEL=xai/grok-4.3
```

Do **not** pass other providers' API keys. The extension always calls xAI's endpoint: `https://api.x.ai/v1/responses`.

By default the package exposes only the `/x-research` command. If you also want the current Pi agent to be able to call standalone search tools, opt in explicitly:

```bash
export X_RESEARCH_REGISTER_TOOLS=1
```

That registers:

- `x_search`
- `xai_web_search`

Raw provider payloads are not returned in tool details by default. To include them for debugging:

```bash
export X_RESEARCH_INCLUDE_RAW_DETAILS=1
```

## Usage

```text
/x-research --from 2026-06-23 --to 2026-06-30 what are people on X saying about <topic>
```

Artifacts are written to:

```text
.pi/x-research/runs/<opaque_run_id>/
  report.md
  evidence.jsonl
  run.json
```

## Package manifest

Pi loads the extension from `package.json`:

```json
{
  "pi": {
    "extensions": ["extensions/x-research/index.ts"]
  }
}
```

## Development

```bash
npm install
npm run check
pi -e ./extensions/x-research/index.ts
```

## Security and privacy

Pi extensions run with your user permissions. Review source before installing any third-party Pi package.

This extension:

- sends research prompts, generated queries, and retrieved evidence to xAI;
- stores local reports/evidence under `.pi/x-research/runs/` with `0700` directories and `0600` files;
- does not intentionally write API keys to artifacts;
- treats X posts and web pages as untrusted quoted data during synthesis;
- registers no global network tools unless `X_RESEARCH_REGISTER_TOOLS=1` is set.

If you opt into global tools, any Pi agent in that session can send tool input to xAI. Do not enable that in untrusted repositories or sessions containing secrets.

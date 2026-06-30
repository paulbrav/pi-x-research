# pi-x-research

Standalone [Pi](https://pi.dev) extension for deep research over X and the web using xAI's native `x_search` and `web_search` tools.

It adds one command:

```text
/x-research [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--angles N] <question>
```

The command runs an evidence-first research workflow:

1. plan X/web queries;
2. gather X evidence with native xAI `x_search`;
3. gather corroborating web evidence with native xAI `web_search`;
4. run a skeptic/counter-evidence pass;
5. synthesize a cited report from evidence only;
6. save artifacts under `.pi/x-research/runs/<run_id>/`.

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

Optional model override:

```bash
export X_RESEARCH_MODEL=grok-4.3
```

For typo-tolerance the extension also accepts `X_AI_API_KEY` and `ZAI_API_KEY`, but it always calls xAI's endpoint: `https://api.x.ai/v1/responses`.

## Usage

```text
/x-research --from 2026-06-23 --to 2026-06-30 what are people on X saying about <topic>
```

Artifacts are written to:

```text
.pi/x-research/runs/<run_id>/
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

## Security

Pi extensions run with your user permissions. Review source before installing any third-party Pi package. This extension sends research prompts and retrieved evidence to xAI.

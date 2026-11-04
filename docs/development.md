# Development guide

LearnHarness is a Next.js application with an Electron desktop host. Teaching and practice use native Pi agents and server-owned conversation records; the browser projects those records into the transcript, docks and knowledge graph.

Start here for local work. The [architecture reference](architecture.md) describes the shipped runtime and its boundaries; [prompt composition](../src/agent/prompts/README.md) describes source fragments and user overrides. Older vision/build-plan documents record design history, not the current implementation contract.

## Setup and commands

Use a current Node.js/npm installation compatible with the lockfile and native dependencies. CI and release builds use **Node 26**. From the repository root:

```bash
npm ci                 # install the locked dependencies
npm run dev            # Next development server, normally http://localhost:3000

npm run build          # production Next build, including standalone output
npm start              # serve the production build with Next

npm run desktop:dev    # Next dev + Electron pointed at localhost:3000
```

No API key is required just to start the UI. Model calls are provisioned through the Vercel AI SDK and [AI Gateway](https://vercel.com/docs/ai-gateway). Set `AI_GATEWAY_API_KEY` for local and non-Vercel hosts; a Vercel deployment can use OIDC instead. Choose strong, cheap, and vision slots from gateway model ids (`creator/model`). There are no factory model choices. Per-provider API keys, the custom OpenAI-compatible endpoint, and ChatGPT/Codex or other subscription logins do not authenticate these calls. Existing sessions keep their explicit conversation model; background roles use their own settings resolution.

For local signed macOS packaging, `npm run desktop:dist` runs the build, runtime smoke/assembly checks and Electron Builder with the configured signing/notarization setup. It is not a portable unsigned-build shortcut. See [desktop release](desktop-release.md) for prerequisites, target-OS builds, Windows/Linux packages and release verification.

## Configuration and credentials

Non-secret preferences live in `data/settings.json` (or the directory selected by `LH_DATA_DIR`). The record stores explicit deltas; absent fields resolve through `src/core/settings.ts` and `src/core/settings-resolution.ts`. Model slots/overrides are settings, not environment variables. Prompt override files live under that same data root, with explicit switches in `agent.prompts`.

Secrets and machine-specific paths may be supplied through the process environment or `.env.local` in ordinary Next development. Supported API keys can also be managed in Settings. The key seam reads the configured auth file and reflects saved values at runtime; a real environment value takes precedence over the saved file value.

| Configuration | Purpose |
|---|---|
| `AI_GATEWAY_API_KEY` | Provisions model calls through the Vercel AI Gateway. Optional on Vercel, where OIDC can authenticate instead. |
| `DEEPSEEK_API_KEY` | Owner DeepSeek key. Trial calls to DeepSeek send it as gateway BYOK so they spend DeepSeek credits. If it is unset, the gateway uses a DeepSeek credential already saved on the AI Gateway dashboard. |
| `TRIAL_INVITE_CODE` | The one university-trial invite. Absent means nobody can redeem it. Shorter than 8 characters is refused. |
| `STRIPE_RESTRICTED_ACCESS_KEY` | Optional restricted key (`rk_…`) with Billing meter events write. Treat it as a secret: keep it out of logs, commits, and shared channels. Sent on gateway requests so AI Gateway can emit `token-billing-tokens` events. Not used to create charges here. The trial does not create a price or a student billing product. |
| Profile `stripeCustomerId` | Optional `cus_…` on a profile, set by the admin. Sent as `stripe-customer-id` for that profile's model calls. Both Stripe headers must be present or the gateway does not meter the request. |
| `TAVILY_API_KEY` / `BRAVE_API_KEY` | Optional search adapters. Research remains available without a search key and can fetch known URLs. |
| `DEEPGRAM_API_KEY` | Optional dictation: short-lived token minting on the server; audio streams directly from the browser to Deepgram. |
| `CHROME_PATH` | Optional Chrome/Chromium executable fallback for demo verification. The Electron browser helper is primary; no extra Chromium is downloaded. PDFs/SVGs use native rendering. |
| `LH_DATA_DIR` | Relocates mutable chats, jobs, graph, settings and prompt overrides; default is repo `data/`. |
| `LH_AUTH_FILE` | Relocates the API-key/custom-endpoint credential file; default is repo-root `auth.json`, separate from `data/`. |

The packaged desktop host sets its own data/auth locations under Electron `userData`; it does not use the repository's development profile. Auth files are owner-only plaintext, not an encrypted vault. Keep `.env.local`, auth/connection files and learning data out of commits and build artifacts. Do not copy a personal profile into fixtures or a reproduction workspace.

Provider-specific references:

- [Claude Code](claude-code.md): opt-in local CLI setup, native authentication, process/tool bridge and session lifecycle. Its CLI authentication is not configured by adding an ordinary LearnHarness API key.
- [Custom providers](custom-providers.md): the supported OpenAI-compatible endpoint editor, authentication binding, models and limits.
- [Compaction and accounting](compaction-accounting.md): context fitting, usage and current-catalog pricing. There is no generated local rate-table maintenance step.

### Subscription connections in web/dev

Ordinary `npm run dev` and `npm start` support ChatGPT, GitHub Copilot and Grok in Settings → Providers. `npm run desktop:dev` uses those same dev-server connections; packaged desktop uses its separate main-process credential owner and private transport. Subscription routes do not silently fall back to API-key billing.

Web/dev stores `chatgpt-credentials.json`, `github-copilot-credentials.json` and `xai-credentials.json` **beside the configured `auth.json`**: in the project directory by default, or the directory containing `LH_AUTH_FILE`. They are not under `data/`, packaged Application Support or a global Pi profile. Git/build exclusions cover the credential files and their atomic-write temporary files. Use only one server process per credential directory; refresh serialization is process-local.

Sign-in opens a tab in the browser that initiated it; allow that tab if blocked. **Complete ChatGPT sign-in in a browser on the server's machine**, because the callback listener is `127.0.0.1` on that machine. Copilot/Grok use device codes. The Electron dev shell opens provider pages in the system browser. Credentials/refresh remain server-owned; other browsers connected to the same server share its connections and background-use consent, just as they share its keys and learning data.

This is a **trusted local/shared developer-server mode**, not multi-user hosting. Same-origin JSON/custom-header checks and short-lived, origin-bound, one-use browser-opening actions prevent ordinary cross-origin browser controls. They are **not user authentication or DNS-rebinding protection**. Subscription support does not change Next's listening/LAN behavior. Do not expose the server to untrusted users or the public Internet without an independent access/host gate. Remote ChatGPT callback routing, per-provider accounts per profile and credential import are not implemented.

### Profiles

Opening the app shows a profile select screen. Each profile keeps its own learner records under `<data dir>/users/<id>/` (chats, graph, jobs, `settings.json`, prompt overrides, debug logs). Install-wide files stay at the data-dir root: `users.json` (the profiles), `host.json` (restricted sign-ups), `sessions.json` (which browser has which profile open), `trial.json` (the university-trial redemption), and the model cache. API keys and subscription credentials are household-wide: every profile uses the same ones. The first profile created is the only admin; on an install that already has records, it claims them (they move into its folder). Without `users.json` the install is unclaimed and learner paths resolve to the data-dir root, which is what tests and the pre-profiles layout rely on.

Profiles are **local profiles, not accounts**. A profile's PIN only stops someone opening it through the app; it is stored in plain text and nothing is encrypted, so anyone with access to the data directory can read every profile. The network gate above still applies: profiles do not make it safe to expose the server to untrusted users.

### University trial

`TRIAL_INVITE_CODE` is one code, at least 8 characters. The owner profile has to exist first. Redeeming the code creates a member profile, not an admin, and pins the main agent and both support tiers to DeepSeek V4.1 Flash (`deepseek/deepseek-v4.1-flash`) through the AI Gateway. Those calls send `DEEPSEEK_API_KEY` as request-scoped BYOK when the key is set, so they spend the owner's DeepSeek credits. The same trial includes one GPT-Sol chat on `openai/gpt-6.1-sol`. That session ends when its first reply lands, or when the friend ends it. Until they sign up, further turns, new chats, and note imports are refused. The signup creates one Better Auth user and leaves public email signup disabled. It does not create a Stripe price or a student billing system. GPT-Sol is billed by the gateway; this app does not name a price for it.

## Source map

| Work area | Start with |
|---|---|
| Turn admission, persistence and live streams | `src/server/chat-handler.ts`, `turn-service.ts`, `turn-runs.ts`, `pi/ui-stream.ts` |
| Native input/record/UI projection | `src/core/input-events.ts`, `native-messages.ts`, `view.ts`; `components/session-core.ts` |
| Agent prompts and tool registries | `src/agent/teacher-agent.ts`, `prompt-segments.ts`, `tools.ts`, `tools/practice.ts` |
| Async workers and result delivery | `src/agent/subagents/runner.ts`, `src/server/jobs.ts` |
| Graph extraction, coverage and derivation | `src/agent/subagents/extraction.ts`, `src/core/coverage.ts`, `graph.ts` |
| Notes/PDF import and local conversion | `components/notes-import.tsx`, `app/api/graph/import/route.ts`, `src/agent/subagents/pdf-markdown.ts` |
| Stores and resolved settings | `src/server/stores.ts`, `src/store/`, `src/core/settings-resolution.ts` |
| Provider/model configuration | `src/agent/models.ts`, `src/server/model-catalog.ts`, linked provider references above |
| Push notifications | `src/core/events.ts`, `src/server/events-stream.ts`, `components/server-events.tsx` |
| Local stack (Mongo, Silo, PM2, agent) | `devenv/dev.sh`, `.envrc` |

PDF note imports use the same extraction pipeline after local conversion to page-marked Markdown by `src/agent/subagents/pdf-markdown.ts`.

The import law is the specific set of ESLint zones in `eslint.config.mjs`: shell imports into `src/` go through the designated barrels; core cannot import the IO layers; agents cannot import server/store adapters. It does not mechanically enforce every architectural convention. Read the relevant installed Next guide under `node_modules/next/dist/docs/` before changing framework-facing code.

## Data and safe local work

Chats are native conversation JSON, jobs are JSON, and the graph combines proposition/chain/checkpoint/coverage JSONL with JSON maps for sources and presentation state. Practice is conversational `kind: "practice"` chat history, not a separate problem-set database. See [storage and compatibility](architecture.md#8-storage-and-compatibility) before changing formats: chat versions, the graph-family sidecar and settings versions have different read/write policies.

For an isolated reproduction, create a disposable data directory and a separate empty `{}` auth file, then set both paths for the process you launch:

```bash
LH_DATA_DIR=/absolute/path/to/scratch/data \
LH_AUTH_FILE=/absolute/path/to/scratch/auth.json \
npm run dev -- --port 3001
```

Those two variables isolate app records and saved API keys, **not every external effect**. Ambient provider environment variables still win; subscription files follow the auth directory; Claude Code can use its native CLI authentication/profile. Learner file tools are read-only but resolve relative/default paths against the server user's home and can read outside the app data directory. An isolated data root is not a filesystem or credential sandbox. Use fake providers/fixtures for automated reproduction and avoid ambient credentials or personal files.

Normal development does not require importing/backfilling a personal corpus. Maintenance helpers under `scripts/` may write the selected data root or invoke model stages; inspect their current implementation and wiring before use rather than treating historical comments as a safe migration recipe. Do not run a separate writer against a live profile. Store-module initialization can itself have effects (including removal of retired graph ledgers), so use fixtures/copies rather than importing production stores to inspect irreplaceable data.

`LH_PROVIDER_EVENTS=1` enables raw provider-event debugging under the selected data root. These traces can contain lesson/provider content; treat them as private diagnostic data, not routine logs to publish.

For background-worker behavioral inspection, use `LH_BACKGROUND_CAPTURE=auditor`, a comma-separated role list such as `auditor,extractor`, or `all`. This covers the shared worker runner (`researcher`, `demoBuilder`, `extractor`, `auditor`) and the separate image-in-the-loop workers (`visualMaker`, `pdfReader`), not foreground teaching/probing. For example:

```bash
LH_BACKGROUND_CAPTURE=auditor npm run desktop:dev
```

The flag must reach the **Next server** process; `desktop:dev` starts both Next and Electron with it. Restart an existing server to change the flag. Captures are off by default and written locally to `<data root>/debug/background-captures/<role>-<run ID>.json`, one file per worker run. Each model turn replaces the previous request body and reply; the final file retains the last request, its final assistant response/error, and its tool results. Earlier tool calls/results and returned thinking remain in the conversation replayed by that last request. Compact per-turn timings remain without duplicated request bodies.

`request.format` is `provider` when the adapter exposes its outgoing payload (after the app's final subscription-body restrictions, including ChatGPT's developer-role/tool-namespace rewrite), or `context` for the model-facing conversation when it does not (for example, CLI adapters). The latter is not an HTTP wire capture. Captures do not enable thinking or recover reasoning a provider does not return. Configure model/thinking settings normally. Request options, credentials and HTTP headers are not recorded; recognized credential/header fields nested in payloads are redacted. Files are owner-only on POSIX systems. Serialization/disk errors do not fail workers. Captures contain private source/graph content, have no automatic expiry, and should be reviewed before sharing and deleted manually when no longer needed. This flag does not change model selection, instructions, retries or timeouts.

## Adding a language

English is the source of truth; anything untranslated falls back to it.

1. **Register it** in `APP_LANGUAGES` (`src/core/i18n.ts`): id, native label, Deepgram dictation code.
2. **UI copy** — copy `src/core/i18n/es/` to `src/core/i18n/<id>/` (one file per surface, typed against the English keys) and add it to `DICTIONARIES`.
3. **Teacher prompts** — mirror `src/agent/prompts/` under `src/agent/prompts/locales/<id>/` (plus `system-prompt.md`). Translate prose only: tool names, backticked identifiers and markers stay verbatim.
4. **Worker prompts** — add `src/agent/subagents/locales/<id>.ts` and register it in `worker-prompts.ts`; add an `<id>` entry to the `Localized` maps (compaction prompts in `src/core/compaction.ts` and `src/server/compaction.ts`).
5. **Run `npm test`** — the dictionary and prompt-coverage tests list anything missing or any identifier lost in translation.

## Checks

```bash
npm test               # node:test via tsx: injected engines, fixtures and fake transports; throwaway data dir
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint, including import restrictions
npm run build          # Next production build
```

The suite does not require paid models or real account sign-in. Tests cover pure domain logic, native turn/session flows, delivery recovery, extraction/import, conversational practice, provider fixtures, rendering and stored-data compatibility. Some tests use filesystem/native-process or local fake-endpoint seams; “offline” is not a promise that every test is a pure function. Review a focused suite's setup before running it alongside a live app.

Golden data under `tests/fixtures/golden-data/` is copied into disposable roots and read through production paths. Keep intentional format changes and fixture expectations together; follow the fixture README rather than editing saved records to make a test pass.

Additional runtime gates are separate from ordinary model use:

- `node scripts/smoke-web-subscriptions.mjs` — after a build, with no dev server running; launches isolated Next start/dev checks with synthetic credentials and external traffic blocked. It briefly changes/restores a source mtime to exercise reload behavior.
- `node scripts/smoke-provider-runtime.mjs` — after a build; checks traced provider payload/runtime behavior with fixtures. Packaging invokes it too.
- Other `scripts/smoke-*.mjs` cover standalone/native renderers, compression, file paths and opening flows. Consult their prerequisites and [desktop release](desktop-release.md) before running packaging checks.

These checks prove the exercised fixture/runtime contracts, not real provider entitlements or the quality of model-authored lessons. For frontend failures, reproduce through the actual UI and inspect runtime requests/console/state rather than inferring success from a static render alone.

## Lineage

The teaching methodology grew from an Obsidian-based proof of concept. The harness began with Pi, moved to a standalone Next.js/AI SDK design, and now uses native Pi records, agents and events with its own browser projection. [Architecture](architecture.md) is the current reference; [the engine-swap document](pi-engine-swap.md) records an earlier transition, not today's wire contract. License and contributor acknowledgements remain in the [repository README](../README.md).

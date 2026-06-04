# AGENTS.md

## Project

Node 24 + TypeScript 5 Telegram chatbot. Receives updates via **Fastify webhook** (not polling). Answers natural language by routing through **OpenRouter function calling** against a pluggable **ToolRegistry**. Persists users, conversations, and messages in **remote PostgreSQL** via Prisma.

---

## Commands

```bash
npm run dev          # Run with tsx (no compile step)
npm run build        # tsc → dist/
npm start            # node dist/main.js (production)
npm test             # vitest run (all tests, one-shot)
npm run test:watch   # vitest watch mode
npm run db:migrate   # prisma migrate dev (requires live DATABASE_URL)
npm run db:generate  # prisma generate (schema → TS types, no DB needed)
```

**Single test file:**
```bash
npm test -- tests/services/llm.test.ts
npm test -- tests/tools/
```

**Type check without emitting:**
```bash
npx tsc --noEmit
```

---

## Environment Variables (`.env`)

All validated at startup by Zod in `src/config/index.ts` — process exits if any required var is missing.

```
TELEGRAM_BOT_TOKEN=        # required
TELEGRAM_WEBHOOK_SECRET=   # required — validated on every incoming webhook request
WEBHOOK_URL=               # required — must be public HTTPS, e.g. https://your-domain.com
PORT=3000                  # default 3000
DATABASE_URL=              # required — remote PostgreSQL connection string
OPENROUTER_API_KEY=        # required
OPENROUTER_DEFAULT_MODEL=openai/gpt-4o-mini   # default
CONVERSATION_WINDOW_SIZE=20                    # default — sliding window message count
TOOL_ENDPOINT_ALLOWLIST=localhost:3000,api.open-meteo.com,api.geonames.org   # default localhost:<PORT>,api.open-meteo.com,api.geonames.org — comma-separated host:port allowlist for declarative tool endpoints
TOOL_VARS=                                     # optional JSON object of NON-SECRET {VAR} substitutions for declarative tools
                                               # e.g. TOOL_VARS={"GEONAMES_USERNAME":"your_username"} for cities_by_country tool
```

Copy `.env.example` to `.env` to start. The bot **auto-registers its own webhook** at startup via `bot.api.setWebhook(...)` — `WEBHOOK_URL` must be publicly reachable before running.

---

## First-Run Checklist

1. `cp .env.example .env` — fill in all required vars
2. `npm run db:migrate` — create tables in remote PostgreSQL
3. Start the bot: `npm run dev` or `npm start`
4. Send `/start` to the bot to create your `User` record
5. Whitelist yourself in the DB:
   ```sql
   UPDATE "User" SET "isAllowed" = true WHERE "telegramId" = <your_telegram_id>;
   ```

---

## Architecture

```
Telegram ──HTTPS webhook──▶ Fastify (:3000/webhook)
                                │
                           grammy Bot
                                │
                    WhitelistMiddleware  ← blocks isAllowed=false
                                │
              ┌─────────────────┼──────────────────┐
        MessageHandler    CommandHandlers     CallbackQueryHandler
              │                                     │ (menu items)
              └─────────────────┬───────────────────┘
                                │
                  ┌─────────────┴─────────────┐
           ConversationService           LLMService
           (sliding window)          (OpenRouter loop)
                  │                       │
             Prisma ORM              ToolRegistry
                  │                  (pluggable)
              PostgreSQL
```

**Startup order in `src/main.ts`:**
1. `import './tools/index.js'` — registers all tools (**must be first import**)
2. `prisma.$connect()` — exits process on failure
3. `createBot()` → `createServer(bot)`
4. `bot.api.setWebhook(...)` — registers webhook with Telegram
5. `server.listen(...)` — starts Fastify

---

## Source Layout

```
src/
├── config/
│   ├── index.ts        # Zod env validation + menuConfig loader
│   └── menu.json       # Menu button definitions (edit without code changes)
├── db/
│   └── client.ts       # Prisma singleton (globalThis pattern)
├── tools/
│   ├── types.ts        # Tool / ToolCall / ToolResult interfaces
│   ├── registry.ts     # ToolRegistry class + singleton export (register() throws on dup)
│   ├── executor.ts     # executeToolCalls() — runs tool_calls in parallel
│   ├── loader.ts       # buildToolFromSpec() + loadToolDefs() — declarative .yaml tools
│   ├── index.ts        # Registers code tools, then loadToolDefs() → add a tool here
│   ├── echo.ts         # Example code tool (dev/test only)
│   ├── defs/           # Declarative .yaml tool definitions (e.g. time_by_region.yaml, temp_by_region.yaml, cities_by_country.yaml)
│   └── transforms/     # Optional response transforms (default export (data)=>unknown)
├── services/
│   ├── user.ts         # getOrCreateUser, isUserAllowed
│   ├── conversation.ts # getOrCreateActive, getWindow, saveMessages, updateConversationModel
│   └── llm.ts          # chat() — OpenRouter + function-calling loop (max 5 iterations)
├── bot/
│   ├── index.ts        # createBot() — wires all middleware/commands/handlers
│   ├── middleware/
│   │   └── whitelist.ts
│   ├── commands/       # start, menu, reset, model, models, status
│   └── handlers/
│       ├── message.ts        # processMessage() — main LLM pipeline (also called by callbackQuery)
│       └── callbackQuery.ts  # inline button tap → menu item prompt
├── server/
│   └── index.ts        # Fastify + /webhook + /health
└── main.ts             # Entrypoint

tests/
├── tools/registry.test.ts
├── services/conversation.test.ts
├── services/llm.test.ts
└── middleware/whitelist.test.ts
```

---

## Database Schema

Three models in `prisma/schema.prisma`:

- **`User`** — `telegramId` (BigInt, unique), `isAllowed` (whitelist flag, default `false`)
- **`Conversation`** — per user, stores active `model` string; `/reset` creates a new one (old records preserved)
- **`Message`** — role: `user | assistant | system | tool`, `content: Text`

**Active conversation** = latest `Conversation` by `createdAt DESC LIMIT 1` per user.  
**Sliding window** = last N `Message` rows by `createdAt DESC` then reversed — all roles count toward N.

After schema changes: `npm run db:migrate` (creates migration + regenerates client).  
After pulling a migration someone else wrote: `npm run db:generate` to regenerate types only.

---

## Adding a Tool

There are two ways to add a tool. Prefer the **declarative `.yaml`** path for anything
that is "call an HTTP endpoint, map params, shape the response". Use the **code** path
only when you need real logic that no HTTP call can express (the `echo` tool is the
canonical code example).

### A. Declarative `.yaml` tool (preferred)

Drop a `.yaml` file in `src/tools/defs/`. It is loaded at startup by `loadToolDefs()`
(wired in `src/tools/index.ts`). The whole file is a single YAML document declaring the
tool; the `response_guidance` field becomes the tool's `responseGuidance`.

```yaml
name: my_tool                 # required, /^[a-z][a-z0-9_]*$/, unique across ALL tools
description: When the LLM should call this and what it returns.   # required
endpoint: http://localhost:{PORT}/api/thing   # required; {VAR} from the subst allowlist
method: GET                   # GET|POST|PUT|PATCH|DELETE (default GET)
timeout_ms: 5000              # default 5000, capped at 15000
success_status: [200]         # optional; default = any 2xx
content_type: application/json # default; sent only when body params exist
headers:                      # optional static headers; values allow {VAR} (allowlist)
  X-Trace: "{PORT}"
parameters:                   # flat map paramName -> spec
  region:
    type: string              # string|number|integer|boolean|array
    description: IANA timezone name.   # required
    required: true            # default false
    in: query                 # query|path|body|header (default query)
    enum: ["a", "b"]          # optional
    default: x                # optional
    items_type: string        # required iff type=array
response:
  pick: [region, datetime]    # optional response field whitelist
transform: time               # optional; module in src/tools/transforms/ (no extension)
optional: true                # optional; if true, load failure only warns instead of process.exit(1)
                              # use when the tool requires an external account (e.g. GEONAMES_USERNAME)
response_guidance: >-         # optional; injected as a system message after the tool
  How the LLM should phrase the final answer using the tool's result.
```

Restart to load (`.yaml` and `.yml` are both picked up). Any parse/validation error
logs the offending file and exits the process. Mark a tool `optional: true` to
downgrade load failures to warnings (e.g. when the tool needs a `TOOL_VARS` key like
`GEONAMES_USERNAME` that may not be set).

**Transforms** — for value reshaping that needs real code (e.g. reformatting an ISO
datetime), create `src/tools/transforms/<name>.ts` with a default export
`(data: unknown) => unknown` and reference it via `transform: <name>`. It runs after
the HTTP response is parsed (and after `response.pick`, if set).

**Security / allowlist (enforced by the loader):**
- The endpoint host:port (after `{VAR}` substitution AND after runtime param
  substitution) must be in `TOOL_ENDPOINT_ALLOWLIST` (comma-separated, default
  `localhost:<PORT>,api.open-meteo.com,api.geonames.org`). Non-http(s) schemes and URLs with embedded credentials are rejected.
- `{VAR}` tokens resolve ONLY from the secret-safe substitution allowlist
  (`getToolSubstitutionVars()` → `{ PORT, ...TOOL_VARS }`). An unknown token fails at
  load time — secrets like `OPENROUTER_API_KEY` are never substitutable.
- Put secrets only in `headers`, only via `TOOL_VARS` — never in query/path.

### B. Code tool

Use when logic can't be a declarative HTTP call. `register()` throws on a duplicate name.

1. Create `src/tools/your_tool.ts`:

```typescript
import type { Tool } from './types.js';

export const yourTool: Tool = {
  name: 'your_tool',
  description: 'What it does and when the LLM should call it.',
  parameters: {
    type: 'object',
    properties: {
      param: { type: 'string', description: '...' },
    },
    required: ['param'],
  },
  async execute(args) {
    const { param } = args as { param: string };
    return { result: '...' };
  },
};
```

2. Register it in `src/tools/index.ts` (code tools register BEFORE `loadToolDefs()`):

```typescript
toolRegistry.register(yourTool);
```

3. Restart. No other changes needed.

**Tool errors:** `executor.ts` wraps failures in `{ error: "..." }` JSON and returns them to the LLM — the LLM explains the failure to the user. Tool errors do not crash the process.

---

## Menu System

`src/config/menu.json` — edit at runtime, server restart picks up changes:

```json
{
  "items": [
    { "id": "unique_id", "label": "Button label", "prompt": "Prompt sent to LLM" }
  ]
}
```

`/menu` shows inline keyboard buttons. Each tap calls `processMessage()` with the item's `prompt` — same LLM + function-calling pipeline as a normal text message.

---

## Testing Conventions

- **Framework:** Vitest v2 (`"type": "module"` ESM project)
- **No real DB or network in tests** — Prisma and `fetch` are always mocked via `vi.mock()`
- `vi.mock()` calls are hoisted by Vitest — place them before imports
- Config is mocked per file: `vi.mock('../../src/config/index.js', () => ({ config: { ... } }))`
- Tests live in `tests/` mirroring `src/` structure with `.test.ts` suffix

---

## TypeScript Conventions

- **`"module": "NodeNext"`** — all local imports **must use `.js` extension** (even for `.ts` source files):
  ```typescript
  import { foo } from './foo.js';   // ✅
  import { foo } from './foo';      // ❌ fails at runtime
  ```
- `"strict": true` — no `as any`, no `@ts-ignore`
- When registering a grammy handler with `bot.on('callback_query:data', handler)`, type the context as `Context` not `CallbackQueryContext<Context>` — the filtered context type has an incompatible `match` property
- JSON files are loaded via `readFileSync` + `JSON.parse` (not `import ... with { type: 'json' }`) for ESM compatibility

---

## Key Gotchas

- **`src/tools/index.js` must be the first import in `main.ts`** — tools must be registered before `createBot()` calls `toolRegistry.toFunctionDefinitions()`
- **`config` calls `process.exit(1)` on import if env vars are missing** — tests that import any service must mock `../../src/config/index.js`
- **No polling mode** — bot only works via webhook; `WEBHOOK_URL` must be a live HTTPS endpoint at startup
- **Webhook secret validated on every request** in `src/server/index.ts` via `x-telegram-bot-api-secret-token` header
- **`prisma generate` works offline** — only needs `prisma/schema.prisma`, no DB connection; `prisma migrate dev` needs a live DB
- **`prisma migrate dev` also regenerates the client** — no need to run `db:generate` separately after a migration

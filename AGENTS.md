# AGENTS.md

## Project

Node 24 + TypeScript 5 Telegram chatbot. Receives updates via **Fastify webhook** (not polling). Answers natural language by routing through **OpenRouter function calling** against a pluggable **ToolRegistry**. Persists users, conversations, messages, and **menu items** in **remote PostgreSQL** via Prisma.

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

No lint/format script or config exists in this repo — don't guess an `npm run lint`; `tsc --noEmit` is the only verification step besides tests.

**Local webhook dev:** `WEBHOOK_URL` must be a live public HTTPS URL at startup (bot calls `setWebhook` immediately). Use `ngrok http 3000` (see `NGROK.md`) and set `WEBHOOK_URL` to the resulting `https://*.ngrok-free.app` URL before starting the bot.

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

## Logging

Log files are written to `./logs/` using **winston** + `winston-daily-rotate-file`.

| File | Description |
|------|-------------|
| `logs/chatbot-project.log` | Symlink → today's log file. Use for `tail -f` monitoring. |
| `logs/chatbot-project-YYYY-MM-DD.log` | Date-stamped actual file. Rotated daily at midnight. Kept for 30 days. |

**Format:** `YYYY-MM-DD HH:mm:ss [LEVEL] message`  
**Levels:** INFO, WARN, ERROR  
**Rotation:** New file created at 00:00 (server timezone). Previous day's file is preserved with its date suffix.

```bash
tail -f logs/chatbot-project.log          # live monitoring
cat logs/chatbot-project-2026-06-05.log   # specific day
```

The `logs/` directory is gitignored. It is created automatically on first run.

---

```
Telegram ──HTTPS webhook──▶ Fastify (:3000/webhook)
                                │
                           grammy Bot
                                │
                    WhitelistMiddleware  ← blocks isAllowed=false
                                │
              ┌─────────────────┼──────────────────┐
        MessageHandler    CommandHandlers     CallbackQueryHandler
              │                                     │ (menu/result/action)
              └─────────────────┬───────────────────┘
                                │
                  ┌─────────────┴─────────────┐
           ConversationService           LLMService
           (sliding window)          (OpenRouter loop)
                  │                       │
             Prisma ORM              ToolRegistry
                  │                  (pluggable)
               PostgreSQL
           (User, Conversation,
            Message, MenuItem)
```

**Startup order in `src/main.ts`:**
1. `import './tools/index.js'` — registers all tools (**must be first import**)
2. `prisma.$connect()` — exits process on failure
3. `seedDefaultMenus()` — idempotent seed; creates default menu tree if `MenuItem` table is empty
4. `createBot()` → `createServer(bot)`
5. `bot.api.setWebhook(...)` — registers webhook with Telegram
6. `server.listen(...)` — starts Fastify

---

## Source Layout

```
src/
├── config/
│   ├── index.ts        # Zod env validation + menuConfig loader
│   └── menu.json       # Legacy menu button definitions (superseded by DB MenuItem)
├── db/
│   └── client.ts       # Prisma singleton (globalThis pattern)
├── logger.ts           # winston logger (file rotation + console)
├── tools/
│   ├── types.ts        # Tool / ToolCall / ToolResult / ToolContent interfaces
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
│   ├── llm.ts          # chat() — OpenRouter + function-calling loop (max 5 iterations)
│   └── menu.ts         # getRootMenuItems, getChildren, getMenuItemById, seedDefaultMenus
├── bot/
│   ├── index.ts        # createBot() — wires all middleware/commands/handlers
│   ├── middleware/
│   │   └── whitelist.ts
│   ├── commands/       # start, menu, reset, model, models, status
│   └── handlers/
│       ├── message.ts        # processMessage() — main LLM pipeline (also called by callbackQuery)
│       ├── callbackQuery.ts  # menu:/result:/action:/back:/close dispatch → DB MenuItem routing
│       ├── menuNav.ts        # single menu message: view snapshot stack + edit/close helpers
│       └── menuHelpers.ts    # parseListFromLLMResponse, row/view builders, callToolPrompt
├── server/
│   └── index.ts        # Fastify + /webhook + /health + /api/get-time-by-region
└── main.ts             # Entrypoint

tests/
├── bot/menuHelpers.test.ts
├── bot/menuNav.test.ts
├── bot/callbackQuery.test.ts
├── tools/registry.test.ts
├── tools/executor.test.ts
├── tools/loader.test.ts
├── tools/time.test.ts
├── tools/temperature.test.ts
├── tools/cities.test.ts
├── services/conversation.test.ts
├── services/llm.test.ts
├── services/menu.test.ts
├── middleware/whitelist.test.ts
└── server/
    ├── time.test.ts
    └── route.test.ts
```

---

## Database Schema

Four models in `prisma/schema.prisma`:

- **`User`** — `telegramId` (BigInt, unique), `isAllowed` (whitelist flag, default `false`)
- **`Conversation`** — per user, stores active `model` string; `/reset` creates a new one (old records preserved)
- **`Message`** — role: `user | assistant | system | tool`, `content: Text`
- **`MenuItem`** — hierarchical menu tree; see [Menu System](#menu-system) below

**Active conversation** = latest `Conversation` by `createdAt DESC LIMIT 1` per user.  
**Sliding window** = last N `Message` rows by `createdAt DESC` then reversed — all roles count toward N.

After schema changes: `npm run db:migrate` (creates migration + regenerates client).  
After pulling a migration someone else wrote: `npm run db:generate` to regenerate types only.

> **Note:** The remote DB user may not have shadow DB privileges required by `prisma migrate dev`.  
> Use `prisma db push` as a workaround: syncs schema directly without a shadow DB.

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

**Tool errors:** `executor.ts` wraps failures in `ToolCallResult { content, isError: true }` and returns them to the LLM — the LLM explains the failure to the user. Tool errors do not crash the process.

---

## Menu System

Menus are stored in **PostgreSQL** (`MenuItem` table) and support an n-depth hierarchical tree with dynamic, tool-driven items.

### MenuItem model

| Field | Type | Description |
|-------|------|-------------|
| `id` | Int PK | Auto-increment |
| `label` | String | Button display text |
| `parentId` | Int? | `null` = root item |
| `sortOrder` | Int | Display order within siblings |
| `isActive` | Boolean | Hidden when `false` |
| `actionType` | String | `submenu` \| `tool` \| `prompt` \| `action` |
| `actionValue` | String | Depends on `actionType` (see below) |
| `resultSubmenuId` | Int? | When `actionType=tool`: submenu shown after a dynamic result button is tapped |

### actionType semantics

| actionType | actionValue format | Behavior |
|------------|-------------------|----------|
| `submenu` | `""` | Show child MenuItems as inline keyboard buttons |
| `tool` | `"toolName:arg"` e.g. `"cities_by_country:KR"` | Build a prompt → call LLM → tool executes → parse list from response → show as dynamic buttons. If `resultSubmenuId` set, each button leads to that submenu. |
| `prompt` | plain text | Call `processMessage(ctx, actionValue)` directly |
| `action` | text with `{value}` placeholder | Replace `{value}` with context (e.g. selected city), call `processMessage` |

### callback_data protocol (Telegram 64-byte limit)

| Format | Trigger | Handling |
|--------|---------|----------|
| `menu:{id}` | Static MenuItem tap | Look up MenuItem → dispatch on `actionType` |
| `result:{submenuId}:{value}` | Dynamic result button tap | Show `getChildren(submenuId)` as action buttons with `value` as context |
| `action:{menuItemId}:{value}` | Sub-action button tap | Substitute `{value}` in `actionValue` → `processMessage` |
| `back:{menuItemId}` | `⬅️ 이전` tap | Pop the snapshot stack → re-render the previous screen |
| `close` | `❌ 닫기` tap | Delete the menu message + drop its navigation state |
| `legacy_menu:{id}` | Old `menu.json` button tap | Backward compatibility |

Buttons whose `callback_data` would exceed 64 bytes are dropped at render time
(`buildDynamicRows` / `buildActionRows`) — a long UTF-8 `value` would otherwise be
rejected by Telegram.

### Single menu message + navigation stack

The menu lives in **one message**. `/menu` sends it (`sendView`) and every later
navigation **edits that same message** (`showView` → `editMessageText`), so the
previous screen is never left on screen. Because the message id never changes, it
keys the navigation state in `menuNav.ts`:

- `Map<"chatId:messageId", ViewSnapshot[]>`, max 500 sessions, 30-minute TTL, LRU eviction.
- A `ViewSnapshot` is the fully rendered screen (`title` + `rows`), so `⬅️ 이전`
  restores LLM-generated lists **without re-calling the LLM**.
- State lost (restart / TTL) → `back:{menuItemId}` falls back to rebuilding the
  nearest static ancestor from the DB; still no LLM call.

### Keyboard layout rules

```
[항목1] [항목2]
[항목3] [항목4]
[항목5]              ← odd tail sits alone
[⬅️ 이전] [❌ 닫기]   ← control row, always last, never mixed with items
```

- Menu items render **2 per row** (`chunkIntoRows`); control buttons get their own bottom row.
- Root screens show `❌ 닫기` only; every deeper screen shows `⬅️ 이전` + `❌ 닫기`.
- The menu **closes** (message deleted) when: `❌ 닫기` is tapped, `⬅️ 이전` is tapped
  with nothing left above, or a final step runs (`action` / `prompt` item, or a `tool`
  item whose result has no buttons to pick).
- While a `tool` item runs, the message is edited to `조회 중...` **without a keyboard**
  so buttons cannot be double-tapped; a failed tool call restores the previous screen
  with an error note prepended.

### Example flow: 국가 → 도시 → 기온/시간

```
/menu
  └─ 🌍 지역 날씨/시간 조회  [submenu]
       ├─ 🇰🇷 한국  [tool: cities_by_country:KR, resultSubmenuId=조회유형선택]
       ├─ 🇯🇵 일본  [tool: cities_by_country:JP, resultSubmenuId=조회유형선택]
       └─ 🇺🇸 미국  [tool: cities_by_country:US, resultSubmenuId=조회유형선택]
            ↓ LLM이 cities_by_country 툴 호출 → 도시 목록 파싱
       ├─ 서울  [result:조회유형선택ID:서울]
       ├─ 부산  [result:조회유형선택ID:부산]
       └─ ...
            ↓ 선택 시 조회 유형 서브메뉴 표시
       ├─ 🌡 기온 조회  [action: "{value}의 현재 기온을 알려줘"]
       └─ 🕐 시간 조회  [action: "{value}의 현재 시간을 알려줘"]
            ↓ {value}=서울 치환 후 processMessage → LLM 응답
```

### Seed data

`seedDefaultMenus()` in `src/services/menu.ts` runs at startup — idempotent (skips if any `MenuItem` exists). Seeds the above 국가→도시→기온/시간 tree as the default example.

### Adding menu items

Insert directly into the `MenuItem` table via SQL or any DB client — no code changes or restart required (items are loaded from DB on each `/menu` command).

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
- **`prisma migrate dev` requires shadow DB privileges** — if the DB user cannot create databases, use `npx prisma db push` instead (syncs schema without a shadow DB, no migration history)

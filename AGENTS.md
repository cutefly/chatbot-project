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
│   ├── registry.ts     # ToolRegistry class + singleton export
│   ├── executor.ts     # executeToolCalls() — runs tool_calls in parallel
│   ├── index.ts        # Registers all tools → import here to add a tool
│   └── echo.ts         # Example tool (dev/test only)
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

Tools are auto-discovered by the LLM at runtime — a precise `description` and `parameters` JSON Schema are critical for the LLM to call them correctly.

1. Create `src/tools/your_tool.ts`:

```typescript
import type { Tool } from './types.js';

export const yourTool: Tool = {
  name: 'your_tool',           // snake_case, unique
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
    return { result: '...' };  // returned as JSON string to the LLM
  },
};
```

2. Add one line to `src/tools/index.ts`:

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

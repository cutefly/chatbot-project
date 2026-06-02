# Telegram AI Chatbot — Design Spec

**Date:** 2026-06-02  
**Status:** Approved  
**Stack:** Node 24 + TypeScript 5 + grammy + Fastify + Prisma + PostgreSQL + OpenRouter

---

## 1. Overview

A Telegram chatbot that answers natural language queries by invoking backend tools/APIs via LLM function calling (OpenRouter). Supports a sliding conversation window, a whitelist-based access control, and a `/menu` command for pre-defined common queries.

---

## 2. Architecture

```
Telegram ←──── HTTPS webhook ────▶ Fastify Server
                                        │
                                   grammy Bot
                                        │
                   ┌────────────────────┼────────────────────┐
                   │                    │                     │
          WhitelistMiddleware    MessageHandler         CommandHandler
                   │                    │
                   └────────┬───────────┘
                            │
           ┌────────────────┼──────────────────┐
           │                │                  │
  ConversationService   LLMService         UserService
  (sliding window)    (OpenRouter +         (whitelist)
                       Tool loop)
           │                │
      Prisma ORM        ToolRegistry
           │           (pluggable tools)
      PostgreSQL
      (remote, via .env)
```

**Update mode:** Webhook (Fastify HTTP server receives Telegram push events)  
**Process management:** PM2 or systemd on always-on server

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Bot framework | grammy v1 (TypeScript-first) |
| HTTP server | Fastify v4 |
| ORM | Prisma v5 |
| Database | PostgreSQL 16 (remote) |
| LLM client | OpenRouter REST API (native fetch) |
| Config validation | Zod v3 |
| Runtime | Node 24 + TypeScript 5 |
| Dev runner | tsx v4 |
| Test runner | Vitest v1 |

---

## 4. Data Model

```prisma
model User {
  id             Int            @id @default(autoincrement())
  telegramId     BigInt         @unique
  username       String?
  firstName      String?
  isAllowed      Boolean        @default(false)
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
  conversations  Conversation[]
}

model Conversation {
  id        Int       @id @default(autoincrement())
  userId    Int
  user      User      @relation(fields: [userId], references: [id])
  model     String    @default("openai/gpt-4o-mini")
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  messages  Message[]
}

model Message {
  id             Int          @id @default(autoincrement())
  conversationId Int
  conversation   Conversation @relation(fields: [conversationId], references: [id])
  role           Role
  content        String       @db.Text
  createdAt      DateTime     @default(now())
}

enum Role {
  user
  assistant
  system
  tool
}
```

**Active conversation:** 1 per user — the latest `Conversation` record (ordered by `createdAt DESC LIMIT 1`).  
**`/reset`:** Creates a new `Conversation`; old records are preserved but no longer active.  
**Sliding window counting:** The last N messages by `createdAt` regardless of role (`user`, `assistant`, `tool`, `system`). Tool-result messages count toward the window to stay within token limits.

---

## 5. Environment Variables

```
# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=        # Fastify webhook validation

# Server
WEBHOOK_URL=https://your-domain.com/webhook
PORT=3000

# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# OpenRouter
OPENROUTER_API_KEY=
OPENROUTER_DEFAULT_MODEL=openai/gpt-4o-mini

# Conversation
CONVERSATION_WINDOW_SIZE=20     # Sliding window: last N messages sent to LLM
```

---

## 6. Message Processing Flow

### 6a. Natural Language Message

```
User message
    │
[WhitelistMiddleware]
    ├─ isAllowed=false → reply "접근 권한이 없습니다" and stop
    └─ isAllowed=true → continue
    │
[ConversationService.getOrCreateActive(telegramUserId)]
    └─ Creates User + Conversation on first contact
    │
[ConversationService.getWindow(conversationId, windowSize)]
    └─ Fetches last N messages (role + content)
    │
[LLMService.chat(model, history + userMessage, tools)]  ← 1st call
    │
    ├─ response has tool_calls?
    │       │
    │   [ToolExecutor.run(tool_calls)]
    │       └─ looks up tool in ToolRegistry → executes → returns result
    │       │
    │   [LLMService.chat(..., toolResults)]  ← 2nd call (can repeat)
    │       └─ final text response
    │
    └─ response is text → final response
    │
[DB] Save user message + assistant response (+ tool messages if any)
    │
Telegram reply (MarkdownV2)
```

### 6b. Menu Button Tap (`/menu` → callback_query)

```
User taps inline button
    │
[CallbackQueryHandler]
    └─ Looks up menu item by callback_data id
    └─ Substitutes prompt template
    │
→ Same pipeline as 6a (from WhitelistMiddleware onward)
```

---

## 7. Bot Commands

| Command | Action |
|---|---|
| `/start` | Welcome message + usage guide |
| `/menu` | Displays inline keyboard with pre-defined query shortcuts |
| `/reset` | Creates new Conversation (clears active context) |
| `/model <id>` | Changes model for current Conversation (e.g. `anthropic/claude-3-haiku`) |
| `/models` | Lists available OpenRouter models (curated subset) |
| `/status` | Shows current model + message count in active conversation |

---

## 8. Menu System

Menu items are defined in `src/config/menu.json`. No code changes needed to add/modify items.

```json
{
  "items": [
    { "id": "menu_item_1", "label": "예시 항목 1", "prompt": "..." },
    { "id": "menu_item_2", "label": "예시 항목 2", "prompt": "..." }
  ]
}
```

- Each item maps to a `callback_data` id.
- On tap, the `prompt` is sent through the standard LLM + function calling pipeline.
- Items are loaded at startup; server restart required to pick up changes.

---

## 9. Tool Registry

Tools are registered at startup and passed to the LLM as function definitions.

```typescript
// src/tools/types.ts
interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;       // Passed to OpenRouter as function schema
  execute(args: unknown): Promise<unknown>;
}
```

- Each tool lives in its own file under `src/tools/`.
- `src/tools/index.ts` imports all tools and registers them.
- New tool = new file + one import line in `index.ts`.
- An `echo` example tool is included for development/testing.

---

## 10. Error Handling

| Scenario | Behavior |
|---|---|
| OpenRouter API failure | Reply "잠시 후 다시 시도해주세요", log error, do NOT save messages |
| Tool execution failure | Return structured error to LLM; LLM replies with failure explanation |
| User not whitelisted | Reply with access-denied message; no further processing |
| DB connection failure at startup | Log fatal error, exit process |
| Telegram send failure | grammy retries once automatically |

---

## 11. Project Structure

```
src/
├── bot/
│   ├── index.ts              # grammy Bot instance + middleware registration
│   ├── middleware/
│   │   └── whitelist.ts
│   ├── commands/
│   │   ├── start.ts
│   │   ├── menu.ts           # /menu → inline keyboard
│   │   ├── reset.ts
│   │   ├── model.ts
│   │   ├── models.ts
│   │   └── status.ts
│   └── handlers/
│       ├── message.ts        # Natural language message handler
│       └── callbackQuery.ts  # Inline button tap handler
├── server/
│   └── index.ts              # Fastify + webhook endpoint + health check
├── services/
│   ├── conversation.ts
│   ├── llm.ts                # OpenRouter client + function calling loop
│   └── user.ts
├── tools/
│   ├── types.ts
│   ├── registry.ts
│   ├── executor.ts           # Dispatches tool_calls → ToolRegistry → results
│   ├── index.ts              # Registers all tools
│   └── echo.ts               # Example tool
├── db/
│   └── client.ts             # Prisma Client singleton
├── config/
│   ├── index.ts              # Env parsing + Zod validation
│   └── menu.json             # Menu item definitions
└── main.ts                   # Entrypoint: DB → bot → server

prisma/
├── schema.prisma
└── migrations/

tests/
├── services/
│   ├── conversation.test.ts
│   └── llm.test.ts
├── tools/
│   └── registry.test.ts
└── middleware/
    └── whitelist.test.ts
```

---

## 12. Testing Strategy

**Framework:** Vitest (Node 24 ESM compatible)

| Layer | Target | Approach |
|---|---|---|
| Unit | Services, ToolRegistry | Mock Prisma + fetch |
| Integration | Middleware, command handlers | grammy mock context |
| E2E (optional) | Full webhook → response | Real DB + OpenRouter sandbox |

**Key test cases:**
- Sliding window returns exactly N messages
- `/reset` creates new conversation, old history remains isolated
- `tool_calls` present → ToolExecutor called → 2nd LLM call made
- No `tool_calls` → single LLM call
- OpenRouter failure → error propagated, message not saved
- Unregistered tool → clear error thrown
- `isAllowed=false` → `next()` not called
- `isAllowed=true` → `next()` called

---

## 13. Out of Scope (for initial version)

- Admin UI for whitelist management (manage via DB directly or future `/admin` commands)
- Streaming responses (standard request/response only)
- Multi-language i18n
- Rate limiting per user
- Analytics dashboard

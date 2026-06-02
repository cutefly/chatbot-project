# Telegram AI Chatbot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Telegram chatbot that answers natural language queries via OpenRouter LLM function calling, with whitelist access control, sliding window conversation memory, and a configurable menu system.

**Architecture:** grammy bot receives updates via Fastify webhook; WhitelistMiddleware gates all requests; MessageHandler drives an OpenRouter function-calling loop that dispatches to a pluggable ToolRegistry; Prisma stores users, conversations, and messages in a remote PostgreSQL database.

**Tech Stack:** Node 24, TypeScript 5, grammy v1, Fastify v4, Prisma v5, PostgreSQL (remote), OpenRouter REST API, Zod v3, Vitest v1, tsx v4

---

## File Map

| File | Responsibility |
|---|---|
| `package.json` | Dependencies, scripts |
| `tsconfig.json` | TypeScript compiler config |
| `.env.example` | Env var template |
| `prisma/schema.prisma` | DB schema (User, Conversation, Message) |
| `src/config/index.ts` | Zod env validation + menu.json loader |
| `src/config/menu.json` | Menu item definitions (runtime-editable) |
| `src/db/client.ts` | Prisma Client singleton |
| `src/tools/types.ts` | Tool, ToolCall, ToolResult interfaces |
| `src/tools/registry.ts` | ToolRegistry class (register/lookup/list) |
| `src/tools/executor.ts` | Dispatches tool_calls array → results |
| `src/tools/echo.ts` | Example/test tool |
| `src/tools/index.ts` | Registers all tools into global registry |
| `src/services/user.ts` | getOrCreateUser, isUserAllowed |
| `src/services/conversation.ts` | getOrCreateActive, getWindow, saveMessages, updateModel |
| `src/services/llm.ts` | OpenRouter client + function-calling loop |
| `src/bot/middleware/whitelist.ts` | Blocks non-whitelisted users |
| `src/bot/commands/start.ts` | /start |
| `src/bot/commands/reset.ts` | /reset → new Conversation |
| `src/bot/commands/status.ts` | /status → model + message count |
| `src/bot/commands/model.ts` | /model <id> |
| `src/bot/commands/models.ts` | /models → curated list |
| `src/bot/commands/menu.ts` | /menu → inline keyboard |
| `src/bot/handlers/message.ts` | Natural language → LLM pipeline |
| `src/bot/handlers/callbackQuery.ts` | Inline button tap → menu item prompt |
| `src/bot/index.ts` | grammy Bot instance + wires all middleware/handlers |
| `src/server/index.ts` | Fastify server + /webhook + /health |
| `src/main.ts` | Entrypoint: DB → tools → bot → server → set webhook |
| `tests/tools/registry.test.ts` | ToolRegistry unit tests |
| `tests/services/conversation.test.ts` | ConversationService unit tests |
| `tests/services/llm.test.ts` | LLMService unit tests |
| `tests/middleware/whitelist.test.ts` | WhitelistMiddleware unit tests |

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "telegram-chatbot",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx src/main.ts",
    "build": "tsc",
    "start": "node dist/main.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate": "prisma migrate dev",
    "db:generate": "prisma generate"
  },
  "dependencies": {
    "grammy": "^1.35.0",
    "fastify": "^4.28.1",
    "@prisma/client": "^5.22.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.7.2",
    "tsx": "^4.19.2",
    "prisma": "^5.22.0",
    "vitest": "^2.1.8",
    "@types/node": "^22.10.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `.env.example`**

```
# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=

# Server
WEBHOOK_URL=https://your-domain.com
PORT=3000

# Database
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# OpenRouter
OPENROUTER_API_KEY=
OPENROUTER_DEFAULT_MODEL=openai/gpt-4o-mini

# Conversation
CONVERSATION_WINDOW_SIZE=20
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.env
*.env.local
prisma/migrations/*.sql
```

- [ ] **Step 5: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 6: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 7: Commit**

```bash
git init
git add package.json tsconfig.json vitest.config.ts .env.example .gitignore
git commit -m "chore: project scaffolding"
```

---

## Task 2: Prisma Schema + Migration

**Files:**
- Create: `prisma/schema.prisma`

- [ ] **Step 1: Create `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id            Int            @id @default(autoincrement())
  telegramId    BigInt         @unique
  username      String?
  firstName     String?
  isAllowed     Boolean        @default(false)
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  conversations Conversation[]
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

- [ ] **Step 2: Copy `.env.example` to `.env` and set `DATABASE_URL` to your remote PostgreSQL connection string**

```bash
cp .env.example .env
# Edit .env and set DATABASE_URL=postgresql://...
```

- [ ] **Step 3: Run initial migration**

```bash
npx prisma migrate dev --name init
```

Expected output:
```
Applying migration `20260602000000_init`
The following migration(s) have been applied:
migrations/
  └─ 20260602000000_init/
    └─ migration.sql
✔ Generated Prisma Client
```

- [ ] **Step 4: Commit**

```bash
git add prisma/
git commit -m "feat: prisma schema with User, Conversation, Message"
```

---

## Task 3: Config Module

**Files:**
- Create: `src/config/index.ts`
- Create: `src/config/menu.json`

- [ ] **Step 1: Create `src/config/menu.json`**

```json
{
  "items": []
}
```

- [ ] **Step 2: Create `src/config/index.ts`**

```typescript
import { z } from 'zod';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Env config ---

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  WEBHOOK_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_DEFAULT_MODEL: z.string().default('openai/gpt-4o-mini'),
  CONVERSATION_WINDOW_SIZE: z.coerce.number().default(20),
});

export type Config = z.infer<typeof envSchema>;

function loadConfig(): Config {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:');
    for (const [key, issues] of Object.entries(result.error.flatten().fieldErrors)) {
      console.error(`  ${key}: ${issues?.join(', ')}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const config = loadConfig();

// --- Menu config ---

export interface MenuItem {
  id: string;
  label: string;
  prompt: string;
}

interface MenuConfig {
  items: MenuItem[];
}

function loadMenuConfig(): MenuConfig {
  try {
    const content = readFileSync(join(__dirname, 'menu.json'), 'utf-8');
    return JSON.parse(content) as MenuConfig;
  } catch {
    return { items: [] };
  }
}

export const menuConfig = loadMenuConfig();
```

- [ ] **Step 3: Verify config compiles**

```bash
npx tsx --eval "import './src/config/index.ts'"
```

Expected: exits with error about missing env vars (since `.env` may not have all values set yet). That's correct behavior — the module validates on import.

- [ ] **Step 4: Commit**

```bash
git add src/config/
git commit -m "feat: env config validation with zod + menu config loader"
```

---

## Task 4: Database Client

**Files:**
- Create: `src/db/client.ts`

- [ ] **Step 1: Create `src/db/client.ts`**

```typescript
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/db/
git commit -m "feat: prisma client singleton"
```

---

## Task 5: Tool Registry, Executor, and Echo Tool

**Files:**
- Create: `src/tools/types.ts`
- Create: `src/tools/registry.ts`
- Create: `src/tools/executor.ts`
- Create: `src/tools/echo.ts`
- Create: `src/tools/index.ts`
- Create: `tests/tools/registry.test.ts`

- [ ] **Step 1: Write failing tests in `tests/tools/registry.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { Tool } from '../../src/tools/types.js';

const mockTool: Tool = {
  name: 'test_tool',
  description: 'A test tool',
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async () => ({ result: 'ok' }),
};

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('registers and retrieves a tool by name', () => {
    registry.register(mockTool);
    expect(registry.get('test_tool')).toBe(mockTool);
  });

  it('throws when retrieving an unregistered tool', () => {
    expect(() => registry.get('nonexistent')).toThrow('Tool not found: nonexistent');
  });

  it('returns all registered tools', () => {
    registry.register(mockTool);
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.getAll()[0]).toBe(mockTool);
  });

  it('converts tools to OpenRouter function definitions', () => {
    registry.register(mockTool);
    const defs = registry.toFunctionDefinitions();
    expect(defs).toHaveLength(1);
    expect(defs[0].type).toBe('function');
    expect(defs[0].function.name).toBe('test_tool');
    expect(defs[0].function.description).toBe('A test tool');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/tools/registry.test.ts
```

Expected: FAIL — "Cannot find module '../../src/tools/registry.js'"

- [ ] **Step 3: Create `src/tools/types.ts`**

```typescript
export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  description?: string;
  [key: string]: unknown;
}

export interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute(args: unknown): Promise<unknown>;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON-encoded string
  };
}

export interface ToolResult {
  tool_call_id: string;
  role: 'tool';
  content: string; // JSON-encoded result
}
```

- [ ] **Step 4: Create `src/tools/registry.ts`**

```typescript
import type { Tool } from './types.js';

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }
    return tool;
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  toFunctionDefinitions() {
    return this.getAll().map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
}

export const toolRegistry = new ToolRegistry();
```

- [ ] **Step 5: Create `src/tools/executor.ts`**

```typescript
import type { ToolCall, ToolResult } from './types.js';
import { toolRegistry } from './registry.js';

export async function executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
  return Promise.all(
    toolCalls.map(async (call): Promise<ToolResult> => {
      try {
        const tool = toolRegistry.get(call.function.name);
        const args = JSON.parse(call.function.arguments) as unknown;
        const result = await tool.execute(args);
        return {
          tool_call_id: call.id,
          role: 'tool',
          content: JSON.stringify(result),
        };
      } catch (error) {
        return {
          tool_call_id: call.id,
          role: 'tool',
          content: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
        };
      }
    }),
  );
}
```

- [ ] **Step 6: Create `src/tools/echo.ts`**

```typescript
import type { Tool } from './types.js';

export const echoTool: Tool = {
  name: 'echo',
  description: 'Echoes back the input message. Used for development and testing.',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The message to echo back',
      },
    },
    required: ['message'],
  },
  async execute(args) {
    const { message } = args as { message: string };
    return { echoed: message };
  },
};
```

- [ ] **Step 7: Create `src/tools/index.ts`**

```typescript
import { toolRegistry } from './registry.js';
import { echoTool } from './echo.js';

// Register all tools here — one import per tool
toolRegistry.register(echoTool);

export { toolRegistry };
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
npm test -- tests/tools/registry.test.ts
```

Expected:
```
✓ registers and retrieves a tool by name
✓ throws when retrieving an unregistered tool
✓ returns all registered tools
✓ converts tools to OpenRouter function definitions
Test Files  1 passed
```

- [ ] **Step 9: Commit**

```bash
git add src/tools/ tests/tools/
git commit -m "feat: tool registry, executor, and echo example tool"
```

---

## Task 6: UserService

**Files:**
- Create: `src/services/user.ts`

- [ ] **Step 1: Create `src/services/user.ts`**

```typescript
import { prisma } from '../db/client.js';
import type { User } from '@prisma/client';

export async function getOrCreateUser(
  telegramId: bigint,
  username?: string,
  firstName?: string,
): Promise<User> {
  return prisma.user.upsert({
    where: { telegramId },
    update: { username: username ?? null, firstName: firstName ?? null },
    create: { telegramId, username: username ?? null, firstName: firstName ?? null, isAllowed: false },
  });
}

export async function isUserAllowed(telegramId: bigint): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: { isAllowed: true },
  });
  return user?.isAllowed ?? false;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/user.ts
git commit -m "feat: user service (getOrCreateUser, isUserAllowed)"
```

---

## Task 7: ConversationService

**Files:**
- Create: `src/services/conversation.ts`
- Create: `tests/services/conversation.test.ts`

- [ ] **Step 1: Write failing tests in `tests/services/conversation.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/db/client.js', () => ({
  prisma: {
    conversation: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    message: {
      findMany: vi.fn(),
      createMany: vi.fn(),
    },
  },
}));

vi.mock('../../src/config/index.js', () => ({
  config: {
    OPENROUTER_DEFAULT_MODEL: 'openai/gpt-4o-mini',
    CONVERSATION_WINDOW_SIZE: 20,
  },
}));

import { prisma } from '../../src/db/client.js';
import {
  getWindow,
  getOrCreateActive,
  createConversation,
  saveMessages,
  updateConversationModel,
} from '../../src/services/conversation.js';

describe('ConversationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getWindow', () => {
    it('returns messages in chronological order', async () => {
      // findMany returns desc order; getWindow reverses to asc
      const descMessages = [
        { id: 3, role: 'assistant', content: 'c', createdAt: new Date('2024-01-03') },
        { id: 2, role: 'user', content: 'b', createdAt: new Date('2024-01-02') },
        { id: 1, role: 'user', content: 'a', createdAt: new Date('2024-01-01') },
      ];
      vi.mocked(prisma.message.findMany).mockResolvedValue(descMessages as any);

      const result = await getWindow(1, 3);

      expect(result[0].content).toBe('a');
      expect(result[1].content).toBe('b');
      expect(result[2].content).toBe('c');
    });

    it('queries with the given windowSize as take', async () => {
      vi.mocked(prisma.message.findMany).mockResolvedValue([]);
      await getWindow(42, 5);
      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { conversationId: 42 }, take: 5 }),
      );
    });

    it('uses default CONVERSATION_WINDOW_SIZE when not specified', async () => {
      vi.mocked(prisma.message.findMany).mockResolvedValue([]);
      await getWindow(1);
      expect(prisma.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20 }),
      );
    });
  });

  describe('getOrCreateActive', () => {
    it('returns existing conversation without creating a new one', async () => {
      const existing = { id: 1, userId: 1, model: 'openai/gpt-4o-mini', createdAt: new Date() };
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(existing as any);

      const result = await getOrCreateActive(1);
      expect(result).toBe(existing);
      expect(prisma.conversation.create).not.toHaveBeenCalled();
    });

    it('creates a new conversation when none exists', async () => {
      const newConv = { id: 2, userId: 1, model: 'openai/gpt-4o-mini', createdAt: new Date() };
      vi.mocked(prisma.conversation.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.conversation.create).mockResolvedValue(newConv as any);

      const result = await getOrCreateActive(1);
      expect(result).toBe(newConv);
      expect(prisma.conversation.create).toHaveBeenCalledOnce();
    });
  });

  describe('saveMessages', () => {
    it('calls createMany with mapped message data', async () => {
      vi.mocked(prisma.message.createMany).mockResolvedValue({ count: 2 });
      await saveMessages(1, [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ]);
      expect(prisma.message.createMany).toHaveBeenCalledWith({
        data: [
          { conversationId: 1, role: 'user', content: 'hello' },
          { conversationId: 1, role: 'assistant', content: 'hi' },
        ],
      });
    });
  });

  describe('updateConversationModel', () => {
    it('updates the model field for a given conversation id', async () => {
      vi.mocked(prisma.conversation.update).mockResolvedValue({} as any);
      await updateConversationModel(5, 'anthropic/claude-3-haiku');
      expect(prisma.conversation.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { model: 'anthropic/claude-3-haiku' },
      });
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/services/conversation.test.ts
```

Expected: FAIL — "Cannot find module '../../src/services/conversation.js'"

- [ ] **Step 3: Create `src/services/conversation.ts`**

```typescript
import { prisma } from '../db/client.js';
import { config } from '../config/index.js';
import type { Conversation, Message, Role } from '@prisma/client';

export async function getOrCreateActive(userId: number): Promise<Conversation> {
  const existing = await prisma.conversation.findFirst({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return existing;

  return prisma.conversation.create({
    data: { userId, model: config.OPENROUTER_DEFAULT_MODEL },
  });
}

export async function getWindow(
  conversationId: number,
  windowSize: number = config.CONVERSATION_WINDOW_SIZE,
): Promise<Message[]> {
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: windowSize,
  });
  return messages.reverse(); // Return in chronological order
}

export async function createConversation(userId: number, model?: string): Promise<Conversation> {
  return prisma.conversation.create({
    data: { userId, model: model ?? config.OPENROUTER_DEFAULT_MODEL },
  });
}

export async function saveMessages(
  conversationId: number,
  messages: Array<{ role: Role; content: string }>,
): Promise<void> {
  await prisma.message.createMany({
    data: messages.map(m => ({ conversationId, role: m.role, content: m.content })),
  });
}

export async function updateConversationModel(
  conversationId: number,
  model: string,
): Promise<void> {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { model },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/services/conversation.test.ts
```

Expected:
```
✓ returns messages in chronological order
✓ queries with the given windowSize as take
✓ uses default CONVERSATION_WINDOW_SIZE when not specified
✓ returns existing conversation without creating a new one
✓ creates a new conversation when none exists
✓ calls createMany with mapped message data
✓ updates the model field for a given conversation id
Test Files  1 passed
```

- [ ] **Step 5: Commit**

```bash
git add src/services/conversation.ts tests/services/conversation.test.ts
git commit -m "feat: conversation service with sliding window"
```

---

## Task 8: LLMService (OpenRouter + Function Calling Loop)

**Files:**
- Create: `src/services/llm.ts`
- Create: `tests/services/llm.test.ts`

- [ ] **Step 1: Write failing tests in `tests/services/llm.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/index.js', () => ({
  config: {
    OPENROUTER_API_KEY: 'test-key',
    WEBHOOK_URL: 'https://example.com',
  },
}));

vi.mock('../../src/tools/index.js', () => ({
  toolRegistry: {
    toFunctionDefinitions: vi.fn(() => [
      { type: 'function', function: { name: 'echo', description: 'test', parameters: {} } },
    ]),
  },
}));

vi.mock('../../src/tools/executor.js', () => ({
  executeToolCalls: vi.fn(),
}));

import { chat } from '../../src/services/llm.js';
import { executeToolCalls } from '../../src/tools/executor.js';

function mockFetch(responses: object[]) {
  let call = 0;
  global.fetch = vi.fn().mockImplementation(async () => {
    const resp = responses[call++];
    return {
      ok: true,
      json: async () => resp,
    };
  }) as any;
}

describe('LLMService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns text response and calls fetch once when no tool_calls', async () => {
    mockFetch([{
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Hello!' } }],
    }]);

    const result = await chat('openai/gpt-4o-mini', [{ role: 'user', content: 'Hi' }]);

    expect(result).toBe('Hello!');
    expect(global.fetch).toHaveBeenCalledOnce();
    expect(executeToolCalls).not.toHaveBeenCalled();
  });

  it('calls ToolExecutor and makes a 2nd LLM call when tool_calls are returned', async () => {
    const toolCall = {
      id: 'call_1',
      type: 'function',
      function: { name: 'echo', arguments: '{"message":"hi"}' },
    };

    mockFetch([
      {
        choices: [{
          finish_reason: 'tool_calls',
          message: { role: 'assistant', content: null, tool_calls: [toolCall] },
        }],
      },
      {
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Done!' } }],
      },
    ]);

    vi.mocked(executeToolCalls).mockResolvedValue([
      { tool_call_id: 'call_1', role: 'tool', content: '{"echoed":"hi"}' },
    ]);

    const result = await chat('openai/gpt-4o-mini', [{ role: 'user', content: 'Echo hi' }]);

    expect(result).toBe('Done!');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(executeToolCalls).toHaveBeenCalledWith([toolCall]);
  });

  it('throws with status code when OpenRouter returns a non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    }) as any;

    await expect(chat('openai/gpt-4o-mini', [])).rejects.toThrow('OpenRouter API error 401');
  });

  it('sends tools array and tool_choice in the request body', async () => {
    mockFetch([{
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
    }]);

    await chat('openai/gpt-4o-mini', []);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body as string);
    expect(body.tools).toBeDefined();
    expect(body.tool_choice).toBe('auto');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/services/llm.test.ts
```

Expected: FAIL — "Cannot find module '../../src/services/llm.js'"

- [ ] **Step 3: Create `src/services/llm.ts`**

```typescript
import { config } from '../config/index.js';
import { toolRegistry } from '../tools/index.js';
import { executeToolCalls } from '../tools/executor.js';
import type { ToolCall } from '../tools/types.js';

interface LLMMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface OpenRouterChoice {
  finish_reason: string;
  message: {
    role: string;
    content: string | null;
    tool_calls?: ToolCall[];
  };
}

interface OpenRouterResponse {
  choices: OpenRouterChoice[];
}

const MAX_TOOL_ITERATIONS = 5;
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export async function chat(model: string, messages: LLMMessage[]): Promise<string> {
  const tools = toolRegistry.toFunctionDefinitions();
  let currentMessages: LLMMessage[] = [...messages];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await callOpenRouter(model, currentMessages, tools);
    const choice = response.choices[0];

    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls?.length) {
      // Append assistant message with tool_calls
      currentMessages.push({
        role: 'assistant',
        content: choice.message.content,
        tool_calls: choice.message.tool_calls,
      });

      // Execute all tool calls in parallel, append results
      const results = await executeToolCalls(choice.message.tool_calls);
      currentMessages.push(...results);
      // Loop continues for the next LLM call
    } else {
      return choice.message.content ?? '';
    }
  }

  throw new Error('Max tool call iterations reached without a final response');
}

async function callOpenRouter(
  model: string,
  messages: LLMMessage[],
  tools: ReturnType<typeof toolRegistry.toFunctionDefinitions>,
): Promise<OpenRouterResponse> {
  const body: Record<string, unknown> = { model, messages };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const response = await fetch(OPENROUTER_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
      'HTTP-Referer': config.WEBHOOK_URL,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${text}`);
  }

  return response.json() as Promise<OpenRouterResponse>;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/services/llm.test.ts
```

Expected:
```
✓ returns text response and calls fetch once when no tool_calls
✓ calls ToolExecutor and makes a 2nd LLM call when tool_calls are returned
✓ throws with status code when OpenRouter returns a non-OK response
✓ sends tools array and tool_choice in the request body
Test Files  1 passed
```

- [ ] **Step 5: Commit**

```bash
git add src/services/llm.ts tests/services/llm.test.ts
git commit -m "feat: LLM service with OpenRouter function calling loop"
```

---

## Task 9: Whitelist Middleware

**Files:**
- Create: `src/bot/middleware/whitelist.ts`
- Create: `tests/middleware/whitelist.test.ts`

- [ ] **Step 1: Write failing tests in `tests/middleware/whitelist.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/user.js', () => ({
  getOrCreateUser: vi.fn().mockResolvedValue({ id: 1 }),
  isUserAllowed: vi.fn(),
}));

import { whitelistMiddleware } from '../../src/bot/middleware/whitelist.js';
import { isUserAllowed, getOrCreateUser } from '../../src/services/user.js';

function makeCtx(userId: number | undefined) {
  const reply = vi.fn().mockResolvedValue(undefined);
  return {
    from: userId
      ? { id: userId, username: 'testuser', first_name: 'Test' }
      : undefined,
    reply,
  } as any;
}

describe('WhitelistMiddleware', () => {
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    next = vi.fn().mockResolvedValue(undefined);
    vi.clearAllMocks();
  });

  it('calls next() when user is allowed', async () => {
    vi.mocked(isUserAllowed).mockResolvedValue(true);
    await whitelistMiddleware(makeCtx(123), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('does NOT call next() when user is not allowed', async () => {
    vi.mocked(isUserAllowed).mockResolvedValue(false);
    const ctx = makeCtx(456);
    await whitelistMiddleware(ctx, next);
    expect(next).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(expect.stringContaining('접근 권한이 없습니다'));
  });

  it('does NOT call next() when ctx.from is missing', async () => {
    const ctx = makeCtx(undefined);
    await whitelistMiddleware(ctx, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls getOrCreateUser to ensure user record exists', async () => {
    vi.mocked(isUserAllowed).mockResolvedValue(true);
    await whitelistMiddleware(makeCtx(789), next);
    expect(getOrCreateUser).toHaveBeenCalledWith(BigInt(789), 'testuser', 'Test');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- tests/middleware/whitelist.test.ts
```

Expected: FAIL — "Cannot find module '../../src/bot/middleware/whitelist.js'"

- [ ] **Step 3: Create `src/bot/middleware/whitelist.ts`**

```typescript
import type { Context, NextFunction } from 'grammy';
import { getOrCreateUser, isUserAllowed } from '../../services/user.js';

export async function whitelistMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const from = ctx.from;
  if (!from) {
    await ctx.reply('사용자 정보를 확인할 수 없습니다.');
    return;
  }

  const telegramId = BigInt(from.id);
  await getOrCreateUser(telegramId, from.username, from.first_name);

  const allowed = await isUserAllowed(telegramId);
  if (!allowed) {
    await ctx.reply('접근 권한이 없습니다. 관리자에게 문의하세요.');
    return;
  }

  await next();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- tests/middleware/whitelist.test.ts
```

Expected:
```
✓ calls next() when user is allowed
✓ does NOT call next() when user is not allowed
✓ does NOT call next() when ctx.from is missing
✓ calls getOrCreateUser to ensure user record exists
Test Files  1 passed
```

- [ ] **Step 5: Commit**

```bash
git add src/bot/middleware/ tests/middleware/
git commit -m "feat: whitelist middleware"
```

---

## Task 10: Bot Commands

**Files:**
- Create: `src/bot/commands/start.ts`
- Create: `src/bot/commands/reset.ts`
- Create: `src/bot/commands/status.ts`
- Create: `src/bot/commands/model.ts`
- Create: `src/bot/commands/models.ts`

- [ ] **Step 1: Create `src/bot/commands/start.ts`**

```typescript
import type { CommandContext, Context } from 'grammy';

export async function startCommand(ctx: CommandContext<Context>): Promise<void> {
  await ctx.reply(
    '안녕하세요! 저는 AI 챗봇입니다. 🤖\n\n' +
    '자연어로 질문하시면 답변해드립니다.\n\n' +
    '📋 사용 가능한 명령어:\n' +
    '/menu — 빠른 질의 메뉴\n' +
    '/reset — 대화 초기화\n' +
    '/model <id> — 모델 변경\n' +
    '/models — 사용 가능한 모델 목록\n' +
    '/status — 현재 상태 확인',
  );
}
```

- [ ] **Step 2: Create `src/bot/commands/reset.ts`**

```typescript
import type { CommandContext, Context } from 'grammy';
import { getOrCreateUser } from '../../services/user.js';
import { createConversation } from '../../services/conversation.js';

export async function resetCommand(ctx: CommandContext<Context>): Promise<void> {
  const from = ctx.from!;
  const user = await getOrCreateUser(BigInt(from.id), from.username, from.first_name);
  await createConversation(user.id);
  await ctx.reply('대화가 초기화되었습니다. 새로운 대화를 시작합니다. ✅');
}
```

- [ ] **Step 3: Create `src/bot/commands/status.ts`**

```typescript
import type { CommandContext, Context } from 'grammy';
import { getOrCreateUser } from '../../services/user.js';
import { getOrCreateActive, getWindow } from '../../services/conversation.js';

export async function statusCommand(ctx: CommandContext<Context>): Promise<void> {
  const from = ctx.from!;
  const user = await getOrCreateUser(BigInt(from.id), from.username, from.first_name);
  const conversation = await getOrCreateActive(user.id);
  const messages = await getWindow(conversation.id);

  await ctx.reply(
    `📊 현재 상태\n\n` +
    `모델: ${conversation.model}\n` +
    `대화 메시지 수: ${messages.length}개`,
  );
}
```

- [ ] **Step 4: Create `src/bot/commands/model.ts`**

```typescript
import type { CommandContext, Context } from 'grammy';
import { getOrCreateUser } from '../../services/user.js';
import { getOrCreateActive, updateConversationModel } from '../../services/conversation.js';

export async function modelCommand(ctx: CommandContext<Context>): Promise<void> {
  const modelId = ctx.match?.trim();
  if (!modelId) {
    await ctx.reply('사용법: /model <model-id>\n예시: /model anthropic/claude-3-haiku');
    return;
  }

  const from = ctx.from!;
  const user = await getOrCreateUser(BigInt(from.id), from.username, from.first_name);
  const conversation = await getOrCreateActive(user.id);
  await updateConversationModel(conversation.id, modelId);
  await ctx.reply(`모델이 변경되었습니다 ✅\n현재 모델: ${modelId}`);
}
```

- [ ] **Step 5: Create `src/bot/commands/models.ts`**

```typescript
import type { CommandContext, Context } from 'grammy';

const CURATED_MODELS = [
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'anthropic/claude-3-haiku',
  'anthropic/claude-3-5-sonnet',
  'google/gemini-flash-1.5',
  'google/gemini-pro-1.5',
  'meta-llama/llama-3.1-70b-instruct',
];

export async function modelsCommand(ctx: CommandContext<Context>): Promise<void> {
  const list = CURATED_MODELS.map(m => `• ${m}`).join('\n');
  await ctx.reply(`🤖 사용 가능한 모델:\n\n${list}\n\n변경 방법: /model <model-id>`);
}
```

- [ ] **Step 6: Commit**

```bash
git add src/bot/commands/
git commit -m "feat: bot commands (start, reset, status, model, models)"
```

---

## Task 11: Message Handler (Main LLM Pipeline)

**Files:**
- Create: `src/bot/handlers/message.ts`

- [ ] **Step 1: Create `src/bot/handlers/message.ts`**

```typescript
import type { Context } from 'grammy';
import { getOrCreateUser } from '../../services/user.js';
import { getOrCreateActive, getWindow, saveMessages } from '../../services/conversation.js';
import { chat } from '../../services/llm.js';
import type { Role } from '@prisma/client';

export async function messageHandler(ctx: Context): Promise<void> {
  const text = ctx.message?.text;
  if (!text) return;
  await processMessage(ctx, text);
}

export async function processMessage(ctx: Context, text: string): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  try {
    const user = await getOrCreateUser(BigInt(from.id), from.username, from.first_name);
    const conversation = await getOrCreateActive(user.id);
    const history = await getWindow(conversation.id);

    const messages = [
      ...history.map(m => ({ role: m.role as Role, content: m.content })),
      { role: 'user' as const, content: text },
    ];

    const response = await chat(conversation.model, messages);

    await saveMessages(conversation.id, [
      { role: 'user', content: text },
      { role: 'assistant', content: response },
    ]);

    // Try MarkdownV2 first; fall back to plain text if parsing fails
    await ctx.reply(response, { parse_mode: 'MarkdownV2' }).catch(() =>
      ctx.reply(response),
    );
  } catch (error) {
    console.error('[MessageHandler] Error processing message:', error);
    await ctx.reply('잠시 후 다시 시도해주세요. 🙏');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/bot/handlers/message.ts
git commit -m "feat: message handler — natural language → LLM pipeline"
```

---

## Task 12: Menu System + Callback Query Handler

**Files:**
- Create: `src/bot/commands/menu.ts`
- Create: `src/bot/handlers/callbackQuery.ts`

> `callbackQuery.ts` imports `processMessage` from `message.ts` (Task 11) — that file must exist before this task.

- [ ] **Step 1: Create `src/bot/commands/menu.ts`**

```typescript
import type { CommandContext, Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { menuConfig } from '../../config/index.js';

export async function menuCommand(ctx: CommandContext<Context>): Promise<void> {
  if (menuConfig.items.length === 0) {
    await ctx.reply('메뉴 항목이 없습니다. src/config/menu.json에 항목을 추가하세요.');
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const item of menuConfig.items) {
    keyboard.text(item.label, `menu:${item.id}`).row();
  }

  await ctx.reply('원하는 항목을 선택하세요:', { reply_markup: keyboard });
}
```

- [ ] **Step 2: Create `src/bot/handlers/callbackQuery.ts`**

```typescript
import type { CallbackQueryContext, Context } from 'grammy';
import { menuConfig } from '../../config/index.js';
import { processMessage } from './message.js';

export async function callbackQueryHandler(
  ctx: CallbackQueryContext<Context>,
): Promise<void> {
  const data = ctx.callbackQuery.data;
  if (!data.startsWith('menu:')) {
    await ctx.answerCallbackQuery();
    return;
  }

  const itemId = data.slice(5); // strip "menu:" prefix
  const item = menuConfig.items.find(i => i.id === itemId);

  if (!item) {
    await ctx.answerCallbackQuery('항목을 찾을 수 없습니다.');
    return;
  }

  await ctx.answerCallbackQuery();
  await processMessage(ctx, item.prompt);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/bot/commands/menu.ts src/bot/handlers/callbackQuery.ts
git commit -m "feat: /menu command and callback query handler"
```

---

## Task 13: Bot Instance (Wire Everything)

**Files:**
- Create: `src/bot/index.ts`

- [ ] **Step 1: Create `src/bot/index.ts`**

```typescript
import { Bot } from 'grammy';
import { config } from '../config/index.js';
import { whitelistMiddleware } from './middleware/whitelist.js';
import { startCommand } from './commands/start.js';
import { menuCommand } from './commands/menu.js';
import { resetCommand } from './commands/reset.js';
import { modelCommand } from './commands/model.js';
import { modelsCommand } from './commands/models.js';
import { statusCommand } from './commands/status.js';
import { messageHandler } from './handlers/message.js';
import { callbackQueryHandler } from './handlers/callbackQuery.js';

export function createBot(): Bot {
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

  // All updates pass through whitelist first
  bot.use(whitelistMiddleware);

  // Commands
  bot.command('start', startCommand);
  bot.command('menu', menuCommand);
  bot.command('reset', resetCommand);
  bot.command('model', modelCommand);
  bot.command('models', modelsCommand);
  bot.command('status', statusCommand);

  // Text messages (non-command)
  bot.on('message:text', messageHandler);

  // Inline keyboard button taps
  bot.on('callback_query:data', callbackQueryHandler);

  return bot;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/bot/index.ts
git commit -m "feat: bot instance — wire middleware, commands, handlers"
```

---

## Task 14: Fastify Server + Webhook Endpoint

**Files:**
- Create: `src/server/index.ts`

- [ ] **Step 1: Create `src/server/index.ts`**

```typescript
import Fastify from 'fastify';
import { webhookCallback } from 'grammy';
import type { Bot } from 'grammy';
import { config } from '../config/index.js';

export async function createServer(bot: Bot) {
  const app = Fastify({ logger: true });

  // grammy webhook handler — created once, reused per request
  const handleUpdate = webhookCallback(bot, 'fastify');

  // Health check
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // Telegram webhook — validates secret token before passing to grammy
  app.post('/webhook', async (req, reply) => {
    const secret = req.headers['x-telegram-bot-api-secret-token'];
    if (secret !== config.TELEGRAM_WEBHOOK_SECRET) {
      reply.code(401);
      return { error: 'Unauthorized' };
    }
    return handleUpdate(req, reply);
  });

  return app;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/
git commit -m "feat: fastify server with webhook endpoint and health check"
```

---

## Task 15: Entrypoint + Smoke Test

**Files:**
- Create: `src/main.ts`

- [ ] **Step 1: Create `src/main.ts`**

```typescript
// Register all tools before anything else
import './tools/index.js';

import { prisma } from './db/client.js';
import { config } from './config/index.js';
import { createBot } from './bot/index.js';
import { createServer } from './server/index.js';

async function main() {
  // Verify database connectivity at startup
  try {
    await prisma.$connect();
    console.log('✅ Database connected');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }

  const bot = createBot();
  const server = await createServer(bot);

  // Register webhook with Telegram
  await bot.api.setWebhook(`${config.WEBHOOK_URL}/webhook`, {
    secret_token: config.TELEGRAM_WEBHOOK_SECRET,
  });
  console.log(`✅ Webhook registered: ${config.WEBHOOK_URL}/webhook`);

  // Start HTTP server
  await server.listen({ port: config.PORT, host: '0.0.0.0' });
  console.log(`✅ Server listening on port ${config.PORT}`);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);
    await server.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run all tests to verify nothing is broken**

```bash
npm test
```

Expected:
```
✓ tests/tools/registry.test.ts (4 tests)
✓ tests/services/conversation.test.ts (7 tests)
✓ tests/services/llm.test.ts (4 tests)
✓ tests/middleware/whitelist.test.ts (4 tests)
Test Files  4 passed | Tests  19 passed
```

- [ ] **Step 3: Verify TypeScript compiles without errors**

```bash
npx tsc --noEmit
```

Expected: no output (zero errors).

- [ ] **Step 4: Smoke test startup (requires valid `.env`)**

Ensure `.env` has all required values set, then:

```bash
npm run dev
```

Expected:
```
✅ Database connected
✅ Webhook registered: https://your-domain.com/webhook
✅ Server listening on port 3000
```

Test health endpoint:

```bash
curl http://localhost:3000/health
```

Expected: `{"status":"ok","timestamp":"..."}`

- [ ] **Step 5: Final commit**

```bash
git add src/main.ts
git commit -m "feat: entrypoint — startup sequence, webhook registration, graceful shutdown"
```

---

## Running Tests

```bash
npm test                              # Run all tests once
npm run test:watch                    # Watch mode
npm test -- tests/tools/             # One directory
npm test -- tests/services/llm.test.ts  # One file
```

## Adding a New Tool

1. Create `src/tools/your_tool.ts` implementing the `Tool` interface
2. Add one line to `src/tools/index.ts`: `toolRegistry.register(yourTool)`
3. Restart the server

## Whitelist a User

Connect to the remote PostgreSQL database and run:

```sql
UPDATE "User" SET "isAllowed" = true WHERE "telegramId" = <telegram_user_id>;
```

## Adding Menu Items

Edit `src/config/menu.json` and restart the server:

```json
{
  "items": [
    { "id": "weather", "label": "🌤 날씨 확인", "prompt": "현재 서울 날씨를 알려주세요." }
  ]
}
```

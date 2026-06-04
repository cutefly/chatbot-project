import { z } from 'zod';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- Env config ---

const toolVarsSchema = z
  .string()
  .optional()
  .transform((raw, ctx): Record<string, string> => {
    if (!raw) {
      return {};
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be valid JSON' });
      return z.NEVER;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be a JSON object' });
      return z.NEVER;
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== 'string') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `value for "${key}" must be a string`,
        });
        return z.NEVER;
      }
      out[key] = value;
    }
    return out;
  });

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  WEBHOOK_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_DEFAULT_MODEL: z.string().default('openai/gpt-4o-mini'),
  CONVERSATION_WINDOW_SIZE: z.coerce.number().default(20),
  TOOL_ENDPOINT_ALLOWLIST: z.string().default(''),
  TOOL_VARS: toolVarsSchema,
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
  const data = result.data;
  // Default the allowlist to localhost:<PORT> (+ Open-Meteo for the built-in
  // temperature tool) once PORT is known.
  if (!data.TOOL_ENDPOINT_ALLOWLIST) {
    data.TOOL_ENDPOINT_ALLOWLIST = `localhost:${data.PORT},api.open-meteo.com,api.geonames.org`;
  }
  return data;
}

export const config = loadConfig();

/**
 * Secret-safe substitution allowlist for declarative tool `{VAR}` tokens.
 * Returns ONLY non-secret values: PORT plus any explicit TOOL_VARS.
 * NEVER includes API keys, DB URLs, or tokens from the full config.
 */
export function getToolSubstitutionVars(): Record<string, string> {
  return {
    PORT: String(config.PORT),
    ...config.TOOL_VARS,
  };
}

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

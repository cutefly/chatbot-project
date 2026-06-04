import { z } from 'zod';
import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parse as parseYaml } from 'yaml';
import type { Tool, JSONSchema } from './types.js';
import type { ToolRegistry } from './registry.js';
import { getToolSubstitutionVars, config } from '../config/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
const PARAM_TYPES = ['string', 'number', 'integer', 'boolean', 'array'] as const;
const PARAM_LOCATIONS = ['query', 'path', 'body', 'header'] as const;

const paramSchema = z
  .object({
    type: z.enum(PARAM_TYPES),
    description: z.string().min(1),
    required: z.boolean().default(false),
    in: z.enum(PARAM_LOCATIONS).default('query'),
    enum: z.array(z.unknown()).optional(),
    default: z.unknown().optional(),
    items_type: z.enum(PARAM_TYPES).optional(),
  })
  .strict()
  .refine((p) => p.type !== 'array' || p.items_type !== undefined, {
    message: 'items_type is required when type is "array"',
  });

export const frontmatterSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/),
    description: z.string().min(1),
    endpoint: z.string().min(1),
    method: z.enum(HTTP_METHODS).default('GET'),
    timeout_ms: z.number().int().positive().default(5000).transform((n) => Math.min(n, 15000)),
    success_status: z.array(z.number().int()).optional(),
    content_type: z.string().default('application/json'),
    headers: z.record(z.string()).optional(),
    parameters: z.record(paramSchema).optional(),
    response: z.object({ pick: z.array(z.string()).min(1) }).strict().optional(),
    transform: z.string().min(1).optional(),
    response_guidance: z.string().min(1).optional(),
  })
  .strict();

export type ToolSpec = z.infer<typeof frontmatterSchema>;
type ParamSpec = z.infer<typeof paramSchema>;

interface BuildOptions {
  allowlist: string[];
  vars: Record<string, string>;
}

const SUBST_TOKEN_RE = /\{([A-Za-z0-9_]+)\}/g;

function substitute(
  template: string,
  vars: Record<string, string>,
  skip: ReadonlySet<string> = new Set(),
): string {
  return template.replace(SUBST_TOKEN_RE, (match, token: string) => {
    if (skip.has(token)) {
      return match;
    }
    if (!(token in vars)) {
      throw new Error(`Unknown substitution token "{${token}}" — not in the allowed vars`);
    }
    return vars[token];
  });
}

function assertHostAllowed(url: URL, allowlist: string[]): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Endpoint scheme not allowed: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error('Endpoint must not contain credentials');
  }
  if (!allowlist.includes(url.host)) {
    throw new Error(`Endpoint host "${url.host}" is not on the allowlist`);
  }
}

function buildParameterSchema(parameters: Record<string, ParamSpec>): JSONSchema {
  const properties: Record<string, JSONSchema> = {};
  const required: string[] = [];

  for (const [paramName, spec] of Object.entries(parameters)) {
    const property: JSONSchema = { type: spec.type, description: spec.description };
    if (spec.type === 'array' && spec.items_type) {
      property.items = { type: spec.items_type };
    }
    if (spec.enum) {
      property.enum = spec.enum;
    }
    properties[paramName] = property;
    if (spec.required) {
      required.push(paramName);
    }
  }

  return { type: 'object', properties, required };
}

function coerce(value: unknown, type: ParamSpec['type']): unknown {
  switch (type) {
    case 'number':
    case 'integer':
      return typeof value === 'number' ? value : Number(value);
    case 'boolean':
      return typeof value === 'boolean' ? value : value === 'true';
    default:
      return value;
  }
}

function pickFields(data: unknown, fields: string[]): unknown {
  if (typeof data !== 'object' || data === null) {
    return data;
  }
  const source = data as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in source) {
      out[field] = source[field];
    }
  }
  return out;
}

export function buildToolFromSpec(
  frontmatter: ToolSpec,
  opts: BuildOptions,
): Tool {
  const params = frontmatter.parameters ?? {};
  const pathParamNames = new Set(
    Object.entries(params)
      .filter(([, spec]) => spec.in === 'path')
      .map(([paramName]) => paramName),
  );

  const baseEndpoint = substitute(frontmatter.endpoint, opts.vars, pathParamNames);
  assertHostAllowed(new URL(baseEndpoint.replace(SUBST_TOKEN_RE, 'x')), opts.allowlist);

  const staticHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(frontmatter.headers ?? {})) {
    staticHeaders[key] = substitute(value, opts.vars);
  }

  const parameters = buildParameterSchema(params);
  const responseGuidance = frontmatter.response_guidance;
  const successStatus = frontmatter.success_status;

  async function execute(rawArgs: unknown): Promise<unknown> {
    const args = (typeof rawArgs === 'object' && rawArgs !== null ? rawArgs : {}) as Record<
      string,
      unknown
    >;

    const resolved: Record<string, unknown> = {};
    for (const [paramName, spec] of Object.entries(params)) {
      let value = args[paramName];
      if (value === undefined && spec.default !== undefined) {
        value = spec.default;
      }
      if (value === undefined) {
        if (spec.required) {
          throw new Error(`Missing required parameter: ${paramName}`);
        }
        continue;
      }
      resolved[paramName] = coerce(value, spec.type);
    }

    let urlString = baseEndpoint;
    const queryEntries: [string, string][] = [];
    const bodyParams: Record<string, unknown> = {};
    const headers: Record<string, string> = { ...staticHeaders };
    let hasBody = false;

    for (const [paramName, spec] of Object.entries(params)) {
      if (!(paramName in resolved)) {
        continue;
      }
      const value = resolved[paramName];
      switch (spec.in) {
        case 'path':
          urlString = urlString.replace(
            `{${paramName}}`,
            encodeURIComponent(String(value)),
          );
          break;
        case 'query':
          queryEntries.push([paramName, String(value)]);
          break;
        case 'header':
          headers[paramName] = String(value);
          break;
        case 'body':
          bodyParams[paramName] = value;
          hasBody = true;
          break;
      }
    }

    // Build via URL so param-mapped query merges with any query string already
    // present in the endpoint (e.g. ".../forecast?current=temperature_2m").
    const finalUrl = new URL(urlString);
    for (const [key, value] of queryEntries) {
      finalUrl.searchParams.set(key, value);
    }
    urlString = finalUrl.toString();

    assertHostAllowed(finalUrl, opts.allowlist);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), frontmatter.timeout_ms);

    let response: Response;
    try {
      const init: RequestInit = { method: frontmatter.method, headers, signal: controller.signal };
      if (hasBody) {
        headers['Content-Type'] = frontmatter.content_type;
        init.body = JSON.stringify(bodyParams);
      }
      response = await fetch(urlString, init);
    } finally {
      clearTimeout(timer);
    }

    const ok = successStatus
      ? successStatus.includes(response.status)
      : response.ok;
    if (!ok) {
      const text = (await response.text()).slice(0, 500);
      throw new Error(`Tool "${frontmatter.name}" API error ${response.status}: ${text}`);
    }

    let data: unknown = await response.json();

    if (frontmatter.response) {
      data = pickFields(data, frontmatter.response.pick);
    }

    if (frontmatter.transform) {
      const mod = (await import(
        /* @vite-ignore */ `./transforms/${frontmatter.transform}.js`
      )) as {
        default: (data: unknown) => unknown;
      };
      data = mod.default(data);
    }

    return data;
  }

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    parameters,
    responseGuidance,
    execute,
  };
}

export function loadToolDefs(registry: ToolRegistry): void {
  const defsDir = join(__dirname, 'defs');
  const allowlist = config.TOOL_ENDPOINT_ALLOWLIST.split(',').map((h) => h.trim());
  const vars = getToolSubstitutionVars();

  let files: string[];
  try {
    files = readdirSync(defsDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  } catch {
    return;
  }

  for (const file of files) {
    try {
      const raw = readFileSync(join(defsDir, file), 'utf-8');
      const spec = frontmatterSchema.parse(parseYaml(raw));
      const tool = buildToolFromSpec(spec, { allowlist, vars });
      registry.register(tool);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to load tool definition "${file}": ${message}`);
      process.exit(1);
    }
  }
}

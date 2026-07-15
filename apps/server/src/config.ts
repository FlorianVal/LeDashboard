import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { SourcesConfig } from "@ledashboard/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));

const serverConfigSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.coerce.number().default(3000),
  databasePath: z.string().default(resolve(__dirname, "../../../data/ledashboard-v2.sqlite")),
  sourcesPath: z.string().default(resolve(__dirname, "../../../sources.yaml")),
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;

const endpointConfigSchema = z.object({
  url: z.string().url(),
  intervalSeconds: z.number().int().positive(),
}).strict();

const homeAssistantConfigSchema = endpointConfigSchema.extend({
  token: z.string().min(1),
});

const macConfigSchema = endpointConfigSchema.extend({
  username: z.string().min(1),
  password: z.string().min(1),
  interface: z.string().min(1),
});

const nasConfigSchema = endpointConfigSchema.extend({
  mountpoint: z.string().startsWith("/"),
});

const serviceConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().url(),
  expectedStatuses: z.array(
    z.number().int().min(100).max(599),
  ).min(1),
  latencyThresholdMs: z.number().int().positive(),
  tlsInsecure: z.boolean().default(false),
}).strict();

const curatedSourcesConfigSchema = z.object({
  homeAssistant: homeAssistantConfigSchema,
  laPlante: endpointConfigSchema,
  leTimelapse: endpointConfigSchema,
  mac: macConfigSchema,
  nas: nasConfigSchema,
  services: z.array(serviceConfigSchema),
}).strict();

export type EndpointConfig = z.infer<typeof endpointConfigSchema>;
export type HomeAssistantConfig = z.infer<typeof homeAssistantConfigSchema>;
export type MacConfig = z.infer<typeof macConfigSchema>;
export type NasConfig = z.infer<typeof nasConfigSchema>;
export type ServiceConfig = z.infer<typeof serviceConfigSchema>;
export type CuratedSourcesConfig = z.infer<typeof curatedSourcesConfigSchema>;

export function loadServerConfig(): ServerConfig {
  return serverConfigSchema.parse({
    host: process.env.HOST,
    port: process.env.PORT,
    databasePath: process.env.DATABASE_PATH,
    sourcesPath: process.env.SOURCES_PATH,
  });
}

export function interpolateEnv(raw: string): string {
  return raw.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name: string) => {
    const value = process.env[name];
    if (value === undefined) {
      throw new Error(`Missing environment variable: ${name}`);
    }
    return value;
  });
}

function interpolateConfigValue(value: unknown): unknown {
  if (typeof value === "string") return interpolateEnv(value);
  if (Array.isArray(value)) return value.map(interpolateConfigValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        interpolateConfigValue(item),
      ]),
    );
  }
  return value;
}

export function loadCuratedSourcesConfig(path: string): CuratedSourcesConfig {
  if (!existsSync(path)) {
    throw new Error(`Curated sources config not found at ${path}`);
  }
  const parsed = parseYaml(readFileSync(path, "utf-8"));
  return curatedSourcesConfigSchema.parse(interpolateConfigValue(parsed));
}

const sourceConfigSchema = z.object({
  sources: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.enum(["prometheus", "home-assistant"]),
      url: z.string(),
      interval: z.number().min(5),
      auth: z
        .object({
          token: z.string().optional(),
          username: z.string().optional(),
          password: z.string().optional(),
        })
        .optional(),
      sensors: z
        .array(
          z.object({
            entity_id: z.string(),
            name: z.string(),
            category: z.string(),
            unit: z.string(),
            attribute: z.string().optional(),
            displayName: z.string().optional(),
            group: z.string().optional(),
          })
        )
        .optional(),
      metrics: z
        .array(
          z.object({
            name: z.string(),
            category: z.string(),
            unit: z.string(),
            displayName: z.string().optional(),
            group: z.string().optional(),
          })
        )
        .optional(),
    })
  ),
});

export function loadSourcesConfig(path: string): SourcesConfig {
  if (!existsSync(path)) {
    console.warn(`Sources config not found at ${path}, using empty config`);
    return { sources: [] };
  }
  const raw = readFileSync(path, "utf-8");
  const parsed = parseYaml(raw);
  return sourceConfigSchema.parse(parsed) as SourcesConfig;
}

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  interpolateEnv,
  loadCuratedSourcesConfig,
} from "../src/config.js";

const originalHaToken = process.env.HA_TOKEN;

afterEach(() => {
  if (originalHaToken === undefined) {
    delete process.env.HA_TOKEN;
  } else {
    process.env.HA_TOKEN = originalHaToken;
  }
});

function curatedYaml(overrides = ""): string {
  return `
homeAssistant:
  url: http://home-assistant.test/api
  token: \${HA_TOKEN}
  intervalSeconds: 300
laPlante:
  url: http://laplante.test/api/dashboard-summary
  intervalSeconds: 3600
leTimelapse:
  url: http://letimelapse.test/api/status
  intervalSeconds: 300
mac:
  url: http://mac.test/metrics
  username: metrics
  password: metrics-password
  intervalSeconds: 60
  interface: en0
nas:
  url: http://nas.test/metrics
  intervalSeconds: 300
  mountpoint: /share/CACHEDEV1_DATA
services:
  - id: lamaison
    name: LaMaison
    url: http://lamaison.test/
    expectedStatuses: [200]
    latencyThresholdMs: 1000
${overrides}`;
}

function withConfig(contents: string, assertion: (path: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "ledashboard-config-"));
  const path = join(directory, "sources.yaml");
  try {
    writeFileSync(path, contents);
    assertion(path);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("curated source configuration", () => {
  it("interpolates deployment secrets before validation", () => {
    process.env.HA_TOKEN = "secret-token";

    expect(interpolateEnv("token: \${HA_TOKEN}"))
      .toBe("token: secret-token");

    withConfig(curatedYaml(), (path) => {
      expect(loadCuratedSourcesConfig(path).homeAssistant.token)
        .toBe("secret-token");
    });
  });

  it("names a missing environment variable without exposing other values", () => {
    delete process.env.HA_TOKEN;

    expect(() => interpolateEnv("token: \${HA_TOKEN}"))
      .toThrow("HA_TOKEN");
  });

  it("preserves secrets containing YAML syntax", () => {
    process.env.HA_TOKEN = "secret: #still-secret";

    withConfig(curatedYaml(), (path) => {
      expect(loadCuratedSourcesConfig(path).homeAssistant.token)
        .toBe("secret: #still-secret");
    });
  });

  it("rejects malformed or uncurated source sections", () => {
    process.env.HA_TOKEN = "secret-token";

    withConfig(curatedYaml("unexpectedSource: true\n"), (path) => {
      expect(() => loadCuratedSourcesConfig(path)).toThrow();
    });

    withConfig(curatedYaml().replace("intervalSeconds: 60", "intervalSeconds: 0"), (path) => {
      expect(() => loadCuratedSourcesConfig(path)).toThrow();
    });
  });
});

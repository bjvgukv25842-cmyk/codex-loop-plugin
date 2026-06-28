import { describe, expect, it } from "vitest";

import { loadPluginManifest, pluginPathExists, validatePluginManifestShape } from "../../src/plugin/manifest.ts";
import { validatePluginManifest } from "../../src/plugin/validate-manifest.ts";

describe("plugin manifest", () => {
  it("loads plugin.json", () => {
    const manifest = loadPluginManifest();
    expect(manifest.name).toBe("codex-loop");
  });

  it("has name, version, and description", () => {
    const manifest = loadPluginManifest();

    expect(manifest.name).toBeTruthy();
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(manifest.description).toBeTruthy();
  });

  it("uses the required component paths", () => {
    const manifest = loadPluginManifest();

    expect(manifest.skills).toBe("./skills/");
    expect(manifest.mcpServers).toBe("./.mcp.json");
    expect(manifest.hooks).toBe("./hooks/hooks.json");
  });

  it("has at least two default prompts", () => {
    const manifest = loadPluginManifest();

    expect(manifest.interface.defaultPrompt.length).toBeGreaterThanOrEqual(2);
    expect(manifest.interface.defaultPrompt).toContain(
      "Use Codex Loop to turn this goal into a PRD, task graph, implementation loop, evaluator loop, and final delivery report."
    );
    expect(manifest.interface.defaultPrompt).toContain(
      "Run a modular PRD → Dev → Eval → Repair loop for this repository and stop only when validation evidence supports completion."
    );
  });

  it("points composerIcon and logo at assets files", () => {
    const manifest = loadPluginManifest();

    expect(manifest.interface.composerIcon).toBe("./assets/icon.svg");
    expect(manifest.interface.logo).toBe("./assets/logo.svg");
    expect(pluginPathExists(manifest.interface.composerIcon)).toBe(true);
    expect(pluginPathExists(manifest.interface.logo)).toBe(true);
  });

  it("validates manifest shape without network access", () => {
    const manifest = loadPluginManifest();
    const result = validatePluginManifestShape(manifest);

    expect(result).toEqual({
      valid: true,
      errors: []
    });
  });

  it("does not warn for implemented M6 and M8 integration paths", () => {
    const result = validatePluginManifest();

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "$.hooks"
        })
      ])
    );
    expect(result.warnings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "$.mcpServers"
        })
      ])
    );
  });
});

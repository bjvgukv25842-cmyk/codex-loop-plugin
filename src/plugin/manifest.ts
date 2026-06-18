import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: {
    name: string;
    email?: string;
    url?: string;
  };
  homepage?: string;
  repository?: string;
  license: string;
  keywords: string[];
  skills: string;
  mcpServers: string;
  hooks: string;
  interface: {
    displayName: string;
    shortDescription: string;
    longDescription: string;
    developerName: string;
    category: string;
    capabilities: string[];
    defaultPrompt: string[];
    composerIcon: string;
    logo: string;
  };
}

export interface ManifestIssue {
  path: string;
  message: string;
}

export interface ManifestShapeValidationResult {
  valid: boolean;
  errors: ManifestIssue[];
}

export const PLUGIN_MANIFEST_PATH = ".codex-plugin/plugin.json";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

export function loadPluginManifest(path = PLUGIN_MANIFEST_PATH): PluginManifest {
  const manifestPath = join(repoRoot, path);
  const payload = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  const result = validatePluginManifestShape(payload);

  if (!result.valid) {
    const summary = result.errors.map((error) => `${error.path}: ${error.message}`).join("; ");
    throw new Error(`Invalid plugin manifest shape: ${summary}`);
  }

  return payload as PluginManifest;
}

export function validatePluginManifestShape(data: unknown): ManifestShapeValidationResult {
  const errors: ManifestIssue[] = [];

  if (!isRecord(data)) {
    return {
      valid: false,
      errors: [
        {
          path: "$",
          message: "manifest must be a JSON object"
        }
      ]
    };
  }

  requireString(data, "name", "$.name", errors);
  requireString(data, "version", "$.version", errors);
  requireString(data, "description", "$.description", errors);
  requireString(data, "license", "$.license", errors);
  requirePathString(data, "skills", "$.skills", errors);
  requirePathString(data, "mcpServers", "$.mcpServers", errors);
  requirePathString(data, "hooks", "$.hooks", errors);
  requireStringArray(data, "keywords", "$.keywords", errors);

  const author = data.author;
  if (!isRecord(author)) {
    errors.push({ path: "$.author", message: "author must be an object" });
  } else {
    requireString(author, "name", "$.author.name", errors);
  }

  const pluginInterface = data.interface;
  if (!isRecord(pluginInterface)) {
    errors.push({ path: "$.interface", message: "interface must be an object" });
  } else {
    for (const key of ["displayName", "shortDescription", "longDescription", "developerName", "category"]) {
      requireString(pluginInterface, key, `$.interface.${key}`, errors);
    }

    requireStringArray(pluginInterface, "capabilities", "$.interface.capabilities", errors);
    requireStringArray(pluginInterface, "defaultPrompt", "$.interface.defaultPrompt", errors, 2);
    requirePathString(pluginInterface, "composerIcon", "$.interface.composerIcon", errors);
    requirePathString(pluginInterface, "logo", "$.interface.logo", errors);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function resolvePluginPath(relativePath: string): string {
  const normalizedPath = relativePath.endsWith("/") ? relativePath.slice(0, -1) : relativePath;
  return join(repoRoot, normalizedPath);
}

export function pluginPathExists(relativePath: string): boolean {
  return existsSync(resolvePluginPath(relativePath));
}

function isRecord(data: unknown): data is Record<string, unknown> {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}

function requireString(data: Record<string, unknown>, key: string, path: string, errors: ManifestIssue[]): void {
  const value = data[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({ path, message: "must be a non-empty string" });
  }
}

function requirePathString(data: Record<string, unknown>, key: string, path: string, errors: ManifestIssue[]): void {
  const value = data[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push({ path, message: "must be a non-empty path string" });
    return;
  }

  if (!value.startsWith("./")) {
    errors.push({ path, message: "must start with ./" });
  }
}

function requireStringArray(
  data: Record<string, unknown>,
  key: string,
  path: string,
  errors: ManifestIssue[],
  minItems = 1
): void {
  const value = data[key];

  if (!Array.isArray(value) || value.length < minItems || !value.every((item) => typeof item === "string" && item.trim())) {
    errors.push({ path, message: `must be an array of at least ${minItems} non-empty string item(s)` });
  }
}

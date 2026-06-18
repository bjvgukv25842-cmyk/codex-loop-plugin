import {
  PLUGIN_MANIFEST_PATH,
  loadPluginManifest,
  pluginPathExists,
  validatePluginManifestShape,
  type ManifestIssue,
  type PluginManifest
} from "./manifest.ts";

export interface ManifestValidationResult {
  valid: boolean;
  manifestPath: string;
  errors: ManifestIssue[];
  warnings: ManifestIssue[];
}

export function validatePluginManifest(): ManifestValidationResult {
  if (!pluginPathExists(PLUGIN_MANIFEST_PATH)) {
    return {
      valid: false,
      manifestPath: PLUGIN_MANIFEST_PATH,
      errors: [
        {
          path: PLUGIN_MANIFEST_PATH,
          message: "plugin manifest file does not exist"
        }
      ],
      warnings: []
    };
  }

  let manifest: PluginManifest;
  try {
    manifest = loadPluginManifest();
  } catch (error) {
    return {
      valid: false,
      manifestPath: PLUGIN_MANIFEST_PATH,
      errors: [
        {
          path: PLUGIN_MANIFEST_PATH,
          message: error instanceof Error ? error.message : "unable to load plugin manifest"
        }
      ],
      warnings: []
    };
  }

  const shapeResult = validatePluginManifestShape(manifest);
  const warnings = validateReferencedPaths(manifest);

  return {
    valid: shapeResult.valid,
    manifestPath: PLUGIN_MANIFEST_PATH,
    errors: shapeResult.errors,
    warnings
  };
}

export function validateReferencedPaths(manifest: PluginManifest): ManifestIssue[] {
  const warnings: ManifestIssue[] = [];

  for (const [path, value] of [
    ["$.skills", manifest.skills],
    ["$.mcpServers", manifest.mcpServers],
    ["$.hooks", manifest.hooks],
    ["$.interface.composerIcon", manifest.interface.composerIcon],
    ["$.interface.logo", manifest.interface.logo]
  ] as const) {
    if (!pluginPathExists(value)) {
      warnings.push({
        path,
        message: `${value} does not exist yet`
      });
    }
  }

  return warnings;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = validatePluginManifest();
  const output = JSON.stringify(result, null, 2);

  if (result.valid) {
    console.log(output);
  } else {
    console.error(output);
    process.exitCode = 1;
  }
}

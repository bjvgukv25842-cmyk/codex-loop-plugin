# Plugin Discovery Validation

Date: 2026-06-18

Status: PASS

This document records evidence that `codex-loop-plugin` is discoverable by Codex as a real plugin, not only present as files inside this repository.

## What Was Proven

Codex discovered the plugin through its real plugin marketplace and plugin install commands:

1. A local marketplace was registered with Codex.
2. `codex plugin list --available --json` listed `codex-loop@codex-loop-proof`.
3. `codex plugin add codex-loop --marketplace codex-loop-proof --json` installed the plugin.
4. `codex plugin list --json` reported `codex-loop@codex-loop-proof` as installed and enabled.
5. The installed plugin cache contains `.codex-plugin/plugin.json` and all skill files.
6. A fresh `codex exec --json` thread reported the `codex-loop:*` skills in its available skills list.

## Marketplace Used

The working proof marketplace is:

- Marketplace root: `tmp/plugin-marketplace`
- Marketplace file: `tmp/plugin-marketplace/.agents/plugins/marketplace.json`
- Marketplace name: `codex-loop-proof`
- Plugin source path: `./plugins/codex-loop`
- Plugin source target: minimal local plugin package copied from this repository's manifest, skills, assets, MCP config, and hooks config.

An earlier direct-root marketplace was also registered as `codex-loop-local`, but Codex did not list any available plugin from it. The successful proof uses the standard marketplace layout expected by Codex:

```text
marketplace-root/
  .agents/plugins/marketplace.json
  plugins/codex-loop -> /Users/litmus/Downloads/codex-loop-plugin
```

## Commands And Evidence

### Marketplace Registration

```sh
codex plugin marketplace add /Users/litmus/Downloads/codex-loop-plugin/tmp/plugin-marketplace --json
```

Observed result:

```json
{
  "marketplaceName": "codex-loop-proof",
  "installedRoot": "/Users/litmus/Downloads/codex-loop-plugin/tmp/plugin-marketplace",
  "alreadyAdded": false
}
```

### Plugin Discovery Before Install

```sh
codex plugin list --marketplace codex-loop-proof --available --json
```

Observed result included:

```json
{
  "pluginId": "codex-loop@codex-loop-proof",
  "name": "codex-loop",
  "marketplaceName": "codex-loop-proof",
  "version": "0.1.0",
  "installed": false,
  "enabled": false
}
```

### Plugin Install

```sh
codex plugin add codex-loop --marketplace codex-loop-proof --json
```

Observed result:

```json
{
  "pluginId": "codex-loop@codex-loop-proof",
  "name": "codex-loop",
  "marketplaceName": "codex-loop-proof",
  "version": "0.1.0",
  "installedPath": "/Users/litmus/.codex/plugins/cache/codex-loop-proof/codex-loop/0.1.0",
  "authPolicy": "ON_INSTALL"
}
```

### Installed And Enabled

```sh
codex plugin list --json
```

Observed result includes:

```json
{
  "pluginId": "codex-loop@codex-loop-proof",
  "name": "codex-loop",
  "marketplaceName": "codex-loop-proof",
  "version": "0.1.0",
  "installed": true,
  "enabled": true
}
```

### Installed Cache Contents

Installed cache path:

```text
/Users/litmus/.codex/plugins/cache/codex-loop-proof/codex-loop/0.1.0
```

The cache contains:

- `.codex-plugin/plugin.json`
- `skills/codex-loop/SKILL.md`
- `skills/context-distiller/SKILL.md`
- `skills/dev-worker/SKILL.md`
- `skills/evaluator/SKILL.md`
- `skills/integration-manager/SKILL.md`
- `skills/prd-planner/SKILL.md`
- `skills/task-decomposer/SKILL.md`

### Runtime Skill Visibility

A fresh Codex thread was launched:

```sh
codex exec --json --sandbox read-only -C /Users/litmus/Downloads/codex-loop-plugin \
  -o artifacts/real-thread/plugin-discovery-runtime-message.json -
```

Runtime evidence files:

- `artifacts/real-thread/plugin-discovery-runtime-events.jsonl`
- `artifacts/real-thread/plugin-discovery-runtime-message.json`

Thread ID:

```text
019edae1-4d55-79a3-853f-52b8e759adf3
```

The fresh thread reported:

```json
{
  "codex_loop_skill_visible": true,
  "matching_skill_names": [
    "codex-loop:codex-loop",
    "codex-loop:context-distiller",
    "codex-loop:dev-worker",
    "codex-loop:evaluator",
    "codex-loop:integration-manager",
    "codex-loop:prd-planner",
    "codex-loop:task-decomposer"
  ],
  "plugin_evidence": "Available skills list contains codex-loop-prefixed skills from r2=/Users/litmus/.codex/plugins/cache/codex-loop-proof/codex-loop/0.1.0/skills"
}
```

## Notes

- The working proof marketplace remains `tmp/plugin-marketplace`, because Codex expects marketplace plugin entries to use the `./plugins/<plugin-name>` layout. An earlier direct-root marketplace was removed because Codex did not list a plugin from that shape.
- The plugin is locally installed and enabled. This is not publication to a remote marketplace.
- Hook trust and MCP runtime behavior are separate concerns. This validation proves plugin discovery and skill visibility, not hook execution trust or MCP tool startup.

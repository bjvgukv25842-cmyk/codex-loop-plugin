# Codex Model Catalog Troubleshooting

Date: 2026-06-20

## Symptom

Gate 6B.1 real SDK smoke can fail before any planner/dev/evaluator thread starts with an error like:

```text
codex_models_manager
failed to refresh available models
failed to decode models response: missing field `models`
body: {"data":[...],"object":"list"}
```

This is classified as:

```text
CODEX_MODEL_CATALOG_REFRESH_FAILED
```

It is not evidence that planner/dev/evaluator orchestration failed. The failure occurs during Codex CLI model catalog startup.

## Diagnosis

Run diagnosis before retrying real SDK smoke:

```bash
npm run codex:model:catalog:diagnose
npm run codex:model:catalog:parse
```

The diagnosis writes:

- `evals/sdk-orchestrated/reports/model-catalog-triage/codex-version.txt`
- `evals/sdk-orchestrated/reports/model-catalog-triage/models-bundled.json`
- `evals/sdk-orchestrated/reports/model-catalog-triage/models-bundled.stderr.log`
- `evals/sdk-orchestrated/reports/model-catalog-triage/models-remote.json`
- `evals/sdk-orchestrated/reports/model-catalog-triage/models-remote.stderr.log`
- `evals/sdk-orchestrated/reports/model-catalog-triage/model-catalog-triage-result.json`

If bundled catalog output is valid, the diagnosis also writes:

- `evals/sdk-orchestrated/model-catalog-bundled.json`

## Retry With Bundled Catalog

Only after reviewing the generated catalog, retry exactly one real SDK smoke with:

```bash
CODEX_LOOP_MODEL_CATALOG_JSON="$(pwd)/evals/sdk-orchestrated/model-catalog-bundled.json" \
CODEX_LOOP_ENABLE_REAL_SDK_RUN=1 \
npm run gate6b:smoke:run
```

Do not use `danger-full-access`, do not edit `~/.codex/config.toml`, and do not proceed to M12 until real Gate 6B smoke and the later complete repair-loop E2E pass.

## Runtime Overrides

The SDK harness supports:

- `CODEX_LOOP_CODEX_MODEL`: passed as a Codex config `model` override.
- `CODEX_LOOP_MODEL_CATALOG_JSON`: passed as a Codex config `model_catalog_json` override after file existence is verified.
- `CODEX_LOOP_CODEX_PROFILE`: currently blocked as `BLOCKED_SDK_PROFILE_UNSUPPORTED` because the installed TypeScript SDK type contract does not expose a profile option.

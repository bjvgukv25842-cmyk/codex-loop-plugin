import { createHash } from "node:crypto";

import type { M12Case } from "../../scripts/effectiveness/types.ts";
import {
  adversarialCompactPlannerOutputSchema,
  ADVERSARIAL_ULTRA_COMPACT_PLANNER_CONTRACT_VERSION
} from "./adversarial-compact-planner-contract.ts";
import {
  ADVERSARIAL_PLANNER_ARTIFACT_VALIDATOR,
  ADVERSARIAL_PLANNER_HYDRATOR_ID,
  ADVERSARIAL_PLANNER_HYDRATOR_VERSION,
  ADVERSARIAL_PLANNER_OUTPUT_SCHEMA_KIND,
  ADVERSARIAL_PLANNER_REDACTION_POLICY_ID,
  ADVERSARIAL_PLANNER_REDACTION_POLICY_VERSION,
  ADVERSARIAL_PLANNER_SAFETY_POLICY_ID,
  ADVERSARIAL_PLANNER_SAFETY_POLICY_VERSION,
  ADVERSARIAL_PLANNER_SANDBOX,
  ADVERSARIAL_PLANNER_SCHEMA_ID,
  ADVERSARIAL_PLANNER_SCHEMA_VERSION,
  ADVERSARIAL_PLANNER_SDK_METHOD,
  buildAdversarialPlannerInvocationConfig
} from "./adversarial-planner-stage.ts";

export interface AdversarialPlannerCanonicalInvocationConfig {
  prompt_builder_hash: string;
  schema_hash: string;
  hydrator_hash: string;
  adapter_path_hash: string;
  redaction_policy_hash: string;
  prompt_template_id: string;
  prompt_template_version: string;
  schema_id: string;
  schema_version: string;
  output_schema_kind: string;
  compact_contract_version: string;
  hydrator_id: string;
  hydrator_version: string;
  artifact_validator: string;
  safety_policy_id: string;
  safety_policy_version: string;
  redaction_policy_id: string;
  redaction_policy_version: string;
  sdk_method: string;
  sandbox_mode: string;
  model: string;
  model_catalog_identity: string;
}

export function buildTreatmentAdversarialPlannerCanonicalConfig(input: {
  testCase: M12Case;
  model?: string;
  model_catalog_json?: string;
}): AdversarialPlannerCanonicalInvocationConfig {
  const config = buildAdversarialPlannerInvocationConfig(input.testCase);
  return buildCanonicalConfig({
    promptHash: config.prompt_hash,
    schemaHash: sdkStableHash(adversarialCompactPlannerOutputSchema),
    model: input.model ?? "",
    modelCatalogIdentity: input.model_catalog_json ?? "",
    outputSchemaKind: config.output_schema_kind,
    artifactValidator: config.artifact_validator,
    sdkMethod: config.sdk_method,
    sandboxMode: config.sandbox,
    promptTemplateId: config.prompt_template_id,
    promptTemplateVersion: config.prompt_template_version,
    schemaId: config.schema_id,
    schemaVersion: config.schema_version,
    compactContractVersion: ADVERSARIAL_ULTRA_COMPACT_PLANNER_CONTRACT_VERSION,
    hydratorId: config.hydrator_id,
    hydratorVersion: config.hydrator_version,
    safetyPolicyId: config.safety_policy_id,
    safetyPolicyVersion: config.safety_policy_version,
    redactionPolicyId: config.redaction_policy_id,
    redactionPolicyVersion: config.redaction_policy_version
  });
}

export function buildSmokeAdversarialPlannerCanonicalConfig(input: {
  invocationTrace: Record<string, unknown> | null;
  schemaTrace: Record<string, unknown> | null;
  fallback?: AdversarialPlannerCanonicalInvocationConfig;
}): AdversarialPlannerCanonicalInvocationConfig {
  const fallback = input.fallback;
  return buildCanonicalConfig({
    promptHash: stringPath(input.invocationTrace, "prompt", "hash") || stringPath(input.schemaTrace, "prompt_hash") || fallback?.prompt_builder_hash || "",
    schemaHash: stringPath(input.invocationTrace, "run_options", "outputSchemaHash") || stringPath(input.schemaTrace, "output_schema_hash") || fallback?.schema_hash || "",
    model: stringPath(input.invocationTrace, "start_thread_options", "model") || stringPath(input.schemaTrace, "model") || fallback?.model || "",
    modelCatalogIdentity: stringPath(input.invocationTrace, "constructor_options", "config_values_redacted", "model_catalog_json") || stringPath(input.schemaTrace, "model_catalog_json") || fallback?.model_catalog_identity || "",
    outputSchemaKind: stringPath(input.schemaTrace, "output_schema_kind") || fallback?.output_schema_kind || "",
    artifactValidator: stringPath(input.schemaTrace, "planner_artifact_validator") || fallback?.artifact_validator || "",
    sdkMethod: stringPath(input.invocationTrace, "sdk_api_method") || stringPath(input.schemaTrace, "sdk_method") || fallback?.sdk_method || "",
    sandboxMode: stringPath(input.invocationTrace, "start_thread_options", "sandboxMode") || stringPath(input.schemaTrace, "sandbox_mode") || fallback?.sandbox_mode || "",
    promptTemplateId: fallback?.prompt_template_id || "adversarial-planner-ultra-compact",
    promptTemplateVersion: fallback?.prompt_template_version || "v2",
    schemaId: fallback?.schema_id || ADVERSARIAL_PLANNER_SCHEMA_ID,
    schemaVersion: fallback?.schema_version || ADVERSARIAL_PLANNER_SCHEMA_VERSION,
    compactContractVersion: fallback?.compact_contract_version || ADVERSARIAL_ULTRA_COMPACT_PLANNER_CONTRACT_VERSION,
    hydratorId: fallback?.hydrator_id || ADVERSARIAL_PLANNER_HYDRATOR_ID,
    hydratorVersion: fallback?.hydrator_version || ADVERSARIAL_PLANNER_HYDRATOR_VERSION,
    safetyPolicyId: fallback?.safety_policy_id || ADVERSARIAL_PLANNER_SAFETY_POLICY_ID,
    safetyPolicyVersion: fallback?.safety_policy_version || ADVERSARIAL_PLANNER_SAFETY_POLICY_VERSION,
    redactionPolicyId: fallback?.redaction_policy_id || ADVERSARIAL_PLANNER_REDACTION_POLICY_ID,
    redactionPolicyVersion: fallback?.redaction_policy_version || ADVERSARIAL_PLANNER_REDACTION_POLICY_VERSION
  });
}

export function compareAdversarialPlannerCanonicalConfigs(input: {
  smoke: AdversarialPlannerCanonicalInvocationConfig;
  treatment: AdversarialPlannerCanonicalInvocationConfig;
}): string[] {
  const fields: Array<keyof AdversarialPlannerCanonicalInvocationConfig> = [
    "prompt_builder_hash",
    "schema_hash",
    "hydrator_hash",
    "adapter_path_hash",
    "redaction_policy_hash",
    "prompt_template_id",
    "prompt_template_version",
    "schema_id",
    "schema_version",
    "output_schema_kind",
    "compact_contract_version",
    "hydrator_id",
    "hydrator_version",
    "artifact_validator",
    "safety_policy_id",
    "safety_policy_version",
    "redaction_policy_id",
    "redaction_policy_version",
    "sdk_method",
    "sandbox_mode",
    "model",
    "model_catalog_identity"
  ];
  return fields.filter((field) => input.smoke[field] !== input.treatment[field]);
}

export function stableHash(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(canonicalJson(value));
  return createHash("sha256").update(text ?? "").digest("hex");
}

function sdkStableHash(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(text ?? "").digest("hex");
}

function buildCanonicalConfig(input: {
  promptHash: string;
  schemaHash: string;
  model: string;
  modelCatalogIdentity: string;
  outputSchemaKind: string;
  artifactValidator: string;
  sdkMethod: string;
  sandboxMode: string;
  promptTemplateId: string;
  promptTemplateVersion: string;
  schemaId: string;
  schemaVersion: string;
  compactContractVersion: string;
  hydratorId: string;
  hydratorVersion: string;
  safetyPolicyId: string;
  safetyPolicyVersion: string;
  redactionPolicyId: string;
  redactionPolicyVersion: string;
}): AdversarialPlannerCanonicalInvocationConfig {
  const hydratorIdentity = {
    id: input.hydratorId,
    version: input.hydratorVersion,
    artifact_validator: input.artifactValidator
  };
  const adapterIdentity = {
    sdk_method: input.sdkMethod || ADVERSARIAL_PLANNER_SDK_METHOD,
    sandbox_mode: input.sandboxMode || ADVERSARIAL_PLANNER_SANDBOX,
    output_schema_kind: input.outputSchemaKind || ADVERSARIAL_PLANNER_OUTPUT_SCHEMA_KIND,
    artifact_validator: input.artifactValidator || ADVERSARIAL_PLANNER_ARTIFACT_VALIDATOR,
    model: input.model,
    model_catalog_identity: input.modelCatalogIdentity
  };
  const redactionIdentity = {
    id: input.redactionPolicyId,
    version: input.redactionPolicyVersion
  };
  return {
    prompt_builder_hash: input.promptHash,
    schema_hash: input.schemaHash,
    hydrator_hash: stableHash(hydratorIdentity),
    adapter_path_hash: stableHash(adapterIdentity),
    redaction_policy_hash: stableHash(redactionIdentity),
    prompt_template_id: input.promptTemplateId,
    prompt_template_version: input.promptTemplateVersion,
    schema_id: input.schemaId,
    schema_version: input.schemaVersion,
    output_schema_kind: input.outputSchemaKind,
    compact_contract_version: input.compactContractVersion,
    hydrator_id: input.hydratorId,
    hydrator_version: input.hydratorVersion,
    artifact_validator: input.artifactValidator,
    safety_policy_id: input.safetyPolicyId,
    safety_policy_version: input.safetyPolicyVersion,
    redaction_policy_id: input.redactionPolicyId,
    redaction_policy_version: input.redactionPolicyVersion,
    sdk_method: input.sdkMethod,
    sandbox_mode: input.sandboxMode,
    model: input.model,
    model_catalog_identity: input.modelCatalogIdentity
  };
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJson(value[key])])
  );
}

function stringPath(value: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  let current: unknown = value;
  for (const key of keys) {
    if (!isRecord(current)) return "";
    current = current[key];
  }
  return typeof current === "string" ? current : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

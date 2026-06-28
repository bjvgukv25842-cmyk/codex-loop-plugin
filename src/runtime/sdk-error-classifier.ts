export type SdkFailureCategory =
  | "CODEX_MODEL_CATALOG_REFRESH_FAILED"
  | "BLOCKED_MODEL_CATALOG_JSON_MISSING"
  | "BLOCKED_SDK_NOT_INSTALLED"
  | "BLOCKED_SDK_IMPORT_FAILED"
  | "BLOCKED_NODE_VERSION_UNSUPPORTED"
  | "BLOCKED_SDK_EXPORT_MISSING_CODEX"
  | "BLOCKED_SDK_PROFILE_UNSUPPORTED"
  | "BLOCKED_SDK_CONFIG_OVERRIDE_UNSUPPORTED"
  | "SDK_OUTPUT_SCHEMA_CAUSES_THREAD_START_FAILURE"
  | "SDK_ADAPTER_INVOCATION_MISMATCH"
  | "SDK_CHILD_PROCESS_EXITED_BEFORE_THREAD"
  | "SDK_ERROR_STX_ONLY_READING_PROMPT"
  | "SDK_VENDOR_CODEX_MISMATCH"
  | "SDK_WORKING_DIRECTORY_NOT_APPLIED"
  | "SDK_MODEL_CATALOG_NOT_APPLIED"
  | "SDK_MODEL_NOT_APPLIED"
  | "SDK_THREAD_FAILED";

export function classifySdkErrorMessage(
  message: string,
  context: { directCliParityStatus?: "PASS" | "FAIL" | "UNKNOWN"; usesOutputSchema?: boolean } = {}
): SdkFailureCategory {
  if (isModelCatalogRefreshFailure(message)) {
    return "CODEX_MODEL_CATALOG_REFRESH_FAILED";
  }
  if (/BLOCKED_MODEL_CATALOG_JSON_MISSING|CODEX_LOOP_MODEL_CATALOG_JSON points to a missing file/.test(message)) {
    return "BLOCKED_MODEL_CATALOG_JSON_MISSING";
  }
  if (/BLOCKED_NODE_VERSION_UNSUPPORTED|Node\.js >= 18 is required|Node\.js >= 18 required/.test(message)) {
    return "BLOCKED_NODE_VERSION_UNSUPPORTED";
  }
  if (/BLOCKED_SDK_EXPORT_MISSING_CODEX|Codex export is missing/.test(message)) {
    return "BLOCKED_SDK_EXPORT_MISSING_CODEX";
  }
  if (/BLOCKED_SDK_IMPORT_FAILED|could not be imported/.test(message)) {
    return "BLOCKED_SDK_IMPORT_FAILED";
  }
  if (/BLOCKED_SDK_NOT_INSTALLED|@openai\/codex-sdk is not installed|Cannot find package '@openai\/codex-sdk'/.test(message)) {
    return "BLOCKED_SDK_NOT_INSTALLED";
  }
  if (/BLOCKED_SDK_PROFILE_UNSUPPORTED|does not expose a profile option/.test(message)) {
    return "BLOCKED_SDK_PROFILE_UNSUPPORTED";
  }
  if (/BLOCKED_SDK_CONFIG_OVERRIDE_UNSUPPORTED|does not expose CodexOptions\.config/.test(message)) {
    return "BLOCKED_SDK_CONFIG_OVERRIDE_UNSUPPORTED";
  }
  if (isPromptOnlyChildExit(message)) {
    if (context.usesOutputSchema) {
      return "SDK_OUTPUT_SCHEMA_CAUSES_THREAD_START_FAILURE";
    }
    return context.directCliParityStatus === "PASS" ? "SDK_ADAPTER_INVOCATION_MISMATCH" : "SDK_ERROR_STX_ONLY_READING_PROMPT";
  }
  if (/Codex Exec exited with code 1/i.test(message) && context.directCliParityStatus === "PASS") {
    return "SDK_ADAPTER_INVOCATION_MISMATCH";
  }
  return "SDK_THREAD_FAILED";
}

export function isModelCatalogRefreshFailure(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("codex_models_manager") ||
    lower.includes("failed to refresh available models") ||
    lower.includes("missing field `models`") ||
    lower.includes("missing field \"models\"") ||
    /body:\s*\{"data"\s*:\s*\[/.test(message)
  );
}

export function isPromptOnlyChildExit(message: string): boolean {
  return /Codex Exec exited with code 1:\s*Reading prompt from stdin\.\.\.\s*$/i.test(message.trim());
}

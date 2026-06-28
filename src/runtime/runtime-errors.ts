export class RuntimeAdapterError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "RuntimeAdapterError";
    this.code = code;
    this.details = details;
  }
}

export class SdkNotInstalledError extends RuntimeAdapterError {
  constructor() {
    super("@openai/codex-sdk is not installed. SDK-Orchestrated Mode cannot start real SDK threads yet.", "BLOCKED_SDK_NOT_INSTALLED");
    this.name = "SdkNotInstalledError";
  }
}

export class SdkImportFailedError extends RuntimeAdapterError {
  constructor(message: string) {
    super(`@openai/codex-sdk is declared but could not be imported: ${message}`, "BLOCKED_SDK_IMPORT_FAILED");
    this.name = "SdkImportFailedError";
  }
}

export class SdkCodexExportMissingError extends RuntimeAdapterError {
  constructor() {
    super("@openai/codex-sdk imported successfully, but the Codex export is missing.", "BLOCKED_SDK_EXPORT_MISSING_CODEX");
    this.name = "SdkCodexExportMissingError";
  }
}

export class SdkNodeVersionUnsupportedError extends RuntimeAdapterError {
  constructor() {
    super(`Node.js >= 18 is required for @openai/codex-sdk; current runtime is ${process.version}.`, "BLOCKED_NODE_VERSION_UNSUPPORTED");
    this.name = "SdkNodeVersionUnsupportedError";
  }
}

export class RealSdkRunDisabledError extends RuntimeAdapterError {
  constructor() {
    super("Real SDK runs are disabled. Set CODEX_LOOP_ENABLE_REAL_SDK_RUN=1 to allow a controlled Gate 6B SDK run.", "BLOCKED_SDK_NOT_ENABLED");
    this.name = "RealSdkRunDisabledError";
  }
}

export class ThreadIdMissingError extends RuntimeAdapterError {
  constructor() {
    super("SDK thread completed or started without a usable thread_id. Gate evidence cannot use a fabricated id.", "THREAD_ID_MISSING");
    this.name = "ThreadIdMissingError";
  }
}

export class ModelCatalogRefreshError extends RuntimeAdapterError {
  constructor(message = "Codex model catalog refresh failed before an SDK thread could start.") {
    super(message, "CODEX_MODEL_CATALOG_REFRESH_FAILED");
    this.name = "ModelCatalogRefreshError";
  }
}

export class ModelCatalogJsonMissingError extends RuntimeAdapterError {
  constructor(path: string) {
    super(`CODEX_LOOP_MODEL_CATALOG_JSON points to a missing file: ${path}`, "BLOCKED_MODEL_CATALOG_JSON_MISSING", {
      path
    });
    this.name = "ModelCatalogJsonMissingError";
  }
}

export class SdkProfileUnsupportedError extends RuntimeAdapterError {
  constructor() {
    super("CODEX_LOOP_CODEX_PROFILE was provided, but @openai/codex-sdk does not expose a profile option in the installed ThreadOptions/CodexOptions type contract.", "BLOCKED_SDK_PROFILE_UNSUPPORTED");
    this.name = "SdkProfileUnsupportedError";
  }
}

export class SdkConfigOverrideUnsupportedError extends RuntimeAdapterError {
  constructor() {
    super("@openai/codex-sdk does not expose CodexOptions.config in the installed type contract. SDK config overrides cannot be passed safely.", "BLOCKED_SDK_CONFIG_OVERRIDE_UNSUPPORTED");
    this.name = "SdkConfigOverrideUnsupportedError";
  }
}

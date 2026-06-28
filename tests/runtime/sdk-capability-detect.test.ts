import { describe, expect, it } from "vitest";

import { canImportCodexSdk, canResolveCodexSdk, detectCodexSdkDependency, detectSdkCapability } from "../../src/runtime/sdk-capability-detect.ts";

describe("SDK capability detector", () => {
  it("detects installed @openai/codex-sdk package capabilities", () => {
    const capability = detectSdkCapability();

    expect(capability.package_name).toBe("@openai/codex-sdk");
    expect(capability.package_version).not.toBe("not_installed");
    expect(capability.codex_named_export_available).toBe(true);
    expect(capability.new_codex_env_supported).toBe(true);
    expect(capability.start_thread_supported).toBe(true);
    expect(capability.thread_run_supported).toBe(true);
    expect(capability.output_schema_supported).toBe(true);
    expect(capability.run_streamed_supported).toBe(true);
    expect(capability.working_directory_supported).toBe(true);
    expect(capability.skip_git_repo_check_supported).toBe(true);
    expect(capability.sandbox_mode_supported).toBe(true);
    expect(capability.run_level_sandbox_supported).toBe(false);
    expect(capability.thread_model_supported).toBe(true);
    expect(capability.config_supported).toBe(true);
    expect(capability.config_model_catalog_json_supported).toBe(true);
    expect(capability.config_sqlite_home_supported).toBe(true);
    expect(capability.sdk_sandbox_control).toBe("VERIFIED");
    expect(capability.gaps).toEqual([]);
  });

  it("can resolve SDK dependency from the project install", () => {
    expect(canResolveCodexSdk()).toBe(true);
  });

  it("detects SDK dependency readiness with dynamic import", async () => {
    const status = await detectCodexSdkDependency();

    expect(status.package_json_has_codex_sdk).toBe(true);
    expect(status.package_lock_has_codex_sdk).toBe(true);
    expect(status.npm_ls_codex_sdk_ok).toBe(true);
    expect(status.dynamic_import_codex_sdk_ok).toBe(true);
    expect(status.codex_named_export_available).toBe(true);
    expect(status.detected).toBe(true);
    expect(status.failure_category).toBe("");
    expect(status.codex_sdk_version).not.toBe("");
    expect(status.codex_sdk_export_keys).toContain("Codex");
    await expect(canImportCodexSdk()).resolves.toBe(true);
  });
});

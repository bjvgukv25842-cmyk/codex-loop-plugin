import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("codex SDK dependency diagnosis script", () => {
  it("reports project-local SDK dependency readiness without starting SDK threads", () => {
    const output = execFileSync("node", ["scripts/diagnostics/codex-sdk-diagnose.ts"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });
    const diagnosis = JSON.parse(output) as {
      package_manager: string;
      package_json_has_codex_sdk: boolean;
      package_lock_has_codex_sdk: boolean;
      npm_ls_codex_sdk_ok: boolean;
      dynamic_import_codex_sdk_ok: boolean;
      codex_sdk_version: string;
      codex_sdk_export_keys: string[];
      recommended_fix: string;
    };

    expect(diagnosis.package_manager).toBe("npm");
    expect(diagnosis.package_json_has_codex_sdk).toBe(true);
    expect(diagnosis.package_lock_has_codex_sdk).toBe(true);
    expect(diagnosis.npm_ls_codex_sdk_ok).toBe(true);
    expect(diagnosis.dynamic_import_codex_sdk_ok).toBe(true);
    expect(diagnosis.codex_sdk_version).not.toBe("");
    expect(diagnosis.codex_sdk_export_keys).toContain("Codex");
    expect(diagnosis.recommended_fix).toContain("safe to retry the feature planner parity smoke");
  });
});

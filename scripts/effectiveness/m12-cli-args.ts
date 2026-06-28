import type { M12Case, M12Variant } from "./types.ts";

export type M12RunMode = M12Variant | "both";

export interface M12CliArgs {
  case_id?: string;
  mode: M12RunMode | string;
  max_cases?: number;
  resume: boolean;
  fresh: boolean;
  regrade_only: boolean;
}

export interface M12Selection {
  status: "PASS" | "BLOCKED";
  cases: M12Case[];
  modes: M12Variant[];
  errors: string[];
  block_code?: "BLOCKED_M12_REQUIRES_CASE_SELECTOR" | "BLOCKED_M12_CASE_NOT_FOUND" | "BLOCKED_M12_INVALID_MODE" | "BLOCKED_M12_INVALID_MAX_CASES";
}

export function parseM12CliArgs(argv = process.argv.slice(2)): M12CliArgs {
  const args: M12CliArgs = {
    mode: "both",
    resume: false,
    fresh: false,
    regrade_only: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index] ?? "";
    if (entry === "--case") {
      args.case_id = argv[index + 1];
      index += 1;
    } else if (entry.startsWith("--case=")) {
      args.case_id = entry.slice("--case=".length);
    } else if (entry === "--mode") {
      args.mode = parseMode(argv[index + 1]);
      index += 1;
    } else if (entry.startsWith("--mode=")) {
      args.mode = parseMode(entry.slice("--mode=".length));
    } else if (entry === "--max-cases") {
      args.max_cases = parsePositiveInteger(argv[index + 1]);
      index += 1;
    } else if (entry.startsWith("--max-cases=")) {
      args.max_cases = parsePositiveInteger(entry.slice("--max-cases=".length));
    } else if (entry === "--resume") {
      args.resume = true;
    } else if (entry === "--fresh") {
      args.fresh = true;
    } else if (entry === "--regrade-only") {
      args.regrade_only = true;
    }
  }

  return args;
}

export function selectM12Cases(
  cases: M12Case[],
  args: M12CliArgs,
  env: NodeJS.ProcessEnv = process.env
): M12Selection {
  const modes = selectedModes(args.mode);
  if (modes.length === 0) {
    return blocked("BLOCKED_M12_INVALID_MODE", `Unsupported M12 mode: ${args.mode}`);
  }

  const realRunRequested = env.CODEX_LOOP_ENABLE_M12_REAL_RUN === "1";
  if (realRunRequested && !args.case_id && !args.max_cases) {
    return blocked(
      "BLOCKED_M12_REQUIRES_CASE_SELECTOR",
      "Real M12 runs require --case or --max-cases so a full dataset is never launched accidentally."
    );
  }

  let selected = cases;
  if (args.case_id) {
    selected = cases.filter((testCase) => testCase.case_id === args.case_id);
    if (selected.length === 0) {
      return blocked("BLOCKED_M12_CASE_NOT_FOUND", `M12 case not found: ${args.case_id}`);
    }
  }

  if (args.max_cases !== undefined) {
    if (!Number.isInteger(args.max_cases) || args.max_cases <= 0) {
      return blocked("BLOCKED_M12_INVALID_MAX_CASES", `Invalid --max-cases value: ${String(args.max_cases)}`);
    }
    selected = selected.slice(0, args.max_cases);
  }

  return {
    status: "PASS",
    cases: selected,
    modes,
    errors: []
  };
}

export function resultPathForVariant(caseId: string, variant: M12Variant): string {
  return `evals/effectiveness/reports/${caseId}/${variant}-result.json`;
}

export function legacyResultPathForVariant(caseId: string, variant: M12Variant): string {
  return `evals/effectiveness/${variant}/${caseId}.json`;
}

function parseMode(value: string | undefined): M12RunMode | string {
  return value ?? "both";
}

function selectedModes(mode: M12RunMode | string): M12Variant[] {
  if (mode === "baseline") return ["baseline"];
  if (mode === "treatment") return ["treatment"];
  if (mode === "both") return ["baseline", "treatment"];
  return [];
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function blocked(code: NonNullable<M12Selection["block_code"]>, message: string): M12Selection {
  return {
    status: "BLOCKED",
    cases: [],
    modes: [],
    block_code: code,
    errors: [message]
  };
}

import { parseDevWorkerLiteOutput, type DevWorkerLiteFailureCategory, type ParsedDevWorkerLiteOutput } from "./parse-dev-worker-lite-output.ts";

export interface DevWorkerValidationResult {
  status: "PASS" | "NEEDS_REVISION" | "BLOCKED";
  changed_files: string[];
  tests_run: string[];
  tests_passed: boolean;
  summary: string;
  failure_category: DevWorkerLiteFailureCategory | "";
  errors: string[];
}

export function validateDevWorkerLiteResult(finalResponse: string, options: { required_changed_file?: string } = {}): DevWorkerValidationResult {
  const parsed = parseDevWorkerLiteOutput(finalResponse);
  if (parsed.status !== "PASS") {
    return fromParsedFailure(parsed);
  }

  const output = parsed.output;
  if (!output) {
    return failure("DEV_WORKER_PROMPT_OR_HARNESS_FAILURE", ["Dev worker parser returned PASS without output."]);
  }

  const requiredChangedFile = options.required_changed_file ?? "src/project-name.js";
  if (!output.changed_files.includes(requiredChangedFile)) {
    return failure("DEV_WORKER_NO_FILE_CHANGE", [`changed_files must include ${requiredChangedFile}.`]);
  }

  if (!output.tests_run.some((command) => command === "npm test" || command.includes("npm test"))) {
    return failure("DEV_WORKER_NO_TEST", ["tests_run must include npm test."]);
  }

  if (output.tests_passed !== true) {
    return failure("DEV_WORKER_TESTS_FAILED", ["tests_passed must be true."]);
  }

  return {
    status: "PASS",
    changed_files: output.changed_files,
    tests_run: output.tests_run,
    tests_passed: output.tests_passed,
    summary: output.summary,
    failure_category: "",
    errors: []
  };
}

function fromParsedFailure(parsed: ParsedDevWorkerLiteOutput): DevWorkerValidationResult {
  return {
    status: parsed.status,
    changed_files: parsed.output?.changed_files ?? [],
    tests_run: parsed.output?.tests_run ?? [],
    tests_passed: parsed.output?.tests_passed ?? false,
    summary: parsed.output?.summary ?? "",
    failure_category: parsed.failure_category || "DEV_WORKER_PROMPT_OR_HARNESS_FAILURE",
    errors: parsed.errors
  };
}

function failure(failureCategory: DevWorkerLiteFailureCategory, errors: string[]): DevWorkerValidationResult {
  return {
    status: "NEEDS_REVISION",
    changed_files: [],
    tests_run: [],
    tests_passed: false,
    summary: "",
    failure_category: failureCategory,
    errors
  };
}

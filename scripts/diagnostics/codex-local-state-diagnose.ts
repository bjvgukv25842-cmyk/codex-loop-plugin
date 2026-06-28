import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { resolveEvalSqliteHome } from "../../src/runtime/eval-sqlite-home.ts";

interface Diagnosis {
  codex_home: string;
  codex_sqlite_home: string;
  project_eval_sqlite_home: string;
  codex_version: string;
  codex_doctor_available: boolean;
  global_state_db_exists: boolean;
  global_state_db_writable: boolean;
  eval_sqlite_home_exists: boolean;
  eval_sqlite_home_writable: boolean;
  recommendation: string;
}

function main(): void {
  const repoRoot = process.cwd();
  const codexHome = resolve(process.env.CODEX_HOME ?? join(homedir(), ".codex"));
  const codexSqliteHome = resolve(process.env.CODEX_SQLITE_HOME ?? codexHome);
  const projectEvalSqliteHome = resolveEvalSqliteHome(repoRoot).path;
  const globalStateDb = join(codexSqliteHome, "state_5.sqlite");
  const codexVersion = runReadonlyCommand("codex", ["--version"]).stdout.trim();
  const doctor = runReadonlyCommand("codex", ["doctor"]);
  const diagnosis: Diagnosis = {
    codex_home: codexHome,
    codex_sqlite_home: codexSqliteHome,
    project_eval_sqlite_home: projectEvalSqliteHome,
    codex_version: codexVersion,
    codex_doctor_available: doctor.exitCode === 0,
    global_state_db_exists: existsSync(globalStateDb),
    global_state_db_writable: isWritable(globalStateDb),
    eval_sqlite_home_exists: existsSync(projectEvalSqliteHome),
    eval_sqlite_home_writable: isWritable(projectEvalSqliteHome),
    recommendation: recommendation({
      globalStateDbExists: existsSync(globalStateDb),
      globalStateDbWritable: isWritable(globalStateDb),
      evalSqliteHomeExists: existsSync(projectEvalSqliteHome),
      evalSqliteHomeWritable: isWritable(projectEvalSqliteHome)
    })
  };
  process.stdout.write(`${JSON.stringify(diagnosis, null, 2)}\n`);
}

function runReadonlyCommand(command: string, args: string[]): { exitCode: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

function isWritable(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }
  try {
    const stat = statSync(path);
    accessSync(stat.isDirectory() ? path : path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function recommendation(input: {
  globalStateDbExists: boolean;
  globalStateDbWritable: boolean;
  evalSqliteHomeExists: boolean;
  evalSqliteHomeWritable: boolean;
}): string {
  if (input.evalSqliteHomeExists && input.evalSqliteHomeWritable) {
    return "Use isolated project SQLite home for eval runs; do not modify global Codex state.";
  }
  if (!input.evalSqliteHomeExists) {
    return "Run npm run gate6:lite:prepare or create .codex-eval/sqlite inside the project before an isolated eval run.";
  }
  if (!input.evalSqliteHomeWritable) {
    return "Project eval SQLite home is not writable; fix project-local permissions before running Gate 6.2-Lite.";
  }
  if (input.globalStateDbExists && !input.globalStateDbWritable) {
    return "Global Codex state DB is readonly; use isolated sqlite_home instead of changing ~/.codex.";
  }
  return "No specific recommendation.";
}

main();


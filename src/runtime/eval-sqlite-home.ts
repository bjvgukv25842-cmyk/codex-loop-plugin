import { accessSync, constants, existsSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export interface EvalSqliteHome {
  path: string;
  mode: "project-isolated" | "advanced-codex-home";
}

export interface EvalSqliteHomeCheck {
  ok: boolean;
  path: string;
  mode: "project-isolated" | "advanced-codex-home";
  reason?: "CODEX_LOOP_EVAL_CODEX_HOME_NOT_FOUND" | "EVAL_SQLITE_HOME_NOT_DIRECTORY" | "BLOCKED_EVAL_SQLITE_HOME_NOT_WRITABLE" | "CODEX_LOCAL_STATE_DB_READONLY";
}

export function resolveEvalSqliteHome(repoRoot = process.cwd(), env: NodeJS.ProcessEnv = process.env): EvalSqliteHome {
  const advancedHome = env.CODEX_LOOP_EVAL_CODEX_HOME;
  if (advancedHome) {
    return {
      path: resolve(advancedHome),
      mode: "advanced-codex-home"
    };
  }
  return {
    path: resolve(repoRoot, ".codex-eval/sqlite"),
    mode: "project-isolated"
  };
}

export function ensureEvalSqliteHome(repoRoot = process.cwd(), env: NodeJS.ProcessEnv = process.env): EvalSqliteHomeCheck {
  const home = resolveEvalSqliteHome(repoRoot, env);
  if (home.mode === "advanced-codex-home" && !existsSync(home.path)) {
    return {
      ok: false,
      path: home.path,
      mode: home.mode,
      reason: "CODEX_LOOP_EVAL_CODEX_HOME_NOT_FOUND"
    };
  }
  if (home.mode === "project-isolated") {
    mkdirSync(home.path, { recursive: true });
  }
  if (!existsSync(home.path) || !statSync(home.path).isDirectory()) {
    return {
      ok: false,
      path: home.path,
      mode: home.mode,
      reason: "EVAL_SQLITE_HOME_NOT_DIRECTORY"
    };
  }
  if (!isWritable(home.path)) {
    return {
      ok: false,
      path: home.path,
      mode: home.mode,
      reason: "BLOCKED_EVAL_SQLITE_HOME_NOT_WRITABLE"
    };
  }
  const stateDb = join(home.path, "state_5.sqlite");
  if (existsSync(stateDb) && !isWritable(stateDb)) {
    return {
      ok: false,
      path: home.path,
      mode: home.mode,
      reason: "CODEX_LOCAL_STATE_DB_READONLY"
    };
  }
  return {
    ok: true,
    path: home.path,
    mode: home.mode
  };
}

export function withEvalSqliteEnv(env: NodeJS.ProcessEnv, sqliteHomePath: string): NodeJS.ProcessEnv {
  return {
    ...env,
    CODEX_SQLITE_HOME: sqliteHomePath
  };
}

export function appendSqliteHomeConfig(args: string[], sqliteHomePath: string): string[] {
  if (args[0] === "exec") {
    return ["exec", "-c", `sqlite_home="${tomlString(sqliteHomePath)}"`, ...args.slice(1)];
  }
  return [...args, "-c", `sqlite_home="${tomlString(sqliteHomePath)}"`];
}

export function classifyReadonlyDatabase(stderr: string): "CODEX_LOCAL_STATE_DB_READONLY" | null {
  return /attempt to write a readonly database/i.test(stderr) ? "CODEX_LOCAL_STATE_DB_READONLY" : null;
}

function isWritable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function tomlString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

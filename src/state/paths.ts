import { join } from "node:path";

export const DEFAULT_STATE_DIR = "state";
export const STATE_DIR_ENV_VAR = "CODEX_LOOP_STATE_DIR";

export type StateFileName =
  | "loop-runs.json"
  | "agents.json"
  | "tasks.json"
  | "artifacts.json"
  | "eval-reports.json"
  | "repair-requests.json"
  | "context-capsules.json"
  | "sdk-thread-runs.json"
  | "events.json";

export function getStateDir(): string {
  return process.env[STATE_DIR_ENV_VAR] || DEFAULT_STATE_DIR;
}

export function resolveStatePath(name: StateFileName, stateDir = getStateDir()): string {
  return join(stateDir, name);
}

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const repoRoot = process.cwd();
const targetRepo = resolve(repoRoot, "tmp/multi-agent/native-dispatch-probe");
const reportsDir = resolve(repoRoot, "evals/multi-agent/reports");
const promptPath = resolve(repoRoot, "evals/multi-agent/probes/native-subagent-dispatch-probe.md");
const eventsPath = resolve(reportsDir, "native-dispatch-probe-events.jsonl");
const stderrPath = resolve(reportsDir, "native-dispatch-probe-stderr.log");
const finalOutputPath = resolve(reportsDir, "native-dispatch-probe-final-output.json");
const commandPath = resolve(reportsDir, "native-dispatch-probe-command.txt");
const exitCodePath = resolve(reportsDir, "native-dispatch-probe-exit-code.txt");
const timeoutMs = 6 * 60 * 1000;

async function main(): Promise<void> {
  mkdirSync(reportsDir, { recursive: true });
  resetOutputs();
  createTargetRepo();

  const prompt = readFileSync(promptPath, "utf8");
  const stateDir = join(targetRepo, "state");
  const args = [
    "exec",
    "-c",
    `mcp_servers.codex_loop_store.command="node"`,
    "-c",
    `mcp_servers.codex_loop_store.args=["src/mcp/server.ts"]`,
    "-c",
    `mcp_servers.codex_loop_store.cwd="${tomlString(repoRoot)}"`,
    "-c",
    `mcp_servers.codex_loop_store.env.CODEX_LOOP_STATE_DIR="${tomlString(stateDir)}"`,
    "--json",
    "--sandbox",
    "workspace-write",
    "-C",
    targetRepo,
    prompt
  ];
  writeFileSync(commandPath, `codex ${args.map(shellQuote).join(" ")}\n`, "utf8");

  const output = await spawnToFiles("codex", args, {
    cwd: targetRepo,
    stdoutPath: eventsPath,
    stderrPath,
    timeoutMs,
    env: {
      ...process.env,
      CODEX_LOOP_STATE_DIR: stateDir
    }
  });
  writeFileSync(exitCodePath, output.timedOut ? `timeout_after_${timeoutMs}ms\n` : `${output.exitCode ?? "null"}\n`, "utf8");
}

function createTargetRepo(): void {
  rmSync(targetRepo, { recursive: true, force: true });
  mkdirSync(join(targetRepo, "artifacts/probe"), { recursive: true });
  mkdirSync(join(targetRepo, "state"), { recursive: true });
  materializeProjectCodexConfig();
  writeFileSync(join(targetRepo, "README.md"), "# Native dispatch probe\n\nTemporary Gate 6.1 probe target.\n", "utf8");
}

function materializeProjectCodexConfig(): void {
  const sourceCodexDir = resolve(repoRoot, ".codex");
  const targetCodexDir = join(targetRepo, ".codex");
  if (!existsSync(sourceCodexDir)) {
    return;
  }
  cpSync(sourceCodexDir, targetCodexDir, {
    recursive: true
  });
}

function resetOutputs(): void {
  writeJson(finalOutputPath, {
    status: "RUNNING",
    real_thread_executed: false,
    parent_thread_id: "",
    spawned_agents: [],
    artifacts: [],
    mcp_agent_run_evidence: false,
    parent_wrote_probe_artifacts: false,
    blockers: ["Native dispatch probe has started; this placeholder must be replaced by event/state verification."]
  });
  writeFileSync(eventsPath, "", "utf8");
  writeFileSync(stderrPath, "", "utf8");
  writeFileSync(exitCodePath, "running\n", "utf8");
}

async function spawnToFiles(
  command: string,
  args: string[],
  options: { cwd: string; stdoutPath: string; stderrPath: string; timeoutMs: number; env: NodeJS.ProcessEnv }
): Promise<{ exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolveSpawn) => {
    let finished = false;
    let timedOut = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      if (finished) {
        return;
      }
      timedOut = true;
      child.kill("SIGINT");
      setTimeout(() => {
        if (!finished) {
          child.kill("SIGTERM");
        }
      }, 5_000).unref();
    }, options.timeoutMs);
    timeout.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      writeFileSync(options.stdoutPath, Buffer.concat(stdoutChunks));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      writeFileSync(options.stderrPath, Buffer.concat(stderrChunks));
    });
    child.on("error", (error) => {
      finished = true;
      clearTimeout(timeout);
      writeFileSync(options.stderrPath, error.message, "utf8");
      resolveSpawn({ exitCode: -1, timedOut });
    });
    child.on("close", (code) => {
      finished = true;
      clearTimeout(timeout);
      resolveSpawn({ exitCode: code, timedOut });
    });
  });
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function tomlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

main().catch((error: unknown) => {
  mkdirSync(dirname(stderrPath), { recursive: true });
  writeFileSync(stderrPath, error instanceof Error ? error.stack ?? error.message : String(error), "utf8");
  writeFileSync(exitCodePath, "-1\n", "utf8");
  process.exitCode = 1;
});

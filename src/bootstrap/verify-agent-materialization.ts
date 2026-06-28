import { verifyLoopAgentMaterialization } from "./materialize-agents.ts";

export { verifyLoopAgentMaterialization };

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = verifyLoopAgentMaterialization();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.valid ? 0 : 1;
}

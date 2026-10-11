import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

/**
 * Sibling-repository lookups. solo-mcp depends on no hub layout: every other
 * checkout is found through an explicit env var, or the sibling folder that
 * sits next to this repository (../<repo>).
 */

/** This repository's root (src/ or dist/ is one level below it). */
export const MCP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sibling(envName: string, repo: string, env: NodeJS.ProcessEnv = process.env): string {
    return env[envName] ? resolve(env[envName] as string) : resolve(MCP_ROOT, "..", repo);
}

/** solo-ops checkout (Python scripts the tools shell out to, owner CLI, .runtime tokens). Override: SOLO_OPS_ROOT. */
export function opsRoot(env: NodeJS.ProcessEnv = process.env): string {
    return sibling("SOLO_OPS_ROOT", "solo-ops", env);
}

/** Directory holding the solo-ops Python scripts. Override: SOLO_OPS_SCRIPTS_DIR. */
export function opsScriptsDir(env: NodeJS.ProcessEnv = process.env): string {
    return env.SOLO_OPS_SCRIPTS_DIR ? resolve(env.SOLO_OPS_SCRIPTS_DIR) : resolve(opsRoot(env), "infra", "scripts");
}

/** solo-data-lake checkout. Override: SOLO_DATA_LAKE_ROOT. */
export function dataLakeRoot(env: NodeJS.ProcessEnv = process.env): string {
    return sibling("SOLO_DATA_LAKE_ROOT", "solo-data-lake", env);
}

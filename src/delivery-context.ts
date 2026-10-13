import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { parseDocument, visit } from "yaml";
import { architectureRoot, knowledgeRoot } from "./roots.js";

export const DELIVERY_CONTEXT_CONTRACT = "solo-empire.delivery-context.v1";
export const DELIVERY_CONTEXT_VIEWS = ["overview", "role", "workflow", "documents", "refinement", "artifact"] as const;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_OFFSET = 2 * 1024 * 1024;
const ROLE_ID = /^[a-z][a-z0-9-]{0,99}$/;
const STEP_ID = /^(?:PD|BA|SA|UX|DEV|QA|REL|OPS)[0-9]{2}$/;
const ARTIFACT_ID = /^artifact-[a-f0-9]{32}$/;
const SOURCE_PATHS = new Set([
    "systems/architecture/product-delivery-workflow.yaml",
    "systems/architecture/delivery-document-standard.yaml",
    "systems/architecture/delivery-refinement-standard.yaml",
    "docs/registries/ROLE-CATALOG.yaml", "docs/registries/ROLE-COVERAGE.yaml", "docs/registries/POSITION-COVERAGE.yaml",
    "docs/lifecycle/DEVELOPMENT-LIFECYCLE.yaml", "systems/architecture/book-dev-role-step-matrix.yaml",
    "docs/lifecycle/UIUX-DESIGN-DELIVERY-FLOW.md",
    "templates/TEMPLATE-REGISTRY.yaml",
]);
const GUIDE_PATHS = new Set([
    "docs/lifecycle/PRODUCT-DELIVERY-FLOW.md", "docs/lifecycle/PRODUCT-DELIVERY-STEPS.md",
    "docs/lifecycle/PRODUCT-DELIVERY-INTERFACE-CONTRACT.md", "docs/lifecycle/PRODUCT-DELIVERY-DOCUMENT-STANDARD.md",
    "docs/lifecycle/PRODUCT-DELIVERY-DOCUMENT-MATRIX.md", "docs/lifecycle/PRODUCT-DELIVERY-REFINEMENT.md",
    "docs/lifecycle/PRODUCT-DELIVERY-REFINEMENT-STEPS.md", "docs/lifecycle/UIUX-DESIGN-DELIVERY-FLOW.md",
    "docs/lifecycle/PRODUCT-DELIVERY-ROLE-MAP.md",
    "docs/lifecycle/PRODUCT-DELIVERY-TOOLS-ADOPTION.md",
]);
const KNOWLEDGE_PATHS = new Set([
    "business-analyst", "client-discovery-and-proposals", "lead-research-and-crm", "content-distribution",
    "ai-product-delivery", "data-engineering", "security-and-privacy", "engagement-delivery",
    "operations-platform", "finance-and-legal",
].flatMap((group) => ["README.md", "PROCESS.md", "PROCESS-REGISTER.md"].map((file) => `roles/${group}/${file}`)));
const DATA_KEYS: Record<string, Set<string>> = Object.fromEntries(Object.entries({
    overview: "counts roles groups guides limitations",
    role: "id name category summary coverage_kind primary_owner groups position_templates owner_step_ids reviewer_step_ids specialist_refinement_status document_standard work_controls refinement_templates limitations",
    workflow: "contract version status runtime_status document_standard refinement_standard description source_catalog tools lanes interfaces feedback_routes steps instance_policy partial_view role_context",
    documents: "contract version status workflow_definition roles_source core_doc_types mandatory_work_types profiles documents step_documents policy partial_view role_context template_refs",
    refinement: "contract version status runtime_status workflow_source guide templates context_dimensions case_profiles invariants review_levels steps source_workflow view verification_basis authority partial_view role_context",
    artifact: "artifact_id path owner_repository availability source version sha256 body offset limit total unit truncated next_offset",
}).map(([key, fields]) => [key, new Set(fields.split(" "))]));
const EXPORTER_CODES = new Set(("arguments_invalid artifact_filter_invalid artifact_path_invalid artifact_unavailable artifact_unknown document_source_pointer_invalid document_standard_invalid filter_conflict generated_drift generated_parent_missing group_metadata_invalid group_process_invalid group_reference_invalid group_registry_v1_required json_mode_required offset_out_of_range pagination_filter_invalid pagination_invalid position_membership_mismatch position_metadata_invalid position_template_catalog_mismatch position_template_membership_mismatch refinement_standard_invalid refinement_template_unregistered registry_contract_invalid registry_identifier_duplicate registry_identifier_invalid registry_rows_invalid registry_source_pointer_invalid role_filter_required role_group_membership_invalid role_identifier_invalid role_metadata_invalid role_position_bijection_required role_unknown source_changed_during_read source_schema_or_path_invalid source_strict_json_required source_version_invalid standard_pointer_invalid step_identifier_invalid step_unknown template_path_invalid template_registry_duplicate template_registry_invalid view_filter_invalid view_unknown workflow_source_pointer_invalid").split(" "));
const ADAPTER_CODES = new Set(("invalid_query invalid_role_query invalid_artifact_query artifact_flags_require_artifact_view unsafe_path invalid_provenance invalid_json invalid_contract invalid_data invalid_artifact filter_mismatch integrity_mismatch output_limit exporter_timeout exporter_failed exporter_unavailable").split(" "));

export const deliveryContextQuerySchema = z.object({
    view: z.enum(DELIVERY_CONTEXT_VIEWS).default("overview"),
    role: z.string().min(1).max(100).regex(ROLE_ID).optional(),
    step: z.string().regex(STEP_ID).optional(),
    artifact_id: z.string().regex(ARTIFACT_ID).optional(),
    offset: z.number().int().min(0).max(MAX_OFFSET).optional(),
    limit: z.number().int().min(1).max(16000).optional(),
}).strict();

export type DeliveryContextQuery = z.input<typeof deliveryContextQuerySchema>;
type ValidatedQuery = z.output<typeof deliveryContextQuerySchema>;
export type DeliveryContextResult = Record<string, unknown> & {
    contract: typeof DELIVERY_CONTEXT_CONTRACT;
    status: "ready" | "invalid" | "unavailable";
};
export class DeliveryContextError extends Error {
    constructor(public readonly code: string) {
        super("คำขอ delivery context ไม่ถูกต้อง");
        this.name = "DeliveryContextError";
    }
}

const authority = {
    content_truth: "not_verified", live_readiness: "not_verified",
    business_acceptance: "not_verified", release_authorization: "not_verified",
};
function failure(status: "invalid" | "unavailable", code: string): DeliveryContextResult {
    return {
        contract: DELIVERY_CONTEXT_CONTRACT, status, errors: [{ code }],
        capabilities: { definition_available: false, runtime_integrated: false },
        authority: { ...authority },
    };
}

function validateQuery(input: unknown): ValidatedQuery {
    const parsed = deliveryContextQuerySchema.safeParse(input);
    if (!parsed.success) throw new DeliveryContextError("invalid_query");
    const query = parsed.data;
    if (query.view === "overview" && (query.role || query.step || query.artifact_id)) throw new DeliveryContextError("filter_conflict");
    if (query.view === "role" && (!query.role || query.step || query.artifact_id)) throw new DeliveryContextError("invalid_role_query");
    if (query.view === "artifact" && (!query.artifact_id || query.role || query.step)) {
        throw new DeliveryContextError("invalid_artifact_query");
    }
    if (query.view !== "artifact" && (query.artifact_id || query.offset !== undefined || query.limit !== undefined)) {
        throw new DeliveryContextError("artifact_flags_require_artifact_view");
    }
    return query;
}

/** Shared owner CLI parser. No caller-controlled filesystem or subprocess options. */
export function parseDeliveryCliArgs(argv: string[]): ValidatedQuery {
    const query: Record<string, unknown> = {};
    const seen = new Set<string>();
    let index = 0;
    if (argv[0] && !argv[0].startsWith("--")) query.view = argv[index++];
    const flags = new Map([
        ["--role", "role"], ["--step", "step"], ["--artifact-id", "artifact_id"],
        ["--offset", "offset"], ["--limit", "limit"],
    ]);
    for (; index < argv.length; index++) {
        const flag = argv[index];
        if (seen.has(flag)) throw new DeliveryContextError("duplicate_flag");
        seen.add(flag);
        if (flag === "--json") continue;
        const key = flags.get(flag);
        if (!key) throw new DeliveryContextError("unknown_flag");
        const value = argv[++index];
        if (!value || value.startsWith("--")) throw new DeliveryContextError("missing_flag_value");
        if (key === "offset" || key === "limit") {
            if (!/^(?:0|[1-9][0-9]*)$/.test(value)) throw new DeliveryContextError("invalid_integer");
            query[key] = Number(value);
        } else query[key] = value;
    }
    return validateQuery(query);
}

function deniedComponent(component: string): boolean {
    const value = component.toLowerCase();
    return new Set([
        ".git", "config", ".config", ".ssh", ".aws", ".azure", ".kube",
        "cookies", "credentials", "secrets", "id_rsa", "id_ed25519", ".netrc", ".npmrc", ".pypirc",
        "config.json", "config.toml", "config.yaml", "config.yml", "config.ini", "settings.json",
    ]).has(value) || value.startsWith(".env") || /token|cookie|credential|secret/.test(value) || /\.(?:pem|key|p12|pfx)$/.test(value);
}

function safePath(path: string, kind: "directory" | "file"): void {
    if (!isAbsolute(path) || path.includes("\0") || path.split(/[\\/]/).some((part) => part === ".." || deniedComponent(part))) {
        throw new DeliveryContextError("unsafe_path");
    }
    let cursor = parse(path).root;
    const components = path.slice(cursor.length).split(sep).filter(Boolean);
    for (const component of components) {
        cursor = join(cursor, component);
        const stat = lstatSync(cursor);
        if (stat.isSymbolicLink()) throw new DeliveryContextError("unsafe_path");
        const final = cursor === path;
        if ((!final || kind === "directory") && !stat.isDirectory()) throw new DeliveryContextError("unsafe_path");
        if (final && kind === "file" && (!stat.isFile() || stat.size > MAX_BYTES)) throw new DeliveryContextError("unsafe_path");
    }
}

function safeOptionalRoot(path: string): void {
    try { safePath(path, "directory"); }
    catch (error) {
        // A missing optional checkout stays missing; it never selects a fallback root.
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
    }
}

function readSafeFile(path: string): Buffer {
    safePath(path, "file");
    const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const stat = fstatSync(descriptor);
        if (!stat.isFile() || stat.size > MAX_BYTES) throw new DeliveryContextError("unsafe_path");
        safePath(path, "file");
        const bytes = readFileSync(descriptor);
        if (bytes.length > MAX_BYTES) throw new DeliveryContextError("output_limit");
        return bytes;
    } finally { closeSync(descriptor); }
}

function sourcePath(root: string, value: unknown): string {
    if (typeof value !== "string" || value.length > 240 || isAbsolute(value) || value.includes("\\") || value.includes("\0")) {
        throw new DeliveryContextError("invalid_provenance");
    }
    const parts = value.split("/");
    if (parts.some((part) => !part || part === "." || part === ".." || deniedComponent(part))) {
        throw new DeliveryContextError("invalid_provenance");
    }
    if (!SOURCE_PATHS.has(value)) {
        throw new DeliveryContextError("invalid_provenance");
    }
    const path = resolve(root, value);
    if (relative(root, path).startsWith("..")) throw new DeliveryContextError("invalid_provenance");
    safePath(path, "file");
    return path;
}

function safeArtifactReference(value: Record<string, unknown>, registered: Set<string>): void {
    const { path, owner_repository: owner, artifact_id: id, availability } = value;
    if (typeof path !== "string" || path.length > 240 || path.split(/[\\/]/).some((part) => !part || part === "." || part === ".." || deniedComponent(part))
        || path.includes("\\") || path.includes("\0") || !["available", "unavailable"].includes(String(availability))
        || (owner !== "architecture-docs" && owner !== "knowledge-base")
        || !(owner === "architecture-docs" ? registered : KNOWLEDGE_PATHS).has(path)
        || id !== `artifact-${createHash("sha256").update(`${owner}:${path}`).digest("hex").slice(0, 32)}`) {
        throw new DeliveryContextError("invalid_artifact");
    }
}

type CanonicalStep = { owner_role: string; reviewer_roles: string[] };
function canonicalSteps(bytes: Buffer): Map<string, CanonicalStep> {
    try {
        const document = parseDocument(new TextDecoder("utf-8", { fatal: true }).decode(bytes), {
            schema: "core", strict: true, uniqueKeys: true, version: "1.2",
        });
        if (document.errors.length || document.warnings.length) throw new DeliveryContextError("invalid_provenance");
        visit(document, { Alias() { throw new DeliveryContextError("invalid_provenance"); } });
        const workflow: unknown = document.toJS({ maxAliasCount: 0 });
        if (!record(workflow) || workflow.contract !== "solo-empire.product-delivery-definition.v1" || workflow.version !== 1
            || workflow.runtime_status !== "not-integrated" || !Array.isArray(workflow.steps) || !workflow.steps.length || workflow.steps.length > 72) {
            throw new DeliveryContextError("invalid_provenance");
        }
        const result = new Map<string, CanonicalStep>();
        for (const step of workflow.steps) {
            if (!record(step) || typeof step.id !== "string" || !STEP_ID.test(step.id) || result.has(step.id)
                || typeof step.owner_role !== "string" || !ROLE_ID.test(step.owner_role) || !Array.isArray(step.reviewer_roles)
                || step.reviewer_roles.length > 50 || step.reviewer_roles.some((role) => typeof role !== "string" || !ROLE_ID.test(role))) {
                throw new DeliveryContextError("invalid_provenance");
            }
            result.set(step.id, { owner_role: step.owner_role, reviewer_roles: step.reviewer_roles as string[] });
        }
        return result;
    } catch { throw new DeliveryContextError("invalid_provenance"); }
}

function validateData(data: unknown, query: ValidatedQuery, registered: Set<string>, root: string, policyRoot: string, workflowBytes: Buffer): void {
    const keys = DATA_KEYS[query.view];
    if (!record(data) || Object.keys(data).length !== keys.size || Object.keys(data).some((key) => !keys.has(key))) throw new DeliveryContextError("invalid_data");
    const scan = (value: unknown): void => {
        if (Array.isArray(value)) { for (const item of value) scan(item); return; }
        if (!record(value)) return;
        for (const [key, item] of Object.entries(value)) {
            if (["password", "access_token", "refresh_token", "cookies", "credentials", "raw", "stdout", "stderr", "private_payload", "client_records"].includes(key)
                || (key === "runtime_integrated" && item !== false)) throw new DeliveryContextError("invalid_data");
            scan(item);
        }
        if ("artifact_id" in value) safeArtifactReference(value, registered);
    };
    scan(data);
    if (query.view === "role" && data.id !== query.role) throw new DeliveryContextError("filter_mismatch");
    if (["workflow", "documents", "refinement"].includes(query.view)) {
        const expected: Record<string, string> = {
            workflow: "solo-empire.product-delivery-definition.v1", documents: "solo-empire.delivery-document-standard.v1",
            refinement: "solo-empire.delivery-refinement-standard.v1",
        };
        if (data.contract !== expected[query.view] || data.version !== 1 || typeof data.partial_view !== "boolean"
            || (["workflow", "refinement"].includes(query.view) && data.runtime_status !== "not-integrated")
            || (query.role ? !record(data.role_context) || data.role_context.id !== query.role : data.role_context !== null)) throw new DeliveryContextError("invalid_data");
        const steps = query.view === "documents" ? data.step_documents : data.steps;
        if (!Array.isArray(steps) || steps.length > 72 || (query.step && steps.length !== 1)) throw new DeliveryContextError("filter_mismatch");
        const canonical = canonicalSteps(workflowBytes);
        const permitted = new Set([...canonical].filter(([id, step]) => (!query.step || query.step === id)
            && (!query.role || query.role === step.owner_role || step.reviewer_roles.includes(query.role))).map(([id]) => id));
        if ((query.step && !permitted.size) || steps.length !== permitted.size) throw new DeliveryContextError("filter_mismatch");
        const ids = new Set<string>();
        for (const step of steps) {
            if (!record(step)) throw new DeliveryContextError("invalid_data");
            const id = query.view === "workflow" ? step.id : step.step_id;
            if (typeof id !== "string" || !permitted.has(id) || ids.has(id)) throw new DeliveryContextError("filter_mismatch");
            ids.add(id);
        }
    }
    if (query.view === "refinement") {
        if (!record(data.authority)) throw new DeliveryContextError("invalid_data");
        const currentAuthority = data.authority;
        if (Object.keys(currentAuthority).length !== 4 || Object.entries(authority).some(([key, value]) => currentAuthority[key] !== value)) throw new DeliveryContextError("invalid_data");
    }
    if (query.view === "artifact") {
        const offset = query.offset ?? 0, limit = query.limit ?? 8000;
        const total = data.total;
        if (data.artifact_id !== query.artifact_id || data.source !== data.path || data.availability !== "available"
            || typeof data.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(data.sha256) || data.version !== `sha256:${data.sha256}`
            || typeof data.body !== "string" || data.offset !== offset || data.limit !== limit || data.unit !== "unicode-codepoint"
            || typeof total !== "number" || !Number.isInteger(total) || total < 0 || total > MAX_BYTES
            || typeof data.truncated !== "boolean") throw new DeliveryContextError("invalid_artifact");
        const length = Array.from(data.body).length;
        const expectedLength = Math.min(limit, Math.max(0, total - offset));
        const truncated = offset + length < total;
        if (length !== expectedLength || data.truncated !== truncated || data.next_offset !== (truncated ? offset + length : null)) throw new DeliveryContextError("invalid_artifact");
        const path = join(data.owner_repository === "architecture-docs" ? root : policyRoot, String(data.path));
        const bytes = readSafeFile(path);
        if (bytes.length > MAX_BYTES || createHash("sha256").update(bytes).digest("hex") !== data.sha256) throw new DeliveryContextError("integrity_mismatch");
        const characters = Array.from(bytes.toString("utf8"));
        if (characters.length !== total || characters.slice(offset, offset + limit).join("") !== data.body) throw new DeliveryContextError("integrity_mismatch");
    }
}

/** Parse JSON without accepting duplicate keys or nonfinite numeric overflow. */
function strictJson(text: string): unknown {
    let cursor = 0;
    const whitespace = () => { while (/\s/.test(text[cursor] ?? "") && cursor < text.length) cursor++; };
    const string = (): string => {
        const start = cursor++;
        while (cursor < text.length) {
            if (text[cursor] === "\\") { cursor += 2; continue; }
            if (text[cursor++] === '"') {
                try { return JSON.parse(text.slice(start, cursor)); }
                catch { throw new DeliveryContextError("invalid_json"); }
            }
        }
        throw new DeliveryContextError("invalid_json");
    };
    const value = (depth: number): void => {
        if (depth > 80) throw new DeliveryContextError("invalid_json");
        whitespace();
        if (text[cursor] === '"') { string(); return; }
        if (text[cursor] === "{" || text[cursor] === "[") {
            const object = text[cursor++] === "{";
            const close = object ? "}" : "]";
            const keys = new Set<string>();
            whitespace();
            if (text[cursor] === close) { cursor++; return; }
            while (cursor < text.length) {
                if (object) {
                    whitespace();
                    if (text[cursor] !== '"') throw new DeliveryContextError("invalid_json");
                    const key = string();
                    if (keys.has(key)) throw new DeliveryContextError("invalid_json");
                    keys.add(key);
                    whitespace();
                    if (text[cursor++] !== ":") throw new DeliveryContextError("invalid_json");
                }
                value(depth + 1);
                whitespace();
                const next = text[cursor++];
                if (next === close) return;
                if (next !== ",") throw new DeliveryContextError("invalid_json");
            }
            throw new DeliveryContextError("invalid_json");
        }
        const match = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(cursor));
        if (!match) throw new DeliveryContextError("invalid_json");
        if (/^-?[0-9]/.test(match[0]) && !Number.isFinite(Number(match[0]))) throw new DeliveryContextError("invalid_json");
        cursor += match[0].length;
    };
    value(0);
    whitespace();
    if (cursor !== text.length) throw new DeliveryContextError("invalid_json");
    try { return JSON.parse(text); }
    catch { throw new DeliveryContextError("invalid_json"); }
}

export type DeliveryContextExecution = (command: string, args: string[], options: {
    cwd: string; timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv;
}) => Promise<{ stdout: string; stderr?: string }>;
/** Dependencies are injected only by local tests/registration, never MCP callers. */
export type DeliveryContextDependencies = { env?: NodeJS.ProcessEnv; execute?: DeliveryContextExecution };
const execute: DeliveryContextExecution = (command, args, options) => new Promise((accept, reject) => {
    execFile(command, args, { ...options, encoding: "utf8", shell: false }, (error, stdout, stderr) => {
        if (error) reject(new DeliveryContextError(error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "output_limit" : error.killed ? "exporter_timeout" : "exporter_failed"));
        else accept({ stdout, stderr });
    });
});

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateResult(value: unknown, query: ValidatedQuery, root: string, policyRoot: string): DeliveryContextResult {
    if (record(value) && value.contract === DELIVERY_CONTEXT_CONTRACT && ["invalid", "unavailable"].includes(String(value.status))) {
        if (!Array.isArray(value.errors) || value.errors.length !== 1 || !record(value.errors[0]) || Object.keys(value.errors[0]).length !== 1
            || typeof value.errors[0].code !== "string" || !EXPORTER_CODES.has(value.errors[0].code)) throw new DeliveryContextError("invalid_contract");
        return failure(value.status as "invalid" | "unavailable", value.errors[0].code);
    }
    if (!record(value) || value.contract !== DELIVERY_CONTEXT_CONTRACT || value.status !== "ready"
        || !record(value.capabilities) || value.capabilities.definition_available !== true || value.capabilities.runtime_integrated !== false
        || !record(value.authority)
        || value.view !== query.view || !record(value.filters) || !Array.isArray(value.sources) || value.sources.length !== SOURCE_PATHS.size
        || !("data" in value)) throw new DeliveryContextError("invalid_contract");
    const resultAuthority = value.authority;
    if (Object.keys(resultAuthority).length !== Object.keys(authority).length || Object.entries(authority).some(([key, expected]) => resultAuthority[key] !== expected)) throw new DeliveryContextError("invalid_contract");
    if (Object.keys(value).some((key) => !["contract", "status", "capabilities", "authority", "sources", "view", "filters", "data"].includes(key))) throw new DeliveryContextError("invalid_contract");
    if (Object.keys(value.capabilities).length !== 2) throw new DeliveryContextError("invalid_contract");
    const filters = value.filters;
    if (Object.keys(filters).length !== 5 || !["role", "step", "artifact_id", "offset", "limit"].every((key) => key in filters)) throw new DeliveryContextError("filter_mismatch");
    if ((filters.role ?? null) !== (query.role ?? null) || (filters.step ?? null) !== (query.step ?? null)
        || (filters.artifact_id ?? null) !== (query.artifact_id ?? null)
        || filters.offset !== (query.view === "artifact" ? query.offset ?? 0 : null)
        || filters.limit !== (query.view === "artifact" ? query.limit ?? 8000 : null)) throw new DeliveryContextError("filter_mismatch");
    const paths = new Set<string>();
    const registered = new Set(GUIDE_PATHS);
    let workflowBytes: Buffer | undefined;
    for (const source of value.sources) {
        if (!record(source) || typeof source.path !== "string" || paths.has(source.path)
            || !(source.version === null || ["string", "number"].includes(typeof source.version)) || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256)
            || Object.keys(source).some((key) => !["path", "version", "sha256"].includes(key))) {
            throw new DeliveryContextError("invalid_provenance");
        }
        paths.add(source.path);
        const bytes = readSafeFile(sourcePath(root, source.path));
        if (bytes.length > MAX_BYTES || createHash("sha256").update(bytes).digest("hex") !== source.sha256) {
            throw new DeliveryContextError("integrity_mismatch");
        }
        if (source.path === "systems/architecture/product-delivery-workflow.yaml") workflowBytes = bytes;
        for (const match of bytes.toString("utf8").matchAll(/\btemplates\/[a-zA-Z0-9_./-]+\.md\b/g)) registered.add(match[0]);
    }
    if (!workflowBytes) throw new DeliveryContextError("invalid_provenance");
    validateData(value.data, query, registered, root, policyRoot, workflowBytes);
    return value as DeliveryContextResult;
}

/** Read validated architecture definitions. It never asserts business truth or live acceptance. */
export async function getDeliveryContext(input: DeliveryContextQuery = {}, dependencies: DeliveryContextDependencies = {}): Promise<DeliveryContextResult> {
    let query: ValidatedQuery;
    try { query = validateQuery(input); }
    catch (error) { return failure("invalid", error instanceof DeliveryContextError ? error.code : "invalid_query"); }
    try {
        const env = dependencies.env ?? process.env;
        const configuredRoot = env.SOLO_ARCHITECTURE_ROOT;
        if (configuredRoot?.split(/[\\/]/).some((part) => part === ".." || deniedComponent(part))) throw new DeliveryContextError("unsafe_path");
        const root = architectureRoot(env);
        safePath(root, "directory");
        const configuredKnowledge = env.SOLO_KNOWLEDGE_ROOT;
        if (configuredKnowledge !== undefined && (!configuredKnowledge || configuredKnowledge.split(/[\\/]/).some((part) => part === ".." || deniedComponent(part)))) throw new DeliveryContextError("unsafe_path");
        const policyRoot = knowledgeRoot(env);
        safeOptionalRoot(policyRoot);
        const script = join(root, "scripts", "delivery_context.py");
        safePath(script, "file");
        const args = [script, "--json", "--view", query.view];
        if (query.role) args.push("--role", query.role);
        if (query.step) args.push("--step", query.step);
        if (query.artifact_id) args.push("--artifact-id", query.artifact_id);
        if (query.view === "artifact") args.push("--offset", String(query.offset ?? 0), "--limit", String(query.limit ?? 8000));
        const result = await (dependencies.execute ?? execute)(env.PYTHON || "python3", args, {
            cwd: root, timeout: 30000, maxBuffer: MAX_BYTES,
            env: {
                PATH: env.PATH, LANG: "C.UTF-8", PYTHONIOENCODING: "utf-8", PYTHONNOUSERSITE: "1", EMPIRE_CLIENT_CONFIG: "/nonexistent",
                ...(configuredKnowledge !== undefined ? { SOLO_KNOWLEDGE_ROOT: policyRoot } : {}),
            },
        });
        if (typeof result.stdout !== "string" || Buffer.byteLength(result.stdout, "utf8") > MAX_BYTES) throw new DeliveryContextError("output_limit");
        return validateResult(strictJson(result.stdout), query, root, policyRoot);
    } catch (error) {
        return failure(error instanceof DeliveryContextError && ["invalid_json", "invalid_contract", "invalid_data", "invalid_artifact", "filter_mismatch", "invalid_provenance", "integrity_mismatch", "output_limit"].includes(error.code) ? "invalid" : "unavailable",
            error instanceof DeliveryContextError && (ADAPTER_CODES.has(error.code) || EXPORTER_CODES.has(error.code)) ? error.code : "exporter_unavailable");
    }
}

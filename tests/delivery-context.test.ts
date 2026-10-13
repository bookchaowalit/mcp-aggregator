import assert from "node:assert/strict";
import { after, test, mock } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { parseDocument } from "yaml";
import {
    DELIVERY_CONTEXT_CONTRACT, DeliveryContextError, getDeliveryContext, parseDeliveryCliArgs,
    type DeliveryContextDependencies, type DeliveryContextQuery,
} from "../src/delivery-context.js";
import { architectureRoot, knowledgeRoot, MCP_ROOT, opsRoot } from "../src/roots.js";
import { registerDeliveryContextTools } from "../src/tools/delivery-context.js";

const directory = mkdtempSync(join(tmpdir(), "delivery-context-"));
after(() => rmSync(directory, { recursive: true, force: true }));
let fixtureCount = 0;
const sourceRelative = "docs/registries/ROLE-CATALOG.yaml";
const sourcePaths = [
    "systems/architecture/product-delivery-workflow.yaml", "systems/architecture/delivery-document-standard.yaml",
    "systems/architecture/delivery-refinement-standard.yaml", sourceRelative, "docs/registries/ROLE-COVERAGE.yaml",
    "docs/registries/POSITION-COVERAGE.yaml", "docs/lifecycle/DEVELOPMENT-LIFECYCLE.yaml",
    "systems/architecture/book-dev-role-step-matrix.yaml", "docs/lifecycle/UIUX-DESIGN-DELIVERY-FLOW.md", "templates/TEMPLATE-REGISTRY.yaml",
];
const fixtureSteps = [
    { id: "PD01", owner_role: "product-manager", reviewer_roles: ["business-analyst"] },
    { id: "BA03", owner_role: "business-analyst", reviewer_roles: ["product-manager"] },
];
function selectedFixtureSteps(query: DeliveryContextQuery) {
    return fixtureSteps.filter((step) => (!query.step || step.id === query.step)
        && (!query.role || step.owner_role === query.role || step.reviewer_roles.includes(query.role)));
}

test("short reads retain a fixed allocation budget across verified sources and policy", async () => {
    const f = knowledgeFixture();
    const cap = 2097152;
    const bytes = Buffer.alloc(cap, "x");
    writeFileSync(join(f.knowledge, f.path), bytes);
    const hash = createHash("sha256").update(bytes).digest("hex");
    Object.assign(f.result.data, { body: "xx", total: cap, sha256: hash, version: `sha256:${hash}` });
    const originalAllocate = Buffer.allocUnsafe;
    const originalRead = fs.readSync;
    let allocated = 0;
    const allocation = mock.method(Buffer, "allocUnsafe", (size: number) => {
        allocated += size;
        return originalAllocate(size);
    });
    const partial = mock.method(fs, "readSync", (...args: any[]) =>
        (originalRead as any)(args[0], args[1], args[2], Math.min(args[3], 777), args[4]));
    syncBuiltinESMExports();
    try {
        assert.equal((await getDeliveryContext(f.query, f.dependencies)).status, "ready");
        assert.ok(allocated > 0);
        assert.ok(allocated <= (sourcePaths.length + 1) * (cap + 1), `allocated ${allocated} bytes for bounded reads`);
    } finally {
        allocation.mock.restore();
        partial.mock.restore();
        syncBuiltinESMExports();
    }
});

test("policy growth after metadata checks cannot consume beyond the byte ceiling", async () => {
    const f = knowledgeFixture();
    const policy = join(f.knowledge, f.path);
    const inode = fs.statSync(policy).ino;
    const cap = 2097152;
    const originalStat = fs.fstatSync;
    const originalReadFile = fs.readFileSync;
    const originalRead = fs.readSync;
    let consumed = 0;
    let grown = false;
    const grow = (fd: number) => {
        if (originalStat(fd).ino !== inode) return false;
        if (!grown) {
            grown = true;
            writeFileSync(policy, Buffer.alloc(cap + 4096, "x"));
        }
        return true;
    };
    const whole = mock.method(fs, "readFileSync", (...args: any[]) => {
        const target = typeof args[0] === "number" && grow(args[0]);
        const before = consumed;
        const bytes = (originalReadFile as any)(...args);
        if (target && consumed === before) consumed += bytes.length;
        return bytes;
    });
    const bounded = mock.method(fs, "readSync", (...args: any[]) => {
        const target = grow(args[0]);
        const count = (originalRead as any)(...args);
        if (target) consumed += count;
        return count;
    });
    syncBuiltinESMExports();
    try {
        safeFailure(await getDeliveryContext(f.query, f.dependencies), "invalid", "output_limit");
        assert.equal(grown, true);
        assert.ok(consumed <= cap + 1, `read ${consumed} bytes past the ceiling`);
    } finally {
        whole.mock.restore();
        bounded.mock.restore();
        syncBuiltinESMExports();
    }
});

test("unregistered requested roles cannot masquerade as empty family results", async () => {
    for (const view of ["workflow", "documents", "refinement"] as const) {
        const query = { view, role: "unregistered-capability" };
        const f = fixture(query);
        safeFailure(await getDeliveryContext(query, f.dependencies), "invalid", "role_unknown");
    }
});

test("canonical owner and reviewer membership and uniqueness are required", async () => {
    for (const view of ["workflow", "documents", "refinement"] as const) {
        const query = { view };
        const f = fixture(query);
        const valid = readFileSync(join(f.root, sourcePaths[0]), "utf8");
        for (const source of [
            valid.replace("owner_role: product-manager", "owner_role: unregistered-capability"),
            valid.replace("reviewer_roles: [business-analyst]", "reviewer_roles: [unregistered-capability]"),
            valid.replace("reviewer_roles: [business-analyst]", "reviewer_roles: [business-analyst, business-analyst]"),
            valid.replace("reviewer_roles: [business-analyst]", "reviewer_roles: []"),
        ]) {
            writeFileSync(join(f.root, sourcePaths[0]), source);
            f.result.sources[0].sha256 = createHash("sha256").update(source).digest("hex");
            safeFailure(await getDeliveryContext(query, f.dependencies), "invalid", "invalid_provenance");
        }
    }
});

test("verified role catalog rejects duplicate IDs keys aliases and malformed identities", async () => {
    const f = fixture({ view: "workflow" });
    const valid = readFileSync(join(f.root, sourceRelative), "utf8");
    for (const source of [
        valid + "- id: product-manager\n",
        valid + "\nroles: []\n",
        valid + "\nextra: &alias []\ncopy: *alias\n",
        valid.replace("- id: product-manager", "- id: [product-manager]"),
        valid.replace("atomic-role-catalog", "unknown-catalog"),
        valid.replace("version: 1", "version: 2"),
    ]) {
        writeFileSync(join(f.root, sourceRelative), source);
        f.result.sources.find((item) => item.path === sourceRelative)!.sha256 = createHash("sha256").update(source).digest("hex");
        safeFailure(await getDeliveryContext({ view: "workflow" }, f.dependencies), "invalid", "invalid_provenance");
    }
});
function fixtureData(query: DeliveryContextQuery): Record<string, unknown> {
    if (query.view === "workflow") return {
        contract: "solo-empire.product-delivery-definition.v1", version: 1, status: "design-ready", runtime_status: "not-integrated",
        document_standard: "systems/architecture/delivery-document-standard.yaml", refinement_standard: "systems/architecture/delivery-refinement-standard.yaml",
        description: "Offline static fixture", source_catalog: {}, tools: {}, lanes: [], interfaces: [], feedback_routes: [],
        steps: selectedFixtureSteps(query), instance_policy: {}, partial_view: true, role_context: query.role ? { id: query.role } : null,
    };
    if (query.view === "documents") return {
        contract: "solo-empire.delivery-document-standard.v1", version: 1, status: "standard",
        workflow_definition: "systems/architecture/product-delivery-workflow.yaml", roles_source: sourceRelative,
        core_doc_types: [], mandatory_work_types: [], profiles: {}, documents: [],
        step_documents: selectedFixtureSteps(query).map((step) => ({ step_id: step.id })), policy: {}, partial_view: true,
        role_context: query.role ? { id: query.role } : null, template_refs: {},
    };
    if (query.view === "refinement") return {
        contract: "solo-empire.delivery-refinement-standard.v1", version: 1, status: "design-ready", runtime_status: "not-integrated",
        workflow_source: "systems/architecture/product-delivery-workflow.yaml", guide: "docs/lifecycle/PRODUCT-DELIVERY-REFINEMENT.md",
        templates: {}, context_dimensions: [], case_profiles: [], invariants: [], review_levels: [], steps: selectedFixtureSteps(query).map((step) => ({ step_id: step.id })),
        source_workflow: {}, view: {}, verification_basis: "static_definitions_and_repository_sources",
        authority: { content_truth: "not_verified", live_readiness: "not_verified", business_acceptance: "not_verified", release_authorization: "not_verified" },
        partial_view: true, role_context: query.role ? { id: query.role } : null,
    };
    return { counts: { roles: 0 }, roles: [], groups: [], guides: [], limitations: ["Offline static fixture"] };
}
function fixture(query: DeliveryContextQuery = {}) {
    const root = join(directory, `architecture-${++fixtureCount}`);
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts/delivery_context.py"), "# Offline fixture\n");
    const source = "version: 1\nroles: []\n";
    const roleCatalog = "version: 1\nkind: atomic-role-catalog\nstatus: current\nroles:\n"
        + ["product-manager", "business-analyst", "finance-accounting"].map((id) => `- id: ${id}\n`).join("");
    const workflow = [
        "contract: solo-empire.product-delivery-definition.v1", "version: 1", "runtime_status: not-integrated", "steps:",
        ...fixtureSteps.flatMap((step) => [`- id: ${step.id}`, `  owner_role: ${step.owner_role}`, `  reviewer_roles: [${step.reviewer_roles.join(", ")}]`]), "",
    ].join("\n");
    for (const path of sourcePaths) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), path === sourcePaths[0] ? workflow : path === sourceRelative ? roleCatalog : source);
    }
    const result = {
        contract: DELIVERY_CONTEXT_CONTRACT, status: "ready",
        capabilities: { definition_available: true, runtime_integrated: false },
        authority: {
            content_truth: "not_verified", live_readiness: "not_verified",
            business_acceptance: "not_verified", release_authorization: "not_verified",
        },
        sources: sourcePaths.map((path) => ({ path, version: 1, sha256: createHash("sha256").update(path === sourcePaths[0] ? workflow : path === sourceRelative ? roleCatalog : source).digest("hex") })),
        view: query.view ?? "overview",
        filters: {
            role: query.role ?? null, step: query.step ?? null, artifact_id: query.artifact_id ?? null,
            offset: query.view === "artifact" ? query.offset ?? 0 : null,
            limit: query.view === "artifact" ? query.limit ?? 8000 : null,
        },
        data: fixtureData(query),
    };
    const dependencies: DeliveryContextDependencies = {
        env: { SOLO_ARCHITECTURE_ROOT: root, PATH: process.env.PATH },
        execute: async () => ({ stdout: JSON.stringify(result) }),
    };
    return { root, result, dependencies };
}
function safeFailure(result: unknown, status = "invalid", code?: string) {
    assert.ok(result && typeof result === "object");
    const data = result as Record<string, any>;
    assert.equal(data.status, status);
    assert.equal(data.contract, DELIVERY_CONTEXT_CONTRACT);
    assert.deepEqual(Object.keys(data).sort(), ["authority", "capabilities", "contract", "errors", "status"]);
    assert.deepEqual(data.capabilities, { definition_available: false, runtime_integrated: false });
    assert.ok(Object.values(data.authority).every((value) => value === "not_verified"));
    if (code) assert.equal(data.errors[0].code, code);
    assert.ok(!JSON.stringify(data).includes("DO_NOT_DISCLOSE"));
}

test("architecture checkout uses the explicit owner root or a sibling, without hub lookup", () => {
    assert.equal(architectureRoot({}), resolve(MCP_ROOT, "../architecture-docs"));
    assert.equal(architectureRoot({ SOLO_ARCHITECTURE_ROOT: directory }), directory);
    assert.equal(knowledgeRoot({ SOLO_ARCHITECTURE_ROOT: join(directory, "custom/architecture-docs") }), join(directory, "custom/knowledge-base"));
    assert.equal(knowledgeRoot({ SOLO_ARCHITECTURE_ROOT: directory, SOLO_KNOWLEDGE_ROOT: join(directory, "alternate") }), join(directory, "alternate"));
});

test("CLI parser and MCP query enforce the same argument boundaries", async () => {
    assert.deepEqual(parseDeliveryCliArgs([]), { view: "overview" });
    assert.deepEqual(parseDeliveryCliArgs(["refinement", "--role", "business-analyst", "--step", "BA03", "--json"]), {
        view: "refinement", role: "business-analyst", step: "BA03",
    });
    const artifact = `artifact-${"a".repeat(32)}`;
    assert.deepEqual(parseDeliveryCliArgs(["artifact", "--artifact-id", artifact, "--offset", "8", "--limit", "20"]), {
        view: "artifact", artifact_id: artifact, offset: 8, limit: 20,
    });
    for (const args of [
        ["--root", "DO_NOT_DISCLOSE"], ["role"], ["role", "--role", "business-analyst", "--role", "product-manager"],
        ["--json", "--json"], ["workflow", "--role"], ["workflow", "--role", "../../DO_NOT_DISCLOSE"],
        ["workflow", "--step", "$(DO_NOT_DISCLOSE)"], ["workflow", "--step", "BA3"],
        ["overview", "--role", "business-analyst"], ["role", "--role", "business-analyst", "--step", "BA03"],
        ["workflow", "--offset", "0"], ["artifact", "--artifact-id", artifact, "--offset", "-1"],
        ["artifact", "--artifact-id", artifact, "--limit", "1e3"], ["artifact", "--artifact-id", artifact, "--limit", "16001"],
        ["artifact", "--artifact-id", artifact, "--offset", "2097153"], ["artifact", "--artifact-id", artifact, "--role", "business-analyst"],
    ]) {
        assert.throws(() => parseDeliveryCliArgs(args), (error: unknown) => error instanceof DeliveryContextError && !error.message.includes("DO_NOT_DISCLOSE"));
    }
    for (const query of [{ path: "DO_NOT_DISCLOSE" }, { view: "overview", role: "business-analyst" }, { view: "role" }, { limit: Infinity }]) {
        safeFailure(await getDeliveryContext(query as DeliveryContextQuery), "invalid");
    }
});

test("fixed exporter invocation is bounded, shell-free, and verified before returning", async () => {
    const f = fixture({ view: "workflow", step: "PD01" });
    let called = false;
    f.dependencies.execute = async (command, args, options) => {
        called = true;
        assert.equal(command, "python3");
        assert.deepEqual(args, [join(f.root, "scripts/delivery_context.py"), "--json", "--view", "workflow", "--step", "PD01"]);
        assert.equal(options.cwd, f.root);
        assert.equal(options.timeout, 30000);
        assert.equal(options.maxBuffer, 2097152);
        assert.equal(options.env.EMPIRE_CLIENT_CONFIG, "/nonexistent");
        assert.equal(options.env.SOLO_ARCHITECTURE_ROOT, undefined);
        return { stdout: JSON.stringify(f.result), stderr: "DO_NOT_DISCLOSE" };
    };
    assert.deepEqual(await getDeliveryContext({ view: "workflow", step: "PD01" }, f.dependencies), f.result);
    assert.equal(called, true);
});

test("invalid JSON, duplicate keys, numeric overflow and private envelope fail closed", async () => {
    const f = fixture();
    for (const text of ["", "DO_NOT_DISCLOSE", "{", '{"contract":"wrong","contract":"DO_NOT_DISCLOSE"}', '{"contract":"bad\nDO_NOT_DISCLOSE"}',
        `\u00a0${JSON.stringify(f.result)}`,
        JSON.stringify(f.result).replace('"version":1', '"version":1e999'), JSON.stringify({ ...f.result, raw: "DO_NOT_DISCLOSE" })]) {
        f.dependencies.execute = async () => ({ stdout: text });
        safeFailure(await getDeliveryContext({}, f.dependencies));
    }
});

test("authority and live runtime claims must remain explicitly unverified", async () => {
    const f = fixture();
    for (const value of [
        { ...f.result, contract: "DO_NOT_DISCLOSE" },
        { ...f.result, capabilities: { definition_available: true, runtime_integrated: true } },
        { ...f.result, authority: { ...f.result.authority, business_acceptance: "approved" } },
        { ...f.result, authority: { ...f.result.authority, private: "DO_NOT_DISCLOSE" } },
    ]) {
        f.dependencies.execute = async () => ({ stdout: JSON.stringify(value) });
        safeFailure(await getDeliveryContext({}, f.dependencies), "invalid", "invalid_contract");
    }
});

test("view and all echoed filters must match the request", async () => {
    const f = fixture({ view: "refinement", role: "business-analyst", step: "BA03" });
    for (const value of [
        { ...f.result, view: "workflow" },
        { ...f.result, filters: { ...f.result.filters, role: "product-manager" } },
        { ...f.result, filters: { ...f.result.filters, offset: 0 } },
        { ...f.result, filters: { role: "business-analyst", step: "BA03" } },
    ]) {
        f.dependencies.execute = async () => ({ stdout: JSON.stringify(value) });
        safeFailure(await getDeliveryContext({ view: "refinement", role: "business-analyst", step: "BA03" }, f.dependencies));
    }
});

test("source integrity detects stale hashes, repeats, unregistered and sensitive paths", async () => {
    const f = fixture();
    for (const sources of [
        [{ ...f.result.sources[0], sha256: "a".repeat(64) }],
        f.result.sources.map((source, i) => i === 1 ? f.result.sources[0] : source),
        [{ ...f.result.sources[0], path: "docs/unregistered.md" }],
        [{ ...f.result.sources[0], path: "docs/../../.env" }],
        [{ ...f.result.sources[0], path: "docs/config/settings.json" }],
        [{ ...f.result.sources[0], path: "/DO_NOT_DISCLOSE" }],
        [{ ...f.result.sources[0], version: { private: "DO_NOT_DISCLOSE" } }],
    ]) {
        f.dependencies.execute = async () => ({ stdout: JSON.stringify({ ...f.result, sources: sources.length === 1 ? [sources[0], ...f.result.sources.slice(1)] : sources }) });
        safeFailure(await getDeliveryContext({}, f.dependencies));
    }
    writeFileSync(join(f.root, sourceRelative), "version: 2\n");
    safeFailure(await getDeliveryContext({}, f.dependencies));
});

test("missing exporter and disallowed or symlinked roots never spawn", async () => {
    let calls = 0;
    const execute = async () => { calls++; return { stdout: "DO_NOT_DISCLOSE" }; };
    const f = fixture();
    const link = join(directory, "linked-root");
    symlinkSync(f.root, link);
    const sensitive = join(directory, "config", "architecture-docs");
    mkdirSync(sensitive, { recursive: true });
    const missing = join(directory, "missing-script");
    mkdirSync(missing);
    for (const root of [link, sensitive, missing, join(directory, "absent"), `${f.root}/../architecture-docs`]) {
        safeFailure(await getDeliveryContext({}, { env: { SOLO_ARCHITECTURE_ROOT: root }, execute }), "unavailable");
    }
    assert.equal(calls, 0);
});

test("exporter script and registered source symlinks are rejected", async () => {
    const scriptFixture = fixture();
    rmSync(join(scriptFixture.root, "scripts/delivery_context.py"));
    symlinkSync(join(scriptFixture.root, sourceRelative), join(scriptFixture.root, "scripts/delivery_context.py"));
    safeFailure(await getDeliveryContext({}, scriptFixture.dependencies), "unavailable", "unsafe_path");
    const sourceFixture = fixture();
    rmSync(join(sourceFixture.root, sourceRelative));
    symlinkSync(join(scriptFixture.root, sourceRelative), join(sourceFixture.root, sourceRelative));
    safeFailure(await getDeliveryContext({}, sourceFixture.dependencies), "unavailable", "unsafe_path");
});

test("timeouts, output caps and arbitrary execution failures have no raw fallback", async () => {
    const f = fixture();
    for (const code of ["exporter_timeout", "output_limit", "exporter_failed"]) {
        f.dependencies.execute = async () => { throw new DeliveryContextError(code); };
        safeFailure(await getDeliveryContext({}, f.dependencies), code === "output_limit" ? "invalid" : "unavailable", code);
    }
    f.dependencies.execute = async () => { throw new Error("DO_NOT_DISCLOSE"); };
    safeFailure(await getDeliveryContext({}, f.dependencies), "unavailable", "exporter_unavailable");
    f.dependencies.execute = async () => { throw new DeliveryContextError("DO_NOT_DISCLOSE"); };
    safeFailure(await getDeliveryContext({}, f.dependencies), "unavailable", "exporter_unavailable");
    f.dependencies.execute = async () => ({ stdout: "ก".repeat(700000) });
    safeFailure(await getDeliveryContext({}, f.dependencies), "invalid", "output_limit");
});

test("artifact pagination verifies Unicode codepoints and exact registered body/hash", async () => {
    const path = "docs/lifecycle/PRODUCT-DELIVERY-FLOW.md";
    const body = "ก🙂abc";
    const hash = createHash("sha256").update(body).digest("hex");
    const artifact_id = `artifact-${createHash("sha256").update(`architecture-docs:${path}`).digest("hex").slice(0, 32)}`;
    const query: DeliveryContextQuery = { view: "artifact", artifact_id, offset: 0, limit: 2 };
    const f = fixture(query);
    mkdirSync(dirname(join(f.root, path)), { recursive: true });
    writeFileSync(join(f.root, path), body);
    const data = {
        artifact_id, path, owner_repository: "architecture-docs", availability: "available", source: path,
        version: `sha256:${hash}`, sha256: hash, body: "ก🙂", offset: 0, limit: 2, total: 5,
        unit: "unicode-codepoint", truncated: true, next_offset: 2,
    };
    f.result.data = data;
    assert.deepEqual(await getDeliveryContext(query, f.dependencies), f.result);
    for (const change of [
        { body: "กx" }, { body: "ก🙂a" }, { sha256: "a".repeat(64), version: `sha256:${"a".repeat(64)}` },
        { source: "DO_NOT_DISCLOSE" }, { next_offset: 3 }, { offset: 1 }, { total: 6 }, { truncated: false },
        { path: "roles/finance-and-legal/records/private.md", owner_repository: "knowledge-base" },
        { path: "docs/lifecycle/unregistered.md" },
    ]) {
        f.result.data = { ...data, ...change };
        safeFailure(await getDeliveryContext(query, f.dependencies));
    }
    f.result.data = { ...data, offset: 5, body: "", truncated: false, next_offset: null };
    f.result.filters.offset = 5;
    assert.equal((await getDeliveryContext({ ...query, offset: 5 }, f.dependencies)).status, "ready");
});

test("unexpected data and exporter failures expose only approved error codes", async () => {
    const f = fixture();
    for (const data of [
        { ...f.result.data, raw: "DO_NOT_DISCLOSE" },
        { ...f.result.data, counts: { credentials: "DO_NOT_DISCLOSE" } },
    ]) {
        f.dependencies.execute = async () => ({ stdout: JSON.stringify({ ...f.result, data }) });
        safeFailure(await getDeliveryContext({}, f.dependencies), "invalid", "invalid_data");
    }
    for (const status of ["invalid", "unavailable"]) {
        f.dependencies.execute = async () => ({ stdout: JSON.stringify({ contract: DELIVERY_CONTEXT_CONTRACT, status, errors: [{ code: "role_unknown" }], raw: "DO_NOT_DISCLOSE" }) });
        safeFailure(await getDeliveryContext({}, f.dependencies), status, "role_unknown");
    }
    f.dependencies.execute = async () => ({ stdout: JSON.stringify({ contract: DELIVERY_CONTEXT_CONTRACT, status: "invalid", errors: [{ code: "DO_NOT_DISCLOSE" }] }) });
    safeFailure(await getDeliveryContext({}, f.dependencies), "invalid", "invalid_contract");
});

test("real subprocess maxBuffer failures cannot disclose stdout or stderr", async () => {
    const f = fixture();
    writeFileSync(join(f.root, "scripts/delivery_context.py"), "import sys\nsys.stderr.write('DO_NOT_DISCLOSE')\nsys.stdout.write('x' * 2097153)\n");
    safeFailure(await getDeliveryContext({}, { env: f.dependencies.env }), "invalid", "output_limit");
});

test("real MCP tools/list and callTool expose read-only metadata and structured/text parity", async () => {
    const f = fixture();
    const server = new McpServer({ name: "delivery-context-fixture", version: "1.0.0" });
    const client = new Client({ name: "delivery-context-client", version: "1.0.0" });
    registerDeliveryContextTools({ server }, f.dependencies);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
        const tool = (await client.listTools()).tools.find((item) => item.name === "get_delivery_context");
        assert.ok(tool);
        assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
        assert.equal(tool.inputSchema.additionalProperties, false);
        const result = await client.callTool({ name: "get_delivery_context", arguments: {} });
        const content = result.content as Array<{ type: string; text?: string }>;
        assert.deepEqual(JSON.parse(content[0].text!), result.structuredContent);
        assert.deepEqual(result.structuredContent, f.result);
        const invalid = await client.callTool({ name: "get_delivery_context", arguments: { view: "overview", role: "business-analyst" } });
        assert.equal(invalid.isError, true);
        safeFailure(invalid.structuredContent);
        const schemaFailure = await client.callTool({ name: "get_delivery_context", arguments: { root: "DO_NOT_DISCLOSE" } });
        assert.equal(schemaFailure.isError, true);
        assert.ok(!JSON.stringify(schemaFailure).includes("DO_NOT_DISCLOSE"));
    } finally {
        await client.close();
        await server.close();
    }
});

test("owner CLI uses this shared parser and returns the same offline definition result", {
    skip: !existsSync(join(opsRoot(), "infra/cli.ts")) || !readFileSync(join(opsRoot(), "infra/cli.ts"), "utf8").includes("delivery-context")
        ? "owner CLI delivery-context route is not installed" : false,
}, () => {
    const f = fixture();
    writeFileSync(join(f.root, "scripts/delivery_context.py"), `import json\nprint(${JSON.stringify(JSON.stringify(f.result))})\n`);
    const result = spawnSync(process.execPath, [join(MCP_ROOT, "node_modules/tsx/dist/cli.mjs"), join(opsRoot(), "infra/cli.ts"), "delivery", "overview", "--json"], {
        cwd: opsRoot(), env: { ...process.env, EMPIRE_CLIENT_CONFIG: "/nonexistent", SOLO_ARCHITECTURE_ROOT: f.root, SOLO_MCP_ROOT: MCP_ROOT },
        encoding: "utf8", timeout: 15000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), f.result);
});

function knowledgeFixture() {
    const path = "roles/finance-and-legal/PROCESS.md";
    const artifact_id = `artifact-${createHash("sha256").update(`knowledge-base:${path}`).digest("hex").slice(0, 32)}`;
    const query: DeliveryContextQuery = { view: "artifact", artifact_id, limit: 2 };
    const f = fixture(query);
    const knowledge = join(directory, `knowledge-${fixtureCount}`);
    const defaultKnowledge = resolve(f.root, "../knowledge-base");
    for (const [root, body] of [[knowledge, "ก🙂alt"], [defaultKnowledge, "default policy"]]) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), body);
    }
    const body = readFileSync(join(knowledge, path), "utf8");
    const sha256 = createHash("sha256").update(body).digest("hex");
    f.result.data = {
        artifact_id, path, owner_repository: "knowledge-base", availability: "available", source: path,
        version: `sha256:${sha256}`, sha256, body: Array.from(body).slice(0, 2).join(""), offset: 0, limit: 2,
        total: Array.from(body).length, unit: "unicode-codepoint", truncated: true, next_offset: 2,
    };
    f.dependencies.env!.SOLO_KNOWLEDGE_ROOT = knowledge;
    return { ...f, knowledge, defaultKnowledge, query, path };
}

test("configured knowledge root reaches exporter; missing or unsafe roots never fall back", async () => {
    const f = knowledgeFixture();
    f.dependencies.execute = async (_command, _args, options) => {
        assert.equal(options.env.SOLO_KNOWLEDGE_ROOT, f.knowledge);
        return { stdout: JSON.stringify(f.result) };
    };
    assert.equal((await getDeliveryContext(f.query, f.dependencies)).status, "ready");
    f.dependencies.env!.SOLO_KNOWLEDGE_ROOT = join(directory, "absent-knowledge");
    f.dependencies.execute = async () => ({ stdout: JSON.stringify(f.result) });
    safeFailure(await getDeliveryContext(f.query, f.dependencies), "unavailable");
    let calls = 0;
    f.dependencies.execute = async () => { calls++; return { stdout: JSON.stringify(f.result) }; };
    for (const root of ["", join(directory, "config", "knowledge-base"), `${f.knowledge}/../knowledge-base`]) {
        f.dependencies.env!.SOLO_KNOWLEDGE_ROOT = root;
        safeFailure(await getDeliveryContext(f.query, f.dependencies), "unavailable", "unsafe_path");
    }
    assert.equal(calls, 0);
    delete f.dependencies.env!.SOLO_KNOWLEDGE_ROOT;
    const body = readFileSync(join(f.defaultKnowledge, f.path), "utf8");
    const hash = createHash("sha256").update(body).digest("hex");
    f.result.data = { ...f.result.data, body: body.slice(0, 2), sha256: hash, version: `sha256:${hash}`, total: body.length };
    f.dependencies.execute = async () => ({ stdout: JSON.stringify(f.result) });
    assert.equal((await getDeliveryContext(f.query, f.dependencies)).status, "ready");
});

test("knowledge policy bodies, hashes and Unicode pages must match the bounded local file", async () => {
    const f = knowledgeFixture();
    assert.equal((await getDeliveryContext(f.query, f.dependencies)).status, "ready");
    const data = { ...f.result.data };
    for (const change of [
        { body: "xy" }, { sha256: "a".repeat(64), version: `sha256:${"a".repeat(64)}` }, { total: 6 },
    ]) {
        f.result.data = { ...data, ...change };
        safeFailure(await getDeliveryContext(f.query, f.dependencies));
    }
    f.result.data = data;
    rmSync(join(f.knowledge, f.path));
    safeFailure(await getDeliveryContext(f.query, f.dependencies), "unavailable");
    symlinkSync(join(f.defaultKnowledge, f.path), join(f.knowledge, f.path));
    safeFailure(await getDeliveryContext(f.query, f.dependencies), "unavailable", "unsafe_path");
    const linkedRoot = join(directory, `linked-knowledge-${fixtureCount}`);
    symlinkSync(f.defaultKnowledge, linkedRoot);
    f.dependencies.env!.SOLO_KNOWLEDGE_ROOT = linkedRoot;
    safeFailure(await getDeliveryContext(f.query, f.dependencies), "unavailable", "unsafe_path");
});

function installKnowledgeFixtureExporter(f: ReturnType<typeof knowledgeFixture>): void {
    writeFileSync(join(f.root, "scripts/delivery_context.py"), [
        "import hashlib, json, os", "from pathlib import Path",
        `payload = json.loads(${JSON.stringify(JSON.stringify(f.result))})`,
        'root = Path(os.environ.get("SOLO_KNOWLEDGE_ROOT", str(Path(__file__).resolve().parent.parent.parent / "knowledge-base")))',
        "try:", `    data = (root / ${JSON.stringify(f.path)}).read_bytes()`,
        '    text = data.decode("utf-8")', '    digest = hashlib.sha256(data).hexdigest()',
        '    payload["data"].update(sha256=digest, version="sha256:"+digest, body=text[:2], total=len(text), truncated=len(text)>2, next_offset=2 if len(text)>2 else None)',
        "except FileNotFoundError:",
        `    payload = {"contract": ${JSON.stringify(DELIVERY_CONTEXT_CONTRACT)}, "status": "unavailable", "errors": [{"code": "artifact_unavailable"}]}`,
        'print(json.dumps(payload, ensure_ascii=False))', "",
    ].join("\n"));
}

test("real exporter, MCP and owner CLI keep alternate and missing knowledge roots when a default exists", {
    skip: !existsSync(join(opsRoot(), "infra/cli.ts")) ? "owner CLI checkout is absent" : false,
}, async () => {
    const f = knowledgeFixture();
    installKnowledgeFixtureExporter(f);
    const server = new McpServer({ name: "knowledge-root-fixture", version: "1.0.0" });
    const client = new Client({ name: "knowledge-root-client", version: "1.0.0" });
    registerDeliveryContextTools({ server }, { env: f.dependencies.env });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
        for (const missing of [false, true]) {
            f.dependencies.env!.SOLO_KNOWLEDGE_ROOT = missing ? join(directory, "absent-configured-knowledge") : f.knowledge;
            const result = await client.callTool({ name: "get_delivery_context", arguments: f.query });
            if (missing) safeFailure(result.structuredContent, "unavailable", "artifact_unavailable");
            else {
                assert.equal((result.structuredContent as any).status, "ready");
                assert.equal((result.structuredContent as any).data.body, "ก🙂");
            }
            const cli = spawnSync(process.execPath, [join(MCP_ROOT, "node_modules/tsx/dist/cli.mjs"), join(opsRoot(), "infra/cli.ts"), "delivery", "artifact", "--artifact-id", f.query.artifact_id!, "--limit", "2", "--json"], {
                cwd: opsRoot(), env: { ...process.env, EMPIRE_CLIENT_CONFIG: "/nonexistent", SOLO_MCP_ROOT: MCP_ROOT, ...f.dependencies.env },
                encoding: "utf8", timeout: 15000,
            });
            assert.ifError(cli.error);
            assert.equal(cli.status, missing ? 2 : 0, cli.stderr);
            assert.deepEqual(JSON.parse(cli.stdout), result.structuredContent);
        }
    } finally { await client.close(); await server.close(); }
});

test("all three delivery views reject steps unrelated to the requested canonical role", async () => {
    for (const view of ["workflow", "documents", "refinement"] as const) {
        const query = { view, role: "finance-accounting" };
        const f = fixture(query);
        const key = view === "documents" ? "step_documents" : "steps";
        f.result.data[key] = view === "workflow" ? [{ id: "PD01" }] : [{ step_id: "PD01" }];
        safeFailure(await getDeliveryContext(query, f.dependencies), "invalid", "filter_mismatch");
    }
});

test("canonical owner/reviewer and step intersections require the exact result set", async () => {
    for (const view of ["workflow", "documents", "refinement"] as const) {
        const key = view === "documents" ? "step_documents" : "steps";
        const query = { view, role: "product-manager" };
        const f = fixture(query);
        assert.equal((await getDeliveryContext(query, f.dependencies)).status, "ready");
        const original = f.result.data[key] as Array<Record<string, unknown>>;
        for (const steps of [original.slice(0, 1), [original[0], original[0]], [original[0], { [view === "workflow" ? "id" : "step_id"]: "BA04" }]]) {
            f.result.data[key] = steps;
            safeFailure(await getDeliveryContext(query, f.dependencies), "invalid", "filter_mismatch");
        }
        const intersection = { view, role: "product-manager", step: "BA03" };
        const selected = fixture(intersection);
        assert.equal((await getDeliveryContext(intersection, selected.dependencies)).status, "ready");
        const unrelated = { view, role: "finance-accounting", step: "PD01" };
        const denied = fixture(unrelated);
        denied.result.data[key] = [{ [view === "workflow" ? "id" : "step_id"]: "PD01" }];
        safeFailure(await getDeliveryContext(unrelated, denied.dependencies), "invalid", "filter_mismatch");
    }
});

test("source-defined family roles legitimately have empty results in all three delivery views", {
    skip: !existsSync(join(architectureRoot(), "docs/registries/ROLE-CATALOG.yaml")) ? "architecture checkout is absent" : false,
}, async () => {
    const root = architectureRoot();
    const catalog = parseDocument(readFileSync(join(root, "docs/registries/ROLE-CATALOG.yaml"), "utf8")).toJS();
    const workflow = parseDocument(readFileSync(join(root, "systems/architecture/product-delivery-workflow.yaml"), "utf8")).toJS();
    const direct = new Set(workflow.steps.flatMap((step: any) => [step.owner_role, ...step.reviewer_roles]));
    const families = catalog.roles.map((role: any) => role.id).filter((role: string) => !direct.has(role));
    assert.equal(families.length, 39);
    for (const role of families) {
        for (const view of ["workflow", "documents", "refinement"] as const) {
            const query = { view, role };
            const f = fixture(query);
            const roleBytes = readFileSync(join(root, sourceRelative));
            writeFileSync(join(f.root, sourceRelative), roleBytes);
            f.result.sources.find((source) => source.path === sourceRelative)!.sha256 = createHash("sha256").update(roleBytes).digest("hex");
            assert.equal((await getDeliveryContext(query, f.dependencies)).status, "ready", `${view}:${role}`);
        }
    }
});

test("canonical workflow parsing rejects aliases, duplicate keys and malformed ownership", async () => {
    const f = fixture({ view: "workflow", step: "PD01" });
    const valid = readFileSync(join(f.root, sourcePaths[0]), "utf8");
    for (const source of [
        `${valid}\nsteps: []\n`, `${valid}\nextra: &alias []\ncopy: *alias\n`,
        valid.replace("owner_role: product-manager", "owner_role: [DO_NOT_DISCLOSE]"),
    ]) {
        writeFileSync(join(f.root, sourcePaths[0]), source);
        f.result.sources[0].sha256 = createHash("sha256").update(source).digest("hex");
        safeFailure(await getDeliveryContext({ view: "workflow", step: "PD01" }, f.dependencies), "invalid", "invalid_provenance");
    }
});

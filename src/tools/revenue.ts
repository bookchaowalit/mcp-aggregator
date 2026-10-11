import { createHash } from "node:crypto";
import { z } from "zod";
import type { ToolContext } from "../tool-context.js";
import { ledgerSection, openCrmLedger } from "../crm-ledger.js";

/** Revenue lives in the CRM ledger (income-pipeline); these tools are thin clients of its API. */
export function registerRevenueTools({ server }: ToolContext): void {

    server.tool(
        "get_revenue",
        "Get revenue records from the CRM ledger",
        {
            source_type: z.string().optional(),
            start_date: z.string().optional(),
            end_date: z.string().optional(),
        },
        async (params) => {
            const section = await ledgerSection((ledger) => ledger.revenue({
                source_type: params.source_type, since: params.start_date, until: params.end_date,
            }));
            const body = section.available
                ? { records: section.data.rows, totals: section.data.totals }
                : { available: false, reason: section.reason };
            return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
        },
    );

    server.tool(
        "add_revenue",
        "Add a revenue record to the CRM ledger (idempotent on the same date, type, amount, currency and source)",
        {
            source_type: z.string(),
            source_name: z.string().optional(),
            amount: z.number(),
            currency: z.string().optional().default("THB"),
            revenue_date: z.string(),
            description: z.string().optional(),
        },
        async (params) => {
            const currency = params.currency || "THB";
            const key = "mcp:" + createHash("sha256")
                .update(`${params.revenue_date}|${params.source_type}|${params.amount}|${currency}|${params.source_name ?? ""}`)
                .digest("hex").slice(0, 32);
            const fields: Record<string, unknown> = {
                source_type: params.source_type, amount: params.amount, currency,
                revenue_date: params.revenue_date, idempotency_key: key,
            };
            if (params.source_name) fields.source_name = params.source_name;
            if (params.description) fields.description = params.description;
            let body: Record<string, unknown>;
            try {
                const { outcome, revenue } = await openCrmLedger().addRevenue(fields);
                body = { success: true, outcome, id: revenue.id };
            } catch (error) {
                body = { success: false, available: false, reason: (error as Error).message.split("\n")[0] };
            }
            return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
        },
    );

}

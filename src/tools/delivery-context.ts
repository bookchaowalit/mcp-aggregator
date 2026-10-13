import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { deliveryContextQuerySchema, getDeliveryContext, type DeliveryContextDependencies } from "../delivery-context.js";

export function registerDeliveryContextTools({ server }: { server: McpServer }, dependencies: DeliveryContextDependencies = {}): void {
    server.registerTool("get_delivery_context", {
        title: "Delivery context",
        description: "อ่านมาตรฐาน workflow, role, เอกสาร, refinement และแม่แบบกลางที่ตรวจเวอร์ชันแล้ว เป็นข้อมูลนิยาม ไม่ใช่สถานะงานจริงหรือการอนุมัติธุรกิจ",
        inputSchema: deliveryContextQuerySchema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async (query) => {
        const result = await getDeliveryContext(query, dependencies);
        return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            structuredContent: result,
            ...(result.status !== "ready" ? { isError: true } : {}),
        };
    });
}

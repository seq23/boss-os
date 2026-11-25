import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { callSimoneTool } from "./simone-tool-client.mjs";

const socket = process.argv[2];
if (!socket) process.exit(2);

const server = new McpServer({ name: "simone", version: "1.0.0" });
server.registerTool("run_tool", {
  description: "Read Simone’s records or carry out a supported action through the current task’s tool broker.",
  inputSchema: { tool: z.string().min(1).max(60), task: z.string().max(3000).optional() },
}, async ({ tool, task }) => {
  try {
    const result = await callSimoneTool(socket, tool, task);
    return { content: [{ type: "text", text: JSON.stringify(result) }], isError: !result.ok };
  } catch {
    return { content: [{ type: "text", text: "Simone's tools are unavailable." }], isError: true };
  }
});

await server.connect(new StdioServerTransport());

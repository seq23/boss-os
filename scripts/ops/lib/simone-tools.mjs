import { createServer } from "node:net";

/** The model supplies a tool name and optional task id. Only the trusted parent attaches the lease. */
export async function listenForSimoneTools(path, call, api, hasCredential) {
  const receipts = [];
  const server = createServer({ allowHalfOpen: true }, (client) => {
    let input = "";
    client.setEncoding("utf8");
    client.setTimeout(15_000, () => client.destroy());
    client.on("error", () => client.destroy());
    client.on("data", (chunk) => {
      input += chunk;
      if (Buffer.byteLength(input) > 4096) client.destroy();
    });
    client.on("end", async () => {
      let output = { ok: false, code: "TOOL_FAILED" };
      try {
        const { tool, task } = JSON.parse(input);
        if (typeof tool !== "string") throw new Error("Missing tool name");
        const result = await api("POST", "/tool", { id: call.id, lease: call.lease, tool, task });
        if (hasCredential(JSON.stringify(result))) output = { ok: false, code: "SECRET_OUTPUT" };
        else {
          output = result;
          if (result.ok && (result.receipt || result.rows?.length)) receipts.push(tool);
        }
      } catch { /* A failed tool return contains neither private detail nor a completion receipt. */ }
      client.end(JSON.stringify(output));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, resolve);
  });
  return { receipts, close: () => new Promise((resolve) => server.close(resolve)) };
}

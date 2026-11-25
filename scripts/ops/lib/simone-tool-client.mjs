import { connect } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

export function callSimoneTool(socket, tool, task) {
  return new Promise((resolve, reject) => {
    const client = connect(socket, () => client.end(JSON.stringify({ tool, task })));
    let response = "";
    client.setEncoding("utf8");
    client.setTimeout(120_000, () => client.destroy(new Error("Timed out")));
    client.on("error", reject);
    client.on("data", (chunk) => { response += chunk; });
    client.on("end", () => {
      try { resolve(JSON.parse(response)); } catch (error) { reject(error); }
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [tool, task] = process.argv.slice(2);
  if (!tool) process.exit(2);
  try {
    const result = await callSimoneTool(fileURLToPath(new URL("./tools.sock", import.meta.url)), tool, task);
    console.log(JSON.stringify(result));
  } catch {
    console.error("Simone's tools are unavailable");
    process.exitCode = 1;
  }
}

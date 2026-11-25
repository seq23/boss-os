import { connect } from "node:net";

const [tool, task] = process.argv.slice(2);
if (!tool) process.exit(2);
const client = connect(new URL("./tools.sock", import.meta.url).pathname, () => client.end(JSON.stringify({ tool, task })));
client.setEncoding("utf8");
client.setTimeout(120_000, () => client.destroy(new Error("Timed out")));
client.on("error", () => { console.error("Simone's tools are unavailable"); process.exitCode = 1; });
client.pipe(process.stdout);

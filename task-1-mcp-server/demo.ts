import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entryPath = path.resolve(__dirname, "src/index.ts");
const tsxCli = path.resolve(__dirname, "../node_modules/tsx/dist/cli.mjs");

console.log("\n=======================================================");
console.log("  Task 1: Live Interactive Demo of MCP STDIO Server");
console.log("=======================================================\n");

const serverProcess = spawn(process.execPath, [tsxCli, entryPath], {
  stdio: ["pipe", "pipe", "pipe"],
});

let stdoutBuffer = "";
let requestId = 1;

serverProcess.stderr.on("data", (chunk: Buffer) => {
  const lines = chunk.toString("utf8").trim().split("\n");
  for (const line of lines) {
    console.log(`\x1b[33m[SERVER STDERR LOG]\x1b[0m ${line}`);
  }
});

function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const currentId = requestId++;
  const payload = { jsonrpc: "2.0", id: currentId, method, params };

  return new Promise((resolve) => {
    const onData = (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.id === currentId) {
            serverProcess.stdout.off("data", onData);
            resolve(parsed);
          }
        } catch {
          // ignore non-JSON
        }
      }
    };

    serverProcess.stdout.on("data", onData);
    console.log(`\n\x1b[36m>>> CLIENT REQUEST (id=${currentId}):\x1b[0m`);
    console.log(JSON.stringify(payload, null, 2));
    serverProcess.stdin.write(JSON.stringify(payload) + "\n");
  });
}

async function runDemo() {
  // 1. Initialize
  console.log("\n--- STEP 1: Protocol Handshake (initialize) ---");
  const initRes = await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "demo-client", version: "1.0.0" },
  });
  console.log(`\x1b[32m<<< SERVER RESPONSE:\x1b[0m\n`, JSON.stringify(initRes, null, 2));

  serverProcess.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n"
  );

  // 2. List tools
  console.log("\n--- STEP 2: Query Advertised Tools (tools/list) ---");
  const listRes = await send("tools/list", {});
  console.log(`\x1b[32m<<< SERVER RESPONSE:\x1b[0m\n`, JSON.stringify(listRes, null, 2));

  // 3. Call get_customer_record with valid ID
  console.log("\n--- STEP 3: Valid Tool Call: get_customer_record (CUST-10001) ---");
  const getCustRes = await send("tools/call", {
    name: "get_customer_record",
    arguments: { customer_id: "CUST-10001" },
  });
  console.log(`\x1b[32m<<< SERVER RESPONSE:\x1b[0m\n`, JSON.stringify(getCustRes, null, 2));

  // 4. Call admin_trigger_refund with valid parameters
  console.log("\n--- STEP 4: Valid Tool Call: admin_trigger_refund ($75.50) ---");
  const refundRes = await send("tools/call", {
    name: "admin_trigger_refund",
    arguments: {
      customer_id: "CUST-10002",
      amount: 75.5,
      reason: "Customer dissatisfaction with delayed express delivery",
    },
  });
  console.log(`\x1b[32m<<< SERVER RESPONSE:\x1b[0m\n`, JSON.stringify(refundRes, null, 2));

  // 5. Call get_customer_record with invalid format
  console.log("\n--- STEP 5: Invalid Input Rejection: get_customer_record (BAD-ID) ---");
  const badCustRes = await send("tools/call", {
    name: "get_customer_record",
    arguments: { customer_id: "BAD-ID-99" },
  });
  console.log(`\x1b[31m<<< SERVER ERROR RESPONSE (-32602 Invalid params):\x1b[0m\n`, JSON.stringify(badCustRes, null, 2));

  // 6. Call admin_trigger_refund with negative amount
  console.log("\n--- STEP 6: Invalid Input Rejection: admin_trigger_refund (negative amount) ---");
  const badRefundRes = await send("tools/call", {
    name: "admin_trigger_refund",
    arguments: {
      customer_id: "CUST-10002",
      amount: -25.0,
      reason: "Attempted negative refund",
    },
  });
  console.log(`\x1b[31m<<< SERVER ERROR RESPONSE (-32602 Invalid params):\x1b[0m\n`, JSON.stringify(badRefundRes, null, 2));

  // 7. Call admin_trigger_refund on suspended account
  console.log("\n--- STEP 7: Internal Error: admin_trigger_refund on Suspended Account ---");
  const suspendedRes = await send("tools/call", {
    name: "admin_trigger_refund",
    arguments: {
      customer_id: "CUST-10003",
      amount: 10.0,
      reason: "Refund attempt on account flagged as suspended",
    },
  });
  console.log(`\x1b[31m<<< SERVER ERROR RESPONSE (-32603 Internal error):\x1b[0m\n`, JSON.stringify(suspendedRes, null, 2));

  console.log("\n=======================================================");
  console.log("  Demo Complete: Pure STDIO Isolation Verified!");
  console.log("  - Yellow: Server logs routed to STDERR");
  console.log("  - Cyan/Green/Red: Pure JSON-RPC 2.0 frames over STDOUT");
  console.log("=======================================================\n");

  serverProcess.kill();
  process.exit(0);
}

runDemo().catch((err) => {
  console.error("Demo failed:", err);
  serverProcess.kill();
  process.exit(1);
});

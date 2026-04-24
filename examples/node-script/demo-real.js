/**
 * Real-world example: actually calls the OpenAI API.
 * Set OPENAI_API_KEY in the environment first.
 *
 * Records go to ./.llmmeter/llmmeter.db. View with `npx @amit641/llmmeter-cli dashboard`.
 */

import OpenAI from "openai";
import { meter } from "@amit641/llmmeter";
import { sqliteSink } from "@amit641/llmmeter/sqlite";
import { withContext, shutdown } from "@amit641/llmmeter";

if (!process.env.OPENAI_API_KEY) {
  console.error("Set OPENAI_API_KEY to run this demo.");
  process.exit(1);
}

const openai = meter(new OpenAI(), {
  sink: sqliteSink({ filePath: "./.llmmeter/llmmeter.db" }),
  recordPayload: false,
  maxDailySpendUsd: 1.0,
  onBudgetExceeded: "warn",
});

await withContext({ userId: "u_demo", feature: "demo" }, async () => {
  const r = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "Say hi in one word." }],
  });
  console.log("response:", r.choices[0]?.message?.content);
});

await shutdown();
console.log("\nRun  `npx @amit641/llmmeter-cli dashboard`  to see the call.\n");

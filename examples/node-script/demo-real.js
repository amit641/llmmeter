/**
 * Real-world example: actually calls the OpenAI API.
 * Set OPENAI_API_KEY in the environment first.
 *
 * Records go to ./.amit641/llmmeter.db. View with `npx llmmeter dashboard`.
 */

import OpenAI from "openai";
import { meter } from "llmmeter";
import { sqliteSink } from "llmmeter/sqlite";
import { withContext, shutdown } from "llmmeter";

if (!process.env.OPENAI_API_KEY) {
  console.error("Set OPENAI_API_KEY to run this demo.");
  process.exit(1);
}

const openai = meter(new OpenAI(), {
  sink: sqliteSink({ filePath: "./.amit641/llmmeter.db" }),
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
console.log("\nRun  `npx llmmeter dashboard`  to see the call.\n");

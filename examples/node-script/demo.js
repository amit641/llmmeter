/**
 * Demo: simulates 100 OpenAI chat calls without ever hitting the network.
 * Records go to ./.llmmeter/llmmeter.db so you can launch the dashboard with
 *   npx @amit641/llmmeter-cli dashboard
 *
 * Run:  node demo.js
 */

import { meter } from "@amit641/llmmeter/openai";
import { sqliteSink } from "@amit641/llmmeter/sqlite";
import { withContext, shutdown } from "@amit641/llmmeter";

const features = ["chat", "summarize", "rag", "agent"];
const models = ["gpt-4o", "gpt-4o-mini", "o1-mini"];
const users = ["u_alice", "u_bob", "u_carol"];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fakeOpenAI() {
  return {
    chat: {
      completions: {
        async create(body) {
          await new Promise((r) => setTimeout(r, 20 + Math.random() * 100));
          if (Math.random() < 0.05) {
            const err = new Error("rate limited");
            err.name = "RateLimitError";
            throw err;
          }
          const inTok = 200 + Math.floor(Math.random() * 1500);
          const outTok = 50 + Math.floor(Math.random() * 800);
          return {
            id: "chatcmpl_" + Math.random().toString(36).slice(2),
            model: body.model,
            choices: [{ message: { role: "assistant", content: "ok." } }],
            usage: { prompt_tokens: inTok, completion_tokens: outTok },
          };
        },
      },
    },
  };
}

const sink = sqliteSink({ filePath: "./.llmmeter/llmmeter.db" });
const openai = meter(fakeOpenAI(), { sink });

const N = 200;
let ok = 0;
let err = 0;

for (let i = 0; i < N; i++) {
  const feature = pick(features);
  const userId = pick(users);
  const model = pick(models);
  await withContext({ userId, feature, conversationId: `conv_${i % 30}` }, async () => {
    try {
      await openai.chat.completions.create({
        model,
        messages: [{ role: "user", content: `Hello #${i}` }],
      });
      ok++;
    } catch {
      err++;
    }
  });
}

await sink.flush();
await shutdown();

console.log(`\nDone. ok=${ok} err=${err}\n`);
console.log("Now run:  npx @amit641/llmmeter-cli dashboard\n");

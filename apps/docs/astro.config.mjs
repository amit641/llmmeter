import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://llmmeter.dev",
  integrations: [
    starlight({
      title: "llmmeter",
      description: "Drop-in observability and cost tracking for any LLM SDK.",
      social: {
        github: "https://github.com/amit641/llmmeter",
      },
      customCss: ["./src/styles/custom.css"],
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Why llmmeter?", slug: "intro/why" },
            { label: "Quick start", slug: "intro/quick-start" },
            { label: "Concepts", slug: "intro/concepts" },
          ],
        },
        {
          label: "Adapters",
          items: [
            { label: "OpenAI", slug: "adapters/openai" },
            { label: "Anthropic", slug: "adapters/anthropic" },
            { label: "Google Gemini", slug: "adapters/google" },
            { label: "Mistral", slug: "adapters/mistral" },
            { label: "Vercel AI SDK", slug: "adapters/vercel-ai" },
            { label: "fetch (catch-all)", slug: "adapters/fetch" },
          ],
        },
        {
          label: "Sinks",
          items: [
            { label: "JSONL (default)", slug: "sinks/jsonl" },
            { label: "SQLite (local)", slug: "sinks/sqlite" },
            { label: "HTTP (edge)", slug: "sinks/http" },
            { label: "Postgres (production)", slug: "sinks/postgres" },
            { label: "OpenTelemetry", slug: "sinks/otel" },
          ],
        },
        {
          label: "Production",
          items: [
            { label: "Self-hosted Docker", slug: "production/self-host" },
            { label: "Edge runtimes", slug: "production/edge" },
            { label: "Cloud (coming soon)", slug: "production/cloud" },
          ],
        },
        {
          label: "Tooling",
          items: [
            { label: "CLI", slug: "tooling/cli" },
            { label: "Live tail", slug: "tooling/tail" },
            { label: "Routing analyzer", slug: "tooling/analyze" },
            { label: "Dashboard", slug: "tooling/dashboard" },
          ],
        },
      ],
    }),
  ],
});

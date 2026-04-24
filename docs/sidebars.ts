import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docsSidebar: [
    "intro",
    "getting-started",
    "concepts",
    {
      type: "category",
      label: "Adapters",
      collapsed: false,
      items: [
        "adapters/openai",
        "adapters/anthropic",
        "adapters/google",
        "adapters/mistral",
        "adapters/vercel-ai",
        "adapters/fetch",
      ],
    },
    {
      type: "category",
      label: "Sinks",
      collapsed: false,
      items: [
        "sinks/jsonl",
        "sinks/sqlite",
        "sinks/postgres",
        "sinks/http",
        "sinks/otel",
      ],
    },
    {
      type: "category",
      label: "CLI & Tooling",
      collapsed: false,
      items: [
        "tooling/cli",
        "tooling/dashboard",
        "tooling/tail",
        "tooling/analyze",
      ],
    },
    {
      type: "category",
      label: "Production",
      collapsed: false,
      items: [
        "production/self-host",
        "production/edge",
        "production/cloud",
      ],
    },
  ],
};

export default sidebars;

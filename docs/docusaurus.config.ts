import { themes as prismThemes } from "prism-react-renderer";
import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

const config: Config = {
  title: "llmmeter — Drop-in Observability & Cost Tracking for any LLM SDK",
  tagline:
    "Wrap your LLM client in one line. Get cost, tokens, latency, and traces across OpenAI, Anthropic, Google, Mistral, and more — local SQLite or self-hosted Postgres, OTel-ready.",
  favicon: "img/favicon.ico",

  url: "https://amit641.github.io",
  baseUrl: "/llmmeter/",

  organizationName: "amit641",
  projectName: "llmmeter",
  trailingSlash: false,

  onBrokenLinks: "warn",
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },

  headTags: [
    {
      tagName: "meta",
      attributes: {
        name: "description",
        content:
          "llmmeter is a drop-in observability and cost tracking library for LLM SDKs. Track tokens, USD cost, latency, and traces for OpenAI, Anthropic, Google, Mistral, Vercel AI SDK, and more. Local SQLite, self-hosted Postgres, and OpenTelemetry sinks. One line of code.",
      },
    },
    {
      tagName: "meta",
      attributes: {
        name: "keywords",
        content:
          "llmmeter, llm observability, llm cost tracking, openai cost, anthropic cost, llm monitoring, gpt cost tracking, ai observability, llm tracing, opentelemetry llm, vercel ai sdk monitoring, llm dashboard, sqlite llm, postgres llm",
      },
    },
    {
      tagName: "meta",
      attributes: {
        property: "og:title",
        content: "llmmeter — Drop-in Observability & Cost Tracking for any LLM SDK",
      },
    },
    {
      tagName: "meta",
      attributes: {
        property: "og:description",
        content:
          "Wrap your LLM client in one line. Get cost, tokens, latency, and traces across OpenAI, Anthropic, Google, Mistral, and more.",
      },
    },
    {
      tagName: "meta",
      attributes: { property: "og:type", content: "website" },
    },
    {
      tagName: "meta",
      attributes: {
        property: "og:url",
        content: "https://amit641.github.io/llmmeter/",
      },
    },
    {
      tagName: "meta",
      attributes: { name: "twitter:card", content: "summary" },
    },
    {
      tagName: "meta",
      attributes: {
        name: "twitter:title",
        content: "llmmeter — Drop-in Observability & Cost Tracking for any LLM SDK",
      },
    },
    {
      tagName: "meta",
      attributes: {
        name: "twitter:description",
        content:
          "One line of code to track LLM tokens, cost, latency, and traces across every major provider.",
      },
    },
  ],

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          routeBasePath: "/",
          editUrl: "https://github.com/amit641/llmmeter/tree/main/docs/",
        },
        blog: false,
        sitemap: {
          lastmod: "date",
          changefreq: "weekly",
          priority: 0.5,
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "llmmeter",
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Docs",
        },
        {
          href: "https://www.npmjs.com/package/@amit641/llmmeter",
          label: "npm",
          position: "right",
        },
        {
          href: "https://github.com/amit641/llmmeter",
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Why llmmeter?", to: "/" },
            { label: "Quick start", to: "/getting-started" },
            { label: "Concepts", to: "/concepts" },
            { label: "CLI", to: "/tooling/cli" },
          ],
        },
        {
          title: "Adapters",
          items: [
            { label: "OpenAI", to: "/adapters/openai" },
            { label: "Anthropic", to: "/adapters/anthropic" },
            { label: "Google", to: "/adapters/google" },
            { label: "Vercel AI SDK", to: "/adapters/vercel-ai" },
            { label: "fetch (catch-all)", to: "/adapters/fetch" },
          ],
        },
        {
          title: "Sinks",
          items: [
            { label: "SQLite", to: "/sinks/sqlite" },
            { label: "Postgres", to: "/sinks/postgres" },
            { label: "OpenTelemetry", to: "/sinks/otel" },
            { label: "HTTP", to: "/sinks/http" },
          ],
        },
        {
          title: "Links",
          items: [
            { label: "GitHub", href: "https://github.com/amit641/llmmeter" },
            {
              label: "npm — @amit641/llmmeter",
              href: "https://www.npmjs.com/package/@amit641/llmmeter",
            },
            {
              label: "npm — CLI",
              href: "https://www.npmjs.com/package/@amit641/llmmeter-cli",
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} llmmeter. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "json"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

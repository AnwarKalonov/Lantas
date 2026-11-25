import type { McpTransport } from "./types";

/**
 * Public MCP servers, one click to add.
 *
 * These are the same servers Claude, Cursor and VS Code connect to: a plugin
 * in those products is an MCP server plus a prompt bundle, and Lantas already
 * has prompt bundles (Skills → plugins). Every URL and command below is the
 * vendor's documented endpoint, not an inference. Remote servers authenticate
 * with OAuth on the first connection; local ones need the desktop runtime
 * because they are processes this app starts itself.
 */

export type CatalogAuth = "oauth" | "token" | "none";

export interface CatalogEntry {
  id: string;
  name: string;
  publisher: string;
  description: string;
  category: "code" | "productivity" | "data" | "design" | "observability" | "web" | "local";
  transport: McpTransport;
  url?: string;
  command?: string;
  auth: CatalogAuth;
  docs?: string;
}

export const MCP_CATALOG: CatalogEntry[] = [
  {
    id: "github",
    name: "GitHub",
    publisher: "GitHub",
    description: "Repositories, issues, pull requests, Actions and code security.",
    category: "code",
    transport: "http",
    url: "https://api.githubcopilot.com/mcp/",
    auth: "oauth",
    docs: "https://github.com/github/github-mcp-server",
  },
  {
    id: "sentry",
    name: "Sentry",
    publisher: "Sentry",
    description: "Errors, issues and traces, scoped to an organisation or project.",
    category: "observability",
    transport: "http",
    url: "https://mcp.sentry.dev/mcp",
    auth: "oauth",
    docs: "https://mcp.sentry.dev/",
  },
  {
    id: "linear",
    name: "Linear",
    publisher: "Linear",
    description: "Find, create and update issues, projects and comments.",
    category: "productivity",
    transport: "http",
    url: "https://mcp.linear.app/mcp",
    auth: "oauth",
    docs: "https://linear.app/docs/mcp",
  },
  {
    id: "notion",
    name: "Notion",
    publisher: "Notion",
    description: "Search the workspace, read and edit pages and databases.",
    category: "productivity",
    transport: "http",
    url: "https://mcp.notion.com/mcp",
    auth: "oauth",
    docs: "https://developers.notion.com/docs/mcp",
  },
  {
    id: "atlassian",
    name: "Jira and Confluence",
    publisher: "Atlassian",
    description: "Rovo: issues, pages and Bitbucket through one server.",
    category: "productivity",
    transport: "http",
    url: "https://mcp.atlassian.com/v2/mcp",
    auth: "oauth",
    docs: "https://support.atlassian.com/atlassian-rovo-mcp-server/",
  },
  {
    id: "stripe",
    name: "Stripe",
    publisher: "Stripe",
    description: "The Stripe API plus a search over Stripe's documentation.",
    category: "data",
    transport: "http",
    url: "https://mcp.stripe.com",
    auth: "oauth",
    docs: "https://docs.stripe.com/mcp",
  },
  {
    id: "supabase",
    name: "Supabase",
    publisher: "Supabase",
    description: "Tables, project settings and queries; scope it with project_ref.",
    category: "data",
    transport: "http",
    url: "https://mcp.supabase.com/mcp",
    auth: "oauth",
    docs: "https://supabase.com/docs/guides/getting-started/mcp",
  },
  {
    id: "vercel",
    name: "Vercel",
    publisher: "Vercel",
    description: "Projects, deployments, logs and documentation search.",
    category: "code",
    transport: "http",
    url: "https://mcp.vercel.com",
    auth: "oauth",
    docs: "https://vercel.com/docs/agent-resources/vercel-mcp",
  },
  {
    id: "figma",
    name: "Figma",
    publisher: "Figma",
    description: "Read frame and component context from a design file.",
    category: "design",
    transport: "http",
    url: "https://mcp.figma.com/mcp",
    auth: "oauth",
    docs: "https://help.figma.com/hc/en-us/articles/32132100833559",
  },
  {
    id: "slack",
    name: "Slack",
    publisher: "Slack",
    description: "Search messages and channels the signed-in member can read.",
    category: "productivity",
    transport: "http",
    url: "https://mcp.slack.com/mcp",
    auth: "oauth",
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    publisher: "Cloudflare",
    description: "Workers, KV, R2, DNS and the rest of the Cloudflare API.",
    category: "web",
    transport: "http",
    url: "https://mcp.cloudflare.com/mcp",
    auth: "oauth",
    docs: "https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/",
  },
  {
    id: "deepwiki",
    name: "DeepWiki",
    publisher: "Cognition",
    description: "Ask about any public repository. No account needed.",
    category: "code",
    transport: "http",
    url: "https://mcp.deepwiki.com/mcp",
    auth: "none",
  },
  {
    id: "context7",
    name: "Context7",
    publisher: "Upstash",
    description: "Current documentation for a library instead of a remembered version.",
    category: "code",
    transport: "http",
    url: "https://mcp.context7.com/mcp",
    auth: "token",
    docs: "https://context7.com",
  },
  {
    id: "filesystem",
    name: "Filesystem",
    publisher: "MCP project",
    description: "Read and write the folders you name. Runs on your machine.",
    category: "local",
    transport: "stdio",
    command: "npx -y @modelcontextprotocol/server-filesystem .",
    auth: "none",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
  },
  {
    id: "memory",
    name: "Memory",
    publisher: "MCP project",
    description: "A knowledge graph that survives between chats.",
    category: "local",
    transport: "stdio",
    command: "npx -y @modelcontextprotocol/server-memory",
    auth: "none",
    docs: "https://github.com/modelcontextprotocol/servers/tree/main/src/memory",
  },
  {
    id: "sequential-thinking",
    name: "Sequential thinking",
    publisher: "MCP project",
    description: "A scratchpad for long, revisable chains of reasoning.",
    category: "local",
    transport: "stdio",
    command: "npx -y @modelcontextprotocol/server-sequential-thinking",
    auth: "none",
  },
  {
    id: "playwright",
    name: "Playwright",
    publisher: "Microsoft",
    description: "Drive a second browser for tests and screenshots.",
    category: "local",
    transport: "stdio",
    command: "npx -y @playwright/mcp@latest",
    auth: "none",
    docs: "https://github.com/microsoft/playwright-mcp",
  },
];

export const AUTH_LABEL: Record<CatalogAuth, string> = {
  oauth: "OAuth",
  token: "API key",
  none: "No account",
};

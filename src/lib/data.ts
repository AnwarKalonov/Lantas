import type {
  AgentMeta,
  AppState,
  McpServer,
  ProviderConfig,
  ProviderId,
  ProviderMeta,
  Settings,
  Skill,
} from "./types";

export const PROVIDERS: ProviderMeta[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude Opus, Sonnet and Haiku",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    needsKey: true,
    local: false,
    models: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
    docs: "console.anthropic.com/settings/keys",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT-5.1 and GPT-4.1",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    needsKey: true,
    local: false,
    models: ["gpt-5.1", "gpt-5.1-mini", "gpt-4.1"],
    docs: "platform.openai.com/api-keys",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "One key for most models",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    needsKey: true,
    local: false,
    models: [
      "anthropic/claude-opus-4.5",
      "openai/gpt-5.1",
      "google/gemini-3-pro",
      "qwen/qwen3-coder",
    ],
    docs: "openrouter.ai/keys",
  },
  {
    id: "groq",
    name: "Groq",
    description: "Fast hosted open models",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    needsKey: true,
    local: false,
    models: ["llama-3.3-70b-versatile", "qwen-3-32b", "moonshotai/kimi-k2-instruct"],
    docs: "console.groq.com/keys",
  },
  {
    id: "google",
    name: "Google",
    description: "Gemini 4 Argon and 3.8 Flash, via AI Studio",
    kind: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    needsKey: true,
    local: false,
    // Free-tier models first: the first entry is what "Test connection" calls.
    models: [
      "gemini-3.8-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
      "gemini-4-argon",
      "gemini-2.5-pro",
      "gemini-2.5-flash",
    ],
    docs: "aistudio.google.com/apikey",
  },
  {
    id: "ollama",
    name: "Ollama",
    description: "Models running on this machine",
    kind: "ollama",
    baseUrl: "http://localhost:11434",
    needsKey: false,
    local: true,
    models: ["qwen3-coder:30b", "llama3.3:latest", "deepseek-r1:14b"],
    docs: "ollama.com",
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    description: "Local server with an OpenAI API",
    kind: "openai",
    baseUrl: "http://localhost:1234/v1",
    needsKey: false,
    local: true,
    models: [],
    docs: "lmstudio.ai",
  },
  {
    id: "custom",
    name: "Custom endpoint",
    description: "Any OpenAI-compatible base URL",
    kind: "openai",
    baseUrl: "",
    needsKey: false,
    local: false,
    models: [],
    docs: "vllm, LiteLLM, Together, vLLM, llama.cpp",
  },
];

export const EMPTY_PROVIDER_CONFIG: ProviderConfig = {
  apiKey: "",
  baseUrl: "",
  enabled: true,
  models: [],
};

function defaultProviders(): Record<ProviderId, ProviderConfig> {
  return PROVIDERS.reduce(
    (acc, provider) => {
      acc[provider.id] = { ...EMPTY_PROVIDER_CONFIG };
      return acc;
    },
    {} as Record<ProviderId, ProviderConfig>,
  );
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  sendOnEnter: true,
  reduceMotion: false,
  defaultAgent: "build",
  defaultProvider: "anthropic",
  defaultModel: "claude-opus-4-5",
  permissionMode: "auto",
  screenAccess: true,
  computerControl: false,
  telemetry: false,
  notifications: true,
  favoriteModels: [],
  providers: defaultProviders(),
};

export const AGENTS: AgentMeta[] = [
  {
    id: "build",
    name: "Build",
    description: "Reads, edits and runs commands in this workspace",
    readOnly: false,
  },
  {
    id: "plan",
    name: "Plan",
    description: "Read-only. Drafts an approach before touching files",
    readOnly: true,
  },
  {
    id: "chat",
    name: "Chat",
    description: "Answers questions without changing anything",
    readOnly: true,
  },
];

export const SUGGESTIONS = [
  {
    title: "Explain this codebase",
    body: "Map entry points, data flow and conventions",
    prompt:
      "Give me a tour of this codebase: entry points, how data flows, and the conventions I should follow.",
    icon: "compass" as const,
  },
  {
    title: "Fix the failing check",
    body: "Reproduce it, then patch the cause",
    prompt: "The typecheck is failing. Reproduce it, find the cause and fix it.",
    icon: "wrench" as const,
  },
  {
    title: "Review my changes",
    body: "Read the working tree and flag real risks",
    prompt:
      "Review the uncommitted changes in this repo and flag anything that would break in production.",
    icon: "diff" as const,
  },
];

export const SLASH_COMMANDS = [
  { command: "/new", label: "Start a fresh thread" },
  { command: "/code", label: "Open the Code tab" },
  { command: "/chat", label: "Back to the thread" },
  { command: "/attach", label: "Attach files to this turn" },
  { command: "/screen", label: "Share a window or display" },
  { command: "/init", label: "Scan the repo and write AGENTS.md" },
  { command: "/review", label: "Review the working tree" },
  { command: "/fix", label: "Reproduce and fix a failing check" },
  { command: "/test", label: "Run the tests and fix the cause" },
  { command: "/diff", label: "Walk through the last change" },
  { command: "/commit", label: "Commit the working tree" },
  { command: "/explain", label: "Explain a part of the codebase" },
  { command: "/plan", label: "Switch to the read-only Plan agent" },
  { command: "/build", label: "Switch to the Build agent" },
  { command: "/model", label: "Choose a model" },
  { command: "/agents", label: "Manage agents" },
  { command: "/skills", label: "Manage skills" },
  { command: "/mcp", label: "Manage MCP integrations" },
  { command: "/permissions", label: "Approval rules" },
  { command: "/theme", label: "Cycle the theme" },
  { command: "/usage", label: "Tokens, cost and context" },
  { command: "/export", label: "Download this thread as JSON" },
  { command: "/copy", label: "Copy the transcript" },
  { command: "/undo", label: "Rewind one turn" },
  { command: "/redo", label: "Reapply the rewound turn" },
  { command: "/compact", label: "Summarise to free context" },
  { command: "/clear", label: "Clear this thread" },
  { command: "/help", label: "Keys and commands" },
];

export const SKILL_SEEDS: Skill[] = [
  {
    id: "skill_commit",
    name: "commit",
    description: "Write a conventional commit from the staged diff",
    instructions:
      "When asked to commit, read the staged diff, then write one conventional commit message. Subject line under 72 characters, no emoji, body explains why the change was made rather than what changed. Never add attribution trailers unless the user asks.",
    enabled: true,
    builtin: true,
  },
  {
    id: "skill_review",
    name: "review",
    description: "Review a diff for correctness, edge cases and regressions",
    instructions:
      "When reviewing, read the diff before commenting. Report only issues that would affect correctness, data, security or users. For each: file, line, what breaks, and the smallest fix. Do not restate what the code does.",
    enabled: true,
    builtin: true,
  },
  {
    id: "skill_release",
    name: "release-notes",
    description: "Turn merged work into notes people can read",
    instructions:
      "Group merged work by user impact, not by commit order. Lead with what changed for the person using the product. One sentence per entry, no marketing language, no internal ticket numbers.",
    enabled: false,
    builtin: true,
  },
  {
    id: "skill_test-gap",
    name: "test-gap",
    description: "Find untested branches in the files that changed",
    instructions:
      "For each changed file, list the branches that no test exercises. Rank by risk. Propose the smallest test that would cover the highest-risk branch, in the project's existing test style.",
    enabled: false,
    builtin: true,
  },
];

export const MCP_SEEDS: McpServer[] = [
  {
    id: "mcp_fs",
    name: "filesystem",
    transport: "stdio",
    command: "npx -y @modelcontextprotocol/server-filesystem ~/dev",
    enabled: true,
    status: "untested",
    detail: "Stdio servers start with the desktop runtime",
  },
  {
    id: "mcp_sentry",
    name: "sentry",
    transport: "http",
    url: "https://mcp.sentry.dev/mcp",
    enabled: false,
    status: "untested",
    detail: "Add the URL, then test the handshake",
  },
];

export const MCP_TEMPLATES = [
  {
    name: "GitHub",
    transport: "stdio" as const,
    command: "npx -y @modelcontextprotocol/server-github",
    url: "",
  },
  {
    name: "Linear",
    transport: "http" as const,
    command: "",
    url: "https://mcp.linear.app/mcp",
  },
  {
    name: "Postgres",
    transport: "stdio" as const,
    command: "npx -y @modelcontextprotocol/server-postgres postgresql://localhost/app",
    url: "",
  },
  {
    name: "Sentry",
    transport: "http" as const,
    command: "",
    url: "https://mcp.sentry.dev/mcp",
  },
];

export const KEYBINDS = [
  { keys: "⌘K", action: "Command palette" },
  { keys: "⌘N", action: "New session" },
  { keys: "⌘B", action: "Toggle sidebar" },
  { keys: "⌘⇧B", action: "Toggle context panel" },
  { keys: "⌘,", action: "Settings" },
  { keys: "⌘↵", action: "Send message" },
  { keys: "⇧↵", action: "New line" },
  { keys: "esc", action: "Stop the running turn" },
  { keys: "/", action: "Commands in the composer" },
  { keys: "@", action: "Reference a file" },
];


export function seedState(): AppState {
  return {
    sessions: [],
    activeId: null,
    view: "chats",
    mode: "chat",
    browserUrl: "https://example.com",
    workspace: [],
    workspaceName: "",
    settings: { ...DEFAULT_SETTINGS },
    skills: SKILL_SEEDS.map((skill) => ({ ...skill })),
    mcpServers: MCP_SEEDS.map((server) => ({ ...server })),
    commands: [],
    sidebarOpen: true,
    panelOpen: false,
  };
}

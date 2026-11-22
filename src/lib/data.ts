import type {
  AgentMeta,
  AppState,
  FileChange,
  McpServer,
  ProviderConfig,
  ProviderId,
  ProviderMeta,
  Session,
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
    description: "Gemini 3 Pro and Flash",
    kind: "google",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    needsKey: true,
    local: false,
    models: ["gemini-3-pro", "gemini-2.5-flash"],
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
  { command: "/init", label: "Scan the repo and write AGENTS.md" },
  { command: "/review", label: "Review the working tree" },
  { command: "/fix", label: "Reproduce and fix a failing check" },
  { command: "/compact", label: "Summarise to free context" },
  { command: "/clear", label: "Start a fresh session" },
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

export const WORKSPACE_FILES = [
  "src/lib/providers.ts",
  "src/lib/store.tsx",
  "src/components/SettingsModal.tsx",
  "src/components/Composer.tsx",
  "src-tauri/tauri.conf.json",
];

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const now = Date.now();

const filesFromSeed: FileChange[] = [
  { path: "src/lib/store.tsx", added: 42, removed: 18, status: "M" },
  { path: "src/components/SessionView.tsx", added: 6, removed: 9, status: "M" },
];

const sessionOne: Session = {
  id: "ses_streams",
  title: "Keep a turn running when I switch sessions",
  cwd: "~/dev/lantas",
  branch: "main",
  created: now - 32 * MIN,
  updated: now - 9 * MIN,
  agent: "build",
  provider: "anthropic",
  model: "claude-opus-4-5",
  tokens: 18_420,
  contextWindow: 200_000,
  cost: 0.31,
  files: filesFromSeed,
  todos: [
    { id: "t1", text: "Move the run controller into the store", done: true },
    { id: "t2", text: "Keep partial output when a turn is interrupted", done: true },
    { id: "t3", text: "Add a regression test for remounting mid-stream", done: false, active: true },
  ],
  messages: [
    {
      id: "msg_1",
      role: "user",
      created: now - 31 * MIN,
      parts: [
        {
          id: "p1",
          kind: "text",
          text: "Sessions lose their streaming state when I switch away and come back. Can you make an in-flight reply keep running?",
        },
      ],
    },
    {
      id: "msg_2",
      role: "assistant",
      created: now - 30 * MIN,
      agent: "build",
      provider: "anthropic",
      model: "claude-opus-4-5",
      durationMs: 74_000,
      tokens: 3_240,
      cost: 0.09,
      parts: [
        {
          id: "p2",
          kind: "text",
          text: "The run is owned by `SessionView`, so unmounting the view aborts it. I moved the controller and the streaming buffer into the store — the view now only subscribes.",
        },
        {
          id: "p3",
          kind: "tool",
          tool: "read",
          label: "src/lib/store.tsx",
          detail: "184 lines",
          state: "done",
        },
        {
          id: "p4",
          kind: "tool",
          tool: "read",
          label: "src/components/SessionView.tsx",
          detail: "96 lines",
          state: "done",
        },
        {
          id: "p5",
          kind: "diff",
          path: "src/lib/store.tsx",
          added: 9,
          removed: 4,
          lines: [
            { type: "ctx", no: 46, text: "  const [runs, setRuns] = useState<Record<string, Run>>({});" },
            { type: "ctx", no: 47, text: "" },
            { type: "del", no: 48, text: "  const startRun = useCallback((sessionId: string) => {" },
            { type: "del", no: 49, text: "    const controller = new AbortController();" },
            { type: "del", no: 50, text: "    setRuns((prev) => ({ ...prev, [sessionId]: controller }));" },
            { type: "del", no: 51, text: "  }, [setRuns]);" },
            { type: "add", no: 48, text: "  const startRun = useCallback((sessionId: string) => {" },
            { type: "add", no: 49, text: "    // One run per session: remounting re-attaches, it does not restart." },
            { type: "add", no: 50, text: "    const existing = runs[sessionId];" },
            { type: "add", no: 51, text: "    if (existing) return existing;" },
            { type: "add", no: 52, text: "" },
            { type: "add", no: 53, text: "    const run = { controller: new AbortController(), buffer: \"\" };" },
            { type: "add", no: 54, text: "    setRuns((prev) => ({ ...prev, [sessionId]: run }));" },
            { type: "add", no: 55, text: "    return run;" },
            { type: "add", no: 56, text: "  }, [runs]);" },
          ],
        },
        {
          id: "p6",
          kind: "shell",
          command: "npm run typecheck",
          output: ["> tsc --noEmit", "no errors in 52 files (2.8s)"],
          state: "done",
        },
        {
          id: "p7",
          kind: "text",
          text: "Switching sessions no longer drops a reply: the run continues in the background and the transcript catches up when you return. The remaining piece is a regression test that remounts mid-stream — it is the open todo.",
        },
      ],
    },
    {
      id: "msg_3",
      role: "user",
      created: now - 10 * MIN,
      parts: [{ id: "p8", kind: "text", text: "Good. Keep partial output if I interrupt too." }],
    },
    {
      id: "msg_4",
      role: "assistant",
      created: now - 9 * MIN,
      agent: "build",
      provider: "anthropic",
      model: "claude-opus-4-5",
      durationMs: 38_000,
      tokens: 1_180,
      cost: 0.03,
      parts: [
        {
          id: "p9",
          kind: "tool",
          tool: "edit",
          label: "src/lib/store.tsx",
          detail: "+8 −1",
          state: "done",
        },
        {
          id: "p10",
          kind: "text",
          text: "Interrupts now flush the buffered text and mark the message as `interrupted` instead of clearing it, so you keep whatever had already streamed.",
        },
      ],
    },
  ],
};

const sessionTwo: Session = {
  id: "ses_auth",
  title: "Review the auth middleware",
  cwd: "~/dev/lantas",
  branch: "feat/passkeys",
  created: now - DAY - 4 * HOUR,
  updated: now - DAY - 3 * HOUR,
  agent: "plan",
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  tokens: 42_100,
  contextWindow: 200_000,
  cost: 0.24,
  files: [],
  todos: [],
  messages: [
    {
      id: "a1",
      role: "user",
      created: now - DAY - 4 * HOUR,
      parts: [
        {
          id: "a2",
          kind: "text",
          text: "Review the auth middleware on this branch. Anything that would let a request skip the session check?",
        },
      ],
    },
    {
      id: "a3",
      role: "assistant",
      created: now - DAY - 3 * HOUR,
      agent: "plan",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      durationMs: 51_000,
      tokens: 2_860,
      cost: 0.06,
      parts: [
        {
          id: "a4",
          kind: "tool",
          tool: "grep",
          label: 'matcher: "getSession|requireAuth"',
          detail: "14 matches",
          state: "done",
        },
        {
          id: "a5",
          kind: "text",
          text: "One real gap: the health-check route is mounted before `requireAuth` and calls `getSession()` itself, so a signed-out request reaches the handler and only fails on a null dereference. Everything else fails closed.",
        },
        {
          id: "a6",
          kind: "note",
          text: "No files changed — Plan is read-only on this branch.",
        },
      ],
    },
  ],
};

const sessionThree: Session = {
  id: "ses_ci",
  title: "Why is CI 40s slower on Linux?",
  cwd: "~/dev/lantas",
  branch: "main",
  created: now - 3 * DAY,
  updated: now - 3 * DAY,
  agent: "build",
  provider: "openai",
  model: "gpt-5.1",
  tokens: 9_640,
  contextWindow: 400_000,
  cost: 0.12,
  files: [{ path: "vite.config.ts", added: 4, removed: 2, status: "M" }],
  todos: [],
  messages: [
    {
      id: "c1",
      role: "user",
      created: now - 3 * DAY,
      parts: [{ id: "c2", kind: "text", text: "CI takes 40 seconds longer than my machine. Where is the time going?" }],
    },
    {
      id: "c3",
      role: "assistant",
      created: now - 3 * DAY,
      agent: "build",
      provider: "openai",
      model: "gpt-5.1",
      durationMs: 44_000,
      tokens: 1_940,
      cost: 0.04,
      parts: [
        {
          id: "c4",
          kind: "shell",
          command: "npm run build -- --profile",
          output: [
            "vite build",
            "  transform    12.4s",
            "  deps scan     1.1s",
            "  minify        8.9s  (3.6x slower than darwin)",
          ],
          state: "done",
        },
        {
          id: "c5",
          kind: "text",
          text: "It is minification: CI runs with two vCPUs and esbuild spawns one worker per core, so the whole bundle lands in a single process. Capping the worker count made it worse; switching the Linux job to `--minify=esbuild` with a larger runner recovered 28s.",
        },
      ],
    },
  ],
};

export function seedState(): AppState {
  return {
    sessions: [sessionOne, sessionTwo, sessionThree],
    activeId: null,
    view: "chats",
    settings: { ...DEFAULT_SETTINGS },
    skills: SKILL_SEEDS.map((skill) => ({ ...skill })),
    mcpServers: MCP_SEEDS.map((server) => ({ ...server })),
    sidebarOpen: true,
    panelOpen: true,
  };
}

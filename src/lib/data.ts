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
      // Free rows: OpenRouter's `:free` models need a key but cost nothing.
      // The picker's Test connection replaces this list with the live one.
      "deepseek/deepseek-r1:free",
      "qwen/qwen3-coder:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "mistralai/mistral-small-3.2-24b-instruct:free",
    ],
    docs: "openrouter.ai/keys",
  },
  {
    id: "opencode",
    name: "OpenCode Zen",
    description: "The opencode.ai gateway · pay-as-you-go models",
    kind: "openai",
    baseUrl: "https://opencode.ai/inference/openai/v1",
    needsKey: true,
    local: false,
    // These are pay-as-you-go rows from the Zen catalog, which accept ordinary
    // personal API keys. The free-tier ids are intentionally absent: OpenCode
    // answers 403 for those outside its own client, even with a valid key.
    // Test connection replaces this list with the key's live /models catalog.
    models: [
      "deepseek-v4-pro",
      "glm-5.3",
      "kimi-k3",
      "minimax-m3",
      "qwen3.8-max",
    ],
    docs: "opencode.ai/console · paid API key (oc_sk_…)",
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
    id: "nvidia",
    name: "NVIDIA NIM",
    description: "Hosted models via build.nvidia.com",
    kind: "openai",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    needsKey: true,
    local: false,
    // Chat-capable rows from the live NIM catalog. The picker replaces these
    // with this key's own /models list as soon as the provider is tested.
    models: [
      "minimaxai/minimax-m3.1-flash",
      "moonshotai/kimi-k3.1-pro",
      "z-ai/glm-5.3-flash",
      "mistralai/mistral-large-4-1t-a52b",
      "google/gemma-4-31b-it",
      "nvidia/nemotron-3.5-lightning-30b-a3b",
    ],
    docs: "build.nvidia.com/settings/api-keys",
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
  theme: "light",
  sendOnEnter: true,
  reduceMotion: false,
  defaultAgent: "build",
  defaultProvider: "anthropic",
  defaultModel: "claude-opus-4-5",
  permissionMode: "auto",
  // Capabilities stay off until the user answers the permission sheet. The
  // sheet is shown once, on first launch, and lives in Settings afterwards.
  fileAccess: false,
  terminalAccess: false,
  screenAccess: false,
  computerControl: false,
  permissionsReviewed: false,
  allowedRules: [],
  telemetry: false,
  notifications: true,
  favoriteModels: [],
  providers: defaultProviders(),
  editor: {
    fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
    fontSize: 13,
    lineHeight: 21,
    tabSize: 2,
    wordWrap: "off",
    minimap: true,
  },
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
    title: "Think it through",
    body: "Compare the options and recommend one",
    prompt:
      "Help me think this through: lay out the realistic options, their tradeoffs, and the one you would choose. Ask me for the missing detail first if it changes the answer.",
    icon: "compass" as const,
  },
  {
    title: "Write something",
    body: "Draft an email, post or short doc",
    prompt:
      "Draft a concise, specific piece of writing for me. Ask for the audience and the one outcome it should produce, then write it.",
    icon: "wrench" as const,
  },
  {
    title: "Review my thinking",
    body: "Find the weak spots before you commit",
    prompt:
      "Here is my plan. Find the weak spots, the missing evidence and the risk I am underestimating, then give me the stronger version.",
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

/**
 * Built-in skills. These are operational procedures, not personalities: each
 * one names the files to read, the order to work in, and what to verify before
 * claiming the task is done. Enabled skills are listed in the system prompt by
 * name only; the model loads the full instructions with the `skill` tool, so a
 * large library costs almost nothing until it is used.
 */
export const SKILL_SEEDS: Skill[] = [
  {
    id: "skill_commit",
    name: "commit",
    description: "Inspect the working tree, then write one precise commit",
    category: "engineering",
    tags: ["git", "history"],
    enabled: true,
    builtin: true,
    instructions: [
      "Purpose: produce a commit a reviewer can understand a year later.",
      "Procedure: run `git status --short` and `git diff --staged`. Read every staged hunk before writing anything. If nothing is staged, show the unstaged diff and ask whether to stage all of it, some paths, or nothing.",
      "Split the change when it contains unrelated work (a refactor plus a behaviour change, a formatting sweep plus a fix). Propose the split as path lists and commit each part separately. Never mix generated files, lockfiles or vendored code into a commit that is about something else unless they changed because of it.",
      "Message: a conventional prefix (feat, fix, refactor, perf, test, docs, build, chore) and a scope when the repo uses them. Subject in the imperative mood, under 72 characters, no trailing period, no emoji. Leave one blank line, then a body that explains why the change was needed, what the previous behaviour was, and what could break. Wrap at 72 columns.",
      "Add a `BREAKING CHANGE:` footer only when a caller must change code, configuration or data. Reference an issue only when the user gave you one. Never add attribution trailers, co-author lines or tool footers unless the user explicitly asks.",
      "Before committing, check the diff for secrets, debug logging, commented-out code, absolute local paths, and files that should be ignored. Report what you committed and the hash. Do not push unless asked.",
    ].join("\n"),
  },
  {
    id: "skill_review",
    name: "review",
    description: "Review a diff for real defects, worst first",
    category: "engineering",
    tags: ["review", "correctness"],
    enabled: true,
    builtin: true,
    instructions: [
      "Purpose: find defects that would reach users, not restate the diff.",
      "Procedure: read the full diff, then open the surrounding function for each hunk. A hunk you cannot explain in context is a finding, not a nit. Read the tests that cover the changed code; if none exist, say so.",
      "Check in this order: correctness on the happy path, then error and empty states, authorization on every new data path, untrusted input reaching a sink (SQL, shell, HTML, filesystem, URL fetch), data loss or irreversible writes, concurrency and ordering, migrations on a populated database, rollback, and finally resource cleanup.",
      "Report format: one line per finding with severity, `path:line`, what breaks, and the smallest fix. Use `blocker` for anything that corrupts data, bypasses auth, or crashes a normal path; `should-fix` for real but recoverable defects; `nit` only for things that affect future maintenance. Put blockers first.",
      "Do not rewrite the author's design unless it is the defect. Do not comment on formatting that the project's formatter owns. If you are unsure whether something is a bug, say what you could not verify instead of guessing.",
      "End with one short paragraph: what you checked, what you could not check, and whether you would ship it.",
    ].join("\n"),
  },
  {
    id: "skill_debug",
    name: "debug",
    description: "Reproduce a failure, isolate the cause, fix the cause",
    category: "engineering",
    tags: ["debugging", "tests"],
    enabled: true,
    builtin: true,
    instructions: [
      "Purpose: turn a vague failure into a reproduced cause and a verified fix.",
      "Procedure: reproduce it first with the smallest command that fails. Record the exact command and the first useful line of output. If you cannot reproduce it, say what you tried and ask for the missing input rather than guessing.",
      "Read the stack trace from the deepest frame that belongs to this project, not the framework. Open that file and the caller. Write down three plausible causes, then test the cheapest one first. Add temporary instrumentation rather than reasoning about invisible state; remove it afterwards.",
      "Fix the cause, not the symptom. Do not swallow the error, widen a type, add a retry around a deterministic failure, or weaken an assertion. If the correct fix is large, make the smallest change that restores correct behaviour and describe the follow-up.",
      "Verify by re-running the failing command and the nearest test suite. Report the command, the real output, and what you ruled out. If the fix is unverified because the environment cannot run it, say exactly that.",
    ].join("\n"),
  },
  {
    id: "skill_test-gap",
    name: "test-gap",
    description: "Find the untested branches that matter in changed files",
    category: "engineering",
    tags: ["testing", "coverage"],
    enabled: false,
    builtin: true,
    instructions: [
      "Purpose: spend test effort where a failure would hurt, not where coverage looks good.",
      "Procedure: list the files in the diff. For each, enumerate the branches that changed: new conditions, new error paths, new optional arguments, new async ordering. Find the existing tests that touch the file and mark which branches they exercise.",
      "Rank the gaps by blast radius: money, auth, persisted data and user-visible state first; pure formatting and logging last. For the top three, describe the failure that would go unnoticed today.",
      "Write the smallest test that would catch that failure, in the project's existing framework, file naming and fixture style. Test behaviour through the public entry point. Do not assert on implementation details, snapshot an entire render tree, or mock so much that the test only proves the mock works.",
      "Report the gap list, then the tests you added, then the command that ran them and its real result.",
    ].join("\n"),
  },
  {
    id: "skill_refactor",
    name: "refactor",
    description: "Change structure without changing behaviour",
    category: "engineering",
    tags: ["refactor", "safety"],
    enabled: false,
    builtin: true,
    instructions: [
      "Purpose: make a change that is provably behaviour-preserving.",
      "Procedure: name the seam you are moving and the behaviour that must not change. Run the relevant tests before touching code and record the result; a refactor on a red suite is not verifiable.",
      "Work in one mechanical step at a time: extract, rename, move, then delete. Do not mix a refactor with a feature, a dependency upgrade or a formatting sweep. Keep public interfaces stable unless the user asked to change them.",
      "After each step, run the narrowest check that can fail (typecheck, the file's tests). If a step is too large to verify, split it.",
      "Finish by comparing behaviour, not just green tests: list the call sites you touched, the ones you deliberately left, and any behaviour you could not exercise. State the measured result of the checks.",
    ].join("\n"),
  },
  {
    id: "skill_release",
    name: "release-notes",
    description: "Turn merged work into notes people can read",
    category: "writing",
    tags: ["release", "writing"],
    enabled: false,
    builtin: true,
    instructions: [
      "Purpose: tell a user what changed for them, in language they use.",
      "Procedure: collect merged work from the range the user names. Group by user impact, not commit order or team. Use the headings Added, Changed, Fixed, Breaking only when that section has content.",
      "One sentence per entry, past tense, naming the surface the user touches (the editor, the sync button, the CLI flag). Say what used to happen when that makes the change concrete. No marketing adjectives, no internal ticket numbers, no author names.",
      "Put breaking changes first with the exact action the reader must take. Link to a migration section when one exists. Keep the whole note under 400 words unless the release is genuinely large.",
      "Verify every entry against the diff or the commit list. If you cannot tell whether something is user-visible, leave it out rather than inventing impact.",
    ].join("\n"),
  },
  {
    id: "skill_pr-description",
    name: "pr-description",
    description: "Write a pull request a reviewer can act on",
    category: "writing",
    tags: ["git", "review"],
    enabled: false,
    builtin: true,
    instructions: [
      "Purpose: give a reviewer the context, the risk and the proof in under a minute.",
      "Structure: a title under 70 characters in the imperative mood. Then `What changed` in two or three sentences, `Why` with the user or system problem, `How I verified it` with the exact commands and results, and `Risk` naming what could break and how to roll back.",
      "Call out the parts a reviewer should look at hardest, with file links. Note deliberate omissions and follow-ups instead of hiding them. Include a screenshot or recording reference only when the change is visual and one exists.",
      "Do not paste the diff, do not claim tests you did not run, and do not describe code the reviewer can already read unless the reason is non-obvious.",
    ].join("\n"),
  },
  {
    id: "skill_api-design",
    name: "api-design",
    description: "Design or review an HTTP or RPC interface",
    category: "engineering",
    tags: ["api", "backend"],
    enabled: false,
    builtin: true,
    instructions: [
      "Purpose: leave an interface that is hard to misuse and cheap to evolve.",
      "Check the contract: resource names are nouns, verbs live in the method, identifiers are stable and opaque. Every write states whether it is idempotent and what happens on retry. Every list states its pagination, default page size, maximum page size and sort order.",
      "Check errors: one envelope, a stable machine code, a human message that names the field, and the right status. Never return 200 for a failure. Distinguish authentication from authorization, and not-found from forbidden only when leaking existence is acceptable.",
      "Check evolution: adding a field is safe, renaming or changing a type is not. Prefer additive changes and a version boundary. Deprecate with a date and a migration path.",
      "Check the edges: empty collections, nulls, large payloads, duplicate keys, rate limits, timeouts, and partial failure in batch calls. Write the request and response example for the happy path and one failure before writing code.",
      "Report the contract, the decisions you would change, and the exact breaking risks in the current shape.",
    ].join("\n"),
  },
  {
    id: "skill_sql-review",
    name: "sql-review",
    description: "Review a schema change or query before production",
    category: "data",
    tags: ["sql", "migrations", "performance"],
    enabled: false,
    builtin: true,
    instructions: [
      "Purpose: catch the migration or query that will lock, scan or lose data in production.",
      "Schema: state the table size and write rate you assume. Adding a nullable column is safe on modern engines; adding a non-null column with a default, changing a type, or adding an index without a concurrent option may lock. Name the exact statement and the lock it takes.",
      "Data: every migration needs a forward path, a backfill plan that is batched and resumable, and a rollback that does not lose rows written after deploy. Never drop a column in the same release that stops writing it.",
      "Queries: read the plan, not just the SQL. Flag sequential scans on large tables, missing composite index order, functions wrapped around indexed columns, N+1 access from a loop, `SELECT *` across a wide table, and unbounded results. Check transaction scope and isolation for read-modify-write races.",
      "Report each finding with the statement, the expected plan or lock, the likely impact at the stated size, and the smallest change that fixes it.",
    ].join("\n"),
  },
  {
    id: "skill_security-review",
    name: "security-review",
    description: "Trace trust boundaries before shipping",
    category: "security",
    tags: ["security", "auth", "review"],
    enabled: false,
    builtin: true,
    instructions: [
      "Purpose: find the path where untrusted input reaches something that acts.",
      "Map the trust boundaries first: browser to server, server to database, server to third-party API, model output to tool execution, file upload to parser. For each boundary, name what is validated and where.",
      "Check: authentication on every new route, authorization on the specific object (not just the role), tenant scoping in every query, injection into SQL, shell, template, header or URL, SSRF from user-supplied URLs, path traversal from filenames, unsafe deserialization, secrets in logs or client bundles, permissive CORS, and missing rate limits on expensive or guessing endpoints.",
      "For model-driven tools, treat arguments as untrusted: allowlist the tool, validate the shape, constrain paths to the workspace, and require approval for destructive or outbound actions.",
      "Report only exploitable findings, with the entry point, the sink, the missing control and a concrete exploit sketch. Rank by impact and reachability. Do not pad the list with hardening advice that does not change the risk.",
    ].join("\n"),
  },
  {
    id: "skill_incident",
    name: "incident",
    description: "Stabilise first, then explain what happened",
    category: "engineering",
    tags: ["on-call", "reliability"],
    enabled: false,
    builtin: true,
    instructions: [
      "Purpose: restore service with the least additional damage, then produce a blameless record.",
      "Order: confirm the symptom from a real signal, state the blast radius (who, what, since when), then choose the fastest reversible mitigation. Prefer rollback, feature flag off, traffic shift or rate limit over a forward fix under pressure.",
      "While mitigating: write a timestamped log of what you observed, what you changed and what happened. One change at a time so the effect is attributable. Do not run destructive commands to 'clean up' before the cause is known.",
      "After: a timeline, the direct cause, the contributing conditions, the detection gap, and two or three actions with owners. No blame, no speculation presented as fact. Mark unknowns as unknown.",
      "If asked to write the postmortem, keep it under a page and lead with user impact and current status.",
    ].join("\n"),
  },
  {
    id: "skill_ux-copy",
    name: "ux-copy",
    description: "Write interface text that says what happened next",
    category: "design",
    tags: ["copy", "product"],
    enabled: false,
    builtin: true,
    instructions: [
      "Purpose: make every label and message answer what happened and what to do now.",
      "Voice: sentence case, present tense, second person. Buttons are verbs that name the result (Save changes, not Submit). Empty states say what belongs here and the one action that starts it. Errors say what failed, why if known, and the next step; never blame the user and never show a raw stack trace.",
      "Cut: exclamation marks, 'please', 'simply', 'just', 'oops', marketing adjectives, and any sentence that only restates the heading. No emoji in product UI. No trailing period on labels, buttons or one-line helpers.",
      "Numbers and names: use the same format everywhere, put the specific value in the message (the file name, the limit, the field), and avoid ambiguous pronouns. Confirmations name the object that changed.",
      "Deliver a table of current copy, proposed copy and the reason, then apply the changes only to the strings you were asked to touch.",
    ].join("\n"),
  },
  {
    id: "skill_frontend-review",
    name: "frontend-review",
    description: "Review a UI change for states, access and layout",
    category: "design",
    tags: ["frontend", "accessibility", "ui"],
    enabled: false,
    builtin: true,
    instructions: [
      "Purpose: catch the states and edge cases a screenshot never shows.",
      "States: loading, empty, error, partial data, long text, missing image, disabled, hover, focus, active, and a slow network. For each, say what the user sees and whether they can recover.",
      "Access: keyboard order matches visual order, focus is visible and trapped only in modals, every control has an accessible name, images have alt text or are marked decorative, color is not the only signal, contrast meets 4.5:1 for body text, and motion respects reduced-motion.",
      "Layout: check the narrowest supported width and a 200% zoom. Text does not truncate a control's meaning, tap targets are at least 40px, nothing scrolls horizontally by accident, and fixed headers do not cover focused content.",
      "Report concrete issues with the component and state, not general advice. Verify what you can by reading the code; say plainly what needs a device or browser you do not have.",
    ].join("\n"),
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
    scope: "chat",
    workspaces: [],
    activeWorkspaceId: null,
    browserUrl: "https://example.com",
    workspace: [],
    workspaceName: "",
    workspaceRoot: "",
    settings: { ...DEFAULT_SETTINGS },
    skills: SKILL_SEEDS.map((skill) => ({ ...skill })),
    mcpServers: MCP_SEEDS.map((server) => ({ ...server })),
    commands: [],
    sidebarOpen: true,
    panelOpen: false,
  };
}

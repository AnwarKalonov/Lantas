export type ProviderId =
  | "anthropic"
  | "openai"
  | "openrouter"
  | "groq"
  | "google"
  | "ollama"
  | "lmstudio"
  | "custom";

export type AgentId = "build" | "plan" | "chat";
export type ThemeMode = "dark" | "light" | "system";
export type ViewId = "chats" | "skills" | "integrations";

export type ToolKind = "read" | "grep" | "edit" | "plan" | "web";
export type ToolState = "run" | "done" | "error";

export interface DiffLine {
  type: "add" | "del" | "ctx";
  no: number;
  text: string;
}

export type Part =
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "tool"; tool: ToolKind; label: string; detail?: string; state: ToolState }
  | { id: string; kind: "diff"; path: string; added: number; removed: number; lines: DiffLine[] }
  | { id: string; kind: "shell"; command: string; output: string[]; state: ToolState }
  | { id: string; kind: "note"; text: string };

export interface Message {
  id: string;
  role: "user" | "assistant";
  parts: Part[];
  created: number;
  agent?: AgentId;
  provider?: ProviderId;
  model?: string;
  streaming?: boolean;
  interrupted?: boolean;
  durationMs?: number;
  tokens?: number;
  cost?: number;
}

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  active?: boolean;
}

export interface FileChange {
  path: string;
  added: number;
  removed: number;
  status: "M" | "A" | "D";
}

export interface Session {
  id: string;
  title: string;
  cwd: string;
  branch: string;
  created: number;
  updated: number;
  messages: Message[];
  todos: Todo[];
  files: FileChange[];
  tokens: number;
  contextWindow: number;
  cost: number;
  agent: AgentId;
  provider: ProviderId;
  model: string;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  enabled: boolean;
  /** Models discovered from the provider at runtime. */
  models: string[];
}

export interface ProviderMeta {
  id: ProviderId;
  name: string;
  description: string;
  kind: "anthropic" | "openai" | "ollama" | "google";
  baseUrl: string;
  needsKey: boolean;
  local: boolean;
  models: string[];
  docs: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  builtin?: boolean;
}

export type McpTransport = "http" | "stdio";

export interface McpServer {
  id: string;
  name: string;
  transport: McpTransport;
  url?: string;
  command?: string;
  enabled: boolean;
  status: "untested" | "connected" | "error";
  detail?: string;
  checkedAt?: number;
}

export interface Settings {
  theme: ThemeMode;
  sendOnEnter: boolean;
  reduceMotion: boolean;
  defaultAgent: AgentId;
  defaultProvider: ProviderId;
  defaultModel: string;
  permissionMode: "auto" | "ask";
  screenAccess: boolean;
  computerControl: boolean;
  telemetry: boolean;
  providers: Record<ProviderId, ProviderConfig>;
}

export interface AppState {
  sessions: Session[];
  activeId: string | null;
  view: ViewId;
  settings: Settings;
  skills: Skill[];
  mcpServers: McpServer[];
  sidebarOpen: boolean;
  panelOpen: boolean;
}

export interface AgentMeta {
  id: AgentId;
  name: string;
  description: string;
  readOnly: boolean;
}

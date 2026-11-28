import type { PermissionRule } from "./permissions";

export type ProviderId =
  | "anthropic"
  | "openai"
  | "openrouter"
  | "opencode"
  | "groq"
  | "google"
  | "nvidia"
  | "ollama"
  | "lmstudio"
  | "custom";

export type AgentId = "build" | "plan" | "chat";
export type ThemeMode = "dark" | "light" | "system";
export type ViewId = "chats" | "skills" | "integrations";
export type Mode = "chat" | "code" | "browser";

export interface Attachment {
  id: string;
  name: string;
  size: number;
  kind: "text" | "image" | "other";
  /** Text contents, or a data URL for images. */
  body: string;
}

export interface EditorSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  tabSize: number;
  wordWrap: "on" | "off";
  minimap: boolean;
}

/** One file change from the assistant, held for Keep or Decline. */
export interface StagedChange {
  path: string;
  before: string;
  after: string;
  existed: boolean;
  at: number;
  /** Chat writes immediately so tools see the file; Discard reverts it. */
  applied?: boolean;
}

export interface WorkspaceFile {
  id: string;
  name: string;
  path: string;
  size: number;
  text: string;
  added: number;
  binary?: boolean;
  /** An empty folder in the explorer. Files are inferred from their paths. */
  dir?: boolean;
  /** Absolute root for a file from an added (multi-root) folder. */
  root?: string;
  /** Path relative to `root`; `path` carries the visible folder prefix. */
  relative?: string;
}

export type ToolKind =
  | "read"
  | "grep"
  | "edit"
  | "terminal"
  | "plan"
  | "web"
  | "deliver"
  | "git"
  | "preview";
export type ToolState = "run" | "done" | "error";

export interface DiffLine {
  type: "add" | "del" | "ctx";
  no: number;
  text: string;
}

export type Part =
  | { id: string; kind: "text"; text: string }
  | {
      id: string;
      kind: "reasoning";
      /** The model's own thinking, when the provider streams it. */
      text: string;
      state: "run" | "done";
      durationMs?: number;
    }
  | {
      id: string;
      kind: "tool";
      tool: ToolKind;
      /** Raw tool name, so the transcript can label a step precisely. */
      name?: string;
      label: string;
      detail?: string;
      state: ToolState;
      /** Wall-clock time this step took, shown at the end of its row. */
      durationMs?: number;
      /** A connected app or product mark for the step icon. */
      brand?: string;
    }
  | { id: string; kind: "diff"; path: string; added: number; removed: number; lines: DiffLine[] }
  | {
      id: string;
      kind: "shell";
      command: string;
      output: string[];
      state: ToolState;
      durationMs?: number;
    }
  | { id: string; kind: "note"; text: string }
  | {
      id: string;
      kind: "artifact";
      /** Key in the in-memory artifact registry, used by the Download button. */
      artifactId: string;
      name: string;
      format: string;
      bytes: number;
    };

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
  attachments?: Attachment[];
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
  /**
   * Which surface owns this thread. Chat, browser and code keep separate
   * histories, so a browser task never overwrites the chat you were writing.
   */
  surface?: Mode;
  /**
   * Absolute folder this thread was started in. Project threads live under
   * their folder in the sidebar; plain chats stay in Chats.
   */
  project?: string;
  /** Kept at the top of the sidebar, above the project groups. */
  pinned?: boolean;
  /** Message snapshots for /undo and /redo. */
  past?: Message[][];
  future?: Message[][];
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

export interface CustomCommand {
  id: string;
  name: string;
  description: string;
  /** Prompt template. `$ARGUMENTS` is replaced with whatever follows the command. */
  template: string;
}

export type SkillCategory =
  | "engineering"
  | "security"
  | "product"
  | "data"
  | "writing"
  | "design";

export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  builtin?: boolean;
  category?: SkillCategory;
  tags?: string[];
  source?: "builtin" | "custom" | "plugin";
  pluginId?: string;
}

export interface PluginSkill {
  name: string;
  description: string;
  instructions: string;
}

export interface Plugin {
  id: string;
  name: string;
  publisher: string;
  description: string;
  category: SkillCategory;
  version: string;
  featured?: boolean;
  skills: PluginSkill[];
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

export type ChimePreset = "soft" | "bell" | "chime" | "blip" | "drop" | "none";
export interface CompareSide {
  provider: ProviderId;
  model: string;
}
export type ChimeKind = "done" | "error" | "ask";

/**
 * A project is a folder you build in. Threads can belong to it, and opening
 * the project makes that folder the active workspace.
 */
export interface Project {
  id: string;
  name: string;
  /** Absolute folder on the desktop build; the folder name in a browser tab. */
  root: string;
  created: number;
}

export interface Settings {
  theme: ThemeMode;
  sendOnEnter: boolean;
  reduceMotion: boolean;
  defaultAgent: AgentId;
  defaultProvider: ProviderId;
  defaultModel: string;
  permissionMode: "auto" | "ask";
  /** The user allowed Lantas to read and edit the folder it was given. */
  fileAccess: boolean;
  /** The user allowed commands to run in that folder. */
  terminalAccess: boolean;
  screenAccess: boolean;
  computerControl: boolean;
  /** The consent sheet has been shown, so it is not shown on every launch. */
  permissionsReviewed: boolean;
  telemetry: boolean;
  notifications: boolean;
  /** A cue when a reply finishes; the presets below choose which one. */
  sound: boolean;
  chimeDone: ChimePreset;
  chimeError: ChimePreset;
  chimeAsk: ChimePreset;
  /** "provider/model" keys pinned to the top of every model list. */
  favoriteModels: string[];
  /** Actions the user chose to stop asking about, from the approval sheet. */
  allowedRules: PermissionRule[];
  providers: Record<ProviderId, ProviderConfig>;
  editor: EditorSettings;
}

export interface AppState {
  sessions: Session[];
  /** Folder-backed projects, including ones with no thread yet. */
  projects: Project[];
  activeId: string | null;
  view: ViewId;
  mode: Mode;
  browserUrl: string;
  workspace: WorkspaceFile[];
  workspaceName: string;
  /** Absolute folder path on the desktop build, so the IDE can write files back. */
  workspaceRoot: string;
  settings: Settings;
  skills: Skill[];
  mcpServers: McpServer[];
  commands: CustomCommand[];
  sidebarOpen: boolean;
  panelOpen: boolean;
}

export interface AgentMeta {
  id: AgentId;
  name: string;
  description: string;
  readOnly: boolean;
}

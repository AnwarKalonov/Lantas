import { httpFetch } from "./providers";

const KEY = "lantas.composio.v1";
const AUTH_CACHE = "lantas.composio.auth.v1";
const DEVICE_KEY = "lantas.device.v1";
const BASE = "https://backend.composio.dev/api/v3.1";

/**
 * The project key ships with the app build (VITE_COMPOSIO_KEY, injected from
 * the CI secret). People using Lantas never paste a key.
 */
const APP_KEY = String(import.meta.env.VITE_COMPOSIO_KEY ?? "").trim();

export interface ComposioConfig {
  apiKey: string;
  userId: string;
}

export interface Connection {
  id: string;
  toolkit: string;
  status: string;
}

export type IntegrationCategory =
  | "Communication"
  | "Productivity"
  | "Developer"
  | "CRM"
  | "Storage"
  | "Social";

export interface IntegrationApp {
  slug: string;
  name: string;
  blurb: string;
  category: IntegrationCategory;
  icon: string;
  domain: string;
}

export const CATALOG: IntegrationApp[] = [
  { slug: "gmail", name: "Gmail", blurb: "Read, search and send mail", category: "Communication", icon: "gmail", domain: "gmail.com" },
  { slug: "slack", name: "Slack", blurb: "Channels, DMs and search", category: "Communication", icon: "slack", domain: "slack.com" },
  { slug: "discord", name: "Discord", blurb: "Servers, channels and DMs", category: "Communication", icon: "discord", domain: "discord.com" },
  { slug: "telegram", name: "Telegram", blurb: "Chats and channels", category: "Communication", icon: "telegram", domain: "telegram.org" },
  { slug: "whatsapp", name: "WhatsApp", blurb: "Messages and contacts", category: "Communication", icon: "whatsapp", domain: "whatsapp.com" },
  { slug: "outlook", name: "Outlook", blurb: "Mail and calendar", category: "Communication", icon: "microsoftoutlook", domain: "outlook.com" },
  { slug: "intercom", name: "Intercom", blurb: "Customer conversations", category: "Communication", icon: "intercom", domain: "intercom.com" },
  { slug: "zendesk", name: "Zendesk", blurb: "Support tickets", category: "Communication", icon: "zendesk", domain: "zendesk.com" },

  { slug: "notion", name: "Notion", blurb: "Pages and databases", category: "Productivity", icon: "notion", domain: "notion.so" },
  { slug: "googlecalendar", name: "Calendar", blurb: "Events and availability", category: "Productivity", icon: "googlecalendar", domain: "calendar.google.com" },
  { slug: "googledrive", name: "Drive", blurb: "Files, docs and sheets", category: "Productivity", icon: "googledrive", domain: "drive.google.com" },
  { slug: "airtable", name: "Airtable", blurb: "Records and bases", category: "Productivity", icon: "airtable", domain: "airtable.com" },
  { slug: "trello", name: "Trello", blurb: "Boards, lists and cards", category: "Productivity", icon: "trello", domain: "trello.com" },
  { slug: "asana", name: "Asana", blurb: "Tasks and projects", category: "Productivity", icon: "asana", domain: "asana.com" },
  { slug: "monday", name: "monday.com", blurb: "Boards and workflows", category: "Productivity", icon: "mondaydotcom", domain: "monday.com" },
  { slug: "clickup", name: "ClickUp", blurb: "Tasks, docs and goals", category: "Productivity", icon: "clickup", domain: "clickup.com" },
  { slug: "todoist", name: "Todoist", blurb: "Tasks and projects", category: "Productivity", icon: "todoist", domain: "todoist.com" },

  { slug: "github", name: "GitHub", blurb: "Repos, issues and PRs", category: "Developer", icon: "github", domain: "github.com" },
  { slug: "linear", name: "Linear", blurb: "Issues and cycles", category: "Developer", icon: "linear", domain: "linear.app" },
  { slug: "jira", name: "Jira", blurb: "Tickets and sprints", category: "Developer", icon: "jira", domain: "atlassian.com" },
  { slug: "sentry", name: "Sentry", blurb: "Errors and releases", category: "Developer", icon: "sentry", domain: "sentry.io" },
  { slug: "vercel", name: "Vercel", blurb: "Deployments and projects", category: "Developer", icon: "vercel", domain: "vercel.com" },
  { slug: "supabase", name: "Supabase", blurb: "Projects and tables", category: "Developer", icon: "supabase", domain: "supabase.com" },

  { slug: "hubspot", name: "HubSpot", blurb: "Contacts, deals and tickets", category: "CRM", icon: "hubspot", domain: "hubspot.com" },
  { slug: "salesforce", name: "Salesforce", blurb: "Leads and opportunities", category: "CRM", icon: "salesforce", domain: "salesforce.com" },
  { slug: "pipedrive", name: "Pipedrive", blurb: "Deals and pipelines", category: "CRM", icon: "pipedrive", domain: "pipedrive.com" },

  { slug: "dropbox", name: "Dropbox", blurb: "Files and folders", category: "Storage", icon: "dropbox", domain: "dropbox.com" },
  { slug: "box", name: "Box", blurb: "Files and collaboration", category: "Storage", icon: "box", domain: "box.com" },

  { slug: "x", name: "X", blurb: "Posts and timeline", category: "Social", icon: "x", domain: "x.com" },
  { slug: "reddit", name: "Reddit", blurb: "Posts and comments", category: "Social", icon: "reddit", domain: "reddit.com" },
  { slug: "youtube", name: "YouTube", blurb: "Videos and playlists", category: "Social", icon: "youtube", domain: "youtube.com" },
  { slug: "spotify", name: "Spotify", blurb: "Playlists and library", category: "Social", icon: "spotify", domain: "spotify.com" },
];

function deviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved) return saved;
    const fresh = `lantas-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return "lantas-desktop";
  }
}

function profileEmail(): string | null {
  try {
    const raw = localStorage.getItem("lantas.el.v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { profile?: { email?: string } };
    return parsed.profile?.email ?? null;
  } catch {
    return null;
  }
}

export function appKeyPresent(): boolean {
  return Boolean(APP_KEY || getStoredKey());
}

function getStoredKey(): string {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}").apiKey ?? "";
  } catch {
    return "";
  }
}

/** A developer override; the shipped app always uses the baked-in key. */
export function setComposioKey(apiKey: string) {
  if (apiKey.trim()) localStorage.setItem(KEY, JSON.stringify({ apiKey: apiKey.trim() }));
  else localStorage.removeItem(KEY);
}

export function getComposio(): ComposioConfig | null {
  const apiKey = APP_KEY || getStoredKey();
  if (!apiKey) return null;
  return { apiKey, userId: profileEmail() ?? deviceId() };
}

export class ComposioError extends Error {}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = getComposio();
  if (!config) throw new ComposioError("This build has no Composio app key.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const response = await httpFetch(`${BASE}${path}`, {
    ...init,
    signal: controller.signal,
    headers: {
      "x-api-key": config.apiKey,
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  }).finally(() => clearTimeout(timer));
  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text);
      detail = parsed?.error?.message ?? parsed?.message ?? detail;
    } catch {
      /* raw */
    }
    throw new ComposioError(`${response.status} · ${detail}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

function list<T>(payload: any): T[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.auth_configs)) return payload.auth_configs;
  return [];
}

export async function listConnections(): Promise<Connection[]> {
  const config = getComposio();
  if (!config) return [];
  const data = await api<any>(
    `/connected_accounts?limit=100&user_ids=${encodeURIComponent(config.userId)}`,
  );
  return list<any>(data).map((item) => ({
    id: item.id,
    toolkit: item.toolkit?.slug ?? item.toolkit_slug ?? "",
    status: (item.status ?? item.connectionData?.status ?? "").toUpperCase(),
  }));
}

function readAuthCache(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(AUTH_CACHE) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function cacheAuthConfig(app: string, id: string) {
  try {
    localStorage.setItem(AUTH_CACHE, JSON.stringify({ ...readAuthCache(), [app]: id }));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Finds the project's auth config for a toolkit, creating a Composio-managed one
 * on first use. Nothing for the user to configure in the dashboard.
 */
async function authConfigId(app: string): Promise<string> {
  const cached = readAuthCache()[app];
  if (cached) return cached;

  const data = await api<any>(`/auth_configs?toolkit_slug=${encodeURIComponent(app)}&limit=20`);
  const found = list<any>(data).find((item) => item.id);
  if (found) {
    cacheAuthConfig(app, found.id);
    return found.id;
  }

  const created = await api<any>("/auth_configs", {
    method: "POST",
    body: JSON.stringify({
      toolkit: { slug: app },
      auth_config: { type: "use_composio_managed_auth", name: app },
    }),
  });
  const id = created?.auth_config?.id ?? created?.id;
  if (!id) {
    throw new ComposioError(
      `Composio could not create an auth config for ${app}. Add it once in the Composio dashboard and retry.`,
    );
  }
  cacheAuthConfig(app, id);
  return id;
}

/** Starts hosted OAuth and returns the URL the user finishes in a browser. */
export async function connectToolkit(app: string): Promise<string> {
  const config = getComposio();
  if (!config) throw new ComposioError("This build has no Composio app key.");
  const authConfig = await authConfigId(app);
  // tauri:// and localhost origins are not valid OAuth callbacks; Composio then
  // shows its own success page and the app picks the account up by polling.
  const here = window.location.href;
  const callback = /^https?:/i.test(here) ? here : undefined;

  try {
    const link = await api<any>("/connected_accounts/link", {
      method: "POST",
      body: JSON.stringify({
        auth_config_id: authConfig,
        user_id: config.userId,
        ...(callback ? { callback_url: callback } : {}),
      }),
    });
    if (link?.redirect_url) return link.redirect_url;
  } catch {
    /* projects without the link endpoint fall through */
  }

  const created = await api<any>("/connected_accounts", {
    method: "POST",
    body: JSON.stringify({
      auth_config: { id: authConfig },
      connection: { user_id: config.userId, ...(callback ? { callback_url: callback } : {}) },
    }),
  });
  const url = created?.redirect_url ?? created?.connectionData?.redirectUrl;
  if (!url) throw new ComposioError("Composio did not return a redirect URL.");
  return url;
}

export async function revokeConnection(id: string): Promise<void> {
  await api(`/connected_accounts/${encodeURIComponent(id)}/revoke`, { method: "POST" });
}

export async function executeTool(
  slug: string,
  args: Record<string, unknown>,
  accountId?: string,
): Promise<unknown> {
  const config = getComposio();
  if (!config) throw new ComposioError("This build has no Composio app key.");
  const data = await api<any>(`/tools/execute/${encodeURIComponent(slug)}`, {
    method: "POST",
    body: JSON.stringify({
      user_id: config.userId,
      arguments: args,
      ...(accountId ? { connected_account_id: accountId } : {}),
      version: "latest",
    }),
  });
  if (data?.successful === false && data?.error) throw new ComposioError(String(data.error));
  return data?.data ?? data;
}

export interface InboxItem {
  subject: string;
  from: string;
  snippet: string;
}

export async function fetchInbox(limit = 8): Promise<InboxItem[]> {
  const data: any = await executeTool("GMAIL_FETCH_EMAILS", {
    max_results: limit,
    query: "is:unread",
  });
  const messages: any[] = Array.isArray(data)
    ? data
    : (data?.messages ?? data?.emails ?? data?.data ?? []);
  return (Array.isArray(messages) ? messages : []).slice(0, limit).map((item) => ({
    subject:
      item.subject ??
      item.messageSubject ??
      item.payload?.headers?.find?.((h: any) => h.name === "Subject")?.value ??
      "(no subject)",
    from:
      item.sender ??
      item.from ??
      item.messageSender ??
      item.payload?.headers?.find?.((h: any) => h.name === "From")?.value ??
      "",
    snippet: item.snippet ?? item.messageSnippet ?? item.preview ?? "",
  }));
}

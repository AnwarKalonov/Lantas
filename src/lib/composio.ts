import { httpFetch } from "./providers";

const KEY = "lantas.composio.v1";
const BASE = "https://backend.composio.dev/api/v3.1";

export interface ComposioConfig {
  apiKey: string;
  userId: string;
}

export interface Toolkit {
  slug: string;
  name: string;
  description: string;
  logo?: string;
  connected: boolean;
  accountId?: string;
}

export const TOOLKITS: Array<{ slug: string; name: string; blurb: string }> = [
  { slug: "gmail", name: "Gmail", blurb: "Read, search and send mail" },
  { slug: "googlecalendar", name: "Google Calendar", blurb: "Events and availability" },
  { slug: "googledrive", name: "Google Drive", blurb: "Files and docs" },
  { slug: "slack", name: "Slack", blurb: "Channels and messages" },
  { slug: "notion", name: "Notion", blurb: "Pages and databases" },
  { slug: "github", name: "GitHub", blurb: "Repos, issues and PRs" },
  { slug: "linear", name: "Linear", blurb: "Issues and projects" },
  { slug: "jira", name: "Jira", blurb: "Tickets and sprints" },
  { slug: "discord", name: "Discord", blurb: "Servers and DMs" },
  { slug: "trello", name: "Trello", blurb: "Boards and cards" },
  { slug: "airtable", name: "Airtable", blurb: "Records and bases" },
  { slug: "hubspot", name: "HubSpot", blurb: "Contacts and deals" },
];

export function getComposio(): ComposioConfig | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ComposioConfig;
    return parsed.apiKey ? parsed : null;
  } catch {
    return null;
  }
}

export function setComposio(config: ComposioConfig | null) {
  if (!config?.apiKey) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, JSON.stringify(config));
}

export class ComposioError extends Error {}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = getComposio();
  if (!config) throw new ComposioError("Add a Composio API key first.");
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
  return [];
}

export async function verifyComposio(): Promise<number> {
  const data = await api<any>("/toolkits?limit=1");
  return list<any>(data).length || Number(data?.total_items ?? 0);
}

export interface Connection {
  id: string;
  toolkit: string;
  status: string;
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

async function authConfigId(toolkit: string): Promise<string> {
  const data = await api<any>(
    `/auth_configs?toolkit_slug=${encodeURIComponent(toolkit)}&limit=20`,
  );
  const items = list<any>(data);
  const config = items.find((item) => item.id);
  if (!config) {
    throw new ComposioError(
      `No auth config for ${toolkit}. Create one in the Composio dashboard, then retry.`,
    );
  }
  return config.id;
}

/** Starts the hosted OAuth flow and returns the URL the user must open. */
export async function connectToolkit(toolkit: string): Promise<{ url: string; id?: string }> {
  const config = getComposio();
  if (!config) throw new ComposioError("Add a Composio API key first.");
  const authConfig = await authConfigId(toolkit);

  try {
    const link = await api<any>("/connected_accounts/link", {
      method: "POST",
      body: JSON.stringify({
        auth_config_id: authConfig,
        user_id: config.userId,
        callback_url: window.location.href,
      }),
    });
    if (link?.redirect_url) return { url: link.redirect_url, id: link.connected_account_id };
  } catch {
    /* older projects only expose connected_accounts */
  }

  const created = await api<any>("/connected_accounts", {
    method: "POST",
    body: JSON.stringify({
      auth_config: { id: authConfig },
      connection: {
        user_id: config.userId,
        callback_url: window.location.href,
      },
    }),
  });
  const url =
    created?.redirect_url ??
    created?.redirectUrl ??
    created?.connectionData?.redirectUrl;
  if (!url) throw new ComposioError("Composio did not return a redirect URL.");
  return { url, id: created.id };
}

export async function accountStatus(id: string): Promise<string> {
  const data = await api<any>(`/connected_accounts/${id}`);
  return (data.status ?? data.connectionData?.status ?? "").toUpperCase();
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
  if (!config) throw new ComposioError("Add a Composio API key first.");
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

/** Read the unread inbox through Composio's Gmail tools. */
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
      item.subject ?? item.messageSubject ?? item.payload?.headers?.find?.((h: any) => h.name === "Subject")?.value ?? "(no subject)",
    from:
      item.sender ?? item.from ?? item.messageSender ?? item.payload?.headers?.find?.((h: any) => h.name === "From")?.value ?? "",
    snippet: item.snippet ?? item.messageSnippet ?? item.preview ?? "",
  }));
}

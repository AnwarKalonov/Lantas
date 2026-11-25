import { httpFetch } from "./providers";

const KEY = "lantas.composio.v1";
const AUTH_CACHE = "lantas.composio.auth.v1";
const DEVICE_KEY = "lantas.device.v1";
const BASE = "https://backend.composio.dev/api/v3.1";

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

export function keyPresent(): boolean {
  return Boolean(getStoredKey());
}

function getStoredKey(): string {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}").apiKey ?? "";
  } catch {
    return "";
  }
}

/** Each person brings their own Composio project key; it stays on this Mac. */
export function setComposioKey(apiKey: string) {
  if (apiKey.trim()) localStorage.setItem(KEY, JSON.stringify({ apiKey: apiKey.trim() }));
  else localStorage.removeItem(KEY);
}

export function getComposio(): ComposioConfig | null {
  const apiKey = getStoredKey();
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

function forgetAuthConfig(app: string) {
  try {
    const map = readAuthCache();
    delete map[app];
    localStorage.setItem(AUTH_CACHE, JSON.stringify(map));
  } catch {
    /* storage unavailable */
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
  // tauri:// and localhost origins are not valid OAuth callbacks; Composio then
  // shows its own success page and the app picks the account up by polling.
  const here = window.location.href;
  const callback = /^https?:/i.test(here) ? here : undefined;

  const withAuthConfig = async (authConfig: string): Promise<string> => {
    let linkError = "";
    try {
      const link = await api<any>("/connected_accounts/link", {
        method: "POST",
        body: JSON.stringify({
          auth_config_id: authConfig,
          user_id: config.userId,
          ...(callback ? { callback_url: callback } : {}),
        }),
      });
      const linkUrl = link?.redirect_url ?? link?.redirectUrl;
      if (linkUrl) return linkUrl;
      linkError = "Composio returned no redirect URL for the connect link.";
    } catch (error) {
      // Keep the reason: a deprecated or rejected endpoint must not turn into a
      // silent second call with a stranger error message.
      linkError = error instanceof Error ? error.message : String(error);
    }

    try {
      const created = await api<any>("/connected_accounts", {
        method: "POST",
        body: JSON.stringify({
          auth_config: { id: authConfig },
          connection: { user_id: config.userId, ...(callback ? { callback_url: callback } : {}) },
        }),
      });
      const url =
        created?.redirect_url ?? created?.redirectUrl ?? created?.connectionData?.redirectUrl;
      if (url) return url;
      throw new ComposioError(linkError || "Composio did not return a redirect URL for this app.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ComposioError(
        linkError && !message.includes(linkError) ? `${message} · connect link: ${linkError}` : message,
      );
    }
  };

  const cached = readAuthCache()[app];
  if (cached) {
    try {
      return await withAuthConfig(cached);
    } catch (first) {
      // A saved auth config can belong to an older project or have been deleted
      // in Composio. Make a current one and try the whole flow once more.
      forgetAuthConfig(app);
      const firstError = first instanceof Error ? first.message : String(first);
      try {
        return await withAuthConfig(await authConfigId(app));
      } catch (second) {
        const message = second instanceof Error ? second.message : String(second);
        throw new ComposioError(message === firstError ? message : `${message} · first attempt: ${firstError}`);
      }
    }
  }
  return withAuthConfig(await authConfigId(app));
}

export async function revokeConnection(id: string): Promise<void> {
  clearConnectionCache();
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
  id: string;
  subject: string;
  from: string;
  snippet: string;
  date: string;
  threadId: string;
  labels: string[];
}

export interface InboxPage {
  items: InboxItem[];
  nextCursor: string | null;
}

/** Gmail tool payloads differ by toolkit version; accept every known shape. */
function header(item: any, name: string): string {
  const headers = item?.payload?.headers ?? item?.headers ?? item?.messagePayload?.headers;
  if (Array.isArray(headers)) {
    const hit = headers.find(
      (entry: any) => String(entry?.name ?? entry?.key ?? "").toLowerCase() === name.toLowerCase(),
    );
    if (hit) return String(hit.value ?? "");
  }
  return "";
}

function findMessageArray(data: any, depth = 0): any[] {
  if (depth > 5 || data == null) return [];
  if (Array.isArray(data)) {
    // A bare array of strings is a label list, not messages.
    return data.some((item) => item && typeof item === "object") ? data : [];
  }
  if (typeof data !== "object") return [];
  for (const key of ["messages", "emails", "items", "data", "results", "response_data"]) {
    const found = data[key];
    if (Array.isArray(found) && found.some((item: any) => item && typeof item === "object")) {
      return found;
    }
  }
  for (const value of Object.values(data)) {
    const nested = findMessageArray(value, depth + 1);
    if (nested.length) return nested;
  }
  return [];
}

function cursorOf(data: any): string | null {
  if (!data || typeof data !== "object") return null;
  const direct =
    data.nextPageToken ??
    data.next_page_token ??
    data.nextCursor ??
    data.next_cursor ??
    data.pageToken ??
    data.page_token;
  if (typeof direct === "string" && direct) return direct;
  const messages = findMessageArray(data);
  if (messages.length) {
    const last = messages[messages.length - 1];
    const token = last?.nextPageToken ?? last?.next_page_token;
    if (typeof token === "string" && token) return token;
  }
  return null;
}

function normalizeMessage(item: any, index: number): InboxItem {
  const labels = Array.isArray(item?.labelIds)
    ? item.labelIds
    : Array.isArray(item?.label_ids)
      ? item.label_ids
      : Array.isArray(item?.labels)
        ? item.labels
        : [];
  const body =
    item?.messageText ??
    item?.body ??
    item?.text ??
    item?.payload?.body?.data ??
    item?.snippet ??
    item?.messageSnippet ??
    item?.preview ??
    "";
  return {
    id: String(item?.messageId ?? item?.id ?? item?.message_id ?? `mail_${index}`),
    subject:
      item?.subject ||
      item?.messageSubject ||
      header(item, "Subject") ||
      "(no subject)",
    from:
      item?.sender ||
      item?.from ||
      item?.messageSender ||
      header(item, "From") ||
      "",
    snippet: String(body).replace(/\s+/g, " ").trim().slice(0, 320),
    date: String(
      item?.messageTimestamp ||
        item?.date ||
        item?.internalDate ||
        header(item, "Date") ||
        "",
    ),
    threadId: String(item?.threadId ?? item?.thread_id ?? ""),
    labels: labels.map((label: unknown) => String(label)),
  };
}

/**
 * One page of mail. `max_results` is the page size; the caller pages with the
 * returned cursor. Composio's Gmail tool caps a single response, so a large
 * request is satisfied by following cursors rather than by trusting one call.
 */
export async function fetchInboxPage(options: {
  limit?: number;
  cursor?: string | null;
  query?: string;
} = {}): Promise<InboxPage> {
  const limit = Math.min(Math.max(1, options.limit ?? 25), 100);
  const query = options.query?.trim() || "is:unread";
  const args: Record<string, unknown> = {
    max_results: limit,
    query,
  };
  if (options.cursor) args.page_token = options.cursor;

  const data: any = await executeTool("GMAIL_FETCH_EMAILS", args);
  const messages = findMessageArray(data);
  return {
    items: messages.slice(0, limit).map(normalizeMessage),
    nextCursor: cursorOf(data),
  };
}

/**
 * Reads up to `limit` messages, following the page cursor. Three round trips is
 * enough for a normal inbox read and keeps a single prompt from hanging on a
 * slow upstream.
 */
export async function fetchInbox(
  limit = 25,
  query = "is:unread",
): Promise<InboxItem[]> {
  const wanted = Math.min(Math.max(1, limit), 200);
  const items: InboxItem[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < 4 && items.length < wanted; page += 1) {
    const result = await fetchInboxPage({
      limit: Math.min(50, wanted - items.length),
      cursor,
      query,
    });
    for (const item of result.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
      if (items.length >= wanted) break;
    }
    if (!result.nextCursor || result.items.length === 0) break;
    cursor = result.nextCursor;
  }

  return items.slice(0, wanted);
}

/** Gmail search with the same pagination contract. */
export async function searchEmails(query: string, limit = 25): Promise<InboxItem[]> {
  const clean = query.trim();
  if (!clean) return fetchInbox(limit, "is:unread");
  return fetchInbox(limit, clean);
}

export interface ComposioTool {
  slug: string;
  name: string;
  description: string;
  toolkit: string;
}

/** Tools a connected app exposes, so the agent can discover instead of guess. */
export async function listToolkitTools(toolkit: string): Promise<ComposioTool[]> {
  const data = await api<any>(
    `/tools?toolkit_slug=${encodeURIComponent(toolkit)}&limit=200&toolkit_versions=latest`,
  );
  return list<any>(data)
    .map((tool) => ({
      slug: String(tool.slug ?? tool.name ?? ""),
      name: String(tool.name ?? tool.slug ?? ""),
      description: String(tool.description ?? "").replace(/\s+/g, " ").slice(0, 240),
      toolkit: String(tool.toolkit?.slug ?? tool.toolkit_slug ?? toolkit),
    }))
    .filter((tool) => tool.slug);
}

/** Connected toolkits, cached briefly so a turn does not re-list on every step. */
let connectionsCache: { at: number; items: Connection[] } | null = null;

export async function activeToolkits(): Promise<string[]> {
  if (connectionsCache && Date.now() - connectionsCache.at < 30_000) {
    return connectionsCache.items
      .filter((item) => item.status === "ACTIVE")
      .map((item) => item.toolkit);
  }
  const items = await listConnections();
  connectionsCache = { at: Date.now(), items };
  return items.filter((item) => item.status === "ACTIVE").map((item) => item.toolkit);
}

export function clearConnectionCache() {
  connectionsCache = null;
}

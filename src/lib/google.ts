import { httpFetch } from "./providers";

const CLIENT_KEY = "lantas.google.client";
const TOKEN_KEY = "lantas.google.token";

export interface GoogleToken {
  token: string;
  expires: number;
}

export function getGoogleClient(): string {
  try {
    return localStorage.getItem(CLIENT_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setGoogleClient(id: string) {
  if (id.trim()) localStorage.setItem(CLIENT_KEY, id.trim());
  else localStorage.removeItem(CLIENT_KEY);
}

export function getGoogleToken(): GoogleToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GoogleToken;
    if (!parsed.token || parsed.expires < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearGoogleToken() {
  localStorage.removeItem(TOKEN_KEY);
}

/** Redirect to Google's consent screen (implicit flow: no secret, no server). */
export function startGoogleAuth(): string | null {
  const client = getGoogleClient();
  if (!client) return "Add an OAuth client ID first.";
  const redirect = `${window.location.origin}${window.location.pathname}`;
  const params = new URLSearchParams({
    client_id: client,
    redirect_uri: redirect,
    response_type: "token",
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    include_granted_scopes: "true",
    prompt: "consent",
    state: "lantas-google",
  });
  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  return null;
}

/** On return, pick the token out of the URL fragment and clean the address bar. */
export function consumeGoogleHash(): boolean {
  if (!window.location.hash.includes("access_token=")) return false;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("access_token");
  const expiresIn = Number(params.get("expires_in") ?? 3600);
  const state = params.get("state");
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  if (!token || state !== "lantas-google") return false;
  localStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({ token, expires: Date.now() + (expiresIn - 60) * 1000 } satisfies GoogleToken),
  );
  return true;
}

export interface MailItem {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

async function gmail<T>(path: string): Promise<T> {
  const auth = getGoogleToken();
  if (!auth) throw new Error("Gmail is not connected.");
  const response = await httpFetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { authorization: `Bearer ${auth.token}` },
  });
  if (!response.ok) throw new Error(`Gmail ${response.status}`);
  return (await response.json()) as T;
}

export async function listMail(max = 8): Promise<MailItem[]> {
  const list = await gmail<{ messages?: Array<{ id: string }> }>(
    `/messages?maxResults=${max}&q=is%3Aunread`,
  );
  const items: MailItem[] = [];
  for (const entry of list.messages ?? []) {
    try {
      const message = await gmail<any>(`/messages/${entry.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
      const headers: Array<{ name: string; value: string }> = message.payload?.headers ?? [];
      const header = (name: string) =>
        headers.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? "";
      items.push({
        id: entry.id,
        subject: header("Subject") || "(no subject)",
        from: header("From"),
        date: header("Date"),
        snippet: message.snippet ?? "",
      });
    } catch {
      /* skip message */
    }
  }
  return items;
}

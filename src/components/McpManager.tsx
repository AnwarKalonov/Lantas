import { useState } from "react";
import { MCP_TEMPLATES } from "../lib/data";
import { httpFetch } from "../lib/providers";
import { useStore } from "../lib/store";
import type { McpServer, McpTransport } from "../lib/types";
import { cx, timeAgo, uid } from "../lib/util";
import { Icon } from "./Icons";

interface Draft {
  name: string;
  transport: McpTransport;
  url: string;
  command: string;
}

const EMPTY: Draft = { name: "", transport: "http", url: "", command: "" };

export function McpManager({ compact = false }: { compact?: boolean }) {
  const { state, addMcp, updateMcp, deleteMcp, notify } = useStore();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [adding, setAdding] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  const test = async (server: McpServer) => {
    if (server.transport === "stdio") {
      updateMcp(server.id, {
        status: "error",
        detail: "Stdio servers need the desktop runtime — they cannot start in a browser tab",
        checkedAt: Date.now(),
      });
      notify("Stdio servers start with the desktop runtime", "error");
      return;
    }
    if (!server.url) {
      updateMcp(server.id, { status: "error", detail: "No URL set", checkedAt: Date.now() });
      return;
    }

    setTesting(server.id);
    try {
      const response = await httpFetch(server.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "lantas", version: "0.1.0" },
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      const body = await response.text();
      const accepted = body.includes("result") || body.includes("serverInfo");
      updateMcp(server.id, {
        status: accepted ? "connected" : "error",
        detail: accepted ? "Handshake accepted" : "Responded, but not with an MCP initialize result",
        checkedAt: Date.now(),
      });
      notify(accepted ? `${server.name} connected` : `${server.name} did not complete the handshake`);
    } catch (error) {
      const detail =
        error instanceof TypeError
          ? "Could not reach the server (network or CORS). In the desktop app this goes through the native client."
          : error instanceof Error
            ? error.message
            : String(error);
      updateMcp(server.id, { status: "error", detail, checkedAt: Date.now() });
      notify(`${server.name}: ${detail}`, "error");
    } finally {
      setTesting(null);
    }
  };

  const submit = () => {
    const name = draft.name.trim();
    if (!name) {
      notify("Give the server a name", "error");
      return;
    }
    if (draft.transport === "http" && !draft.url.trim()) {
      notify("An HTTP server needs a URL", "error");
      return;
    }
    if (draft.transport === "stdio" && !draft.command.trim()) {
      notify("A stdio server needs a command", "error");
      return;
    }
    addMcp({
      id: uid("mcp"),
      name,
      transport: draft.transport,
      url: draft.transport === "http" ? draft.url.trim() : undefined,
      command: draft.transport === "stdio" ? draft.command.trim() : undefined,
      enabled: true,
      status: "untested",
      detail: "Not tested yet",
    });
    setDraft(EMPTY);
    setAdding(false);
    notify(`${name} added`);
  };

  return (
    <div className={cx("mcp-manager", compact && "is-compact")}>
      <div className="mcp-list-full">
        {state.mcpServers.map((server) => (
          <div className="mcp-item" key={server.id}>
            <div className="mcp-item-head">
              <span
                className={cx(
                  "mcp-status",
                  server.status === "connected" && "is-ok",
                  server.status === "error" && "is-err",
                )}
                aria-hidden="true"
              />
              <span className="mcp-item-name">{server.name}</span>
              <span className="mcp-item-transport mono">{server.transport}</span>
              <span className="mcp-item-spacer" />
              <button
                type="button"
                className="text-button"
                onClick={() => updateMcp(server.id, { enabled: !server.enabled })}
              >
                {server.enabled ? "Disable" : "Enable"}
              </button>
              <button
                type="button"
                className="text-button"
                onClick={() => test(server)}
                disabled={testing === server.id}
              >
                {testing === server.id ? "Testing" : "Test"}
              </button>
              <button
                type="button"
                className="icon-button danger-hover"
                aria-label={`Remove ${server.name}`}
                onClick={() => {
                  deleteMcp(server.id);
                  notify(`${server.name} removed`);
                }}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
            <div className="mcp-item-detail mono">
              {server.transport === "http" ? server.url : server.command}
            </div>
            <div className={cx("mcp-item-status", server.status === "error" && "is-err")}>
              {server.detail}
              {server.checkedAt ? ` · checked ${timeAgo(server.checkedAt)}` : ""}
            </div>
          </div>
        ))}

        {state.mcpServers.length === 0 && (
          <p className="empty-line">No MCP servers configured</p>
        )}
      </div>

      {adding ? (
        <div className="mcp-form">
          <div className="field-row">
            <label className="field">
              <span>Name</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="linear"
                autoFocus
              />
            </label>
            <div className="field">
              <span>Transport</span>
              <div className="segmented">
                <button
                  type="button"
                  className={cx(draft.transport === "http" && "is-active")}
                  onClick={() => setDraft({ ...draft, transport: "http" })}
                >
                  HTTP
                </button>
                <button
                  type="button"
                  className={cx(draft.transport === "stdio" && "is-active")}
                  onClick={() => setDraft({ ...draft, transport: "stdio" })}
                >
                  Stdio
                </button>
              </div>
            </div>
          </div>

          {draft.transport === "http" ? (
            <label className="field">
              <span>Endpoint URL</span>
              <input
                value={draft.url}
                onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                placeholder="https://mcp.example.com/mcp"
                spellCheck={false}
              />
            </label>
          ) : (
            <label className="field">
              <span>Command</span>
              <input
                value={draft.command}
                onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                placeholder="npx -y @modelcontextprotocol/server-filesystem ~/dev"
                spellCheck={false}
              />
            </label>
          )}

          <div className="mcp-form-actions">
            <button type="button" className="button-primary" onClick={submit}>
              Add server
            </button>
            <button
              type="button"
              className="button-quiet"
              onClick={() => {
                setAdding(false);
                setDraft(EMPTY);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mcp-add-row">
          <button type="button" className="button-quiet" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} /> Add server
          </button>
          <span className="mcp-templates">
            {MCP_TEMPLATES.map((template) => (
              <button
                key={template.name}
                type="button"
                className="template-chip"
                onClick={() => {
                  setDraft({
                    name: template.name.toLowerCase(),
                    transport: template.transport,
                    url: template.url,
                    command: template.command,
                  });
                  setAdding(true);
                }}
              >
                {template.name}
              </button>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}

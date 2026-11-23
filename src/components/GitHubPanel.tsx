import { useEffect, useState } from "react";
import {
  commitFile,
  createRepo,
  getFile,
  getGithubToken,
  listRepos,
  loadRepo,
  setGithubToken,
  whoami,
  type Repo,
  type TreeEntry,
  getTree,
} from "../lib/github";
import { useStore } from "../lib/store";
import { cx } from "../lib/util";
import { Icon } from "./Icons";

export function GitHubPanel() {
  const { setWorkspace, setMode, notify } = useStore();
  const [token, setToken] = useState(getGithubToken());
  const [login, setLogin] = useState("");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [repo, setRepo] = useState<Repo | null>(null);
  const [tree, setTree] = useState<TreeEntry[]>([]);
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [sha, setSha] = useState("");
  const [message, setMessage] = useState("Update from Lantas");
  const [newName, setNewName] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);

  const connected = Boolean(getGithubToken());

  const refresh = async () => {
    setBusy("repos");
    setError("");
    try {
      const me = await whoami();
      setLogin(me.login);
      setRepos(await listRepos());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (connected) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openRepo = async (target: Repo) => {
    setBusy(`tree:${target.full_name}`);
    setError("");
    try {
      setRepo(target);
      const entries = await getTree(target.full_name, target.default_branch);
      setTree(entries.filter((entry) => /\.(md|mdx|txt|ts|tsx|js|jsx|json|css|html|yml|yaml|toml|py|rs|go|sh|swift)$/i.test(entry.path)).slice(0, 400));
      setPath("");
      setContent("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  const pick = async (entry: TreeEntry) => {
    if (!repo) return;
    setBusy("file");
    try {
      const file = await getFile(repo.full_name, entry.path, repo.default_branch);
      setPath(entry.path);
      setContent(file.text);
      setSha(file.sha);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!repo || !path) return;
    setBusy("save");
    try {
      await commitFile(repo.full_name, path, content, message || "Update from Lantas", repo.default_branch, sha);
      notify(`Committed ${path} to ${repo.name}`);
      const file = await getFile(repo.full_name, path, repo.default_branch);
      setSha(file.sha);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  const load = async (target: Repo) => {
    setBusy(`load:${target.full_name}`);
    try {
      const files = await loadRepo(target.full_name, target.default_branch);
      setWorkspace(`${target.name} · ${target.default_branch}`, files);
      setMode("code");
      notify(`${files.length} files from ${target.full_name}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };

  const filtered = repos.filter((entry) =>
    query.trim() ? entry.full_name.toLowerCase().includes(query.trim().toLowerCase()) : true,
  );

  return (
    <section className="gh-panel">
      <div className="gh-head">
        <div>
          <h2>GitHub</h2>
          <p className="gh-lede">
            A token stays on this machine. Repos load into the Code tab; edits commit straight back.
          </p>
        </div>
        {connected ? (
          <div className="gh-account">
            <span className="status-dot is-ok" />
            <span>{login || "connected"}</span>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setGithubToken("");
                setToken("");
                setRepos([]);
                setLogin("");
                setRepo(null);
              }}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <span className="tag">not connected</span>
        )}
      </div>

      {!connected && (
        <div className="gh-connect">
          <label className="field">
            <span>Personal access token</span>
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="github_pat_… or ghp_…"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <div className="gh-connect-actions">
            <button
              type="button"
              className="button-primary"
              disabled={!token.trim() || busy !== null}
              onClick={async () => {
                setGithubToken(token);
                await refresh();
              }}
            >
              Connect
            </button>
            <a
              className="text-button"
              href="https://github.com/settings/tokens/new?scopes=repo&description=Lantas"
              target="_blank"
              rel="noreferrer"
            >
              Create a token
            </a>
          </div>
          <p className="page-note">
            Needs <code>repo</code> scope (classic) or Contents + Metadata read/write (fine-grained).
          </p>
        </div>
      )}

      {error && <p className="status-line is-error">{error}</p>}

      {connected && !repo && (
        <>
          <div className="gh-toolbar">
            <label className="code-filter gh-search">
              <Icon name="search" size={13} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a repository"
                spellCheck={false}
              />
            </label>
            <button type="button" className="button-quiet" onClick={refresh} disabled={busy !== null}>
              {busy === "repos" ? "Loading" : "Refresh"}
            </button>
          </div>

          <div className="gh-repos">
            {filtered.map((entry) => (
              <div className="gh-repo" key={entry.full_name}>
                <button type="button" className="gh-repo-main" onClick={() => void openRepo(entry)}>
                  <span className="gh-repo-name">
                    <Icon name="folder" size={13} />
                    {entry.full_name}
                    {entry.private && <span className="tag">private</span>}
                  </span>
                  <span className="gh-repo-desc">
                    {entry.description || "No description"} · {entry.default_branch}
                  </span>
                </button>
                <button
                  type="button"
                  className="button-ghost"
                  disabled={busy !== null}
                  onClick={() => void load(entry)}
                >
                  {busy === `load:${entry.full_name}` ? "Loading" : "Open in Code"}
                </button>
              </div>
            ))}
            {filtered.length === 0 && (
              <p className="page-note">
                {busy === "repos" ? "Fetching repositories…" : "No repositories match."}
              </p>
            )}
          </div>

          <div className="gh-create">
            <label className="field">
              <span>New repository</span>
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="lantas-experiment"
                spellCheck={false}
              />
            </label>
            <label className="toggle-inline">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(event) => setIsPrivate(event.target.checked)}
              />
              Private
            </label>
            <button
              type="button"
              className="button-primary"
              disabled={!newName.trim() || busy !== null}
              onClick={async () => {
                setBusy("create");
                try {
                  const created = await createRepo(newName.trim(), isPrivate);
                  setRepos((current) => [created, ...current]);
                  setNewName("");
                  notify(`${created.full_name} created`);
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : String(caught));
                } finally {
                  setBusy(null);
                }
              }}
            >
              Create
            </button>
          </div>
        </>
      )}

      {repo && (
        <div className="gh-editor">
          <div className="gh-editor-head">
            <button type="button" className="text-button" onClick={() => setRepo(null)}>
              ← Repositories
            </button>
            <span className="mono gh-editor-repo">{repo.full_name}</span>
            <button type="button" className="button-quiet" onClick={() => void load(repo)}>
              Open in Code
            </button>
          </div>

          <div className="gh-editor-body">
            <div className="gh-files">
              {tree.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className={cx("gh-file", entry.path === path && "is-active")}
                  onClick={() => void pick(entry)}
                >
                  {entry.path}
                </button>
              ))}
              {tree.length === 0 && <p className="page-note">No text files in this repo.</p>}
            </div>

            <div className="gh-file-view">
              {path ? (
                <>
                  <div className="gh-file-head">
                    <span className="mono">{path}</span>
                    <input
                      className="gh-commit-message"
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      placeholder="Commit message"
                    />
                    <button
                      type="button"
                      className="button-primary"
                      onClick={() => void save()}
                      disabled={busy !== null}
                    >
                      {busy === "save" ? "Committing" : "Commit"}
                    </button>
                  </div>
                  <textarea
                    className="gh-textarea"
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    spellCheck={false}
                  />
                </>
              ) : (
                <p className="page-note">Pick a file to read and edit it.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

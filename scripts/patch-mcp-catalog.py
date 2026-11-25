def edit(path, pairs):
    s = open(path).read()
    for old, new in pairs:
        if new and new in s:
            continue
        if old not in s:
            raise SystemExit(f"MISS in {path}: {old[:80]!r}")
        s = s.replace(old, new, 1)
    open(path, "w").write(s)
    print("edited", path)


edit("src/components/McpManager.tsx", [
    (
        'import { MCP_TEMPLATES } from "../lib/data";',
        'import { MCP_TEMPLATES } from "../lib/data";\nimport { AUTH_LABEL, MCP_CATALOG } from "../lib/mcpCatalog";',
    ),
    (
        '  const [testing, setTesting] = useState<string | null>(null);',
        '''  const [testing, setTesting] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");''',
    ),
    (
        "  const submit = () => {",
        '''  const installed = (url?: string, command?: string) =>
    state.mcpServers.some((server) =>
      url ? server.url === url : command ? server.command === command : false,
    );

  const install = (entry: (typeof MCP_CATALOG)[number]) => {
    if (installed(entry.url, entry.command)) {
      notify(`${entry.name} is already added`);
      return;
    }
    addMcp({
      id: uid("mcp"),
      name: entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      transport: entry.transport,
      url: entry.url,
      command: entry.command,
      enabled: true,
      status: "untested",
      detail:
        entry.transport === "stdio"
          ? "Needs the desktop runtime to start"
          : entry.auth === "oauth"
            ? "Sign in with OAuth on the first connection"
            : "Not tested yet",
    });
    notify(`${entry.name} added`);
  };

  const submit = () => {''',
    ),
    (
        "      {adding ? (",
        '''      {!adding && (
        <div className="mcp-catalog">
          <button
            type="button"
            className="mcp-catalog-toggle"
            onClick={() => setCatalogOpen((open) => !open)}
            aria-expanded={catalogOpen}
          >
            <Icon name={catalogOpen ? "chevronDown" : "chevronRight"} size={13} />
            Public catalog
            <span className="mcp-catalog-count">{MCP_CATALOG.length} servers</span>
          </button>

          {catalogOpen && (
            <>
              <input
                className="mcp-catalog-search"
                value={catalogQuery}
                onChange={(event) => setCatalogQuery(event.target.value)}
                placeholder="Filter by name or what it does"
                spellCheck={false}
              />
              <div className="mcp-catalog-list">
                {MCP_CATALOG.filter((entry) => {
                  const query = catalogQuery.trim().toLowerCase();
                  if (!query) return true;
                  return `${entry.name} ${entry.publisher} ${entry.description} ${entry.category}`
                    .toLowerCase()
                    .includes(query);
                }).map((entry) => {
                  const has = installed(entry.url, entry.command);
                  return (
                    <div className="mcp-catalog-item" key={entry.id}>
                      <div className="mcp-catalog-copy">
                        <span className="mcp-catalog-name">
                          {entry.name}
                          <span className="mcp-catalog-publisher">{entry.publisher}</span>
                        </span>
                        <span className="mcp-catalog-desc">{entry.description}</span>
                      </div>
                      <span className="mcp-catalog-badges">
                        <span className="mcp-badge">{entry.transport === "http" ? "remote" : "local"}</span>
                        <span className="mcp-badge is-quiet">{AUTH_LABEL[entry.auth]}</span>
                      </span>
                      <button
                        type="button"
                        className={cx("mcp-catalog-add", has && "is-added")}
                        onClick={() => install(entry)}
                        disabled={has}
                      >
                        {has ? "Added" : "Add"}
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="mcp-catalog-note">
                Remote servers ask you to sign in the first time they connect. Local servers start
                with the desktop app, not in a browser tab.
              </p>
            </>
          )}
        </div>
      )}

      {adding ? (''',
    ),
])

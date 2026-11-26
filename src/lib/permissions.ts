export type PermissionEffect = "allow" | "ask" | "deny";

export interface PermissionRule {
  /** Tool name, or `*` for every tool. */
  tool: string;
  /** Resource pattern: a path, a browser action, or `*`. */
  pattern: string;
  effect: PermissionEffect;
  /**
   * Compare `pattern` as one exact string. A saved “always allow” for the
   * command `rm *` must not turn into a wildcard that matches every command.
   */
  literal?: boolean;
}

export interface PermissionDecision {
  effect: PermissionEffect;
  /** The rule that decided, for the approval sheet. */
  rule?: PermissionRule;
}

/**
 * Rules are evaluated in order and the last match wins, the same way opencode
 * resolves its permission config: put the broad catch-all first and the
 * specific exceptions after it. `*` matches any run of characters and `?`
 * matches one.
 */
export function matchesPattern(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const source = `^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`;
  try {
    return new RegExp(source, "i").test(value);
  } catch {
    return pattern === value;
  }
}

export function decide(
  rules: PermissionRule[],
  tool: string,
  resource: string,
): PermissionDecision {
  let winner: PermissionRule | undefined;
  for (const rule of rules) {
    if (!matchesPattern(rule.tool, tool)) continue;
    if (rule.literal ? rule.pattern !== resource : !matchesPattern(rule.pattern, resource)) {
      continue;
    }
    winner = rule;
  }
  return { effect: winner?.effect ?? "ask", rule: winner };
}

/**
 * Defaults. Reads are safe and cheap, so they run. Anything that writes to the
 * workspace, drives a browser or spends money on an integration asks first
 * while the app is in ask mode; auto mode is the same list with the asks
 * relaxed, except for actions with external side effects, which always ask.
 */
export function defaultRules(mode: "auto" | "ask", buildAgent: boolean): PermissionRule[] {
  const rules: PermissionRule[] = [
    { tool: "read", pattern: "*", effect: "allow" },
    { tool: "glob", pattern: "*", effect: "allow" },
    { tool: "grep", pattern: "*", effect: "allow" },
    { tool: "semantic_search", pattern: "*", effect: "allow" },
    { tool: "skill", pattern: "*", effect: "allow" },
    // Settings are reversible and app-local: theme, quiet toggles, the model
    // picker, a settings panel. Nothing outside the window changes.
    { tool: "settings", pattern: "*", effect: "allow" },
    { tool: "todo", pattern: "*", effect: "allow" },
    // Reading a page is not acting on it. These stay allowed in every mode,
    // including Plan and Chat, so a question never waits on an approval card.
    { tool: "browser", pattern: "snapshot", effect: "allow" },
    { tool: "browser", pattern: "extract", effect: "allow" },
    { tool: "browser", pattern: "find", effect: "allow" },
    { tool: "browser", pattern: "wait*", effect: "allow" },
    { tool: "browser", pattern: "tabs", effect: "allow" },
    { tool: "browser", pattern: "screenshot", effect: "allow" },
    // A connected-app read keeps its toolkit in the resource (`inbox gmail`),
    // so the patterns must cover the suffix. These are read-only calls; asking
    // for each one is what made every inbox check feel like a permission wall.
    { tool: "integrations", pattern: "apps*", effect: "allow" },
    { tool: "integrations", pattern: "inbox*", effect: "allow" },
    { tool: "integrations", pattern: "search_email*", effect: "allow" },
    { tool: "integrations", pattern: "tools*", effect: "allow" },
    { tool: "integrations", pattern: "get_*", effect: "allow" },
    { tool: "integrations", pattern: "list_*", effect: "allow" },
  ];

  if (!buildAgent) {
    // Plan and Chat agents cannot change anything.
    rules.push(
      { tool: "write", pattern: "*", effect: "deny" },
      { tool: "edit", pattern: "*", effect: "deny" },
      { tool: "terminal", pattern: "*", effect: "deny" },
      { tool: "browser", pattern: "click*", effect: "deny" },
      { tool: "browser", pattern: "type*", effect: "deny" },
      { tool: "browser", pattern: "fill*", effect: "deny" },
      { tool: "browser", pattern: "press*", effect: "deny" },
      { tool: "browser", pattern: "select*", effect: "deny" },
      { tool: "browser", pattern: "check*", effect: "deny" },
      { tool: "browser", pattern: "hover*", effect: "deny" },
      { tool: "browser", pattern: "scroll*", effect: "deny" },
      { tool: "browser", pattern: "navigate*", effect: "deny" },
      { tool: "browser", pattern: "evaluate*", effect: "deny" },
      { tool: "browser", pattern: "execute*", effect: "deny" },
      { tool: "browser", pattern: "steps*", effect: "deny" },
      { tool: "browser", pattern: "task*", effect: "deny" },
      { tool: "browser", pattern: "back*", effect: "deny" },
      { tool: "browser", pattern: "forward*", effect: "deny" },
      { tool: "browser", pattern: "reload*", effect: "deny" },
      { tool: "browser", pattern: "new_tab*", effect: "deny" },
      { tool: "browser", pattern: "close_tab*", effect: "deny" },
      { tool: "integrations", pattern: "run*", effect: "deny" },
    );
    return rules;
  }

  const write = mode === "auto" ? "allow" : "ask";
  rules.push(
    { tool: "write", pattern: "*", effect: write },
    { tool: "edit", pattern: "*", effect: write },
    // A command can touch anything the app can reach, so it follows the same
    // approval mode as writes rather than silently running on Auto.
    { tool: "terminal", pattern: "*", effect: mode === "auto" ? "allow" : "ask" },
    // Broad rule first, then the read-only exceptions, because the last
    // matching rule wins.
    { tool: "browser", pattern: "*", effect: mode === "auto" ? "allow" : "ask" },
    { tool: "browser", pattern: "snapshot", effect: "allow" },
    { tool: "browser", pattern: "extract", effect: "allow" },
    { tool: "browser", pattern: "find", effect: "allow" },
    { tool: "browser", pattern: "wait*", effect: "allow" },
    { tool: "browser", pattern: "tabs", effect: "allow" },
    { tool: "browser", pattern: "screenshot", effect: "allow" },
    // Running an arbitrary connected-app tool changes the outside world, so it
    // asks even when the app is otherwise on auto.
    { tool: "integrations", pattern: "run", effect: "ask" },
  );

  return rules;
}

export function describeAction(tool: string, resource: string): string {
  switch (tool) {
    case "write":
      return `Create or overwrite ${resource}`;
    case "edit":
      return `Edit ${resource}`;
    case "terminal":
      return `Run in the terminal: ${resource}`;
    case "browser":
      return `Browser: ${resource}`;
    case "integrations":
      return `Connected app: ${resource}`;
    default:
      return `${tool}: ${resource}`;
  }
}

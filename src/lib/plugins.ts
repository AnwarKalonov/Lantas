import type { Plugin, Skill } from "./types";
import { uid } from "./util";

/**
 * Lantas plugin catalog.
 *
 * A plugin is a themed bundle of skills, installable in one click. This is our
 * own catalog shipped with the app: there is no public endpoint that would let
 * us mirror another product's marketplace, and installing arbitrary remote
 * prompt bundles into an agent that can edit files would be a security hole.
 * Every entry below is reviewable in this file, and installing one only adds
 * skills, never code.
 */
export const PLUGIN_CATALOG: Plugin[] = [
  {
    id: "plugin_frontend",
    name: "Frontend craft",
    publisher: "Lantas",
    description:
      "Layout, state and accessibility review for interface work, plus copy that survives translation.",
    category: "design",
    version: "1.2.0",
    featured: true,
    skills: [
      {
        name: "ui-states",
        description: "Audit loading, empty, error and long-content states",
        instructions: [
          "For the screen in front of you, list every state a user can reach: first load, slow load, empty, permission denied, partial data, error, offline, long text, missing image, and disabled.",
          "For each state say what renders today (cite the component and line), what the user can do to recover, and whether a layout shift or a dead end exists. Fix the ones that leave the user stuck, then the ones that lose their input.",
          "Never add a spinner where a skeleton preserves the layout. Never show a raw error string. Keep one retry affordance per failed surface.",
        ].join("\n"),
      },
      {
        name: "a11y-pass",
        description: "Check a component against keyboard and screen-reader use",
        instructions: [
          "Read the component and answer: can every action be reached and triggered by keyboard, in visual order, with a visible focus ring? Does every control have an accessible name that matches its visible label? Are images described or marked decorative?",
          "Check that color is not the only carrier of state, that body text reaches 4.5:1 contrast in both themes, that modals trap focus and restore it on close, and that reduced-motion is respected.",
          "Report only real failures with the element and the fix. Do not add aria attributes that duplicate native semantics.",
        ].join("\n"),
      },
    ],
  },
  {
    id: "plugin_api",
    name: "API reliability",
    publisher: "Lantas",
    description:
      "Contract review, idempotency and failure handling for services other teams call.",
    category: "engineering",
    version: "1.0.3",
    skills: [
      {
        name: "contract-check",
        description: "Compare an endpoint against its callers and its docs",
        instructions: [
          "Find the route, its handler, its request and response types, and every caller in the repo. List where the caller's assumptions differ from what the handler actually returns: optional fields assumed present, status codes assumed successful, arrays assumed ordered.",
          "Check retries: is every write idempotent, or does a retry create a duplicate? Check timeouts: what does the caller do when the handler is slow but succeeded? Check pagination: can a caller silently see only the first page?",
          "Report each mismatch with both file locations and the smallest compatible fix.",
        ].join("\n"),
      },
      {
        name: "failure-modes",
        description: "Enumerate what breaks when a dependency is down",
        instructions: [
          "For the feature in scope, list each external dependency (database, queue, third-party API, model provider). For each, describe the behaviour when it is slow, when it errors, and when it returns malformed data.",
          "Verify: is there a timeout, is the timeout shorter than the caller's, is the error surfaced or swallowed, is partial work rolled back, and does a retry storm make it worse?",
          "Propose the smallest change that turns each unhandled case into a bounded, observable failure.",
        ].join("\n"),
      },
    ],
  },
  {
    id: "plugin_react",
    name: "React systems",
    publisher: "Lantas",
    description:
      "Effect discipline, render cost and state ownership for large React codebases.",
    category: "engineering",
    version: "2.0.0",
    skills: [
      {
        name: "effect-audit",
        description: "Find effects that should be derived state or event handlers",
        instructions: [
          "List every useEffect in the changed files. For each, classify it: external system subscription, data fetch, or state synchronisation. The third category is usually a bug.",
          "For state synchronisation, show the derived value that removes the effect. For fetches, check cancellation on unmount and on dependency change, and check that a stale response cannot overwrite a fresh one.",
          "Check dependencies for missing values and for objects recreated each render. Do not silence the linter; fix the dependency graph.",
        ].join("\n"),
      },
      {
        name: "render-cost",
        description: "Trace why a component re-renders and what it costs",
        instructions: [
          "Start from the user-visible interaction that feels slow. Trace which state changes, which subtree re-renders, and which expensive work runs during render.",
          "Look for: context values recreated each render, inline object props defeating memo, lists without stable keys, derived arrays built in render, and animation driven by layout properties.",
          "Fix the cause, then measure the same interaction before and after. Do not add memo, useMemo or useCallback without naming the render it prevents.",
        ].join("\n"),
      },
    ],
  },
  {
    id: "plugin_security",
    name: "Security baseline",
    publisher: "Lantas",
    description:
      "Trust boundaries, secret hygiene and dependency risk for a web product.",
    category: "security",
    version: "1.1.0",
    featured: true,
    skills: [
      {
        name: "secret-sweep",
        description: "Find credentials and sensitive data in the wrong place",
        instructions: [
          "Search the working tree and the built output for keys, tokens, connection strings, private URLs and personal data. Check client bundles, source maps, logs, test fixtures, error reports and committed .env files.",
          "For each hit, say whether it is a live credential, a placeholder, or public by design. Live credentials need rotation, not just deletion, because history keeps them.",
          "Check that secrets are read from the environment at runtime, that the client never receives a server-only key, and that logs redact authorization headers and message bodies.",
        ].join("\n"),
      },
      {
        name: "authz-map",
        description: "Verify object-level authorization on every path",
        instructions: [
          "List every route or tool that reads or writes user data. For each, find where the authenticated user id comes from and where ownership is checked.",
          "Flag any query filtered only by a client-supplied id, any admin action checked only in the UI, any shared resource without membership, and any cache key that omits the tenant.",
          "Write the check as a rule the server enforces, with the exact data scope, and a test that proves a second account is refused.",
        ].join("\n"),
      },
    ],
  },
  {
    id: "plugin_data",
    name: "Data and migrations",
    publisher: "Lantas",
    description:
      "Safe schema evolution, query plans and backfills that can be resumed.",
    category: "data",
    version: "0.9.4",
    skills: [
      {
        name: "migration-safety",
        description: "Review a migration against a live table",
        instructions: [
          "State the table's approximate row count and write rate. For the migration, name every lock it takes and how long it holds. Flag type changes, non-null columns with defaults, indexes built without the concurrent option, and rewrites that copy the table.",
          "Require a batched, idempotent, resumable backfill separate from the deploy. Require that a rollback does not lose rows written after the forward migration.",
          "Give the exact revised statements in order: add, backfill, switch reads, switch writes, remove.",
        ].join("\n"),
      },
      {
        name: "query-plan",
        description: "Read the plan and fix the scan",
        instructions: [
          "Run EXPLAIN on the query with realistic parameters. Report the scan type, rows examined, join order and sort. Identify the step that scales with data rather than with the result.",
          "Check index column order against the predicate and sort, functions wrapped around indexed columns, and whether the query fetches columns it never uses.",
          "Propose the smallest index or rewrite, and say what write cost it adds.",
        ].join("\n"),
      },
    ],
  },
  {
    id: "plugin_writing",
    name: "Product writing",
    publisher: "Lantas",
    description:
      "Specs, changelogs and interface copy that stay specific under pressure.",
    category: "writing",
    version: "1.0.0",
    skills: [
      {
        name: "spec",
        description: "Write a spec a builder can start from",
        instructions: [
          "Write the problem in one paragraph: who hits it, what they do today, what it costs. Then the outcome, stated as something observable, not a feature name.",
          "List the decisions that are already made, the ones still open with a recommendation and a deadline, and the ones explicitly out of scope. Describe the main flow step by step, then the edge cases: empty, error, permission, concurrent, and undo.",
          "Add how success is measured, what could go wrong, and what ships first. Keep it under two pages; delete any sentence that does not change what gets built.",
        ].join("\n"),
      },
      {
        name: "changelog-entry",
        description: "Write one entry a user understands",
        instructions: [
          "Start from the user's surface, not the code. One sentence: what they can do now, or what no longer breaks. Use the name they see in the product.",
          "If behaviour changed, say what it was before in a clause. If something must be done, put that in the next sentence with the exact action.",
          "No adjectives, no internal names, no ticket numbers, no exclamation marks. Cut it to the shortest version that still identifies the change.",
        ].join("\n"),
      },
    ],
  },
];

export function pluginSkills(plugin: Plugin): Skill[] {
  return plugin.skills.map((skill) => ({
    id: uid("skill"),
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    enabled: true,
    category: plugin.category,
    tags: [plugin.name.toLowerCase(), "plugin"],
    source: "plugin",
    pluginId: plugin.id,
  }));
}

/** Plugin ids that currently have at least one installed skill. */
export function installedPlugins(skills: Skill[]): Set<string> {
  return new Set(
    skills
      .map((skill) => skill.pluginId)
      .filter((id): id is string => Boolean(id)),
  );
}

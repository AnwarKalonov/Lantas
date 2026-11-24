import { useCallback, useEffect, useRef, useState } from "react";
import { inTauri } from "../lib/native";
import {
  onTerminalExit,
  onTerminalOutput,
  stripAnsi,
  terminalCli,
  terminalShell,
  terminalStop,
  terminalWrite,
} from "../lib/terminal";
import { cx, uid } from "../lib/util";
import { Icon } from "./Icons";

interface Line {
  id: string;
  tone: "out" | "err" | "meta";
  text: string;
}

const WELCOME = [
  "Lantas terminal",
  "Runs in the open workspace. The assistant uses the same shell with its terminal tool.",
];

export function TerminalPanel({
  cwd,
  onClose,
  cliRequest = 0,
}: {
  cwd: string;
  onClose: () => void;
  /** Increment from the title bar to open the bundled CLI directly. */
  cliRequest?: number;
}) {
  const [tab, setTab] = useState<"shell" | "cli">("shell");
  const [lines, setLines] = useState<Line[]>(() =>
    WELCOME.map((text) => ({ id: uid("line"), tone: "meta", text })),
  );
  const [input, setInput] = useState("");
  const [shellReady, setShellReady] = useState(false);
  const [shellStarting, setShellStarting] = useState(false);
  const [cliId, setCliId] = useState<string | null>(null);
  const [cliStarted, setCliStarted] = useState(false);
  const cliWarnedRef = useRef(false);
  const cliIdRef = useRef<string | null>(null);
  const shellIdRef = useRef<string | null>(null);
  const idsRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const native = inTauri();

  const append = useCallback((tone: Line["tone"], text: string) => {
    if (!text.trim()) return;
    setLines((current) => [
      ...current.slice(-500),
      { id: uid("line"), tone, text: stripAnsi(text) },
    ]);
  }, []);

  useEffect(() => {
    let alive = true;
    const cleanups: Array<() => void> = [];
    void onTerminalOutput((event) => {
      if (!alive) return;
      append(event.stream === "stderr" ? "err" : "out", event.line);
    }).then((unlisten) => {
      if (alive) cleanups.push(unlisten);
      else unlisten();
    });
    void onTerminalExit((event) => {
      if (!alive) return;
      idsRef.current.delete(event.id);
      if (event.id === cliIdRef.current) {
        append("meta", `CLI exited${event.code === null ? "" : ` with code ${event.code}`}.`);
        cliIdRef.current = null;
        setCliId(null);
      }
      if (event.id === shellIdRef.current) {
        shellIdRef.current = null;
        setShellReady(false);
      }
    }).then((unlisten) => {
      if (alive) cleanups.push(unlisten);
      else unlisten();
    });
    return () => {
      alive = false;
      cleanups.forEach((unlisten) => unlisten());
      idsRef.current.forEach((id) => void terminalStop(id).catch(() => {}));
      idsRef.current.clear();
      cliIdRef.current = null;
      shellIdRef.current = null;
    };
  }, [append]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines]);

  const startShell = useCallback(async (): Promise<string | null> => {
    if (!native) {
      append("err", "The terminal needs the desktop app. This is the web preview.");
      return null;
    }
    if (shellIdRef.current) return shellIdRef.current;
    if (shellStarting) return null;
    setShellStarting(true);
    const id = uid("shell");
    shellIdRef.current = id;
    idsRef.current.add(id);
    try {
      await terminalShell(id, cwd);
      setShellReady(true);
      append("meta", "Shell ready. Type a command and press Enter.");
      return id;
    } catch (error) {
      idsRef.current.delete(id);
      shellIdRef.current = null;
      setShellReady(false);
      append(
        "err",
        `Could not start the shell. ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    } finally {
      setShellStarting(false);
    }
  }, [append, cwd, native, shellStarting]);

  useEffect(() => {
    if (native) void startShell();
    // Start once for this panel, not on every keystroke or cwd change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native]);

  const startCli = useCallback(async () => {
    if (!native) {
      if (!cliWarnedRef.current) {
        append("err", "The Lantas CLI needs the desktop app.");
        cliWarnedRef.current = true;
      }
      return;
    }
    if (cliIdRef.current) return;
    const id = uid("cli");
    cliIdRef.current = id;
    idsRef.current.add(id);
    setCliId(id);
    setCliStarted(true);
    append("meta", "Starting the bundled Lantas CLI…");
    append(
      "meta",
      "If it exits immediately, install Node.js 18 or newer. The desktop terminal works without it.",
    );
    try {
      await terminalCli(id, cwd);
    } catch (error) {
      append("err", error instanceof Error ? error.message : String(error));
      idsRef.current.delete(id);
      cliIdRef.current = null;
      setCliId(null);
    }
  }, [append, cwd, native]);

  useEffect(() => {
    if (!cliRequest) return;
    setTab("cli");
    void startCli();
  }, [cliRequest, startCli]);

  const runShell = async () => {
    const command = input.trim();
    if (!command) return;
    if (command === "clear") {
      setLines([]);
      setInput("");
      return;
    }
    append("meta", `$ ${command}`);
    setInput("");
    const id = await startShell();
    if (!id) return;
    try {
      await terminalWrite(id, `${command}\n`);
    } catch (error) {
      append("err", error instanceof Error ? error.message : String(error));
    }
  };

  const submit = async () => {
    if (tab === "shell") {
      await runShell();
      return;
    }
    const value = input;
    if (!value.trim() || !cliIdRef.current) return;
    append("meta", `› ${value}`);
    setInput("");
    try {
      await terminalWrite(cliIdRef.current, `${value}\n`);
    } catch (error) {
      append("err", error instanceof Error ? error.message : String(error));
    }
  };

  const stop = async () => {
    const id = cliIdRef.current ?? shellIdRef.current;
    if (id) {
      await terminalStop(id).catch(() => {});
      idsRef.current.delete(id);
      if (id === cliIdRef.current) {
        cliIdRef.current = null;
        setCliId(null);
      }
      if (id === shellIdRef.current) {
        shellIdRef.current = null;
        setShellReady(false);
      }
    }
    append("meta", "Stopped.");
  };

  return (
    <section className="ide-terminal">
      <header className="ide-terminal-head">
        <div className="ide-terminal-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "shell"}
            className={cx("ide-terminal-tab", tab === "shell" && "is-active")}
            onClick={() => setTab("shell")}
          >
            <Icon name="terminal" size={12} />
            Terminal
            {shellReady && <span className="ide-terminal-ready">live</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "cli"}
            className={cx("ide-terminal-tab", tab === "cli" && "is-active")}
            onClick={() => {
              setTab("cli");
              if (!cliStarted) void startCli();
            }}
          >
            <span className="ide-cli-dot" />
            Lantas CLI
          </button>
        </div>
        <div className="ide-terminal-actions">
          {!shellReady && tab === "shell" && (
            <button
              type="button"
              className="ide-terminal-action"
              onClick={() => void startShell()}
              disabled={shellStarting}
            >
              {shellStarting ? "Starting…" : "Start shell"}
            </button>
          )}
          {tab === "cli" && !cliId && (
            <button type="button" className="ide-terminal-action" onClick={() => void startCli()}>
              Start
            </button>
          )}
          <button
            type="button"
            className="ide-terminal-action"
            onClick={() => setLines([])}
            title="Clear"
          >
            Clear
          </button>
          <button
            type="button"
            className="ide-terminal-action"
            onClick={() => void stop()}
            title="Stop"
          >
            Stop
          </button>
          <button
            type="button"
            className="ide-terminal-close"
            onClick={onClose}
            aria-label="Close terminal"
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      </header>

      <div className="ide-terminal-output" ref={scrollRef}>
        {lines.map((line) => (
          <pre key={line.id} className={cx("ide-terminal-line", `is-${line.tone}`)}>
            {line.text}
          </pre>
        ))}
      </div>

      <form
        className="ide-terminal-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <span className="ide-terminal-prompt">{tab === "cli" ? "›" : "$"}</span>
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={
            tab === "cli"
              ? cliId
                ? "Type a task or a CLI command"
                : "Start the CLI to begin"
              : shellReady
                ? "Run a command in this folder"
                : "Starting the shell…"
          }
          spellCheck={false}
          disabled={tab === "cli" && !cliId}
          autoComplete="off"
        />
        <button type="submit" className="ide-terminal-send" disabled={!input.trim()}>
          <Icon name="arrowUp" size={12} />
        </button>
      </form>
    </section>
  );
}

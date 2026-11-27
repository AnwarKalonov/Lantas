import type { Session } from "../lib/types";
import { cx } from "../lib/util";
import { Icon } from "./Icons";

/** The strip of open conversations that OpenWork keeps above the thread. */
export function ChatTabs({
  sessions,
  activeId,
  onSelect,
  onClose,
  onNew,
}: {
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  if (sessions.length === 0) return null;

  return (
    <div className="ow-tabs" role="tablist" aria-label="Open chats">
      <div className="ow-tabs-scroll">
        {sessions.map((session) => (
          <button
            key={session.id}
            type="button"
            role="tab"
            aria-selected={session.id === activeId}
            className={cx("ow-tab", session.id === activeId && "is-active")}
            onClick={() => onSelect(session.id)}
            onAuxClick={(event) => {
              if (event.button === 1) onClose(session.id);
            }}
            title={session.title}
          >
            <span className="ow-tab-title">{session.title}</span>
            <span
              className="ow-tab-close"
              role="button"
              aria-label={`Close ${session.title}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(session.id);
              }}
            >
              <Icon name="close" size={11} />
            </span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="ow-tab-new"
        onClick={onNew}
        title="New chat (⌘N)"
        aria-label="New chat"
      >
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
}

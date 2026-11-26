import { Icon } from "./Icons";

/**
 * The header from the supplied "Assistant side panel" in ReUI Chat. Both the
 * editor assistant and the browser rail use it so the two side chats read as
 * the same surface, not two different products.
 */
export function TrustPanelHead({
  onNewChat,
  onSettings,
  onClose,
}: {
  onNewChat: () => void;
  onSettings: () => void;
  onClose: () => void;
}) {
  return (
    <header className="trust-head">
      <div className="trust-head-title">
        <Icon name="bot" size={15} className="trust-bot" />
        <span>Trust in AI replies</span>
        <Icon name="chevronDown" size={12} className="trust-chev" />
      </div>
      <div className="trust-head-actions">
        <button type="button" className="trust-icon" onClick={onNewChat} aria-label="New chat" title="New chat">
          <Icon name="pencil" size={15} />
        </button>
        <button
          type="button"
          className="trust-icon"
          onClick={onSettings}
          aria-label="Settings"
          title="Settings"
        >
          <Icon name="settings" size={15} />
        </button>
        <button type="button" className="trust-icon" onClick={onClose} aria-label="Close">
          <Icon name="close" size={15} />
        </button>
      </div>
    </header>
  );
}

/**
 * The command palette from the same template panel. It is a real set of
 * prompts, not a picture of one: the spark in the composer toggles it, and
 * picking a row sends it to the assistant.
 */
export function TrustPalette({
  items,
  onPick,
  onDismiss,
}: {
  items: string[];
  onPick: (text: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="trust-pal" id="trust-pal">
      <div className="trust-pal-top">
        <kbd className="trust-kbd sq">↑</kbd>
        <kbd className="trust-kbd sq">↓</kbd>
        <span>navigate</span>
        <kbd className="trust-kbd">Enter</kbd>
        <span>select</span>
        <span className="trust-pal-sp" />
        <kbd className="trust-kbd">Esc</kbd>
        <button
          type="button"
          className="trust-pal-x"
          onClick={onDismiss}
          aria-label="Dismiss prompt suggestions"
        >
          <Icon name="close" size={13} />
        </button>
      </div>
      <ul>
        {items.map((item) => (
          <li key={item}>
            <button type="button" onClick={() => onPick(item)}>
              <Icon name="chevronRight" size={13} />
              {item}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

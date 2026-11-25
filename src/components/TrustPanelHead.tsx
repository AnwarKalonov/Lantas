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
          <Icon name="pencil" size={14} />
        </button>
        <button
          type="button"
          className="trust-icon"
          onClick={onSettings}
          aria-label="Settings"
          title="Settings"
        >
          <Icon name="settings" size={14} />
        </button>
        <button type="button" className="trust-icon" onClick={onClose} aria-label="Close">
          <Icon name="close" size={14} />
        </button>
      </div>
    </header>
  );
}

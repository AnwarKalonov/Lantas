Lantas 1.0.5

- **The demo agent is gone.** Lantas no longer plays back canned tool calls, fake shell output or random token counts when no model is connected. Without a configured provider it now says exactly that and points to Settings → Providers. The real agent loop is the only path that runs.
- **“Open Desmos” opens Desmos.** A model that sends the bare fragment `calculator` is resolved against the user's request and the current page, so the browser goes to `https://www.desmos.com/calculator` instead of a Google search. A literal request such as “the Desmos website” still goes through search.
- **Broken addresses no longer masquerade as pages.** Whitespace in a model-generated URL is collapsed before navigation, and a hostless `https://` is rejected before it can produce an empty page that looks successful.
- **Honest status in the UI.** The composer, session panel, home screen and settings now say “No provider connected” / “offline” instead of “Demo runtime” or “fallback”.

This build is ad-hoc signed. macOS may ask you to approve Lantas once: open **System Settings → Privacy & Security**, click **Open Anyway**, and authenticate. The installer clears the quarantine flag for you if you prefer not to click through.

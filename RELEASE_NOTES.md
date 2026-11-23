Lantas 1.0.4

- **The download page now explains the first open.** It has a clear drag-to-Applications guide, the exact **Privacy & Security → Open Anyway** steps, a Terminal quarantine alternative, and a plain explanation of why macOS shows the warning. The hosted page is updated from this release.
- **Desmos works from a request, not a magic phrase.** Named apps resolve to their real site, while a literal request such as “the Desmos website” goes through search. The browser guide teaches the model to snapshot, click the expression row, type the math and verify the graph; the Chrome bridge also has real CDP mouse and keyboard input as its first path.
- **Chrome actions use real browser input.** Clicks, typing and key presses go through the browser’s input pipeline, with the DOM and Desmos APIs as fallbacks. Page reads include the expression list and graph state, so a success is checked rather than assumed.
- **NVIDIA NIM is a provider.** Add an NVIDIA API key, fetch the live model catalog from `https://integrate.api.nvidia.com/v1`, and choose from NVIDIA’s hosted models in the same model picker as the other providers.
- **A calmer Chrome side panel.** The panel has a simpler header, a quieter page card, prompt rows and a cleaner composer, while keeping the read-only kill switch.
- **The Code tab no longer turns green.** Lantas Studio uses a neutral warm graphite and paper palette with a copper accent for actions, selection and syntax highlights.

This build is ad-hoc signed. macOS may ask you to approve Lantas once: open **System Settings → Privacy & Security**, click **Open Anyway**, and authenticate. The installer clears the quarantine flag for you if you prefer not to click through.

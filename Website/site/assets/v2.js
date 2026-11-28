/* Lantas v2 — the demo player.
   One panel is visible at a time, each loop restarts cleanly, and the four
   tabs cycle by themselves like a short reel. No video files, no autoplay
   permissions, nothing to buffer. */

(() => {
  const root = document.querySelector("[data-demo-root]");
  if (!root) return;

  const tabs = [...root.querySelectorAll("[data-demo-tab]")];
  const panels = [...root.querySelectorAll("[data-demo-panel]")];
  const caption = root.querySelector("[data-demo-caption]");
  const bar = root.querySelector("[data-demo-progress]");
  if (!tabs.length || !panels.length) return;

  const captions = {
    chat: "Chat · a question becomes work you can read back, with the check that proves it.",
    code: "Code · a real edit in the open folder, then the tests that decide whether it is done.",
    browser: "Browser · it reads the page, clicks the control by name, and verifies the result.",
    screen: "Computer · the real pointer, a private screen map, and a fresh read after every step.",
  };

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let active = tabs.findIndex((tab) => tab.classList.contains("is-on"));
  if (active < 0) active = 0;
  let timer = 0;
  let visible = true;
  const DURATION = 9000;

  const play = (index) => {
    active = (index + tabs.length) % tabs.length;
    const name = tabs[active].dataset.demoTab;

    tabs.forEach((tab, i) => {
      const on = i === active;
      tab.classList.toggle("is-on", on);
      tab.setAttribute("aria-selected", String(on));
      tab.setAttribute("tabindex", on ? "0" : "-1");
    });

    panels.forEach((panel) => {
      const on = panel.dataset.demoPanel === name;
      panel.hidden = !on;
      panel.classList.remove("is-on");
    });

    const panel = panels.find((item) => item.dataset.demoPanel === name);
    if (panel) {
      // Force the animation timeline to start again when a panel returns.
      void panel.offsetWidth;
      panel.classList.add("is-on");
    }

    if (caption) caption.textContent = captions[name] || "";
    if (bar) {
      bar.classList.remove("is-running");
      void bar.offsetWidth;
      if (!reduced) bar.classList.add("is-running");
    }
  };

  const schedule = () => {
    window.clearTimeout(timer);
    if (reduced || !visible) return;
    timer = window.setTimeout(() => {
      play(active + 1);
      schedule();
    }, DURATION);
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => {
      play(index);
      schedule();
    });
    tab.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      const next = (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus();
      play(next);
      schedule();
    });
  });

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        if (visible) schedule();
        else window.clearTimeout(timer);
      },
      { threshold: 0.25 }
    );
    io.observe(root);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) window.clearTimeout(timer);
    else schedule();
  });

  play(active);
  schedule();
})();

/* Real MP4 clips, recorded from the same loops. The link row opens one in a
   small modal so the page does not carry four autoplaying videos. */
(() => {
  const overlay = document.querySelector('[data-reel-overlay]');
  const video = document.querySelector('[data-reel-video]');
  const title = document.querySelector('[data-reel-title]');
  if (!overlay || !video) return;

  const names = { chat: 'Chat', code: 'Code', browser: 'Browser', screen: 'Computer control' };
  const files = {
    chat: 'assets/demos/chat.mp4',
    code: 'assets/demos/code.mp4',
    browser: 'assets/demos/browser.mp4',
    screen: 'assets/demos/computer.mp4',
  };

  const close = () => {
    overlay.hidden = true;
    video.pause();
    video.removeAttribute('src');
    video.load();
  };

  document.querySelectorAll('[data-reel]').forEach((button) => {
    button.addEventListener('click', () => {
      const name = button.dataset.reel;
      if (!name || !files[name]) return;
      if (title) title.textContent = `Lantas · ${names[name]}`;
      video.src = files[name];
      overlay.hidden = false;
      void video.play().catch(() => {});
    });
  });

  overlay.querySelector('[data-reel-close]')?.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !overlay.hidden) close();
  });
})();

/* The three surfaces start apart and settle into one pile as the section
   scrolls. One scroll listener, one transform variable, no layout thrash. */
(() => {
  const stack = document.querySelector("[data-stack]");
  if (!stack) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    stack.style.setProperty("--p", "1");
    stack.classList.add("is-stacked");
    return;
  }

  const track = stack.querySelector(".v2-stack-track");
  if (!track) return;
  let frame = 0;

  const update = () => {
    frame = 0;
    const rect = track.getBoundingClientRect();
    const travel = Math.max(1, track.offsetHeight - window.innerHeight);
    const p = Math.min(1, Math.max(0, -rect.top / travel));
    stack.style.setProperty("--p", p.toFixed(3));
    stack.classList.toggle("is-stacked", p > 0.66);
  };

  const onScroll = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(update);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  update();
})();

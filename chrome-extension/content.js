/**
 * Lantas Browser Bridge — content script.
 *
 * Reads the page into a small, model-friendly shape and performs clicks,
 * typing, Enter and scrolling on request. Runs only in http(s) tabs.
 */

(() => {
  if (window.__lantasBridge) return;
  window.__lantasBridge = true;

  const MAX_ELEMENTS = 80;
  const MAX_TEXT = 40_000;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function tidy(value, max = 140) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  }

  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    if (Number(style.opacity) < 0.06) return false;
    return true;
  }

  function selectorFor(el) {
    if (el.id && /^[A-Za-z][\w:-]*$/.test(el.id)) {
      const candidate = `#${CSS.escape(el.id)}`;
      try {
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      } catch {
        /* invalid id, fall through */
      }
    }
    const name = el.getAttribute("name");
    if (name) {
      const candidate = `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
      try {
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      } catch {
        /* keep going */
      }
    }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (node === document.body) break;
      node = parent;
    }
    return parts.join(" > ");
  }

  function labelFor(el) {
    const tag = el.tagName.toLowerCase();
    const direct =
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      (tag === "input" ? el.value : "") ||
      el.getAttribute("alt") ||
      el.getAttribute("title") ||
      el.innerText ||
      el.textContent;
    const label = tidy(direct);
    if (label) return label;
    const labelled = el.getAttribute("aria-labelledby");
    if (labelled) {
      const node = document.getElementById(labelled);
      if (node?.textContent) return tidy(node.textContent);
    }
    return tidy(tag === "a" ? el.getAttribute("href") || "link" : tag);
  }

  function kindFor(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button" || el.getAttribute("role") === "button") return "button";
    if (tag === "input") return el.type || "input";
    if (tag === "textarea") return "text";
    if (tag === "select") return "select";
    if (el.isContentEditable) return "text";
    return tag;
  }

  function interactive() {
    const nodes = document.querySelectorAll(
      'a[href], button, [role="button"], input:not([type="hidden"]), textarea, select, summary, [contenteditable="true"]',
    );
    const list = [];
    for (const el of nodes) {
      if (list.length >= MAX_ELEMENTS) break;
      if (!visible(el)) continue;
      list.push(el);
    }
    return list;
  }

  function readPage() {
    const clone = document.body ? document.body.cloneNode(true) : null;
    if (clone) {
      clone
        .querySelectorAll("script,style,noscript,svg,template,iframe,canvas")
        .forEach((node) => node.remove());
    }
    const text = String(clone?.textContent || "")
      .replace(/[ \t\u00a0]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, MAX_TEXT);
    const description =
      document.querySelector("meta[name='description']")?.getAttribute("content") ||
      document.querySelector("meta[property='og:description']")?.getAttribute("content") ||
      "";
    return {
      url: location.href,
      title: document.title || location.hostname,
      description: tidy(description, 300),
      text,
      words: text ? text.split(/\s+/).length : 0,
    };
  }

  function readElements() {
    return interactive().map((el, index) => ({
      i: index,
      tag: el.tagName.toLowerCase(),
      kind: kindFor(el),
      label: labelFor(el),
      selector: selectorFor(el),
    }));
  }

  function findTarget(options = {}) {
    if (typeof options.index === "number") {
      const list = interactive();
      return list[options.index] || null;
    }
    if (options.selector) {
      try {
        const found = document.querySelector(options.selector);
        if (found) return found;
      } catch {
        /* not a valid selector, try text */
      }
    }
    const wanted = tidy(options.text, 200).toLowerCase();
    if (!wanted) return null;
    const candidates = interactive();
    return (
      candidates.find((el) => labelFor(el).toLowerCase() === wanted) ||
      candidates.find((el) => labelFor(el).toLowerCase().includes(wanted)) ||
      candidates.find((el) => {
        const words = labelFor(el).toLowerCase().split(/\s+/);
        return words.includes(wanted);
      }) ||
      null
    );
  }

  function setNativeValue(el, value) {
    const proto =
      el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : el.tagName === "SELECT"
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  async function act(message) {
    const action = message.action;
    if (action === "scroll") {
      const dy = Number(message.dy) || 600;
      window.scrollBy({ top: dy, behavior: "smooth" });
      await sleep(250);
      return { ok: true, detail: dy > 0 ? "Scrolled down" : "Scrolled up" };
    }

    if (action === "highlight") {
      const el = findTarget(message);
      if (!el) return { ok: false, error: "Nothing on the page matched that." };
      el.scrollIntoView({ block: "center", inline: "center" });
      const rect = el.getBoundingClientRect();
      const box = document.createElement("div");
      box.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;border:2px solid #7aa87f;border-radius:8px;pointer-events:none;z-index:2147483646;transition:opacity .4s ease;`;
      document.body.appendChild(box);
      setTimeout(() => box.remove(), 1600);
      return { ok: true, detail: "Found it on the page" };
    }

    if (action === "enter") {
      const el = document.activeElement || document.body;
      for (const type of ["keydown", "keypress", "keyup"]) {
        el.dispatchEvent(
          new KeyboardEvent(type, { key: "Enter", code: "Enter", bubbles: true, cancelable: true }),
        );
      }
      if (el.form && typeof el.form.requestSubmit === "function") el.form.requestSubmit();
      await sleep(500);
      return {
        ok: true,
        detail: "Pressed Enter",
        page: readPage(),
        elements: readElements(),
      };
    }

    if (action === "type") {
      const el = message.selector ? findTarget(message) : document.activeElement;
      if (!el) {
        return { ok: false, error: "That field was not found on the page." };
      }
      el.scrollIntoView({ block: "center", inline: "center" });
      if (typeof el.focus === "function") el.focus();
      const text = String(message.text ?? "");
      if (el.isContentEditable) {
        el.textContent = text;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
      } else {
        setNativeValue(el, text);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (message.submit) {
        const form = el.form || el.closest("form");
        if (form && typeof form.requestSubmit === "function") form.requestSubmit();
      }
      await sleep(400);
      return {
        ok: true,
        detail: `Typed into ${labelFor(el) || "the page"}`,
        page: readPage(),
        elements: readElements(),
      };
    }

    // Default: click.
    const el = findTarget(message);
    if (!el) {
      return { ok: false, error: "Nothing on the page matched that." };
    }
    el.scrollIntoView({ block: "center", inline: "center" });
    if (typeof el.focus === "function") el.focus();
    el.click();
    await sleep(450);
    return {
      ok: true,
      detail: `Clicked ${labelFor(el) || el.tagName.toLowerCase()}`,
      page: readPage(),
      elements: readElements(),
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (!message || (message.cmd !== "inspect" && message.cmd !== "act")) return undefined;
    (async () => {
      try {
        if (message.cmd === "inspect") {
          respond({ ok: true, page: readPage(), elements: readElements() });
        } else {
          respond(await act(message));
        }
      } catch (error) {
        respond({ ok: false, error: String(error?.message || error) });
      }
    })();
    return true;
  });
})();

/**
 * The page-side half of the native browser engine.
 *
 * These are script *bodies*, not modules: `runInPage` wraps each one in a
 * synchronous IIFE and returns the object it produces, so nothing here may
 * await. A promise would serialize as `{}` and the action would look like it
 * silently failed.
 *
 * Every action shares one set of lookups on purpose. The scan that produces the
 * numbered refs already walks open shadow roots and same-origin iframes, so the
 * actions have to walk exactly the same tree. When they only queried
 * `document`, a control the model could see was a control it could not reach,
 * which is why the agent looked broken on any app built out of web components.
 */

const quote = (value: string) => JSON.stringify(String(value ?? ""));

const HELPERS = `
  const cleanText = (value, max) =>
    String(value == null ? "" : value).replace(/\\s+/g, " ").trim().slice(0, max || 160);

  const visible = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0.04;
  };

  let __roots = null;
  const roots = () => {
    if (__roots) return __roots;
    const list = [document];
    let scanned = 0;
    for (let index = 0; index < list.length && scanned < 5000; index += 1) {
      let nodes = [];
      try { nodes = Array.from(list[index].querySelectorAll("*")); } catch (_) { continue; }
      for (const node of nodes) {
        scanned += 1;
        if (scanned >= 5000) break;
        if (node.shadowRoot && list.indexOf(node.shadowRoot) < 0) list.push(node.shadowRoot);
        if (node.tagName === "IFRAME") {
          try {
            if (node.contentDocument && list.indexOf(node.contentDocument) < 0) list.push(node.contentDocument);
          } catch (_) {}
        }
      }
    }
    __roots = list;
    return list;
  };

  const deepQuery = (selector) => {
    const found = [];
    for (const root of roots()) {
      let nodes = [];
      try { nodes = root.querySelectorAll(selector); } catch (_) { continue; }
      for (const node of nodes) found.push(node);
    }
    return found;
  };

  const deepFind = (selector) => {
    for (const root of roots()) {
      try {
        const hit = root.querySelector(selector);
        if (hit) return hit;
      } catch (_) {}
    }
    return null;
  };

  const CONTROL =
    'a[href],button,summary,input:not([type="hidden"]),textarea,select,' +
    '[contenteditable="true"],[contenteditable=""],[role="button"],[role="link"],' +
    '[role="textbox"],[role="searchbox"],[role="checkbox"],[role="radio"],[role="switch"],' +
    '[role="tab"],[role="menuitem"],[role="menuitemcheckbox"],[role="option"],' +
    '[role="treeitem"],[role="combobox"]';

  const kindOf = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.isContentEditable) return "text";
    if (tag === "a") return "link";
    if (tag === "input") return el.type || "input";
    if (tag === "textarea") return "text";
    if (tag === "select") return "select";
    if (tag === "summary") return "button";
    return el.getAttribute("role") || tag;
  };

  const labelOf = (el) => {
    const type = el.tagName === "INPUT" ? String(el.type || "text").toLowerCase() : "";
    // A checkbox's value is "on" and a file input's is "", so only text-like
    // controls and buttons are labelled by their value.
    const usesValue =
      el.tagName === "TEXTAREA" ||
      ["submit", "button", "reset"].indexOf(type) >= 0 ||
      (el.tagName === "INPUT" && ["checkbox", "radio", "file", "image", "range", "color", "hidden"].indexOf(type) < 0);
    const wrapping = el.closest && el.closest("label");
    const direct =
      el.getAttribute("aria-label") ||
      (wrapping && wrapping.textContent) ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      (usesValue ? el.value : "") ||
      (el.tagName === "SELECT" && el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : "") ||
      el.innerText ||
      el.textContent;
    const label = cleanText(direct, 140);
    if (label) return label;
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const node = document.getElementById(by);
      if (node && node.textContent) return cleanText(node.textContent, 140);
    }
    return el.tagName.toLowerCase();
  };

  const byLabel = (want) => {
    const needle = cleanText(want, 200).toLowerCase();
    if (!needle) return null;
    const controls = deepQuery(CONTROL).filter(visible);
    return (
      controls.find((el) => labelOf(el).toLowerCase() === needle) ||
      controls.find((el) => labelOf(el).toLowerCase().startsWith(needle)) ||
      controls.find((el) => labelOf(el).toLowerCase().includes(needle)) ||
      null
    );
  };

  const resolve = (target) => {
    const value = cleanText(target, 300);
    if (!value) return null;
    if (/^\\d+$/.test(value)) {
      const tagged = deepFind('[data-lantas-ref="' + value + '"]');
      if (tagged) return tagged;
    }
    const direct = deepFind(value);
    if (direct) return direct;
    return byLabel(value);
  };

  const midpoint = (el) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };

  const fire = (el, type, point, extra) => {
    const pointer = type.indexOf("pointer") === 0;
    const Ctor = pointer ? PointerEvent : MouseEvent;
    const bubbles =
      type !== "pointerenter" && type !== "pointerleave" &&
      type !== "mouseenter" && type !== "mouseleave";
    const init = {
      bubbles, cancelable: true, composed: true, view: window,
      clientX: point.x, clientY: point.y, button: 0, buttons: 0,
    };
    if (pointer) { init.pointerId = 1; init.pointerType = "mouse"; init.isPrimary = true; }
    if (extra) Object.assign(init, extra);
    el.dispatchEvent(new Ctor(type, init));
  };

  const tap = (el) => {
    el.scrollIntoView({ block: "center", inline: "center" });
    const point = midpoint(el);
    fire(el, "pointerover", point);
    fire(el, "pointerenter", point);
    fire(el, "mouseover", point);
    fire(el, "pointermove", point);
    fire(el, "mousemove", point);
    if (typeof el.focus === "function") {
      try { el.focus({ preventScroll: true }); } catch (_) {}
    }
    fire(el, "pointerdown", point, { buttons: 1 });
    fire(el, "mousedown", point, { buttons: 1 });
    fire(el, "pointerup", point);
    fire(el, "mouseup", point);
    fire(el, "click", point, { detail: 1 });
    return point;
  };

  const atPoint = (x, y) => {
    let node = document.elementFromPoint(x, y);
    while (node && node.shadowRoot) {
      const inner = node.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === node) break;
      node = inner;
    }
    return node;
  };

  const setValue = (el, value) => {
    const proto =
      el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype :
      el.tagName === "SELECT" ? HTMLSelectElement.prototype :
      el.tagName === "INPUT" ? HTMLInputElement.prototype : null;
    const setter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : null;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const isEditable = (el) =>
    Boolean(el) &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.isContentEditable === true ||
      el.getAttribute("role") === "textbox" ||
      el.getAttribute("role") === "searchbox" ||
      el.getAttribute("role") === "combobox");
`;

/** Click a control by ref, selector or visible label. */
export function clickScript(target: string): string {
  return `${HELPERS}
    const want = ${quote(target)};
    const el = resolve(want);
    if (!el) {
      return {
        ok: false,
        error: "Nothing on the page matched \\"" + want + "\\". Take a fresh snapshot and use its refs.",
      };
    }
    const point = tap(el);
    return {
      ok: true,
      detail: labelOf(el),
      x: Math.round(point.x),
      y: Math.round(point.y),
    };
  `;
}

/** Click the element the latest snapshot tagged with this ref. */
export function clickRefScript(index: number): string {
  const ref = Math.max(0, Math.floor(Number(index) || 0));
  return `${HELPERS}
    const el = deepFind('[data-lantas-ref="${ref}"]');
    if (!el) {
      return { ok: false, error: "Element ${ref} is gone. Take a fresh snapshot and use its new refs." };
    }
    const point = tap(el);
    return { ok: true, detail: labelOf(el), x: Math.round(point.x), y: Math.round(point.y) };
  `;
}

/** Real mouse click at viewport coordinates, for canvas editors. */
export function clickAtScript(x: number, y: number): string {
  const px = Math.max(0, Math.round(Number(x) || 0));
  const py = Math.max(0, Math.round(Number(y) || 0));
  return `${HELPERS}
    const el = atPoint(${px}, ${py});
    if (!el) return { ok: false, error: "Nothing is at those coordinates." };
    const point = { x: ${px}, y: ${py} };
    fire(el, "pointerover", point);
    fire(el, "pointerenter", point);
    fire(el, "mouseover", point);
    fire(el, "pointermove", point);
    fire(el, "mousemove", point);
    fire(el, "pointerdown", point, { buttons: 1 });
    fire(el, "mousedown", point, { buttons: 1 });
    fire(el, "pointerup", point);
    fire(el, "mouseup", point);
    fire(el, "click", point, { detail: 1 });
    return { ok: true, detail: el.tagName.toLowerCase() + " " + labelOf(el) };
  `;
}

/** Open hover menus: many navigation bars only render their links on hover. */
export function hoverScript(target: string): string {
  return `${HELPERS}
    const want = ${quote(target)};
    const el = resolve(want);
    if (!el) {
      return { ok: false, error: "Nothing on the page matched \\"" + want + "\\". Take a fresh snapshot." };
    }
    el.scrollIntoView({ block: "center", inline: "center" });
    const point = midpoint(el);
    fire(el, "pointerover", point);
    fire(el, "pointerenter", point);
    fire(el, "mouseover", point);
    fire(el, "pointermove", point);
    fire(el, "mousemove", point);
    return { ok: true, detail: labelOf(el) };
  `;
}

/** Type into the focused field, a named field, or the first visible one. */
export function typeScript(text: string, selector: string | undefined, submit: boolean): string {
  return `${HELPERS}
    const value = ${quote(text)};
    const wanted = ${quote(selector ?? "")};
    let el = wanted ? resolve(wanted) : null;
    if (wanted && !isEditable(el)) {
      return { ok: false, error: "\\"" + wanted + "\\" is not an editable field. Take a fresh snapshot." };
    }
    if (!el) {
      const focused = document.activeElement;
      if (focused && focused !== document.body && isEditable(focused)) el = focused;
    }
    if (!el) {
      el = roots().map((root) => root.activeElement).find((node) => node && isEditable(node)) || null;
    }
    if (!el) {
      el = deepQuery('input:not([type="hidden"]),textarea,[contenteditable="true"],[contenteditable=""],[role="textbox"],[role="searchbox"]')
        .filter(visible)[0] || null;
    }
    if (!el) {
      return { ok: false, error: "No editable field was found. Click the field first, then type." };
    }

    el.scrollIntoView({ block: "center", inline: "center" });
    try { el.focus({ preventScroll: true }); } catch (_) {}

    if (el.isContentEditable) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      if (selection) { selection.removeAllRanges(); selection.addRange(range); }
      let inserted = false;
      try { inserted = document.execCommand("insertText", false, value); } catch (_) {}
      if (!inserted) {
        el.textContent = value;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
      }
    } else {
      setValue(el, value);
    }

    if (${submit ? "true" : "false"}) {
      for (const type of ["keydown", "keypress", "keyup"]) {
        el.dispatchEvent(new KeyboardEvent(type, {
          key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true,
        }));
      }
      const form = el.form || (el.closest && el.closest("form"));
      if (form && typeof form.requestSubmit === "function") form.requestSubmit();
    }

    return { ok: true, detail: labelOf(el) };
  `;
}

/** Pick an option in a real select element by visible label or value. */
export function selectScript(target: string, value: string): string {
  return `${HELPERS}
    const wanted = ${quote(target)};
    const value = ${quote(value)};
    const isSelect = (node) => Boolean(node) && node.tagName === "SELECT";
    let el = resolve(wanted);
    if (!isSelect(el)) {
      const needle = cleanText(wanted, 200).toLowerCase();
      el = deepQuery("select").filter(visible).find((node) => {
        const label =
          node.getAttribute("aria-label") ||
          node.getAttribute("name") ||
          node.id ||
          (node.closest("label") && node.closest("label").textContent) ||
          "";
        return cleanText(label, 200).toLowerCase().indexOf(needle) >= 0;
      }) || null;
    }
    if (!isSelect(el)) {
      return { ok: false, error: "No select element matched \\"" + wanted + "\\"." };
    }
    const needle = cleanText(value, 200).toLowerCase();
    const options = Array.from(el.options);
    const option =
      options.find((item) => cleanText(item.textContent, 200).toLowerCase() === needle) ||
      options.find((item) => cleanText(item.value, 200).toLowerCase() === needle) ||
      options.find((item) => cleanText(item.textContent, 200).toLowerCase().indexOf(needle) >= 0);
    if (!option) {
      return {
        ok: false,
        error:
          "\\"" + value + "\\" is not one of the options: " +
          options.slice(0, 12).map((item) => cleanText(item.textContent, 60)).join(", "),
      };
    }
    setValue(el, option.value);
    return { ok: el.value === option.value, detail: cleanText(option.textContent, 120) };
  `;
}

/** Set a checkbox, radio or switch. Callers read the state back afterwards. */
export function toggleScript(target: string, checked: boolean): string {
  return `${HELPERS}
    const wanted = ${quote(target)};
    const on = ${checked ? "true" : "false"};
    const BOXES = 'input[type="checkbox"],input[type="radio"],[role="checkbox"],[role="switch"],[role="radio"]';
    const stateOf = (el) =>
      el.getAttribute("aria-checked") === "true" ||
      el.getAttribute("aria-pressed") === "true" ||
      el.checked === true;
    let el = resolve(wanted);
    if (el && deepQuery(BOXES).indexOf(el) < 0) el = null;
    if (!el) {
      const needle = cleanText(wanted, 200).toLowerCase();
      el = deepQuery(BOXES).filter(visible).find((node) =>
        labelOf(node).toLowerCase().indexOf(needle) >= 0) || null;
    }
    if (!el) {
      return { ok: false, error: "No checkbox or switch matched \\"" + wanted + "\\"." };
    }
    const before = stateOf(el);
    if (before !== on) {
      if (el.tagName === "INPUT") el.click();
      else tap(el);
    }
    el.setAttribute("data-lantas-check", "1");
    return { ok: true, before, after: stateOf(el), detail: labelOf(el) };
  `;
}

/** Read back the control the last toggle marked, so React has settled. */
export function checkedStateScript(): string {
  return `${HELPERS}
    const el = deepFind('[data-lantas-check="1"]');
    if (!el) return { ok: false };
    return {
      ok: true,
      state:
        el.getAttribute("aria-checked") === "true" ||
        el.getAttribute("aria-pressed") === "true" ||
        el.checked === true,
    };
  `;
}

/**
 * Scroll the surface under the middle of the viewport. Modern apps scroll an
 * inner container while the document stays put, so scrolling `window` alone
 * looked like the page was frozen.
 */
export function scrollScript(pixels: number): string {
  const amount = Number.isFinite(pixels) ? Math.round(pixels) : 600;
  return `${HELPERS}
    const amount = ${amount};
    const scrollable = (node) => {
      if (!node || node.nodeType !== 1) return false;
      const flow = getComputedStyle(node).overflowY;
      if (flow !== "auto" && flow !== "scroll" && flow !== "overlay") return false;
      return node.scrollHeight - node.clientHeight > 4;
    };
    let scroller = null;
    let node = atPoint(Math.round(window.innerWidth / 2), Math.round(window.innerHeight / 2));
    while (node && node !== document.body && node !== document.documentElement) {
      if (scrollable(node)) { scroller = node; break; }
      node = node.parentElement || (node.getRootNode && node.getRootNode().host) || null;
    }
    if (!scroller) {
      for (const candidate of [document.scrollingElement, document.documentElement, document.body]) {
        if (candidate && candidate.scrollHeight - candidate.clientHeight > 4) { scroller = candidate; break; }
      }
    }
    const before = scroller ? scroller.scrollTop : 0;
    const windowBefore = window.scrollY;
    if (scroller) scroller.scrollTop = before + amount;
    if (!scroller || scroller.scrollTop === before) window.scrollBy(0, amount);
    const moved = (scroller ? scroller.scrollTop - before : 0) + (window.scrollY - windowBefore);
    return {
      ok: moved !== 0,
      moved: Math.round(moved),
      where: scroller ? "container" : "window",
    };
  `;
}

/**
 * Press a key with the effect the user would get. Synthetic key events do not
 * perform default actions, so Tab has to move focus and Enter has to submit or
 * activate the focused control explicitly.
 */
export function pressScript(key: string): string {
  return `${HELPERS}
    const key = ${quote(key)};
    const codes = {
      Enter: 13, Tab: 9, Escape: 27, Space: 32, " ": 32, Backspace: 8, Delete: 46,
      ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39,
      PageDown: 34, PageUp: 33, Home: 36, End: 35,
    };
    const name = key === "Space" ? " " : key;
    const code = codes[key] || 0;
    const active = document.activeElement;
    const target = active && active !== document.body ? active : document.body;
    for (const type of ["keydown", "keypress", "keyup"]) {
      target.dispatchEvent(new KeyboardEvent(type, {
        key: name,
        code: name === " " ? "Space" : key,
        keyCode: code,
        which: code,
        bubbles: true,
        cancelable: true,
      }));
    }

    if (key === "Enter") {
      const form = target.form || (target.closest && target.closest("form"));
      if (form && typeof form.requestSubmit === "function") {
        form.requestSubmit();
        return { ok: true, detail: "submitted the form" };
      }
      if (target.tagName === "BUTTON" || target.getAttribute("role") === "button") {
        tap(target);
        return { ok: true, detail: "pressed " + labelOf(target) };
      }
      return {
        ok: false,
        error: "Enter did nothing: no form or button had focus. Click the submit control instead.",
      };
    }

    if (key === "Tab") {
      const order = deepQuery(CONTROL).filter(visible);
      if (!order.length) return { ok: false, error: "Nothing focusable is on the page." };
      const index = order.indexOf(target);
      const next = order[(index + 1 + order.length) % order.length];
      try { next.focus({ preventScroll: false }); } catch (_) {}
      next.scrollIntoView({ block: "nearest" });
      return { ok: true, detail: "focused " + labelOf(next) };
    }

    if (name === " ") {
      if (target.tagName === "INPUT" || target.getAttribute("role") === "checkbox" || target.getAttribute("role") === "switch") {
        target.click();
        return { ok: true, detail: "toggled " + labelOf(target) };
      }
    }

    return { ok: true, detail: key };
  `;
}

/**
 * Run page JavaScript. Site APIs and the agent's own verification reads are
 * both expressions and statement bodies, so try the expression first and only
 * fall back to a function body for a syntax error (never to re-run a script
 * that failed at runtime).
 */
export function evaluateScript(code: string): string {
  return `${HELPERS}
    const source = ${quote(code)};
    const safe = (value) => {
      if (value === undefined) return null;
      try { return JSON.parse(JSON.stringify(value)); } catch (_) { return String(value).slice(0, 4000); }
    };
    let value;
    try {
      value = (0, eval)(source);
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        return { ok: false, error: String(error && error.message ? error.message : error) };
      }
      try {
        value = Function(source)();
      } catch (fallback) {
        return { ok: false, error: String(fallback && fallback.message ? fallback.message : fallback) };
      }
    }
    if (value && typeof value.then === "function") {
      return { ok: false, error: "That expression returned a promise. Use a synchronous expression." };
    }
    return { ok: true, value: safe(value) };
  `;
}

/**
 * The page map the model reads before it acts.
 *
 * This follows the serializer design browser-use uses for its own agents
 * (MIT, github.com/browser-use/browser-use): one pass over the visible tree in
 * reading order, every interactive node tagged with the index the agent clicks
 * by, containers carrying the indentation instead of their own lines, select
 * options inline, and a `*` on controls that appeared since the last read.
 *
 * A flat list of labels loses the one thing that makes an agent reliable on a
 * real page: which control belongs to which section. Structure plus refs is
 * what turns "click the second Continue" into a decision.
 */
export function snapshotScript(): string {
  return `${HELPERS}
    const SKIP = new Set([
      "script", "style", "noscript", "template", "svg", "canvas", "meta", "link",
      "head", "title", "path", "rect", "circle", "g", "defs", "use",
    ]);
    const GROUP = new Set([
      "header", "nav", "main", "section", "article", "aside", "footer", "form",
      "ul", "ol", "table", "tbody", "tr", "dialog", "fieldset", "details", "li", "td", "th",
    ]);
    const ROLES = new Set([
      "button", "link", "textbox", "searchbox", "checkbox", "radio", "switch", "tab",
      "menuitem", "menuitemcheckbox", "option", "treeitem", "combobox", "slider", "spinbutton",
    ]);
    const TAGS = new Set(["a", "button", "input", "textarea", "select", "summary"]);

    const prior =
      window.__lantasSeen && window.__lantasSeen.url === location.href && Array.isArray(window.__lantasSeen.keys)
        ? window.__lantasSeen.keys
        : null;
    const keys = [];
    const lines = [];
    const elements = [];
    let ref = 0;
    let budget = 700;

    const pad = (depth) => "  ".repeat(Math.min(depth, 10));

    const isInteractive = (el) => {
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role");
      if (TAGS.has(tag)) return true;
      if (role && ROLES.has(role)) return true;
      if (el.isContentEditable === true) return true;
      return false;
    };

    const chars = (el) => {
      const bits = [el.tagName.toLowerCase()];
      // A <button> is a submit button by default; printing that on every one is
      // noise. Only inputs have a type the model needs.
      if (el.tagName === "INPUT" && el.type) bits.push("type=" + el.type);
      if (el.name) bits.push("name=" + el.name);
      const role = el.getAttribute("role");
      if (role) bits.push("role=" + role);
      if (el.disabled) bits.push("disabled");
      const href = el.getAttribute("href");
      if (href && href.length < 90) bits.push("href=" + href);
      const placeholder = el.getAttribute("placeholder");
      if (placeholder) bits.push('placeholder="' + cleanText(placeholder, 60) + '"');
      const aria = el.getAttribute("aria-label");
      if (aria) bits.push('aria-label="' + cleanText(aria, 60) + '"');
      return bits.join(" ");
    };

    const state = (el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === "select") {
        const options = Array.from(el.options);
        const chosen = el.options[el.selectedIndex];
        const shown = options.slice(0, 5).map((item) => cleanText(item.textContent, 30));
        if (options.length > 5) shown.push("... " + (options.length - 5) + " more");
        return (
          (chosen ? ' value="' + cleanText(chosen.textContent, 40) + '"' : "") +
          (shown.length ? " options: " + shown.join(" | ") : "")
        );
      }
      if (el.type === "checkbox" || el.type === "radio" || el.getAttribute("role") === "switch") {
        const on = el.checked === true || el.getAttribute("aria-checked") === "true";
        return on ? " [checked]" : " [unchecked]";
      }
      if (tag === "input" || tag === "textarea") {
        const value = String(el.value || "").trim();
        return value ? ' value="' + cleanText(value, 80) + '"' : "";
      }
      return "";
    };

    const record = (el, index) => {
      elements.push({
        i: index,
        tag: el.tagName.toLowerCase(),
        kind: kindOf(el),
        label: labelOf(el),
        selector: el.id ? "#" + CSS.escape(el.id) : "",
      });
    };

    const descends = (el) => {
      const tag = el.tagName.toLowerCase();
      return tag === "select";
    };

    const walk = (root, depth) => {
      if (budget <= 0) return;
      const nodes = Array.from(root.childNodes || []);
      for (const node of nodes) {
        if (budget <= 0) return;
        if (node.nodeType === 3) {
          // The text of a wrapping <label> is already the control's label.
          if (node.parentElement && node.parentElement.tagName === "LABEL") continue;
          const text = cleanText(node.nodeValue, 170);
          if (text.length > 1) {
            lines.push(pad(depth) + text);
            budget -= 1;
          }
          continue;
        }
        if (node.nodeType !== 1) continue;
        const el = node;
        const tag = el.tagName.toLowerCase();
        if (SKIP.has(tag)) continue;
        if (el.getAttribute("aria-hidden") === "true" || el.hasAttribute("inert")) continue;
        if (!visible(el)) continue;

        if (tag === "iframe") {
          try {
            const doc = el.contentDocument;
            if (doc && doc.body && visible(el)) {
              const label = el.getAttribute("title") || el.getAttribute("src") || "frame";
              lines.push(pad(depth) + "[iframe " + cleanText(label, 70) + "]");
              budget -= 1;
              walk(doc.body, depth + 1);
            }
          } catch (_) {}
          continue;
        }

        if (/^h[1-6]$/.test(tag)) {
          const text = cleanText(el.textContent, 170);
          if (text) {
            lines.push(pad(depth) + tag + " " + text);
            budget -= 1;
            continue;
          }
        }

        if (isInteractive(el)) {
          const index = ref;
          ref += 1;
          el.setAttribute("data-lantas-ref", String(index));
          const key = tag + "|" + labelOf(el).slice(0, 70);
          keys.push(key);
          const isNew = prior && prior.indexOf(key) < 0 ? "*" : "";
          const label = labelOf(el);
          // The label is what the model clicks by, so it has to be on the line;
          // only skip it when the descriptor already carries it (a placeholder
          // or aria-label), which would otherwise print it twice.
          const descriptor = chars(el);
          const attrLabel = el.getAttribute("aria-label") || el.getAttribute("placeholder") || "";
          const inline =
            label && tag !== "select" && !attrLabel ? ' "' + cleanText(label, 140) + '"' : "";
          lines.push(
            pad(depth) + isNew + "[" + index + "] <" + descriptor + ">" + state(el) + inline,
          );
          record(el, index);
          budget -= 1;
          if (tag === "select") walk(el, depth + 1);
          continue;
        }

        if (GROUP.has(tag)) {
          walk(el, depth + 1);
          continue;
        }

        const shadow = el.shadowRoot;
        walk(el, depth);
        // Shadow content belongs to the host, which has no line of its own, so
        // it stays at the host's depth instead of looking nested under a
        // sibling control.
        if (shadow) walk(shadow, depth);
      }
    };

    if (document.body) walk(document.body, 0);

    for (const root of roots()) {
      try {
        root.querySelectorAll("[data-lantas-ref]").forEach((node) => {
          if (Number(node.getAttribute("data-lantas-ref")) >= ref) node.removeAttribute("data-lantas-ref");
        });
      } catch (_) {}
    }

    window.__lantasSeen = { url: location.href, keys: keys };

    const bodyText = String(document.body ? document.body.innerText : "")
      .replace(/[ \\t\\u00a0]+/g, " ")
      .replace(/\\n{3,}/g, "\\n\\n")
      .trim();
    const description =
      document.querySelector("meta[name='description']")?.getAttribute("content") ||
      document.querySelector("meta[property='og:description']")?.getAttribute("content") ||
      "";
    const text = lines.join("\\n").slice(0, 24000);

    return {
      ok: true,
      page: {
        url: location.href,
        title: document.title || location.hostname,
        description: cleanText(description, 300),
        text,
        words: bodyText ? bodyText.split(/\\s+/).length : 0,
      },
      elements,
    };
  `;
}

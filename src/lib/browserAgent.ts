import { browserEngine, chromeCommand, readChromeTab } from "./chrome";
import type { ElPage } from "./el";
import { elClick, elEval, elHistory, elReload } from "./native";

/**
 * One surface for browser actions, so the assistant does not care whether the
 * page is in Lantas' own engine or in the user's Chrome via the extension.
 */

const looksLikeSelector = (value: string) =>
  /^[#.]/.test(value) || /^\w+\[/.test(value) || /^[a-z][\w-]*\s*>/.test(value);

export async function agentClick(target: string): Promise<boolean> {
  if (browserEngine() === "chrome") {
    try {
      await chromeCommand("act", {
        action: "click",
        text: looksLikeSelector(target) ? undefined : target,
        selector: looksLikeSelector(target) ? target : undefined,
      });
      return true;
    } catch {
      return false;
    }
  }
  return elClick(target);
}

export async function agentType(text: string, selector?: string): Promise<boolean> {
  if (browserEngine() === "chrome") {
    try {
      await chromeCommand("act", { action: "type", text, selector });
      return true;
    } catch {
      return false;
    }
  }
  const target = selector ? JSON.stringify(selector) : "document.activeElement";
  const payload = JSON.stringify(text);
  await elEval(
    `(() => {
      const el = ${target};
      if (!el) return;
      el.focus();
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, ${payload}); else el.value = ${payload};
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    })()`,
  );
  return true;
}

export async function agentEnter(): Promise<boolean> {
  if (browserEngine() === "chrome") {
    try {
      await chromeCommand("act", { action: "enter" });
      return true;
    } catch {
      return false;
    }
  }
  await elEval(
    `(() => {
      const el = document.activeElement;
      if (!el) return;
      for (const type of ["keydown", "keypress", "keyup"]) {
        el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", bubbles: true }));
      }
      if (el.form && typeof el.form.requestSubmit === "function") el.form.requestSubmit();
    })()`,
  );
  return true;
}

export async function agentScroll(pixels: number): Promise<boolean> {
  if (browserEngine() === "chrome") {
    try {
      await chromeCommand("act", { action: "scroll", dy: pixels });
      return true;
    } catch {
      return false;
    }
  }
  await elEval(`window.scrollBy({ top: ${pixels}, behavior: "smooth" })`);
  return true;
}

export async function agentHistory(direction: "back" | "forward"): Promise<boolean> {
  if (browserEngine() === "chrome") {
    try {
      await chromeCommand("history", { direction });
      return true;
    } catch {
      return false;
    }
  }
  await elHistory(direction);
  return true;
}

export async function agentReload(): Promise<boolean> {
  if (browserEngine() === "chrome") {
    try {
      await chromeCommand("reload");
      return true;
    } catch {
      return false;
    }
  }
  await elReload();
  return true;
}

/** The page's text as the model should see it, from Chrome or from the native engine. */
export async function agentPage(): Promise<ElPage | null> {
  if (browserEngine() !== "chrome") return null;
  try {
    const result = await readChromeTab();
    if (!result.page) return null;
    return {
      url: result.page.url,
      title: result.page.title,
      description: result.page.description ?? "",
      text: result.page.text,
      words: result.page.words,
    };
  } catch {
    return null;
  }
}

export async function agentOpenChrome(url: string, newTab = false): Promise<boolean> {
  try {
    await chromeCommand("navigate", { url, newTab });
    return true;
  } catch {
    return false;
  }
}

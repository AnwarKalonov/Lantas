import { useEffect, useRef, useState } from "react";
import {
  answerUserAsk,
  getActiveUserAsk,
  skipUserAsk,
  subscribeUserAsk,
  type UserAsk,
  type UserAskField,
} from "../lib/userAsk";
import { Icon } from "./Icons";
import { MarkGlyph } from "./Brand";

/**
 * A small reply bubble for a question the browser agent asks mid-turn, such
 * as an email and password needed to finish a sign-in. Credentials stay in
 * this component and the provider request; they are never added to the chat
 * transcript or the session checkpoint.
 *
 * The model can also describe the answers it needs. `fields` turns the card
 * into one titled input per detail (Name, Age, Country), and `options` turns
 * it into a multiple-choice question instead of making the user type a choice
 * in prose.
 */
export function AgentQuestion({ inline = false }: { inline?: boolean }) {
  const [ask, setAsk] = useState<UserAsk | null>(getActiveUserAsk);
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [choice, setChoice] = useState("");
  const [choices, setChoices] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);

  useEffect(() => subscribeUserAsk(setAsk), []);

  useEffect(() => {
    setText("");
    setEmail("");
    setPassword("");
    setShowPassword(false);
    setValues({});
    setChoice("");
    setChoices([]);
    setOther("");
    if (!ask) return;
    const timer = window.setTimeout(() => {
      if (ask.options?.length && !ask.fields?.length) firstOptionRef.current?.focus();
      else inputRef.current?.focus();
    }, 40);
    return () => window.clearTimeout(timer);
  }, [ask?.id]);

  if (!ask) return null;

  const fields = ask.fields ?? [];
  const options = ask.options ?? [];
  const hasFields = fields.length > 0;
  const hasOptions = options.length > 0;
  const credentials = ask.kind === "credentials" && !hasFields && !hasOptions;
  const secret = ask.kind === "password" && !hasFields && !hasOptions;
  const mail = (ask.kind === "email" || credentials) && !hasFields && !hasOptions;

  const fieldValue = (field: UserAskField) => values[field.label] ?? "";
  const fieldsReady = fields.every(
    (field) => field.optional || fieldValue(field).trim().length > 0,
  );
  const optionsReady = ask.multiple ? choices.length > 0 : Boolean(choice);
  const otherReady = Boolean(other.trim());
  const legacyReady = credentials
    ? Boolean(email.trim() && password)
    : secret
      ? Boolean(password)
      : mail
        ? Boolean(email.trim())
        : Boolean(text.trim());
  const ready = hasFields || hasOptions
    ? fieldsReady && (!hasOptions || optionsReady || otherReady || (ask.multiple && choices.length > 0))
    : legacyReady;

  const submit = () => {
    if (!ready) return;
    const lines: string[] = [];
    if (hasFields) {
      for (const field of fields) {
        const value = fieldValue(field).trim();
        if (value || field.optional) lines.push(`${field.label}: ${value || "(left blank)"}`);
      }
    }
    if (hasOptions) {
      const picked = [...(ask.multiple ? choices : choice ? [choice] : [])];
      if (other.trim()) picked.push(other.trim());
      lines.push(picked.length > 1 ? `Choices: ${picked.join(", ")}` : picked[0]);
    }
    const answer = hasFields || hasOptions
      ? lines.filter(Boolean).join("\n")
      : credentials
        ? `email: ${email.trim()}\npassword: ${password}`
        : secret
          ? password
          : mail
            ? email.trim()
            : text.trim();
    answerUserAsk(ask.id, answer);
  };

  const toggleChoice = (option: string) => {
    if (!ask.multiple) {
      setChoice(option);
      setOther("");
      return;
    }
    setChoices((current) =>
      current.includes(option)
        ? current.filter((item) => item !== option)
        : [...current, option],
    );
  };

  return (
    <form
      className={inline ? "trust-question is-inline" : "trust-question ask-pop"}
      role={inline ? "group" : "dialog"}
      aria-label={credentials ? "Sign in to continue" : "Lantas needs a detail"}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="trust-question-head">
        <span className="trust-question-mark" aria-hidden="true">
          <MarkGlyph size={15} />
        </span>
        <div>
          <strong>{credentials ? "Sign in to continue" : ask.question}</strong>
          {credentials ? <p>{ask.question}</p> : null}
          {hasOptions && !hasFields ? (
            <span className="trust-question-hint">
              {ask.multiple ? "Select all that apply" : "Pick one"}
            </span>
          ) : null}
        </div>
      </div>

      <div className="trust-question-fields">
        {hasFields &&
          fields.map((field, index) => (
            <label key={`${field.label}-${index}`}>
              <span>{field.label}</span>
              {field.type === "select" ? (
                <select
                  value={fieldValue(field)}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.label]: event.target.value }))
                  }
                >
                  <option value="">Choose…</option>
                  {(field.options ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : field.type === "textarea" ? (
                <textarea
                  rows={3}
                  value={fieldValue(field)}
                  placeholder={field.placeholder}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.label]: event.target.value }))
                  }
                />
              ) : field.type === "password" ? (
                <span className="trust-question-secret">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={fieldValue(field)}
                    placeholder={field.placeholder ?? "Password"}
                    autoComplete="off"
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [field.label]: event.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className="trust-question-eye"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    <Icon name="eye" size={13} />
                  </button>
                </span>
              ) : (
                <input
                  ref={index === 0 ? inputRef : undefined}
                  type={field.type === "number" ? "number" : field.type ?? "text"}
                  value={fieldValue(field)}
                  placeholder={field.placeholder}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field.label]: event.target.value }))
                  }
                />
              )}
            </label>
          ))}

        {hasOptions && (
          <div
            className="trust-question-choice"
            role={ask.multiple ? "group" : "radiogroup"}
            aria-label={ask.question}
          >
            {options.map((option, index) => {
              const picked = ask.multiple ? choices.includes(option) : choice === option;
              return (
                <button
                  key={option}
                  ref={index === 0 ? firstOptionRef : undefined}
                  type="button"
                  className={picked ? "is-picked" : undefined}
                  role={ask.multiple ? "checkbox" : "radio"}
                  aria-checked={picked}
                  onClick={() => toggleChoice(option)}
                >
                  <span className="trust-question-choice-mark" aria-hidden="true">
                    {picked && <Icon name="check" size={10} />}
                  </span>
                  <span>{option}</span>
                </button>
              );
            })}
            <label className="trust-question-other">
              <span>Something else</span>
              <input
                value={other}
                placeholder="Type a different answer"
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setOther(event.target.value);
                  if (event.target.value) {
                    setChoice("");
                    setChoices([]);
                  }
                }}
              />
            </label>
          </div>
        )}

        {mail && (
          <label>
            <span>Username or email</span>
            <input
              ref={inputRef}
              type="text"
              value={email}
              autoComplete="username"
              spellCheck={false}
              placeholder="you@example.com"
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && credentials) {
                  event.preventDefault();
                  (event.currentTarget.form?.elements.namedItem("ask-password") as HTMLInputElement | null)?.focus();
                }
              }}
            />
          </label>
        )}

        {(secret || credentials) && (
          <label>
            <span>Password</span>
            <span className="trust-question-secret">
              <input
                ref={credentials ? undefined : inputRef}
                name="ask-password"
                type={showPassword ? "text" : "password"}
                value={password}
                autoComplete="current-password"
                placeholder="Password"
                onChange={(event) => setPassword(event.target.value)}
              />
              <button
                type="button"
                className="trust-question-eye"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
              >
                <Icon name="eye" size={13} />
              </button>
            </span>
          </label>
        )}

        {!mail && !secret && !hasFields && !hasOptions && (
          <label>
            <span>Your answer</span>
            <input
              ref={inputRef}
              value={text}
              autoComplete="off"
              spellCheck={false}
              placeholder="Type the detail Lantas needs"
              onChange={(event) => setText(event.target.value)}
            />
          </label>
        )}
      </div>

      <div className="trust-question-foot">
        <span>Shared with the model for this step only.</span>
        <div>
          <button type="button" className="trust-question-skip" onClick={() => skipUserAsk(ask.id)}>
            Skip
          </button>
          <button type="submit" className="trust-question-send" disabled={!ready}>
            <Icon name="arrowUp" size={12} />
            Continue
          </button>
        </div>
      </div>
    </form>
  );
}

/**
 * A model that asked its question in prose instead of using ask_user still
 * gets a real input in the browser rail, where there is no ask_user tool.
 * It is the same panel, not a second composer, so the suggestion list becomes
 * the answer field exactly when an answer is what the turn is waiting for.
 */
export function QuickAnswer({
  question,
  onSubmit,
}: {
  question: string;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <form
      className="trust-question is-inline trust-quick-answer"
      role="group"
      aria-label="Answer Lantas"
      onSubmit={(event) => {
        event.preventDefault();
        const answer = text.trim();
        if (!answer) return;
        setText("");
        onSubmit(answer);
      }}
    >
      <div className="trust-question-head">
        <span className="trust-question-mark" aria-hidden="true">
          <Icon name="bot" size={13} />
        </span>
        <div>
          <strong>Answer to continue</strong>
          <p>{question}</p>
        </div>
      </div>
      <div className="trust-question-fields">
        <label>
          <span>Your answer</span>
          <input
            ref={inputRef}
            value={text}
            autoComplete="off"
            spellCheck={false}
            placeholder="Type your answer"
            onChange={(event) => setText(event.target.value)}
          />
        </label>
      </div>
      <div className="trust-question-foot">
        <span>Goes to the model as your reply.</span>
        <div>
          <button type="submit" className="trust-question-send" disabled={!text.trim()}>
            <Icon name="arrowUp" size={12} />
            Continue
          </button>
        </div>
      </div>
    </form>
  );
}

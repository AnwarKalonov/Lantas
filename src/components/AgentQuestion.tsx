import { useEffect, useRef, useState } from "react";
import {
  answerUserAsk,
  getActiveUserAsk,
  skipUserAsk,
  subscribeUserAsk,
  type UserAsk,
} from "../lib/userAsk";
import { Icon } from "./Icons";

/**
 * A small reply bubble for a question the browser agent asks mid-turn, such
 * as an email and password needed to finish a sign-in. Credentials stay in
 * this component and the provider request; they are never added to the chat
 * transcript or the session checkpoint.
 */
export function AgentQuestion() {
  const [ask, setAsk] = useState<UserAsk | null>(getActiveUserAsk);
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => subscribeUserAsk(setAsk), []);

  useEffect(() => {
    setText("");
    setEmail("");
    setPassword("");
    setShowPassword(false);
    if (!ask) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, [ask?.id]);

  if (!ask) return null;

  const credentials = ask.kind === "credentials";
  const secret = ask.kind === "password";
  const mail = ask.kind === "email" || credentials;
  const ready = credentials
    ? Boolean(email.trim() && password)
    : secret
      ? Boolean(password)
      : mail
        ? Boolean(email.trim())
        : Boolean(text.trim());

  const submit = () => {
    if (!ready) return;
    const answer = credentials
      ? `email: ${email.trim()}\npassword: ${password}`
      : secret
        ? password
        : mail
          ? email.trim()
          : text.trim();
    answerUserAsk(ask.id, answer);
  };

  return (
    <form
      className="trust-question"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="trust-question-head">
        <span className="trust-question-mark" aria-hidden="true">
          <Icon name="bot" size={13} />
        </span>
        <div>
          <strong>Lantas needs a detail</strong>
          <p>{ask.question}</p>
        </div>
      </div>

      <div className="trust-question-fields">
        {mail && (
          <label>
            <span>Email</span>
            <input
              ref={inputRef}
              type="email"
              value={email}
              autoComplete="off"
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
                autoComplete="new-password"
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

        {!mail && !secret && (
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
            Share
          </button>
        </div>
      </div>
    </form>
  );
}

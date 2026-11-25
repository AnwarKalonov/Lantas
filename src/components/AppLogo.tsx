import { useEffect, useState } from "react";

/** Brand mark: vector logo, then the site favicon, then a letter. */
export function AppLogo({
  slug,
  name,
  size = 18,
  eager = false,
  domain,
}: {
  slug: string;
  name: string;
  size?: number;
  eager?: boolean;
  domain?: string;
}) {
  const [stage, setStage] = useState(0);
  const [loaded, setLoaded] = useState(false);

  // Some hosts return a 404 that never reaches onError. Fall back to the letter
  // instead of leaving a broken image in the page chrome.
  useEffect(() => {
    if (stage >= 2 || loaded) return;
    const timer = window.setTimeout(() => setStage(2), 1800);
    return () => window.clearTimeout(timer);
  }, [stage, loaded]);

  if (stage >= 2) {
    return (
      <span
        className="app-logo is-fallback"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
        aria-hidden="true"
      >
        {name.charAt(0).toUpperCase()}
      </span>
    );
  }
  const src =
    stage === 0
      ? `https://cdn.simpleicons.org/${slug}`
      : `https://www.google.com/s2/favicons?domain=${domain ?? `${slug}.com`}&sz=64`;
  return (
    <img
      className="app-logo"
      src={src}
      width={size}
      height={size}
      alt=""
      loading={eager ? "eager" : "lazy"}
      onLoad={() => setLoaded(true)}
      onError={() => {
        setLoaded(false);
        setStage((value) => value + 1);
      }}
    />
  );
}

import { useState } from "react";

/** Brand mark with a letter fallback when the icon CDN is unreachable. */
export function AppLogo({
  slug,
  name,
  size = 18,
  eager = false,
}: {
  slug: string;
  name: string;
  size?: number;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
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
  return (
    <img
      className="app-logo"
      src={`https://cdn.simpleicons.org/${slug}`}
      width={size}
      height={size}
      alt=""
      loading={eager ? "eager" : "lazy"}
      onError={() => setFailed(true)}
    />
  );
}

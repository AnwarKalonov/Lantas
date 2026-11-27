import type { BrandId } from "../lib/brands";

/**
 * Small product marks for tool steps.
 *
 * These are deliberately tiny geometric interpretations, not copied brand
 * assets: at 14px the silhouette and colour are what make a row scannable,
 * and they stay legible in both themes.
 */
export function BrandMark({ id, size = 14 }: { id: BrandId; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    "aria-hidden": true as const,
    className: `brand-mark is-${id}`,
  };

  switch (id) {
    case "gmail":
      return (
        <svg {...common}>
          <rect x="1" y="3" width="14" height="10" rx="2" fill="#fff" />
          <path
            d="M2 4.6h1.6L8 8l4.4-3.4H14V12h-1.9V7.3L8 10.2 3.9 7.3V12H2z"
            fill="#EA4335"
          />
        </svg>
      );
    case "drive":
      return (
        <svg {...common}>
          <path d="M5.9 2.4h4.2L15 11h-4.2z" fill="#34A853" />
          <path d="M5.9 2.4 1 11l2.1 3.7 4.9-8.5z" fill="#FBBC04" />
          <path d="M3.1 14.7h9.8L15 11H5.2z" fill="#4285F4" />
        </svg>
      );
    case "slack":
      return (
        <svg {...common}>
          <rect x="6.6" y="1" width="2.8" height="6.4" rx="1.4" fill="#36C5F0" />
          <rect x="8.6" y="6.6" width="6.4" height="2.8" rx="1.4" fill="#2EB67D" />
          <rect x="6.6" y="8.6" width="2.8" height="6.4" rx="1.4" fill="#ECB22E" />
          <rect x="1" y="6.6" width="6.4" height="2.8" rx="1.4" fill="#E01E5A" />
        </svg>
      );
    case "linear":
      return (
        <svg {...common}>
          <rect x="1" y="1" width="14" height="14" rx="4" fill="#5E6AD2" />
          <path
            d="M3.8 10.1 10.1 3.8M3.8 6.4l2.6-2.6M8.1 12.2l4.1-4.1"
            stroke="#fff"
            strokeWidth="1.35"
            strokeLinecap="round"
            opacity=".92"
          />
        </svg>
      );
    case "notion":
      return (
        <svg {...common}>
          <rect x="1.4" y="1.4" width="13.2" height="13.2" rx="2.6" fill="#fff" />
          <rect
            x="1.4"
            y="1.4"
            width="13.2"
            height="13.2"
            rx="2.6"
            fill="none"
            stroke="rgba(0,0,0,.22)"
          />
          <path
            d="M4.9 11.6V4.4l1.8.2 3 4.7V4.5h1.3v7l-1.7-.2-3-4.8v5.1z"
            fill="#191918"
          />
        </svg>
      );
    case "github":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.6" fill="#24292f" />
          <circle cx="5.7" cy="5" r="1.35" fill="#fff" />
          <circle cx="10.3" cy="5" r="1.35" fill="#fff" />
          <circle cx="5.7" cy="11" r="1.35" fill="#fff" />
          <path
            d="M5.7 6.4v3.2M10.3 6.4v1.5c0 1.5-1.2 2.1-2.8 2.1H5.7"
            stroke="#fff"
            strokeWidth="1.15"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      );
    case "figma":
      return (
        <svg {...common}>
          <circle cx="5.6" cy="3.4" r="2.5" fill="#F24E1E" />
          <circle cx="10.4" cy="3.4" r="2.5" fill="#FF7262" />
          <circle cx="5.6" cy="8" r="2.5" fill="#A259FF" />
          <circle cx="10.4" cy="8" r="2.5" fill="#1ABCFE" />
          <circle cx="5.6" cy="12.6" r="2.5" fill="#0ACF83" />
        </svg>
      );
    case "vercel":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.6" fill="#111" />
          <path d="M8 4.4 12 11H4z" fill="#fff" />
        </svg>
      );
    case "browser":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6.4" fill="#fff" />
          <path d="M8 1.6A6.4 6.4 0 0 1 14.4 8H8z" fill="#EA4335" />
          <path d="M14.4 8A6.4 6.4 0 0 1 8 14.4V8z" fill="#34A853" />
          <path d="M8 14.4A6.4 6.4 0 0 1 1.6 8H8z" fill="#FBBC04" />
          <circle cx="8" cy="8" r="2.7" fill="#fff" />
          <circle cx="8" cy="8" r="2.1" fill="#4285F4" />
        </svg>
      );
    default:
      return null;
  }
}

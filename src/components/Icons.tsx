import type { ReactNode, SVGProps } from "react";

const PATHS = {
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  minus: <path d="M5 12h14" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M16.5 16.5 21 21" /></>,
  panelLeft: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  panelRight: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>,
  settings: <><path d="M4 7h9" /><path d="M17 7h3" /><path d="M4 17h4" /><path d="M12 17h8" /><circle cx="15" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  arrowUp: <><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></>,
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />,
  check: <path d="m4.5 12.5 4.5 4.5L20 6.5" />,
  loader: <path d="M12 3a9 9 0 1 0 9 9" />,
  file: <><path d="M6 3h7l5 5v13H6z" /><path d="M13 3v5h5" /></>,
  branch: <><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="8" r="2" /><path d="M6 8v8" /><path d="M18 10v1.5c0 3-4 3-6 4.5" /></>,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  more: <><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 7V5h6v2" /><path d="m6 7 1 13h10l1-13" /></>,
  close: <><path d="m6 6 12 12" /><path d="M18 6 6 18" /></>,
  screen: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" /></>,
  cursor: <path d="M5 3l6.2 17 2.2-6.6L20 11z" />,
  paperclip: <path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-2.8-2.8l7-7" />,
  sparkle: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></>,
  wrench: <><path d="M14 4l6 6-3 3-6-6z" /><path d="M11 7 4 14v6h6l7-7" /></>,
  diff: <><path d="M7 3v18" /><path d="M17 3v18" /><path d="M10 7h4" /><path d="M10 11h4" /><path d="M15 16h4" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 5H5v10" /></>,
  alert: <><path d="M12 4l9 16H3z" /><path d="M12 10v4" /><path d="M12 17h.01" /></>,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3" /><path d="M13 15h4" /></>,
  message: <path d="M4 20l1.2-4A8 8 0 1 1 8 20z" />,
  refresh: <><path d="M20 12a8 8 0 1 0-2.6 5.9" /><path d="M20 6v6h-6" /></>,
  command: <><path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" /></>,
  frame: <><path d="M8 3H4v4" /><path d="M16 3h4v4" /><path d="M20 16v4h-4" /><path d="M4 16v4h4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2" /><path d="M12 19.5v2" /><path d="M2.5 12h2" /><path d="M19.5 12h2" /><path d="m5.2 5.2 1.4 1.4" /><path d="m17.4 17.4 1.4 1.4" /><path d="m18.8 5.2-1.4 1.4" /><path d="m6.6 17.4-1.4 1.4" /></>,
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  monitor: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M9 21h6" /><path d="M12 17v4" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8" /><path d="m16 7 3 3" /><path d="m18 5 2 2" /></>,
  server: <><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01" /><path d="M7 16.5h.01" /></>,
  plug: <><path d="M9 3v5" /><path d="M15 3v5" /><path d="M6 8h12v3a6 6 0 0 1-12 0z" /><path d="M12 17v4" /></>,
  cpu: <><rect x="7" y="7" width="10" height="10" rx="1.5" /><path d="M10 3v2" /><path d="M14 3v2" /><path d="M10 19v2" /><path d="M14 19v2" /><path d="M3 10h2" /><path d="M3 14h2" /><path d="M19 10h2" /><path d="M19 14h2" /></>,
  palette: <><path d="M12 21a9 9 0 1 1 9-9c0 2-1.5 3-3 3h-2a2 2 0 0 0-1.6 3.2l.3.5A1.7 1.7 0 0 1 12 21z" /><circle cx="8" cy="10" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="16" cy="10" r="1" fill="currentColor" stroke="none" /></>,
  keyboard: <><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01" /><path d="M10 10h.01" /><path d="M14 10h.01" /><path d="M18 10h.01" /><path d="M8 14h8" /></>,
  book: <><path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2z" /><path d="M4 17h15" /></>,
  shield: <path d="M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6z" />,
  external: <><path d="M14 4h6v6" /><path d="m20 4-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  eye: <><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6z" /><circle cx="12" cy="12" r="2.5" /></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  strokeWidth?: number;
}

export function Icon({ name, size = 16, strokeWidth = 1.5, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

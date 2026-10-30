import type { SquadId } from "./data";

type IconName =
  | "arrow"
  | "diagonal"
  | "calendar"
  | "target"
  | "trophy"
  | "pin"
  | "menu"
  | "close"
  | "chevron"
  | "plus"
  | "check";

export function Icon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  const paths = {
    arrow: (
      <>
        <path d="M4 12h15M13 6l6 6-6 6" />
      </>
    ),
    diagonal: (
      <>
        <path d="M5 19 19 5M5 5h14v14" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2" />
      </>
    ),
    target: (
      <>
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="2" />
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      </>
    ),
    trophy: (
      <>
        <path d="M8 3h8v7a4 4 0 0 1-8 0V3ZM8 5H4v3a4 4 0 0 0 4 4M16 5h4v3a4 4 0 0 1-4 4M12 14v6M8 21h8" />
      </>
    ),
    pin: (
      <>
        <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
        <circle cx="12" cy="10" r="2" />
      </>
    ),
    menu: (
      <>
        <path d="M4 7h16M4 12h16M4 17h16" />
      </>
    ),
    close: (
      <>
        <path d="m6 6 12 12M6 18 18 6" />
      </>
    ),
    chevron: (
      <>
        <path d="m8 10 4 4 4-4" />
      </>
    ),
    plus: (
      <>
        <path d="M12 4v16M4 12h16" />
      </>
    ),
    check: (
      <>
        <path d="m5 12 4 4L19 6" />
      </>
    ),
  };
  return (
    <svg
      className={`icon ${className}`}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function Brand({
  light = false,
  href = "#home",
}: {
  light?: boolean;
  href?: string;
}) {
  return (
    <a
      className={`brand ${light ? "brand-light" : ""}`}
      href={href}
      aria-label="ArewaVanta homepage"
    >
      <svg viewBox="0 0 50 44" aria-hidden="true">
        <path
          d="M0 42 20 2h10L10 42Zm20 0 10-20L40 42h10L30 2l-5 10L40 42Z"
          fill="currentColor"
        />
      </svg>
      <span>
        arewa<span className="brand-vanta">vanta</span>
        <span className="brand-dot">.</span>
      </span>
    </a>
  );
}

export function SquadMark({
  id,
  className = "",
}: {
  id: SquadId;
  className?: string;
}) {
  const marks = {
    reapers: (
      <>
        <path d="m15 14 13 5 4-13 5 13 12-5-6 23-11 16-12-16Z" />
        <path
          d="m20 28 10 5-6 4Zm24 0-10 5 6 4ZM28 41h8l-4 6Z"
          fill="var(--mark-cutout, #f3f1e9)"
        />
        <path d="m18 13 8 3-5-8Zm28 0-8 3 5-8Z" />
      </>
    ),
    wolves: (
      <>
        <path d="m10 8 19 12h6L54 8l-7 32-15 16-15-16Z" />
        <path
          d="m17 26 12 8-10-1Zm30 0-12 8 10-1ZM25 42l7-5 7 5-7 6Z"
          fill="var(--mark-cutout, #f3f1e9)"
        />
      </>
    ),
    phantoms: (
      <>
        <path d="M15 30a17 17 0 0 1 34 0v23l-9-6-8 7-8-7-9 6Z" />
        <path
          d="m21 29 9 5-9 5Zm22 0-9 5 9 5Z"
          fill="var(--mark-cutout, #f3f1e9)"
        />
      </>
    ),
    savannah: (
      <>
        <path
          d="M32 5 55 18l-4 26-19 14-19-14-4-26Zm0 10L20 37h24Z"
          fillRule="evenodd"
        />
        <path d="M24 43h16l-8 9Z" />
      </>
    ),
    strikers: (
      <>
        <path d="M34 4 13 34h16l-4 25 27-36H36l8-19Z" />
      </>
    ),
    guard: (
      <>
        <path
          d="m32 5 23 9-5 26-18 18-18-18-5-26Zm0 10L21 37h9v10h4V37h9Z"
          fillRule="evenodd"
        />
      </>
    ),
  };
  return (
    <svg
      className={`squad-mark ${className}`}
      viewBox="0 0 64 64"
      fill="currentColor"
      aria-hidden="true"
    >
      {marks[id]}
    </svg>
  );
}

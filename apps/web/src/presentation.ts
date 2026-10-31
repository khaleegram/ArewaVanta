import type { EventSummary } from "./api/types";

/** Shared, presentation-only formatting. Internal IDs and slugs stay out of the UI. */

export function competitionTypeLabel(
  type: EventSummary["competition_type"] | string | null | undefined,
): string {
  switch (type) {
    case "scrim":
      return "Scrim";
    case "league":
      return "League";
    case "tournament":
      return "Tournament";
    default:
      return "Competition";
  }
}

export function competitionLabel(
  event: Pick<EventSummary, "competition_type" | "season" | "series_id" | "skipped_at">,
): string {
  if (event.skipped_at) return "Not playing this week";
  if (event.series_id) return "Weekly scrim";
  if (event.competition_type) return competitionTypeLabel(event.competition_type);
  return event.season?.name ?? "Community competition";
}

export function countLabel(
  value: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function ordinal(value: number): string {
  const rest = value % 100;
  if (rest >= 11 && rest <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

export function placementLabel(value: number | null | undefined): string {
  return value == null ? "No placement" : `${ordinal(value)} place`;
}

export function gamesWithResults(scored: number, total: number): string {
  if (total <= 0) return "No games scheduled";
  if (scored <= 0) return `No results yet · ${countLabel(total, "game")} scheduled`;
  if (scored >= total) return `All ${countLabel(total, "game")} have results`;
  return `${scored} of ${total} games have results`;
}

export function scoringLabel(
  name: string | null | undefined,
  fallback = "Standard scoring",
): string {
  const text = name?.trim();
  return text || fallback;
}

export function squadIdentity(input: {
  name?: string | null;
  squadNumber?: number | null;
  clanTag?: string | null;
  clanName?: string | null;
  clanSquadCount?: number | null;
}): string {
  const name = input.name?.trim();
  const number = input.squadNumber ?? (name ? /^squad\s+(\d+)$/i.exec(name)?.[1] : null);
  const identity = [input.clanTag?.trim(), input.clanName?.trim()]
    .filter((part): part is string => Boolean(part))
    .join(" · ");

  if (!input.clanName?.trim()) {
    const fallback = name || (number ? `Squad ${number}` : "Squad");
    return input.clanTag?.trim() ? `${input.clanTag.trim()} · ${fallback}` : fallback;
  }
  return `${identity}${input.clanSquadCount != null && input.clanSquadCount > 1 && number ? ` (${number})` : ""}`;
}

export function submissionStatusLabel(
  status: string | null | undefined,
  audience: "captain" | "organizer" = "organizer",
): string {
  if (!status) return audience === "captain" ? "Open" : "Not submitted";
  if (status === "pending")
    return audience === "captain" ? "Awaiting slot selection" : "Awaiting review";
  if (status === "selected") return "Selected";
  if (status === "not_selected") return "Not selected";
  if (status === "withdrawn") return "Withdrawn";
  return "In review";
}

function utcDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

export function formatDate(
  value: string | null,
  options: { weekday?: boolean } = {},
): string {
  if (!value) return "Date to be announced";
  return new Intl.DateTimeFormat("en-NG", {
    ...(options.weekday ? { weekday: "short" as const } : {}),
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcDate(value));
}

export function formatDateRange(
  start: string | null,
  end: string | null,
): string {
  if (!start) return "Date to be announced";
  if (!end || end === start) return formatDate(start);
  const first = utcDate(start);
  const last = utcDate(end);
  const sameYear = first.getUTCFullYear() === last.getUTCFullYear();
  if (!sameYear) return `${formatDate(start)} – ${formatDate(end)}`;
  const dayMonth = (date: Date) =>
    new Intl.DateTimeFormat("en-NG", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(date);
  return `${dayMonth(first)} – ${dayMonth(last)} ${last.getUTCFullYear()}`;
}

export function timezoneLabel(timezone: string | null | undefined): string {
  if (!timezone) return "Local time";
  const city = timezone.split("/").pop()?.replaceAll("_", " ") ?? timezone;
  const localNames: Record<string, string> = {
    "Africa/Lagos": "WAT",
    "Africa/Abuja": "WAT",
    "Africa/Kano": "WAT",
  };
  if (localNames[timezone]) return `${city} time (${localNames[timezone]})`;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      timeZoneName: "short",
    }).formatToParts(new Date());
    const short = parts.find((part) => part.type === "timeZoneName")?.value;
    return short ? `${city} time (${short})` : `${city} time`;
  } catch {
    return `${city} time`;
  }
}

function activityDate(value: string) {
  return new Date(
    value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`,
  );
}

export function activityTime(value: string): string {
  const date = activityDate(value);
  if (Number.isNaN(date.getTime())) return "";
  const startOfDay = (input: Date) =>
    new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime();
  const days = Math.round(
    (startOfDay(new Date()) - startOfDay(date)) / 86_400_000,
  );
  const time = date.toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
  });
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  const day = new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === new Date().getFullYear()
      ? {}
      : { year: "numeric" as const }),
    timeZone: "Africa/Lagos",
  }).format(date);
  return `${day}, ${time}`;
}

export function activityFullTime(value: string): string {
  const date = activityDate(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos",
  });
}

/** Presentation cleanup for activity messages: short, human sentences only. */
export function activityText(value: string): string {
  let text = value.replace(/\s+/g, " ").trim();
  text = text
    .replace(/\bregistered player\b/i, "registered")
    .replace(/\bupdated player\b/i, "updated")
    .replace(/^(.+) assigned (.+) as a clan captain\.$/i, "$1 made $2 a clan captain.")
    .replace(/\baccepted a clan captain invitation\b/i, "joined as a clan captain");
  if (!text) return "";
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

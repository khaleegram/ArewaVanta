const apiBase = (process.env.VITE_API_BASE_URL || "https://api.arewavanta.com/api/v1").replace(/\/+$/, "");

export type ShareEvent = {
  id: string;
  title: string;
  slug: string;
  start_date: string | null;
  end_date: string | null;
  squad_count: number;
  scored_match_count: number;
  series_id: string | null;
};

export type ShareStanding = {
  squad: {
    name: string;
    squad_number: number | null;
    clan: { name: string; tag: string | null; squad_count: number };
  };
  matches_played: number;
  total_kills: number;
  wins: number;
  total_points: string;
};

export type ShareData = {
  event: ShareEvent;
  standings: ShareStanding[];
};

type EventPage = { data: ShareEvent[]; meta?: { last_page?: number } };

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error(`Leaderboard preview source returned ${response.status}`);
  return await response.json() as T;
}

export function shareCode(slug: string): string | null {
  return slug.match(/-([a-z0-9]{8})$/i)?.[1]?.toLowerCase() ?? null;
}

export async function leaderboardShareData(code: string): Promise<ShareData | null> {
  if (!/^[a-z0-9]{8}$/i.test(code)) return null;

  const first = await getJson<EventPage>("/events?per_page=50&page=1");
  const events = first.data ?? [];
  const firstPageMatch = events.find((event) => shareCode(event.slug) === code.toLowerCase());
  if (firstPageMatch) return await getShareData(firstPageMatch);
  const lastPage = Math.min(first.meta?.last_page ?? 1, 100);
  for (let firstPageNumber = 2; firstPageNumber <= lastPage; firstPageNumber += 4) {
    const pages = Array.from(
      { length: Math.min(4, lastPage - firstPageNumber + 1) },
      (_, index) => getJson<EventPage>(`/events?per_page=50&page=${firstPageNumber + index}`),
    );
    const results = await Promise.all(pages);
    for (const result of results) {
      const match = result.data?.find((event) => shareCode(event.slug) === code.toLowerCase());
      if (match) return await getShareData(match);
    }
  }

  return null;
}

async function getShareData(event: ShareEvent): Promise<ShareData> {
  const response = await getJson<{ data: { standings: ShareStanding[] } }>(
    `/events/${encodeURIComponent(event.slug)}/standings`,
  );
  return { event, standings: response.data?.standings ?? [] };
}

export function squadLabel(row: ShareStanding): string {
  const { clan, squad_number: number } = row.squad;
  return `${clan.name}${clan.squad_count > 1 ? ` (${number ?? 1})` : ""}`;
}

export function formatShareDate(start: string | null, end: string | null): string {
  if (!start) return "Arewa CODM standings";
  const fmt = new Intl.DateTimeFormat("en-NG", {
    day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos",
  });
  const date = (value: string) => fmt.format(new Date(`${value}T12:00:00+01:00`));
  return end && end !== start ? `${date(start)} – ${date(end)}` : date(start);
}

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

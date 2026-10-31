type VercelRequest = { method?: string; headers: Record<string, string | string[] | undefined> };
type VercelResponse = {
  status: (code: number) => VercelResponse;
  setHeader: (name: string, value: string) => VercelResponse;
  send: (body: string) => void;
};

const origin = "https://arewavanta.com";
const apiBase = (process.env.VITE_API_BASE_URL || "https://api.arewavanta.com/api/v1").replace(/\/+$/, "");
const staticPaths = ["/", "/competitions", "/leaderboard", "/clans", "/players"];

type Page<T> = { data: T[]; meta?: { last_page?: number } };
type Event = {
  slug: string;
  series_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  timezone?: string;
  skipped_at?: string | null;
};
type Clan = { slug: string; squads?: { slug: string }[] };
type Match = { id: string };
type EventDetail = { days?: { matches?: Match[] }[] };

async function all<T>(path: string): Promise<T[]> {
  const firstResponse = await fetch(`${apiBase}${path}?page=1&per_page=50`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!firstResponse.ok) throw new Error(`Public sitemap source returned ${firstResponse.status}`);
  const first = await firstResponse.json() as Page<T>;
  const pages = [first.data ?? []];
  const lastPage = Math.min(first.meta?.last_page ?? 1, 500);
  for (let page = 2; page <= lastPage; page += 1) {
    const response = await fetch(`${apiBase}${path}?page=${page}&per_page=50`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Public sitemap source returned ${response.status}`);
    const result = await response.json() as Page<T>;
    pages.push(result.data ?? []);
  }
  return pages.flat();
}

function localToday(timezone = "Africa/Lagos") {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Lagos",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }
}

function publicEvents(events: Event[]) {
  const groups = new Map<string, Event[]>();
  for (const event of events) {
    const key = event.series_id || event.slug;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.values()].map((weeks) => {
    const ordered = [...weeks].sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? ""));
    return ordered.find((event) => !event.skipped_at && !!event.start_date && (event.end_date ?? event.start_date)! >= localToday(event.timezone))
      ?? ordered.at(-1)!;
  });
}

function xmlEscape(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function xml(urls: Set<string>) {
  const locations = [...urls].map((path) => `  <url><loc>${xmlEscape(`${origin}${path}`)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locations}\n</urlset>`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).send("Method not allowed");
  }
  const urls = new Set(staticPaths);
  try {
    const [events, clans, players] = await Promise.all([
      all<Event>("/events"),
      all<Clan>("/clans"),
      all<{ id: string }>("/players"),
    ]);
    const indexableEvents = publicEvents(events);
    for (const event of indexableEvents) urls.add(`/competitions/${encodeURIComponent(event.slug)}`);
    for (const clan of clans) {
      urls.add(`/clans/${encodeURIComponent(clan.slug)}`);
      for (const squad of clan.squads ?? []) urls.add(`/squads/${encodeURIComponent(squad.slug)}`);
    }
    for (const player of players) urls.add(`/players/${encodeURIComponent(player.id)}`);

    const details = await Promise.all(indexableEvents.map(async (event) => {
      const response = await fetch(`${apiBase}/events/${encodeURIComponent(event.slug)}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return null;
      return await response.json() as { data?: EventDetail };
    }));
    for (const [index, detail] of details.entries()) {
      const event = indexableEvents[index];
      for (const day of detail?.data?.days ?? []) {
        for (const match of day.matches ?? []) {
          urls.add(`/competitions/${encodeURIComponent(event.slug)}/games/${encodeURIComponent(match.id)}`);
        }
      }
    }
  } catch (error) {
    console.error("Unable to refresh ArewaVanta public sitemap", error);
  }

  res.status(200)
    .setHeader("Content-Type", "application/xml; charset=utf-8")
    .setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400")
    .setHeader("X-Robots-Tag", "noindex")
    .send(xml(urls));
}

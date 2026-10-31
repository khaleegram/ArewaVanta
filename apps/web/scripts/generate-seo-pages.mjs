import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const site = "https://arewavanta.com";
const api = (process.env.VITE_API_BASE_URL || "https://api.arewavanta.com/api/v1").replace(/\/+$/, "");
const dist = path.resolve("dist");
const baseHtml = await readFile(path.join(dist, "index.html"), "utf8");
let generated = 0;

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function routeFile(route) {
  const segments = route.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  if (segments.some((part) => part === "." || part === ".." || part.includes("/") || part.includes("\\"))) return null;
  return path.join(dist, ...segments, "index.html");
}

function setMeta(html, attr, key, content) {
  const escaped = escapeHtml(content);
  const pattern = new RegExp(`<meta\\s+${attr}=["']${key}["'][^>]*>`, "i");
  const element = `<meta ${attr}="${key}" content="${escaped}" />`;
  return pattern.test(html) ? html.replace(pattern, element) : html.replace("</head>", `    ${element}\n  </head>`);
}

function setCanonical(html, route) {
  const url = `${site}${route}`;
  const link = `<link rel="canonical" href="${escapeHtml(url)}" />`;
  return /<link\s+rel=["']canonical["'][^>]*>/i.test(html)
    ? html.replace(/<link\s+rel=["']canonical["'][^>]*>/i, link)
    : html.replace("</head>", `    ${link}\n  </head>`);
}

async function page(route, title, description, schema) {
  const file = routeFile(route);
  if (!file) return;
  let html = baseHtml.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  html = setMeta(html, "name", "description", description);
  html = setMeta(html, "name", "robots", "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1");
  html = setMeta(html, "property", "og:type", "website");
  html = setMeta(html, "property", "og:site_name", "ArewaVanta");
  html = setMeta(html, "property", "og:locale", "en_NG");
  html = setMeta(html, "property", "og:title", title);
  html = setMeta(html, "property", "og:description", description);
  html = setMeta(html, "property", "og:url", `${site}${route}`);
  html = setMeta(html, "property", "og:image", `${site}/images/northern-force.webp`);
  html = setMeta(html, "property", "og:image:alt", "ArewaVanta Call of Duty: Mobile Battle Royale community");
  html = setMeta(html, "name", "twitter:card", "summary_large_image");
  html = setMeta(html, "name", "twitter:title", title);
  html = setMeta(html, "name", "twitter:description", description);
  html = setMeta(html, "name", "twitter:image", `${site}/images/northern-force.webp`);
  html = setCanonical(html, route);
  if (schema) {
    const script = `<script type="application/ld+json" id="arewavanta-page-schema">${JSON.stringify(schema).replaceAll("<", "\\u003c")}</script>`;
    html = html.replace("</head>", `    ${script}\n  </head>`);
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html);
  generated += 1;
}

async function list(pathname) {
  const firstResponse = await fetch(`${api}${pathname}?page=1&per_page=50`, { signal: AbortSignal.timeout(8000) });
  if (!firstResponse.ok) throw new Error(`${pathname} returned ${firstResponse.status}`);
  const first = await firstResponse.json();
  const pages = [first.data ?? []];
  const last = Math.min(first.meta?.last_page ?? 1, 500);
  for (let current = 2; current <= last; current += 1) {
    const response = await fetch(`${api}${pathname}?page=${current}&per_page=50`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`${pathname} returned ${response.status}`);
    pages.push((await response.json()).data ?? []);
  }
  return pages.flat();
}

function formatDate(value) {
  if (!value) return "";
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" }).format(parsed);
}

const corePages = [
  ["/competitions", "CODM Scrims, Leagues & Tournaments in Nigeria | ArewaVanta", "Find upcoming and past Arewa CODM Battle Royale competitions in Nigeria. Explore weekly scrims, game schedules, participating squads and match results."],
  ["/leaderboard", "Arewa CODM Leaderboard — Squad & Player Rankings | ArewaVanta", "Follow Nigerian Arewa CODM Battle Royale squad standings and player rankings, including kills, wins and competition results."],
  ["/clans", "Arewa CODM Clans & Squads in Nigeria | ArewaVanta", "Discover Call of Duty: Mobile clans and Battle Royale squads from the Nigerian Arewa community. View squad lineups and competition history."],
  ["/players", "Arewa CODM Players & Profiles | ArewaVanta", "Find Arewa CODM Battle Royale players, view their squads and explore recorded match statistics from competitions in Nigeria."],
];
for (const [route, title, description] of corePages) {
  await page(route, title, description, {
    "@context": "https://schema.org",
    "@type": "WebPage",
    url: `${site}${route}`,
    name: title,
    description,
    inLanguage: "en-NG",
    about: { "@id": `${site}/#organization` },
  });
}

try {
  const [events, clans, players] = await Promise.all([list("/events"), list("/clans"), list("/players")]);
  for (const clan of clans) {
    const route = `/clans/${encodeURIComponent(clan.slug)}`;
    const description = clan.bio || `${clan.name}${clan.tag ? ` (${clan.tag})` : ""} is an Arewa CODM clan in Nigeria. View its ${clan.squads?.length ?? clan.squad_count ?? 0} squads and players on ArewaVanta.`;
    await page(route, `${clan.name} — Arewa CODM Clan & Squads | ArewaVanta`, description, {
      "@context": "https://schema.org", "@type": "SportsOrganization", name: clan.name,
      alternateName: clan.tag || undefined, description, sport: "Call of Duty: Mobile Battle Royale",
      url: `${site}${route}`,
    });
    for (const squad of clan.squads ?? []) {
      const squadRoute = `/squads/${encodeURIComponent(squad.slug)}`;
      const squadName = squad.squad_number ? `${clan.tag ? `${clan.tag} ` : ""}${clan.name} (${squad.squad_number})` : squad.name;
      const squadDescription = `${squadName} represents ${clan.name} in Call of Duty: Mobile Battle Royale competitions. View its players and recorded results.`;
      await page(squadRoute, `${squadName} — CODM Squad & Players | ArewaVanta`, squadDescription, {
        "@context": "https://schema.org", "@type": "SportsTeam", name: squadName,
        sport: "Call of Duty: Mobile Battle Royale", url: `${site}${squadRoute}`,
        parentOrganization: { "@type": "SportsOrganization", name: clan.name, url: `${site}${route}` },
      });
    }
  }
  for (const player of players) {
    const route = `/players/${encodeURIComponent(player.id)}`;
    const description = `${player.current_ign} is a Call of Duty: Mobile Battle Royale player in the Arewa community. View squad affiliations, match appearances, kills and competition history.`;
    await page(route, `${player.current_ign} — Arewa CODM Player Profile | ArewaVanta`, description, {
      "@context": "https://schema.org", "@type": "Person", name: player.current_ign,
      url: `${site}${route}`, description,
    });
  }

  const grouped = new Map();
  for (const event of events) {
    const key = event.series_id || event.slug;
    grouped.set(key, [...(grouped.get(key) ?? []), event]);
  }
  const indexableEvents = [...grouped.values()].map((weeks) => {
    const ordered = [...weeks].sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? ""));
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    return ordered.find((event) => !event.skipped_at && event.start_date && (event.end_date ?? event.start_date) >= today) ?? ordered.at(-1);
  }).filter(Boolean);

  for (const event of indexableEvents) {
    const route = `/competitions/${encodeURIComponent(event.slug)}`;
    const type = event.series_id ? "weekly Arewa CODM Battle Royale scrim" : `${event.competition_type || "CODM"} competition`;
    const dateLabel = [formatDate(event.start_date), event.end_date && event.end_date !== event.start_date ? formatDate(event.end_date) : ""].filter(Boolean).join(" – ");
    const description = `${event.title} is a ${type} in Nigeria${dateLabel ? ` scheduled for ${dateLabel}` : ""}. View the game schedule, participating squads, standings and results.`;
    const breadcrumb = {
      "@context": "https://schema.org", "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${site}/` },
        { "@type": "ListItem", position: 2, name: "Competitions", item: `${site}/competitions` },
        { "@type": "ListItem", position: 3, name: event.title, item: `${site}${route}` },
      ],
    };
    await page(route, `${event.series_id ? "Weekly Arewa CODM Scrims" : event.title}${dateLabel ? ` — ${dateLabel}` : ""} | ArewaVanta`, description, breadcrumb);
    try {
      const response = await fetch(`${api}/events/${encodeURIComponent(event.slug)}`, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) continue;
      const detail = (await response.json()).data;
      for (const day of detail?.days ?? []) for (const match of day.matches ?? []) {
        const matchRoute = `${route}/games/${encodeURIComponent(match.id)}`;
        const matchDescription = `${match.map_label} Game ${match.match_index} in ${event.title}, played ${formatDate(day.date)}. View squad placements, kills and player match statistics.`;
        await page(matchRoute, `${event.title} Game ${match.match_index} on ${match.map_label} | ArewaVanta`, matchDescription, {
          "@context": "https://schema.org", "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: `${site}/` },
            { "@type": "ListItem", position: 2, name: "Competitions", item: `${site}/competitions` },
            { "@type": "ListItem", position: 3, name: event.title, item: `${site}${route}` },
            { "@type": "ListItem", position: 4, name: `Game ${match.match_index}`, item: `${site}${matchRoute}` },
          ],
        });
      }
    } catch (error) {
      console.warn(`Could not pre-render match metadata for ${event.slug}`, error);
    }
  }
} catch (error) {
  console.warn("Could not fetch public ArewaVanta data for route metadata; the app shell pages are still available.", error);
}

console.log(`Generated SEO HTML for ${generated} public pages.`);

import { useEffect } from "react";

export const SITE_ORIGIN = "https://arewavanta.com";
const DEFAULT_IMAGE = `${SITE_ORIGIN}/images/northern-force.webp`;

export type PageSeo = {
  title: string;
  description: string;
  path: string;
  image?: string;
  type?: "website" | "article";
  noIndex?: boolean;
  schema?: Record<string, unknown> | Record<string, unknown>[];
};

function meta(selector: string, attribute: "name" | "property", key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.append(element);
  }
  element.content = content;
}

export function applyPageSeo(page: PageSeo) {
  const canonical = `${SITE_ORIGIN}${page.path === "/" ? "/" : page.path.replace(/\/$/, "")}`;
  const image = page.image ?? DEFAULT_IMAGE;
  document.title = page.title;
  meta('meta[name="description"]', "name", "description", page.description);
  meta('meta[name="robots"]', "name", "robots", page.noIndex ? "noindex,nofollow" : "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1");
  meta('meta[property="og:type"]', "property", "og:type", page.type ?? "website");
  meta('meta[property="og:site_name"]', "property", "og:site_name", "ArewaVanta");
  meta('meta[property="og:locale"]', "property", "og:locale", "en_NG");
  meta('meta[property="og:title"]', "property", "og:title", page.title);
  meta('meta[property="og:description"]', "property", "og:description", page.description);
  meta('meta[property="og:url"]', "property", "og:url", canonical);
  meta('meta[property="og:image"]', "property", "og:image", image);
  meta('meta[property="og:image:alt"]', "property", "og:image:alt", "ArewaVanta Call of Duty: Mobile Battle Royale community");
  meta('meta[name="twitter:card"]', "name", "twitter:card", "summary_large_image");
  meta('meta[name="twitter:title"]', "name", "twitter:title", page.title);
  meta('meta[name="twitter:description"]', "name", "twitter:description", page.description);
  meta('meta[name="twitter:image"]', "name", "twitter:image", image);

  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.append(link);
  }
  link.href = canonical;

  document.getElementById("arewavanta-page-schema")?.remove();
  if (page.schema) {
    const script = document.createElement("script");
    script.id = "arewavanta-page-schema";
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(page.schema);
    document.head.append(script);
  }
}

export function usePageSeo(page: PageSeo) {
  const schemaText = page.schema ? JSON.stringify(page.schema) : "";
  useEffect(() => {
    applyPageSeo(page);
  }, [page.title, page.description, page.path, page.image, page.type, page.noIndex, schemaText]);
}

export const pageMetadata = {
  home: {
    title: "Arewa CODM Scrims, Leagues & Tournaments in Nigeria | ArewaVanta",
    description: "Join Arewa Call of Duty: Mobile Battle Royale scrims, leagues and tournaments in Nigeria. Find weekly scrims, schedules, squad standings, results and player rankings.",
    path: "/",
  },
  competitions: {
    title: "CODM Scrims, Leagues & Tournaments in Nigeria | ArewaVanta",
    description: "Find upcoming and past Arewa CODM Battle Royale competitions in Nigeria. Explore weekly scrims, game schedules, participating squads and match results.",
    path: "/competitions",
  },
  clans: {
    title: "Arewa CODM Clans & Squads in Nigeria | ArewaVanta",
    description: "Discover Call of Duty: Mobile clans and Battle Royale squads from the Nigerian Arewa community. View squad lineups and competition history.",
    path: "/clans",
  },
  players: {
    title: "Arewa CODM Players & Profiles | ArewaVanta",
    description: "Find Arewa CODM Battle Royale players, view their squads and explore recorded match statistics from competitions in Nigeria.",
    path: "/players",
  },
  leaderboard: {
    title: "Arewa CODM Leaderboard — Squad & Player Rankings | ArewaVanta",
    description: "Follow Nigerian Arewa CODM Battle Royale squad standings and player rankings, including kills, wins and competition results.",
    path: "/leaderboard",
  },
} satisfies Record<string, PageSeo>;

import { escapeHtml, formatShareDate, leaderboardShareData, squadLabel } from "./_lib/leaderboard";

type Request = { method?: string; query: Record<string, string | string[] | undefined> };
type Response = {
  status: (code: number) => Response;
  setHeader: (name: string, value: string) => Response;
  send: (body: string) => void;
};

export default async function handler(req: Request, res: Response) {
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).send("Method not allowed");
  }
  const rawCode = req.query.code;
  const code = Array.isArray(rawCode) ? rawCode[0] : rawCode;
  if (!code) return res.status(404).send("Leaderboard not found");

  try {
    const data = await leaderboardShareData(code);
    if (!data) return res.status(404).send("Leaderboard not found");

    const url = `https://arewavanta.com/l/${code.toLowerCase()}`;
    const image = `https://arewavanta.com/api/leaderboard-image?code=${encodeURIComponent(code.toLowerCase())}`;
    const scored = data.standings.filter((row) => row.matches_played > 0);
    const leader = scored[0];
    const title = `${data.event.title} Squad Leaderboard | ArewaVanta`;
    const dates = formatShareDate(data.event.start_date, data.event.end_date);
    const description = leader
      ? `${squadLabel(leader)} leads with ${leader.total_points} points. See squad points, kills and wins from ${dates} on the Arewa CODM leaderboard.`
      : `Follow squad standings, kills, wins and results for ${data.event.title}, ${dates}. Arewa CODM competitions in Nigeria.`;
    const head = [
      `<title>${escapeHtml(title)}</title>`,
      `<meta name="description" content="${escapeHtml(description)}">`,
      '<meta name="robots" content="noindex,follow">',
      `<link rel="canonical" href="${escapeHtml(url)}">`,
      '<meta property="og:type" content="website">',
      '<meta property="og:site_name" content="ArewaVanta">',
      '<meta property="og:locale" content="en_NG">',
      `<meta property="og:title" content="${escapeHtml(title)}">`,
      `<meta property="og:description" content="${escapeHtml(description)}">`,
      `<meta property="og:url" content="${escapeHtml(url)}">`,
      `<meta property="og:image" content="${escapeHtml(image)}">`,
      '<meta property="og:image:type" content="image/png">',
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      '<meta property="og:image:alt" content="ArewaVanta squad leaderboard with live competition standings">',
      '<meta name="twitter:card" content="summary_large_image">',
      `<meta name="twitter:title" content="${escapeHtml(title)}">`,
      `<meta name="twitter:description" content="${escapeHtml(description)}">`,
      `<meta name="twitter:image" content="${escapeHtml(image)}">`,
    ].join("\n    ");

    return res.status(200)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      .setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=3600")
      .send(`<!doctype html><html lang="en"><head><meta charset="utf-8">${head}</head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><a href="${escapeHtml(`https://arewavanta.com/leaderboard?type=squads&event=${encodeURIComponent(data.event.slug)}`)}">Open leaderboard</a></body></html>`);
  } catch (error) {
    console.error("Unable to build ArewaVanta leaderboard share preview", error);
    return res.status(503).send("Leaderboard preview is temporarily unavailable");
  }
}

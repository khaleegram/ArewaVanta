import { ImageResponse } from "@vercel/og";
import { formatShareDate, leaderboardShareData, squadLabel } from "./_lib/leaderboard";

type Request = { query: Record<string, string | string[] | undefined> };

const colors = {
  forest: "#173d2d",
  deep: "#10291f",
  green: "#2c6246",
  cream: "#f4f1e7",
  paper: "#fffdf7",
  muted: "#a8c2ad",
  gold: "#efc85c",
  coral: "#ef6550",
};

const shorten = (text: string, max = 27) => [...text].length > max ? `${[...text].slice(0, max - 1).join("")}…` : text;

export default async function handler(req: Request) {
  const rawCode = req.query.code;
  const code = Array.isArray(rawCode) ? rawCode[0] : rawCode;
  if (!code) return new Response("Not found", { status: 404 });

  try {
    const data = await leaderboardShareData(code);
    if (!data) return new Response("Not found", { status: 404 });
    const leaders = data.standings.filter((row) => row.matches_played > 0).slice(0, 3);
    const title = shorten(data.event.title, 42);
    const dates = formatShareDate(data.event.start_date, data.event.end_date);
    const items = leaders.length ? leaders : [null, null, null];

    return new ImageResponse(
      <div style={{
        width: "100%", height: "100%", display: "flex", flexDirection: "column",
        background: colors.cream, padding: 28, color: colors.forest,
        fontFamily: "Arial, sans-serif",
      }}>
        <div style={{
          height: 74, borderRadius: 18, background: colors.forest, color: colors.paper,
          display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 28px",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 28, fontWeight: 800 }}>
            <span style={{ color: colors.coral, fontSize: 36 }}>▲</span> arewavanta<span style={{ color: colors.coral }}>.</span>
          </div>
          <div style={{ color: colors.muted, fontSize: 14, letterSpacing: 2 }}>AREWA CODM · NIGERIA</div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "24px 8px 18px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ color: colors.green, fontSize: 13, fontWeight: 700, letterSpacing: 3 }}>OFFICIAL SQUAD STANDINGS</div>
            <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: -1 }}>{title}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, color: colors.green }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{dates}</div>
            <div style={{ fontSize: 13 }}>{data.event.scored_match_count} games scored · {data.event.squad_count} squads</div>
          </div>
        </div>
        <div style={{ height: 3, background: colors.coral, margin: "0 8px 16px" }} />
        <div style={{ display: "flex", flex: 1, gap: 14, alignItems: "stretch" }}>
          {items.map((row, index) => {
            const rank = row ? data.standings.indexOf(row) + 1 : index + 1;
            const first = index === 0;
            const medal = first ? colors.gold : index === 1 ? "#d8e4d7" : "#ead9ca";
            return <div key={row ? `${row.squad.name}-${rank}` : `empty-${index}`} style={{
              flex: first ? 1.08 : 1, borderRadius: 16, background: first ? colors.forest : colors.paper,
              border: `1px solid ${first ? colors.forest : "#d8e0d2"}`,
              padding: 19, display: "flex", flexDirection: "column", justifyContent: "space-between",
              color: first ? colors.paper : colors.forest,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: medal, color: colors.deep, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 800 }}>0{rank}</div>
                <div style={{ color: first ? colors.gold : colors.green, fontSize: 12, fontWeight: 800, letterSpacing: 1 }}>{first ? "CURRENT LEADER" : `RANK ${rank}`}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.15 }}>{row ? shorten(squadLabel(row), 23) : "Standings update soon"}</div>
                <div style={{ fontSize: 13, color: first ? colors.muted : "#718273" }}>{row ? `${row.total_kills} kills  ·  ${row.wins} wins` : "The live rankings will appear here"}</div>
              </div>
              <div style={{ borderTop: `1px solid ${first ? "#ffffff33" : "#e0e5dc"}`, paddingTop: 8, display: "flex", alignItems: "baseline", gap: 7 }}>
                <span style={{ fontSize: 34, lineHeight: 1, fontWeight: 800, color: first ? colors.gold : colors.green }}>{row?.total_points ?? "—"}</span>
                <span style={{ fontSize: 10, letterSpacing: 2, color: first ? colors.muted : "#718273", fontWeight: 700 }}>POINTS</span>
              </div>
            </div>;
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 8px 2px", color: colors.green, fontSize: 13 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}><span style={{ color: colors.coral, fontSize: 18 }}>●</span> Points · placements · squad kills</div>
          <div style={{ fontWeight: 800, letterSpacing: 1 }}>VIEW LIVE LEADERBOARD  ↗</div>
        </div>
      </div>,
      {
        width: 1200,
        height: 630,
        headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" },
      },
    );
  } catch (error) {
    console.error("Unable to render ArewaVanta leaderboard image", error);
    return new Response("Leaderboard preview is temporarily unavailable", { status: 503 });
  }
}

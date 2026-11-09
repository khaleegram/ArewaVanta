import type { MatchResultInput, ResultSheet, SavedResult } from "./api/types";

export type ScorePlayer = {
  id: string;
  ign: string;
  kills: string;
  clan_id?: string | null;
  clan_tag?: string | null;
};
export type ScoreRow = {
  status: "unentered" | "present" | "absent";
  placement: string;
  teamKills: string;
  players: ScorePlayer[];
};
export type ScoreRows = Record<string, ScoreRow>;
export type ScoreSquad = ResultSheet["squads"][number];
export type Candidate = {
  id: string;
  ign: string;
  squads?: { id: string; name: string }[];
  clan_id?: string | null;
  clan_tag?: string | null;
};
export const sameRow = (a: ScoreRow | undefined, b: ScoreRow | undefined) =>
  JSON.stringify(a) === JSON.stringify(b);
export const knownKills = (row: ScoreRow) =>
  row.players.reduce(
    (total, p) => total + (/^\d+$/.test(p.kills) ? Number(p.kills) : 0),
    0,
  );
export const totalKills = (row: ScoreRow) =>
  Math.max(
    knownKills(row),
    /^\d+$/.test(row.teamKills) ? Number(row.teamKills) : 0,
  );
export const hasKills = (row: ScoreRow) =>
  row.teamKills !== "" || row.players.some((p) => p.kills !== "");
export const incomplete = (row: ScoreRow) =>
  row.status === "present" &&
  (!row.placement ||
    !row.players.length ||
    row.players.some((p) => !p.kills) ||
    knownKills(row) !== totalKills(row));
export function sheetRows(sheet: ResultSheet): ScoreRows {
  return Object.fromEntries(
    sheet.squads.map((squad) => {
      const saved = sheet.result?.results.find((r) => r.squad_id === squad.id);
      return [
        squad.id,
        {
          status: saved?.participation_status ?? "unentered",
          placement: saved?.placement?.toString() ?? "",
          teamKills:
            (
              saved?.team_kills_override ??
              (saved && saved.team_kills_override === undefined
                ? saved.team_kills
                : null)
            )?.toString() ?? "",
          players: (saved?.players ?? []).map((p) => ({
            id: p.player_id,
            ign: p.ign,
            kills: p.kills?.toString() ?? "",
            clan_tag: saved?.clan_tag ?? squad.clan_tag ?? null,
          })),
        } satisfies ScoreRow,
      ];
    }),
  );
}
export function sheetWithResult(
  sheet: ResultSheet,
  result: SavedResult,
): ResultSheet {
  return {
    ...sheet,
    result,
    squads: sheet.squads.map((squad) => ({
      ...squad,
      eligible_players: [
        ...new Map(
          [
            ...squad.eligible_players,
            ...(
              result.results.find((r) => r.squad_id === squad.id)?.players ?? []
            ).map((p) => ({
              id: p.player_id,
              ign: p.ign,
              clan_tag: squad.clan_tag ?? null,
            })),
          ].map((p) => [p.id, p]),
        ).values(),
      ],
    })),
  };
}
export function scoreInput(id: string, row: ScoreRow): MatchResultInput {
  if (row.status !== "present")
    return { squad_id: id, status: row.status, players: [] };
  return {
    squad_id: id,
    status: row.status,
    placement: row.placement === "" ? null : Number(row.placement),
    team_kills: row.teamKills === "" ? null : Number(row.teamKills),
    players:
      row.status !== "present"
        ? []
        : row.players.map((p) => ({
            ...(p.id.startsWith("new:")
              ? { ign: p.ign, clan_id: p.clan_id ?? null }
              : { player_id: p.id }),
            kills: p.kills === "" ? null : Number(p.kills),
          })),
  };
}
export function validateRow(row: ScoreRow): string | null {
  if (row.status !== "present") return null;
  if (
    row.placement &&
    (!/^\d+$/.test(row.placement) || +row.placement < 1 || +row.placement > 100)
  )
    return "Placement must be 1–100, or blank if unknown.";
  if (row.teamKills && (!/^\d+$/.test(row.teamKills) || +row.teamKills > 999))
    return "Team kills must be 0–999, or blank to calculate from players.";
  if (
    row.players.some(
      (p) => p.kills !== "" && (!/^\d+$/.test(p.kills) || +p.kills > 999),
    )
  )
    return "Player kills must be 0–999, or blank if unknown.";
  return null;
}
export function pointsPreview(
  row: ScoreRow,
  snapshot: Record<string, unknown>,
): string {
  if (row.status !== "present" || (!hasKills(row) && !row.placement))
    return "—";
  const rules = snapshot.rules as
    | {
        mode?: string;
        kill_point_value?: string;
        maximum_position?: number;
        tiers?: {
          position_from: number;
          position_to: number;
          placement_points?: string;
          multiplier?: string;
        }[];
        fallback_multiplier?: string;
        fallback_placement_points?: string;
      }
    | undefined;
  if (!rules?.mode) return "—";
  const placement = Number(row.placement);
  const tier = rules.tiers?.find(
    (t) => placement >= t.position_from && placement <= t.position_to,
  );
  const fallback = placement > (rules.maximum_position ?? 100);
  if (row.placement && rules.mode !== "kills_only" && !tier && !fallback)
    return "—";
  const kills =
    rules.mode === "placement_only"
      ? 0
      : totalKills(row) * Number(rules.kill_point_value ?? 1);
  const bonus = Number(
    tier?.placement_points ??
      (fallback ? rules.fallback_placement_points : 0) ??
      0,
  );
  const multiplier =
    tier?.multiplier ?? (fallback ? rules.fallback_multiplier : undefined);
  if (row.placement && rules.mode === "multiplier" && multiplier === undefined)
    return "—";
  const points =
    rules.mode === "multiplier"
      ? row.placement
        ? kills * Number(multiplier)
        : 0
      : kills + (row.placement ? bonus : 0);
  return Number.isFinite(points)
    ? new Intl.NumberFormat("en", { maximumFractionDigits: 4 }).format(points)
    : "—";
}

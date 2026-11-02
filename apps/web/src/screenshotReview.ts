import type {
  ResultSheet,
  ScreenshotImport,
  ScreenshotImportTeam,
  ScreenshotPlayer,
  ScreenshotSquad,
} from "./api/types";
import { playerSearchKey } from "./playerSearch";
import type { ScoreRows } from "./scoreEntry";

export type ImportCandidate = ScreenshotPlayer["candidates"][number];
export type ApplyImportResult = { applied: boolean; message: string };
export const teamKey = (team: ScreenshotImportTeam) =>
  team.review_id ?? String(team.team_number ?? team.team_label);
export const playerKey = (player: ScreenshotPlayer) =>
  player.review_id ?? `${player.name}:${player.player_id ?? "unknown"}`;
export const applicableTeam = (team: ScreenshotImportTeam) =>
  !team.excluded &&
  !!team.squad &&
  ["matched", "roster_matched"].includes(team.status);
export const selectedPlayer = (player: ScreenshotPlayer) =>
  !player.excluded && player.status === "matched" && !!player.player_id;
export function squadSummary(
  squad: ResultSheet["squads"][number],
): ScreenshotSquad {
  return {
    id: squad.id,
    name: squad.name,
    squad_number: squad.squad_number ?? null,
    clan: squad.clan,
    clan_id: squad.clan_id,
    clan_tag: squad.clan_tag,
    clan_squad_count: squad.clan_squad_count ?? null,
    slot_number: squad.slot_number,
  };
}
export function uniqueCandidates(
  candidates: ImportCandidate[],
): ImportCandidate[] {
  return [
    ...new Map(
      candidates.map((candidate) => [candidate.player_id, candidate]),
    ).values(),
  ];
}
export function reviewCandidates(
  sheet: ResultSheet,
  teams: ScreenshotImportTeam[],
): ImportCandidate[] {
  const candidates: ImportCandidate[] = [];
  for (const squad of sheet.squads)
    for (const player of [
      ...(squad.roster_players ?? []),
      ...squad.eligible_players,
    ])
      candidates.push({
        player_id: player.id,
        ign: player.ign,
        squad_id: squad.id,
        squad_name: squad.name,
        clan: squad.clan,
        clan_tag: squad.clan_tag,
        slot_number: squad.slot_number,
      });
  for (const team of teams)
    for (const player of team.players) {
      candidates.push(...player.candidates);
      if (player.player_id && !player.player_id.startsWith("new:"))
        candidates.push({
          player_id: player.player_id,
          ign: player.ign ?? player.name,
          squad_id: player.squad_id,
          squad_name: player.squad_name,
          clan: player.clan,
          clan_tag: player.clan_tag,
          slot_number: player.slot_number,
        });
    }
  return uniqueCandidates(candidates);
}
export function remapTeam(
  team: ScreenshotImportTeam,
  target: ResultSheet["squads"][number],
  sheet: ResultSheet,
  allTeams: ScreenshotImportTeam[],
): ScreenshotImportTeam {
  const candidates = reviewCandidates(sheet, allTeams);
  const localIds = new Set(
    [...(target.roster_players ?? []), ...target.eligible_players].map(
      (p) => p.id,
    ),
  );
  const players = team.players.map((player): ScreenshotPlayer => {
    // A confirmed identity remains the same person when a team mapping changes.
    if (player.player_id && !player.player_id.startsWith("new:"))
      return {
        ...player,
        status:
          localIds.has(player.player_id) || player.confirmed
            ? "matched"
            : "other_squad",
      };
    const matches = candidates.filter(
      (p) => playerSearchKey(p.ign) === playerSearchKey(player.name),
    );
    const local = matches.filter((p) => localIds.has(p.player_id));
    const options = local.length ? local : matches;
    if (options.length === 1)
      return {
        ...player,
        ...options[0],
        status: localIds.has(options[0].player_id) ? "matched" : "other_squad",
        candidates: [],
        confirmed: false,
      };
    if (options.length > 1)
      return {
        ...player,
        status: "ambiguous",
        player_id: null,
        ign: null,
        candidates: options,
        confirmed: false,
      };
    if (player.player_id?.startsWith("new:") && player.confirmed) return player;
    return {
      ...player,
      status: "new",
      player_id: null,
      ign: player.name,
      candidates: [],
      confirmed: false,
    };
  });
  return {
    ...team,
    status: "matched",
    squad: squadSummary(target),
    suggested_squad: null,
    players,
  };
}
export function prepareReview(
  data: ScreenshotImport,
  sheet: ResultSheet,
): ScreenshotImport {
  const teams = data.teams.map((team) => ({
    ...team,
    review_id: team.review_id ?? crypto.randomUUID(),
    players: team.players.map((player) => ({
      ...player,
      review_id: player.review_id ?? crypto.randomUUID(),
      status:
        player.status === "duplicate" && player.player_id
          ? ("other_squad" as const)
          : player.status,
    })),
  }));
  return {
    ...data,
    teams: teams.map((team) => {
      if (!team.squad || team.status === "roster_mismatch") return team;
      const target = sheet.squads.find((squad) => squad.id === team.squad!.id);
      if (!target) return team;
      const mapped = remapTeam(team, target, sheet, teams);
      return { ...mapped, status: team.status };
    }),
  };
}
export function importProblems(teams: ScreenshotImportTeam[]): string[] {
  const problems: string[] = [];
  const usedSquads = new Map<string, string>();
  const usedPlayers = new Map<string, string>();
  for (const team of teams.filter(applicableTeam)) {
    const other = usedSquads.get(team.squad!.id);
    if (other)
      problems.push(
        `${team.team_label} and ${other} both map to slot ${team.squad!.slot_number}. Unmap or skip one team.`,
      );
    else usedSquads.set(team.squad!.id, team.team_label);
    const players = team.players.filter(selectedPlayer);
    if (players.length > 4)
      problems.push(
        `${team.team_label} has ${players.length} selected players. Keep up to four actual participants; skip spelling duplicates or nonparticipants.`,
      );
    for (const player of players) {
      const id = player.player_id!.startsWith("new:")
        ? `new-name:${playerSearchKey(player.name)}`
        : player.player_id!;
      const previous = usedPlayers.get(id);
      if (previous)
        problems.push(
          `${player.ign ?? player.name} is selected more than once (${previous} and ${team.team_label}). Keep the correct occurrence.`,
        );
      else usedPlayers.set(id, team.team_label);
    }
  }
  return [...new Set(problems)];
}
export function mergeImport(
  teams: ScreenshotImportTeam[],
  rows: ScoreRows,
): { rows: ScoreRows; conflicts: string[]; errors: string[]; count: number } {
  const applicable = teams.filter(applicableTeam);
  const errors = importProblems(teams);
  const conflicts: string[] = [];
  const next = { ...rows };
  for (const team of applicable) {
    const id = team.squad!.id;
    const current = rows[id];
    if (!current) {
      errors.push(
        `${team.team_label}'s squad is no longer on this score sheet. Refresh the game first.`,
      );
      continue;
    }
    const imported = team.players.filter(selectedPlayer);
    const players = team.replace_lineup ? [] : [...current.players];
    if (
      team.replace_lineup &&
      current.players.some(
        (player) => !imported.some((p) => p.player_id === player.id),
      )
    )
      conflicts.push(`${team.team_label}: replace its existing match lineup.`);
    for (const player of imported) {
      const existing = current.players.find((p) => p.id === player.player_id);
      if (
        existing &&
        existing.kills !== "" &&
        player.kills !== null &&
        existing.kills !== String(player.kills)
      )
        conflicts.push(
          `${team.team_label} · ${player.ign ?? player.name}: ${existing.kills} → ${player.kills} kills.`,
        );
      const added = {
        id: player.player_id!,
        ign: player.ign ?? player.name,
        kills:
          player.kills === null
            ? (existing?.kills ?? "")
            : String(player.kills),
      };
      const index = players.findIndex((p) => p.id === added.id);
      if (index < 0) players.push(added);
      else players[index] = added;
    }
    if (players.length > Math.max(4, current.players.length))
      errors.push(
        `${team.team_label}: merging would produce ${players.length} players. Choose “Replace match lineup” or skip extra players.`,
      );
    const placement =
      team.placement === null ? current.placement : String(team.placement);
    if (current.placement && placement !== current.placement)
      conflicts.push(
        `${team.team_label}: placement ${current.placement} → ${placement}.`,
      );
    // A sum read from player rows is never promoted to an authoritative team override.
    const teamKills =
      team.team_kills === null ? current.teamKills : String(team.team_kills);
    if (current.teamKills && teamKills !== current.teamKills)
      conflicts.push(
        `${team.team_label}: known team total ${current.teamKills} → ${teamKills}.`,
      );
    if (current.status === "absent")
      conflicts.push(
        `${team.team_label}: change attendance from absent to played.`,
      );
    next[id] = { status: "present", placement, teamKills, players };
  }
  // Importing must not silently move a player out of an untouched existing team.
  const existingPlayers = new Map<string, string>();
  for (const [id, row] of Object.entries(next))
    if (row.status === "present")
      for (const player of row.players) {
        const source = existingPlayers.get(player.id);
        if (source && source !== id)
          errors.push(
            `${player.ign} is already recorded for another team in this game. Move them to the correct team in the score sheet first.`,
          );
        else existingPlayers.set(player.id, id);
      }
  return {
    rows: next,
    conflicts,
    errors: [...new Set(errors)],
    count: applicable.length,
  };
}
export function validReview(value: unknown): value is ScreenshotImport {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<ScreenshotImport>;
  const validNumber = (n: unknown) =>
    n === null || (Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 999);
  return (
    Array.isArray(data.warnings) &&
    data.warnings.every((w) => typeof w === "string") &&
    Array.isArray(data.teams) &&
    data.teams.every(
      (t) =>
        t &&
        typeof t.team_label === "string" &&
        validNumber(t.team_number) &&
        validNumber(t.placement) &&
        validNumber(t.team_kills) &&
        Array.isArray(t.players) &&
        t.players.every(
          (p: ScreenshotPlayer) =>
            p &&
            typeof p.name === "string" &&
            validNumber(p.kills) &&
            Array.isArray(p.candidates) &&
            (p.player_id === null || typeof p.player_id === "string"),
        ),
    )
  );
}

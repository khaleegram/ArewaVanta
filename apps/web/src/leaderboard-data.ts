import { squads } from "./data";
import type { SquadId } from "./data";

export type RankingKind = "squads" | "players";
export type EventKey = "weekend-005" | "weekend-004" | "season";
export type RankingEntry = {
  id: string;
  name: string;
  squad: string;
  city: string;
  tag: string;
  mark?: SquadId;
  color: string;
  rank: number;
  kills: number;
  points: number;
  wins: number;
  appearances: number;
  best: number;
  average: number;
  games: number[];
};
export const rankingEvents: Record<
  EventKey,
  { name: string; date: string; games: number; type: string }
> = {
  "weekend-005": {
    name: "Arewa Weekender 005",
    date: "24–25 Oct 2026",
    games: 6,
    type: "Weekend scrims",
  },
  "weekend-004": {
    name: "Arewa Weekender 004",
    date: "17–18 Oct 2026",
    games: 6,
    type: "Weekend scrims",
  },
  season: {
    name: "October scrims",
    date: "17–25 Oct 2026",
    games: 12,
    type: "2 weekends combined",
  },
};
const extraTeams = [
  ["Borno Battalion", "Maiduguri", "BB"],
  ["Katsina Kings", "Katsina", "KK"],
  ["Bauchi Vanguard", "Bauchi", "BV"],
  ["Sokoto Storm", "Sokoto", "SS"],
  ["Gombe Ghosts", "Gombe", "GG"],
  ["Jigawa Titans", "Dutse", "JT"],
  ["Minna Marauders", "Minna", "MM"],
  ["Yola Raiders", "Yola", "YR"],
  ["Kebbi Hunters", "Birnin Kebbi", "KH"],
  ["Kaduna Havoc", "Kaduna", "KH"],
  ["Zamfara Force", "Gusau", "ZF"],
  ["Plateau Phoenix", "Jos", "PP"],
  ["Damaturu Dawn", "Damaturu", "DD"],
  ["Taraba Thunder", "Jalingo", "TT"],
  ["Nasarawa Knights", "Lafia", "NK"],
  ["Ilorin Outlaws", "Ilorin", "IO"],
  ["Lokoja Legends", "Lokoja", "LL"],
  ["Abuja Renegades", "Abuja", "AR"],
];
const colors = ["#ef8a65", "#bed09c", "#d4bd80", "#95b9b2"];
const roster = [
  ...squads.map((s, i) => ({
    id: s.id as string,
    name: s.name,
    city: s.city,
    tag: s.tag,
    mark: s.id as SquadId | undefined,
    color: colors[i % 4],
    kills: s.kills,
    points: s.points,
    wins: s.wins,
  })),
  ...extraTeams.map(([name, city, tag], i) => ({
    id: `squad-${i + 7}`,
    name,
    city,
    tag,
    mark: undefined,
    color: colors[(i + 2) % 4],
    kills: 82 - i * 3,
    points: 105 - i * 4,
    wins: 0,
  })),
];
const playerNames = [
  ["REAPER", "DANFODIO", "KILO", "SPECTRE"],
  ["SARKI", "FANG", "NOMAD", "RAVEN"],
  ["GHOST", "ZEE", "SHADOW", "NOVA"],
  ["ACE", "RANGER", "DUNE", "BLAZE"],
  ["VIPER", "STORM", "CRUX", "RUSH"],
  ["SANDMAN", "HAWK", "BOLT", "KHAI"],
  ["BULLET", "RAY", "FROST", "NERO"],
  ["KING", "DRAKE", "LYNX", "JET"],
  ["FALCON", "ASH", "ROOK", "VOID"],
  ["TEMPEST", "FLINT", "ZEN", "REX"],
  ["PHANTOM", "NASH", "QUAKE", "ORBIT"],
  ["TITAN", "SCOUT", "ZERO", "BISHOP"],
  ["MARAUDER", "DEX", "RIOT", "ONYX"],
  ["RAIDER", "TAZ", "EMBER", "HEX"],
  ["HUNTER", "IVAR", "MACE", "FOX"],
  ["HAVOC", "VEGA", "DUSK", "RYU"],
  ["FORCE", "YAK", "PIKE", "OMEN"],
  ["PHOENIX", "SKYE", "RAZE", "AXEL"],
  ["DAWN", "MARS", "NOX", "QUILL"],
  ["THUNDER", "WOLF", "KAZ", "FUSE"],
  ["KNIGHT", "ROAN", "SAGE", "DASH"],
  ["OUTLAW", "FEZ", "KANE", "WISP"],
  ["LEGEND", "CROW", "LEO", "FLARE"],
  ["RENEGADE", "MAX", "ORION", "SOL"],
];
function spread(total: number, seed: number) {
  const values = Array.from({ length: 6 }, () => Math.floor(total / 6));
  for (let n = 0; n < total % 6; n++) values[(n + seed) % 6]++;
  const from = (seed + 1) % 6,
    to = (seed + 3) % 6;
  const moved = Math.min(values[from], Math.ceil(total / 12));
  values[from] -= moved;
  values[to] += moved;
  return values;
}
function weekend(offset: number) {
  return roster.map((s, i) => {
    const kills =
      offset === 0 ? s.kills : Math.max(8, s.kills + ((i * 13) % 25) - 17);
    const placement =
      offset === 0
        ? s.points - s.kills
        : Math.max(0, s.points - s.kills + ((i * 7) % 11) - 5);
    const first =
      offset === 0 && i < 6
        ? [84, 68, 62, 57, 52, 48][i]
        : Math.round(kills * 0.49);
    const rest = kills - first;
    const totals = [
      first,
      Math.round(rest * 0.43),
      Math.round(rest * 0.33),
      rest - Math.round(rest * 0.43) - Math.round(rest * 0.33),
    ];
    const players = totals.map((total, j) => ({
      id: `${s.id}-player-${j}`,
      name: playerNames[i][j],
      squad: s.name,
      city: s.city,
      tag: s.tag,
      mark: s.mark,
      color: s.color,
      rank: 0,
      kills: total,
      points: 0,
      wins: 0,
      appearances: 6,
      best: 0,
      average: total / 6,
      games:
        offset === 0 && i === 0 && j === 0
          ? [12, 9, 24, 16, 11, 12]
          : spread(total, i + j + offset),
    }));
    players.forEach((p) => (p.best = Math.max(...p.games)));
    const entry: RankingEntry = {
      ...s,
      squad: s.name,
      rank: 0,
      kills,
      points: kills + placement,
      wins: offset === 0 ? s.wins : i < 6 ? 1 : 0,
      appearances: 6,
      best: Math.max(...players[0].games),
      average: kills / 6,
      games: [],
    };
    return { entry, players };
  });
}
const latest = weekend(0),
  previous = weekend(1);
export function getRankings(
  kind: RankingKind,
  event: EventKey,
): RankingEntry[] {
  const unwrap = (input: ReturnType<typeof weekend>) =>
    kind === "squads"
      ? input.map((x) => x.entry)
      : input.flatMap((x) => x.players);
  let entries = unwrap(event === "weekend-004" ? previous : latest).map(
    (x) => ({ ...x }),
  );
  if (event === "season") {
    const earlier = new Map(unwrap(previous).map((x) => [x.id, x]));
    entries = entries.map((x) => {
      const old = earlier.get(x.id)!;
      return {
        ...x,
        kills: x.kills + old.kills,
        points: x.points + old.points,
        wins: x.wins + old.wins,
        appearances: 12,
        average: (x.kills + old.kills) / 12,
        best: Math.max(x.best, old.best),
        games: [...old.games, ...x.games],
      };
    });
  }
  entries.sort((a, b) =>
    kind === "squads"
      ? b.points - a.points || b.kills - a.kills || b.wins - a.wins
      : b.kills - a.kills || a.name.localeCompare(b.name),
  );
  entries.forEach((entry, i) => {
    const prior = entries[i - 1];
    const tied =
      prior &&
      (kind === "players"
        ? entry.kills === prior.kills
        : entry.points === prior.points &&
          entry.kills === prior.kills &&
          entry.wins === prior.wins);
    entry.rank = tied ? prior.rank : i + 1;
  });
  return entries;
}

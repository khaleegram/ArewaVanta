/** Public and organizer API contracts. Point values are decimal strings from the API. */
export type Id = string;
export type ApiPage<T> = {
  data: T[];
  meta: {
    current_page: number;
    last_page: number;
    total: number;
    per_page?: number;
  };
};
export type ApiData<T> = { data: T };
export type SeasonRef = { id: Id; name: string };
export type ClanRef = { name: string; tag: string | null };
export type PublicClan = {
  id: Id;
  name: string;
  slug: string;
  tag: string | null;
  bio: string | null;
  squads: { id: Id; name: string; slug: string; tag: string | null }[];
};
export type PublicSquad = {
  id: Id;
  name: string;
  slug: string;
  tag: string | null;
  clan: { id: Id; name: string; slug: string; tag: string | null };
  roster: { id: Id; ign: string }[];
};
export type PublicPlayer = { id: Id; current_ign: string };
export type ManageClan = {
  id: Id;
  name: string;
  slug: string;
  tag: string;
  squads: { id: Id; name: string; slug: string; tag: string | null }[];
};
export type ClanEditResponse = {
  id: Id;
  name: string;
  slug: string;
  tag: string;
  bio?: string | null;
};
export type ManageSquad = {
  id: Id;
  clan_id: Id;
  name: string;
  slug: string;
  tag: string | null;
};
export type ManagePlayer = {
  id: Id;
  current_ign: string;
  uid: string | null;
  uid_public: boolean;
};
export type RosterMember = {
  membership_id: Id;
  player_id: Id;
  ign: string;
  joined_at: string;
};
export type ManagePerson = {
  id: string | number;
  name: string;
  email: string;
  roles: { id: Id; role: string; scope_type: string; scope_id: string }[];
};
export type SquadRef = {
  id: Id;
  name: string;
  slug: string;
  tag: string | null;
  clan: ClanRef;
};
export type EventSummary = {
  id: Id;
  title: string;
  competition_type?: "scrim" | "league" | "tournament" | null;
  slug: string;
  timezone: string;
  season: SeasonRef | null;
  start_date: string | null;
  end_date: string | null;
  match_count: number;
  scored_match_count: number;
  squad_count?: number;
};
export type PublicMatch = {
  id: Id;
  match_index: number;
  map_code: string;
  map_label: string;
  has_results: boolean;
  is_scoring_override: boolean;
  scoring: Record<string, unknown>;
  results: PublicSquadResult[] | null;
};
export type PublicSquadResult = {
  squad_id: Id;
  squad_name: string;
  squad_slug: string | null;
  clan_name: string | null;
  participation_status: "present" | "absent";
  placement: number | null;
  team_kills: number;
  total_points: string;
};
export type PublicEvent = EventSummary & {
  description?: string | null;
  maximum_position: number;
  squad_size: number;
  default_scoring: { preset_name: string | null; mode: string | null };
  squads: SquadRef[];
  days: {
    id: Id;
    date: string;
    label: string;
    sort_order: number;
    matches: PublicMatch[];
  }[];
};
export type StandingMatch = {
  match_id: Id;
  event_date: string;
  match_index: number;
  map_label: string;
  scoring_preset: string;
  placement: number;
  team_kills: number;
  total_points: string;
};
export type SquadStanding = {
  rank: number;
  squad: SquadRef;
  matches_played: number;
  total_kills: number;
  wins: number;
  total_points: string;
  additive_placement_points: string;
  multiplier_scored_points: string;
  multiplier_matches: number;
  tie_break_position_sum: number | null;
  match_results: StandingMatch[];
};
export type Standings = {
  uses_mixed_scoring_presets: boolean;
  standings: SquadStanding[];
};
export type EventStandings = Standings & {
  event: { id: Id; title: string; slug: string };
};
export type SeasonStandings = Standings & {
  season: { id: Id; name: string; slug: string };
};
export type PlayerRanking = {
  id: Id;
  ign: string;
  appearances: number;
  total_kills: number;
  rank: number;
};
export type PlayerProfile = {
  id: Id;
  current_ign: string;
  current_squads?: {
    id: Id;
    name: string;
    slug: string;
    clan: { name: string; slug: string };
  }[];
  uid: string | null;
  appearances: number;
  total_kills: number;
  kills_per_appearance: string | null;
  best_game_kills: number | null;
  match_history: {
    ign_snapshot: string;
    kills: number;
    match_id: Id;
    match_index: number;
    map_label: string;
    event_date: string;
    event_title: string;
    event_slug: string;
    squad_id: Id;
    squad_name_snapshot: string;
  }[];
  history_meta: { current_page: number; last_page: number; total: number };
};
export type User = {
  id: Id;
  name: string;
  email: string;
  roles: {
    role: "platform_admin" | "organizer" | "clan_captain";
    scope_type: string;
    scope_id: string;
  }[];
};
export type AuthSession = { token: string; user: User };
export type CompetitionTemplate = {
  id: Id;
  name: string;
  slug: string;
  description: string | null;
  timezone: string;
  squad_size: number;
  maximum_position: number;
  is_system: boolean;
  default_scoring: {
    id: Id;
    preset_name: string;
    mode: string;
    version_number: number;
  } | null;
  days: {
    label: string;
    sort_order: number;
    games: {
      game_number: number;
      map_code: string;
      map_label: string;
      rule_version_override_id: Id | null;
      override_preset_name: string | null;
    }[];
  }[];
};
export type ManageEventSummary = {
  id: Id;
  title: string;
  slug: string;
  visibility: "public" | "private";
  season: SeasonRef | null;
  start_date: string | null;
  match_count: number;
  scored_match_count: number;
};
export type ManageEvent = {
  id: Id;
  title: string;
  description: string | null;
  competition_type: "scrim" | "league" | "tournament" | null;
  slug: string;
  visibility: "public" | "private";
  timezone: string;
  squad_size: number;
  maximum_position: number;
  season?: SeasonRef | null;
  scoring: {
    preset_name: string | null;
    version_number: number | null;
    mode: string | null;
    rules: Record<string, unknown> | null;
  };
  days?: {
    id: Id;
    date: string;
    label: string;
    sort_order: number;
    matches: {
      id: Id;
      match_index: number;
      map_code: string;
      map_label: string;
      has_results: boolean;
      is_scoring_override: boolean;
      scoring: Record<string, unknown>;
      expected_squads: {
        id: Id;
        name: string;
        tag: string | null;
        clan: string;
      }[];
    }[];
  }[];
  squads?: {
    id: Id;
    name: string;
    tag: string | null;
    clan: string;
    seed: number | null;
  }[];
};
export type ScoringPreset = {
  id: Id;
  name: string;
  slug: string;
  description: string | null;
  is_builtin: boolean;
  versions: {
    id: Id;
    version_number: number;
    mode: string;
    kill_point_value: string;
    maximum_position: number;
  }[];
};
export type ScheduleInput = {
  id: Id | null;
  date: string;
  label: string;
  games: { id: Id | null; map_code: string; map_label: string }[];
}[];
export type CreateEventInput = {
  title: string;
  description?: string | null;
  competition_type?: "scrim" | "league" | "tournament" | null;
  competition_template_id?: Id;
  season_id?: Id | null;
  scoring_rule_version_id?: Id | null;
  dates?: string[];
  squad_ids?: Id[];
  timezone?: string;
  maximum_position?: number;
  squad_size?: number;
  visibility?: "public" | "private";
};
export type MatchResultInput = {
  squad_id: Id;
  status?: "present" | "absent";
  placement?: number | null;
  players: { player_id: Id; kills: number }[];
};
export type SavedResult = {
  saved_at: string | null;
  results: {
    squad_id: Id;
    squad_name: string;
    squad_slug: string | null;
    clan_name: string | null;
    participation_status: "present" | "absent";
    placement: number | null;
    team_kills: number;
    kill_points: string | null;
    placement_points: string | null;
    placement_multiplier: string | null;
    total_points: string;
    players: { player_id: Id; ign: string; kills: number }[];
  }[];
};
export type PublicMatchResult = {
  match: {
    id: Id;
    event: { id: Id; title: string; slug: string };
    date: string;
    match_index: number;
    map_code: string;
    map_label: string;
  };
  scoring: Record<string, unknown>;
  result: SavedResult;
};
export type ResultSheet = {
  event: {
    id: Id;
    title: string;
    slug: string;
    timezone: string;
    squad_size: number;
    maximum_position: number;
  };
  match: {
    id: Id;
    date: string;
    match_index: number;
    map_label: string;
    scoring: Record<string, unknown>;
  };
  squads: {
    id: Id;
    name: string;
    tag: string | null;
    clan: string;
    eligible_players: { id: Id; ign: string }[];
  }[];
  result: SavedResult | null;
};

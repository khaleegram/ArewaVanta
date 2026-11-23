export type AssistantPlayer = {
  player_id?: string | null;
  ign: string;
  clan_tag?: string | null;
  kills: number | null;
  creates_profile?: boolean;
};

export type AssistantScore = {
  status: "present" | "absent" | "unentered";
  placement: number | null;
  team_kills: number | null;
  known_player_kills?: number;
  total_points: string;
  players: AssistantPlayer[];
};

export type AssistantProposal = {
  id: string;
  message_id: string;
  match_id: string;
  title: string;
  reason: string;
  status: "pending" | "accepted" | "rejected" | "superseded" | "undone";
  preview: {
    kind?: "csv_import" | "admin_action";
    items?: { label: string; before: string; after: string; note?: string }[];
    standings?: { scope: string; teams: number; rows: { squad_id: string; clan: string; slot: number | null; before_rank: number | null; after_rank: number; before_points: string; after_points: string; total_kills: number }[] } | null;
    evidence_ids: string[];
    games?: { match_id: string; title: string; rows: AssistantProposal["preview"]["rows"] }[];
    slot_changes?: { slot: number; before: string; after: string }[];
    affected_weeks?: { id: string; date: string }[];
    new_players?: { ign: string; clan_id: string | null }[];
    omitted_players?: { record: number; name: string; reason: string }[];
    warnings?: string[];
    team_count?: number;
    rows: {
      squad_id: string;
      clan: string;
      slot: number | null;
      source_team_number: number | null;
      before: AssistantScore;
      after: AssistantScore;
      warnings?: string[];
    }[];
  };
};

export type AssistantCsv = {
  kind: "csv";
  delimiter: string;
  headers: string[];
  rows: { record: number; values: string[]; duplicate_of?: number }[];
  row_count: number;
  duplicate_row_count: number;
  warnings: string[];
};

export type AssistantEvidence = {
  id: string;
  name: string;
  mime: string;
  csv?: AssistantCsv | null;
  observations: {
    kind: "personal_result" | "scoreboard" | "other";
    printed_datetime?: string | null;
    map?: string | null;
    team_number?: number | null;
    placement?: number | null;
    lobby_teams?: number | null;
    team_kills?: number | null;
    visible_player_kills: number;
    all_visible_kills_read: boolean;
    players?: { name: string; kills: number | null }[];
    note?: string | null;
  }[] | null;
};

export type AssistantMessage = {
  id: string;
  client_id: string | null;
  role: "user" | "assistant";
  status: "pending" | "completed" | "failed";
  content: string;
  details: {
    match_id?: string | null;
    read_evidence_ids?: string[];
    duplicate_uploads?: string[];
    ruling?: string;
    model?: string;
    findings?: {
      kind: "observed" | "inferred" | "unresolved";
      text: string;
      evidence_ids: string[];
    }[];
    warnings?: string[];
  } | null;
};

export type AssistantThread = {
  id: string;
  event_id: string;
  title: string;
  processing: boolean;
  messages: AssistantMessage[];
  evidence: AssistantEvidence[];
  proposals: AssistantProposal[];
};

export type AssistantThreadSummary = { id: string; title: string; updated_at: string };
export type AssistantMessageInput = {
  client_id: string;
  message: string;
  match_id?: string | null;
  images?: File[];
  csv_files?: File[];
  recheck_evidence_ids?: string[];
};

export type AssistantProposalEdit = {
  squad_id: string;
  placement?: number | null;
  team_kills?: number | null;
  players?: { player_id?: string | null; ign?: string | null; kills?: number | null; remove?: boolean }[];
};

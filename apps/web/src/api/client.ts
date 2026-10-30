import type {
  ApiData,
  ApiPage,
  AuthSession,
  CompetitionTemplate,
  CreateEventInput,
  EventStandings,
  EventSummary,
  Id,
  ManageEvent,
  ManageEventSummary,
  ManageClan,
  ClanEditResponse,
  ManageSquad,
  ManagePlayer,
  RosterMember,
  ManagePerson,
  MatchResultInput,
  PlayerProfile,
  PlayerRanking,
  PublicEvent,
  PublicClan,
  PublicSquad,
  PublicPlayer,
  PublicMatchResult,
  ScoringPreset,
  ScheduleInput,
  ResultSheet,
  SavedResult,
  SeasonStandings,
  User,
} from "./types";

const base = (import.meta.env.VITE_API_BASE_URL?.trim() || "/api/v1").replace(
  /\/+$/,
  "",
);
type Options = {
  token?: string;
  signal?: AbortSignal;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
};
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errors: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}
async function request<T>(path: string, options: Options = {}): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(options.query ?? {}))
    if (value !== undefined) query.set(key, String(value));
  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined)
    headers.set("Content-Type", "application/json");
  if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
  let response: Response;
  try {
    response = await fetch(`${base}${path}${query.size ? `?${query}` : ""}`, {
      method: options.method ?? "GET",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ApiError(
      0,
      "Could not reach ArewaVanta. Check your connection and try again.",
    );
  }
  const payload: unknown =
    response.status === 204
      ? undefined
      : await response.json().catch(() => undefined);
  if (!response.ok) {
    const details =
      payload && typeof payload === "object"
        ? (payload as { message?: unknown; errors?: unknown })
        : {};
    const message =
      typeof details.message === "string"
        ? details.message
        : `Request failed (${response.status}).`;
    const errors =
      details.errors && typeof details.errors === "object"
        ? (details.errors as Record<string, string[]>)
        : {};
    throw new ApiError(response.status, message, errors);
  }
  if (response.status !== 204 && payload === undefined)
    throw new ApiError(
      response.status,
      "The server returned an invalid response.",
    );
  return payload as T;
}
const key = (value: string) => encodeURIComponent(value);
export const api = {
  inviteCaptain: (token: string, clanId: string, email: string) =>
    request<{ message: string }>(
      `/manage/clans/${key(clanId)}/captain-invitations`,
      { token, method: "POST", body: { email } },
    ),
  inspectInvitation: (token: string, signal?: AbortSignal) =>
    request<
      ApiData<{ clan: string; email: string; existing_account: boolean }>
    >("/captain-invitations/inspect", {
      method: "POST",
      body: { token },
      signal,
    }),
  acceptInvitation: (
    token: string,
    name: string | undefined,
    password: string,
    password_confirmation: string | undefined,
  ) =>
    request<ApiData<{ token: string }>>("/captain-invitations/accept", {
      method: "POST",
      body: { token, name, password, password_confirmation },
    }),
  activity: (token: string, signal?: AbortSignal) =>
    request<
      ApiData<{
        items: {
          id: number;
          message: string;
          read_at: string | null;
          created_at: string;
        }[];
        unread: number;
        push_public_key: string | null;
      }>
    >("/manage/activity", { token, signal }),
  markActivityRead: (token: string) =>
    request<void>("/manage/activity/read", { token, method: "POST" }),
  subscribePush: (token: string, body: unknown) =>
    request<{ message: string }>("/manage/push-subscriptions", {
      token,
      method: "POST",
      body,
    }),
  unsubscribePush: (token: string, endpoint: string) =>
    request<void>("/manage/push-subscriptions", {
      token,
      method: "DELETE",
      body: { endpoint },
    }),
  addNewRosterPlayer: (
    token: string,
    squadId: string,
    current_ign: string,
    uid: string | null,
  ) =>
    request<ApiData<RosterMember>>(`/manage/squads/${key(squadId)}/roster`, {
      token,
      method: "POST",
      body: { current_ign, uid },
    }),
  managePeople: (token: string, page = 1, search = "", signal?: AbortSignal) =>
    request<ApiPage<ManagePerson>>("/manage/people", {
      token,
      signal,
      query: { page, search },
    }),
  assignCaptain: (token: string, userId: string | number, clanId: string) =>
    request<ApiData<{ id: Id }>>(
      `/manage/people/${key(String(userId))}/roles`,
      {
        token,
        method: "POST",
        body: { role: "clan_captain", scope_type: "clan", scope_id: clanId },
      },
    ),
  revokeCaptain: (token: string, userId: string | number, roleId: string) =>
    request<void>(
      `/manage/people/${key(String(userId))}/roles/${key(roleId)}`,
      { token, method: "DELETE" },
    ),
  manageClans: (token: string, page = 1, signal?: AbortSignal) =>
    request<ApiPage<ManageClan>>("/manage/clans", {
      token,
      query: { page },
      signal,
    }),
  createClan: (
    token: string,
    body: { name: string; tag: string; bio: string | null },
  ) =>
    request<ApiData<ClanEditResponse>>("/manage/clans", {
      method: "POST",
      token,
      body,
    }),
  updateClan: (
    token: string,
    id: string,
    body: { name: string; tag: string; bio: string | null },
  ) =>
    request<ApiData<ClanEditResponse>>(`/manage/clans/${key(id)}`, {
      method: "PATCH",
      token,
      body,
    }),
  createSquad: (
    token: string,
    clanId: string,
    body: { name: string; tag: string | null },
  ) =>
    request<ApiData<ManageSquad>>(`/manage/clans/${key(clanId)}/squads`, {
      method: "POST",
      token,
      body,
    }),
  updateSquad: (
    token: string,
    id: string,
    body: { name: string; tag: string | null },
  ) =>
    request<ApiData<ManageSquad>>(`/manage/squads/${key(id)}`, {
      method: "PATCH",
      token,
      body,
    }),
  roster: (token: string, squadId: string, signal?: AbortSignal) =>
    request<ApiData<RosterMember[]>>(`/manage/squads/${key(squadId)}/roster`, {
      token,
      signal,
    }),
  addRosterPlayer: (token: string, squadId: string, playerId: string) =>
    request<ApiData<Omit<RosterMember, "joined_at">>>(
      `/manage/squads/${key(squadId)}/roster`,
      {
        method: "POST",
        token,
        body: { player_id: playerId },
      },
    ),
  removeRosterPlayer: (token: string, squadId: string, playerId: string) =>
    request<void>(`/manage/squads/${key(squadId)}/roster/${key(playerId)}`, {
      method: "DELETE",
      token,
    }),
  managePlayer: (token: string, id: string) =>
    request<ApiData<ManagePlayer>>(`/manage/players/${key(id)}`, { token }),
  createPlayer: (token: string, body: Omit<ManagePlayer, "id">) =>
    request<ApiData<ManagePlayer>>("/manage/players", {
      method: "POST",
      token,
      body,
    }),
  updatePlayer: (token: string, id: string, body: Omit<ManagePlayer, "id">) =>
    request<ApiData<ManagePlayer>>(`/manage/players/${key(id)}`, {
      method: "PATCH",
      token,
      body,
    }),
  clans: (page = 1, search = "", signal?: AbortSignal) =>
    request<ApiPage<PublicClan>>("/clans", { query: { page, search }, signal }),
  clan: (slug: string, signal?: AbortSignal) =>
    request<ApiData<PublicClan>>(`/clans/${key(slug)}`, { signal }),
  squad: (slug: string, signal?: AbortSignal) =>
    request<ApiData<PublicSquad>>(`/squads/${key(slug)}`, { signal }),
  players: (page = 1, search = "", signal?: AbortSignal) =>
    request<ApiPage<PublicPlayer>>("/players", {
      query: { page, search },
      signal,
    }),
  events: (page = 1, signal?: AbortSignal) =>
    request<ApiPage<EventSummary>>("/events", {
      query: { page, per_page: 50 },
      signal,
    }),
  event: (slug: string, signal?: AbortSignal) =>
    request<ApiData<PublicEvent>>(`/events/${key(slug)}`, { signal }),
  matchResults: (id: string, signal?: AbortSignal) =>
    request<ApiData<PublicMatchResult>>(`/matches/${key(id)}/results`, {
      signal,
    }),
  eventStandings: (slug: string, signal?: AbortSignal) =>
    request<ApiData<EventStandings>>(`/events/${key(slug)}/standings`, {
      signal,
    }),
  seasonStandings: (id: Id, signal?: AbortSignal) =>
    request<ApiData<SeasonStandings>>(`/seasons/${key(id)}/standings`, {
      signal,
    }),
  playerRankings: (page = 1, signal?: AbortSignal) =>
    request<ApiPage<PlayerRanking>>("/rankings/players", {
      query: { page },
      signal,
    }),
  player: (id: Id, page = 1, signal?: AbortSignal) =>
    request<ApiData<PlayerProfile>>(`/players/${key(id)}`, {
      query: { page },
      signal,
    }),
  login: (email: string, password: string, signal?: AbortSignal) =>
    request<ApiData<AuthSession>>("/auth/login", {
      method: "POST",
      body: { email, password, device_name: "arewavanta-web" },
      signal,
    }),
  me: (token: string, signal?: AbortSignal) =>
    request<ApiData<User>>("/auth/me", { token, signal }),
  logout: (token: string, signal?: AbortSignal) =>
    request<void>("/auth/logout", { method: "POST", token, signal }),
  manageEvents: (token: string, page = 1, signal?: AbortSignal) =>
    request<ApiPage<ManageEventSummary>>("/manage/events", {
      token,
      query: { page },
      signal,
    }),
  manageEvent: (token: string, id: Id, signal?: AbortSignal) =>
    request<ApiData<ManageEvent>>(`/manage/events/${key(id)}`, {
      token,
      signal,
    }),
  scoringPresets: (token: string, signal?: AbortSignal) =>
    request<ApiData<ScoringPreset[]>>("/manage/scoring-presets", {
      token,
      signal,
    }),
  publicScoringPresets: (signal?: AbortSignal) =>
    request<ApiData<ScoringPreset[]>>("/scoring-presets", { signal }),
  updateEvent: (
    token: string,
    id: Id,
    body: Partial<CreateEventInput>,
    signal?: AbortSignal,
  ) =>
    request<ApiData<ManageEvent>>(`/manage/events/${key(id)}`, {
      method: "PATCH",
      token,
      body,
      signal,
    }),
  updateSchedule: (
    token: string,
    id: Id,
    days: ScheduleInput,
    signal?: AbortSignal,
  ) =>
    request<ApiData<ManageEvent>>(`/manage/events/${key(id)}/schedule`, {
      method: "PUT",
      token,
      body: { days },
      signal,
    }),
  templates: (token: string, signal?: AbortSignal) =>
    request<ApiData<CompetitionTemplate[]>>("/manage/competition-templates", {
      token,
      signal,
    }),
  createEvent: (token: string, body: CreateEventInput, signal?: AbortSignal) =>
    request<ApiData<ManageEvent>>("/manage/events", {
      method: "POST",
      token,
      body,
      signal,
    }),
  setEventSquads: (
    token: string,
    id: Id,
    squadIds: Id[],
    signal?: AbortSignal,
  ) =>
    request<ApiData<ManageEvent>>(`/manage/events/${key(id)}/squads`, {
      method: "PUT",
      token,
      body: { squad_ids: squadIds },
      signal,
    }),
  resultSheet: (token: string, matchId: Id, signal?: AbortSignal) =>
    request<ApiData<ResultSheet>>(
      `/manage/matches/${key(matchId)}/result-sheet`,
      { token, signal },
    ),
  saveResults: (
    token: string,
    matchId: Id,
    results: MatchResultInput[],
    signal?: AbortSignal,
  ) =>
    request<ApiData<SavedResult>>(`/manage/matches/${key(matchId)}/results`, {
      method: "PUT",
      token,
      body: { results },
      signal,
    }),
};

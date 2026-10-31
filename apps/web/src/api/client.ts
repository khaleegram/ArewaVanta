import type {
  ApiData,
  ApiPage,
  AuthSession,
  CaptainSquadSubmissions,
  CompetitionTemplate,
  CreateEventInput,
  EventStandings,
  EventSubmissionReview,
  EventSummary,
  Id,
  ManageEvent,
  RecurrenceAction,
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
  SquadHistoryEntry,
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
function fallbackMessage(status: number) {
  if (status === 401) return "Please sign in again to continue.";
  if (status === 403) return "You don’t have permission to do that.";
  if (status === 404) return "That item could not be found. It may have been removed.";
  if (status === 409)
    return "This changed while you were working. Reload and try again.";
  if (status === 422) return "Please check the form and try again.";
  if (status === 429)
    return "Too many attempts. Please wait a moment and try again.";
  if (status >= 500)
    return "ArewaVanta is having trouble right now. Please try again.";
  return "We couldn’t complete that request. Please try again.";
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
        : fallbackMessage(response.status);
    const errors =
      details.errors && typeof details.errors === "object"
        ? (details.errors as Record<string, string[]>)
        : {};
    throw new ApiError(response.status, message, errors);
  }
  if (response.status !== 204 && payload === undefined)
    throw new ApiError(
      response.status,
      "Something went wrong. Please refresh and try again.",
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
    body: { tag?: string | null },
  ) =>
    request<ApiData<ManageSquad>>(`/manage/clans/${key(clanId)}/squads`, {
      method: "POST",
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
  squadEventSubmissions: (token: string, squadId: string, signal?: AbortSignal) =>
    request<ApiData<CaptainSquadSubmissions>>(
      `/manage/squads/${key(squadId)}/event-submissions`,
      { token, signal },
    ),
  submitSquadForEvent: (token: string, squadId: string, eventId: string) =>
    request<ApiData<{ id: Id; event_id: Id; squad_id: Id; status: string }>>(
      `/manage/squads/${key(squadId)}/event-submissions`,
      { token, method: "POST", body: { event_id: eventId } },
    ),
  withdrawSquadSubmission: (token: string, squadId: string, submissionId: string) =>
    request<void>(
      `/manage/squads/${key(squadId)}/event-submissions/${key(submissionId)}`,
      { token, method: "DELETE" },
    ),
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
  squadHistory: (slug: string, signal?: AbortSignal) =>
    request<ApiData<SquadHistoryEntry[]>>(`/squads/${key(slug)}/history`, { signal }),
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
  sendPasswordResetLink: (email: string, signal?: AbortSignal) =>
    request<{ message: string }>("/auth/forgot-password", {
      method: "POST",
      body: { email },
      signal,
    }),
  resetPassword: (
    email: string,
    token: string,
    password: string,
    password_confirmation: string,
    signal?: AbortSignal,
  ) =>
    request<{ message: string }>("/auth/reset-password", {
      method: "POST",
      body: { email, token, password, password_confirmation },
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
  updateRecurrence: (token: string, eventId: Id, action: RecurrenceAction, reason?: string) =>
    request<ApiData<ManageEvent>>(`/manage/events/${key(eventId)}/recurrence`, {
      token, method: "PATCH", body: { action, ...(reason ? { reason } : {}) },
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
  eventSubmissions: (token: string, eventId: Id, signal?: AbortSignal) =>
    request<ApiData<EventSubmissionReview>>(
      `/manage/events/${key(eventId)}/submissions`,
      { token, signal },
    ),
  decideEventSubmission: (
    token: string,
    eventId: Id,
    submissionId: Id,
    decision: "select" | "not_selected" | "pending",
    slotNumber?: number,
  ) =>
    request<ApiData<{ id: Id; event_id: Id; squad_id: Id; status: string; slot_number: number | null }>>(
      `/manage/events/${key(eventId)}/submissions/${key(submissionId)}`,
      { token, method: "PATCH", body: { decision, ...(slotNumber === undefined ? {} : { slot_number: slotNumber }) } },
    ),
  resultSheet: (token: string, matchId: Id, signal?: AbortSignal) =>
    request<ApiData<ResultSheet>>(
      `/manage/matches/${key(matchId)}/result-sheet`,
      { token, signal },
    ),
  saveResults: (
    token: string,
    matchId: Id,
    results: MatchResultInput[],
    expectedLockVersion: number | null,
    expectedScoringVersionId: Id | null,
    signal?: AbortSignal,
  ) =>
    request<ApiData<SavedResult>>(`/manage/matches/${key(matchId)}/results`, {
      method: "PUT",
      token,
      body: { results, expected_lock_version: expectedLockVersion, expected_scoring_version_id: expectedScoringVersionId },
      signal,
    }),
};

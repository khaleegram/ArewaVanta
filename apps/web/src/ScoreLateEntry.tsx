import { useEffect, useState } from "react";
import { api, ApiError } from "./api/client";
import type { ManageClan, ResultSheet } from "./api/types";
import { matchesPlayerSearch } from "./playerSearch";

export function ScoreLateEntry({
  token,
  sheet,
  busy,
  initialSlot,
  onAdd,
  onClose,
}: {
  token: string;
  sheet: ResultSheet;
  busy: boolean;
  initialSlot?: number | null;
  onAdd: (body: {
    squad_id?: string;
    clan_id?: string;
    slot_number: number;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const [clans, setClans] = useState<ManageClan[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [clanId, setClanId] = useState("");
  const [squadId, setSquadId] = useState("");
  const [slot, setSlot] = useState(() =>
    initialSlot != null
      ? String(initialSlot)
      : String(
          Array.from({ length: 25 }, (_, i) => i + 1).find(
            (n) =>
              !(sheet.event_slots ?? sheet.squads).some(
                (s) => s.slot_number === n,
              ),
          ) ?? "",
        ),
  );
  const clan = clans.find((c) => c.id === clanId);
  const filtered = clans.filter((c) =>
    matchesPlayerSearch(`${c.name} ${c.tag}`, query),
  );
  useEffect(() => {
    const c = new AbortController();
    setLoading(true);
    setLoadError("");
    (async () => {
      const first = await api.manageClans(token, 1, c.signal);
      const all = [...first.data];
      for (let page = 2; page <= first.meta.last_page; page++)
        all.push(...(await api.manageClans(token, page, c.signal)).data);
      if (!c.signal.aborted) setClans(all);
    })()
      .catch((e) => {
        if (!c.signal.aborted)
          setLoadError(
            e instanceof ApiError ? e.message : "Could not load clans.",
          );
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [token, retry]);
  return (
    <section className="score-late-entry" aria-labelledby="late-entry-title">
      <header>
        <div>
          <h2 id="late-entry-title">Add a late squad</h2>
          <p>Add to this game without changing its saved results.</p>
        </div>
        <button
          type="button"
          disabled={busy}
          aria-label="Close late squad panel"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <fieldset disabled={busy || loading}>
        <label>
          Find clan
          <input
            type="search"
            value={query}
            placeholder="Clan name or tag"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="score-late-fields">
          <label>
            Clan
            <select
              value={clanId}
              onChange={(e) => {
                setClanId(e.target.value);
                setSquadId("");
              }}
            >
              <option value="">Choose clan</option>
              {filtered.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.tag} · {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Squad
            <select
              disabled={!clan}
              value={squadId}
              onChange={(e) => {
                const id = e.target.value;
                setSquadId(id);
                const entry =
                  sheet.event_slots?.find((s) => s.squad_id === id) ??
                  sheet.squads.find((s) => s.id === id);
                if (entry?.slot_number) setSlot(String(entry.slot_number));
              }}
            >
              <option value="">Choose squad</option>
              {clan?.squads.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {sheet.squads.some((entry) => entry.id === s.id)
                    ? " · Already in game"
                    : ""}
                </option>
              ))}
              <option value="new">＋ Create next squad</option>
            </select>
          </label>
          <label>
            Game slot
            <input
              type="text"
              inputMode="numeric"
              value={slot}
              placeholder="1–25"
              onChange={(e) => setSlot(e.target.value)}
            />
          </label>
        </div>
        <div className="score-late-actions">
          <a href="/manage/directory" target="_blank" rel="noreferrer">
            Register a new clan ↗
          </a>
          <button
            type="button"
            className="score-primary"
            disabled={!clanId || !squadId}
            onClick={async () => {
              if (!/^\d+$/.test(slot) || +slot < 1 || +slot > 25) {
                setError("Choose a game slot from 1 to 25.");
                return;
              }
              setError("");
              try {
                await onAdd({
                  ...(squadId === "new"
                    ? { clan_id: clanId }
                    : { squad_id: squadId }),
                  slot_number: +slot,
                });
              } catch (e) {
                setError(
                  e instanceof ApiError
                    ? Object.values(e.errors).flat().join(" ") || e.message
                    : "Could not add the squad. Try again.",
                );
              }
            }}
          >
            {busy ? "Adding…" : "Add to this game"}
          </button>
        </div>
      </fieldset>
      {loading && <p role="status">Loading clans…</p>}
      {loadError && (
        <p className="score-error" role="alert">
          {loadError}{" "}
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            Retry
          </button>
        </p>
      )}
      {error && (
        <p className="score-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

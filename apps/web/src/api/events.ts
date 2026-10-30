import { api } from "./client";
import type { EventSummary } from "./types";

/** Read all public event pages in small batches without hiding older competitions. */
export async function allPublicEvents(
  signal?: AbortSignal,
): Promise<EventSummary[]> {
  const first = await api.events(1, signal);
  const pages = [first.data];
  for (let page = 2; page <= first.meta.last_page; page += 4) {
    const batch = Array.from(
      { length: Math.min(4, first.meta.last_page - page + 1) },
      (_, offset) => api.events(page + offset, signal),
    );
    pages.push(...(await Promise.all(batch)).map((result) => result.data));
  }
  return [...new Map(pages.flat().map((event) => [event.id, event])).values()];
}

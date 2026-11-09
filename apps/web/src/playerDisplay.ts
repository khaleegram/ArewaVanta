const TAG_END = /[|·・･•∙⋅:;\/\\\-–—_~]$/u;

/**
 * Players are stored without their clan tag. Show the tag as a prefix in every
 * human-facing player name so the handle stays recognisable.
 */
export function playerHandle(name: string, tag?: string | null): string {
  const player = name.trim();
  const clanTag = tag?.trim();
  if (!clanTag || !player) return player;
  const lowerPlayer = player.toLocaleLowerCase();
  const lowerTag = clanTag.toLocaleLowerCase();
  if (lowerPlayer.startsWith(lowerTag)) {
    const rest = player.slice(clanTag.length);
    const separated = !rest || /^[\s\p{P}\p{S}]/u.test(rest);
    // A stored name may still contain a decorated or non-Latin tag without a
    // separator (for example "A4ャABBA"). Rewrite that once instead of adding
    // the tag a second time. Plain short tags such as "NE" keep the boundary
    // check so a name like "Nero" is still prefixed.
    if (separated) return player;
    if (/[^\x00-\x7F]/u.test(clanTag) || /[^\p{L}\p{N}]/u.test(clanTag))
      return `${clanTag}${TAG_END.test(clanTag) ? "" : "・"}${rest}`;
  }
  return `${clanTag}${TAG_END.test(clanTag) ? "" : "・"}${player}`;
}

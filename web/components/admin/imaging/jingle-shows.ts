// What a jingle's show list reads as in the admin (#1875). Pure, so the wording
// and the "deleted show" case are tested without rendering anything.

export interface ShowRef { id?: string; name?: string }

/** "all shows", or the show names; an id no longer on the roster is named as such. */
export function jingleShowsLabel(showIds: readonly string[] | undefined, shows: readonly ShowRef[]): string {
  if (!showIds?.length) return 'all shows';
  return showIds
    .map(id => shows.find(s => s.id === id)?.name || '(deleted show)')
    .join(', ');
}

/** How many jingles are tied to at least one show. */
export function tiedJingleCount(jingles: readonly { showIds?: readonly string[] }[]): number {
  return jingles.filter(j => (j.showIds?.length ?? 0) > 0).length;
}

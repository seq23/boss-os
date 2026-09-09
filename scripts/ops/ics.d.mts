/**
 * Types for `ics.mjs`. Named `.d.mts` because that is what TypeScript looks for beside a `.mjs`.
 *
 * HAND-WRITTEN AND TINY, RATHER THAN A SECOND COPY OF THE PARSER IN TYPESCRIPT. The parser has to be
 * plain JavaScript because a `.mjs` ops script imports it at runtime and Node does not strip types;
 * the tests want it typed. A declaration file gives the second without duplicating the first, and
 * two copies of a parser is the drift this repository names by name.
 */
export interface IcsEvent {
  calendar_uid: string;
  title: string;
  scheduled_at: number;
  duration_min: number | null;
  location: string | null;
}

export function parseIcs(
  text: string,
  now?: number,
  horizonDays?: number,
): { events: IcsEvent[]; unexpanded: number };

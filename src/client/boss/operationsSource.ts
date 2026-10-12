/*
 * THE MAP IS THE SOURCE (owner, 12 Oct 2026). docs/OUTBOUND_EMAIL_MAP.md and its one owners file
 * are compiled into the app at build, so Team → Duties can never disagree with the doc: change the
 * doc and the next deploy shows it; there is no second copy to forget.
 */
import mapMd from "../../../docs/OUTBOUND_EMAIL_MAP.md?raw";
import owners from "../../../docs/outbound_email_owners.json";
import {
  dutiesDueToday, mergeOperations, parseOutboundMap, synopsis,
  type OperationsLedgers, type OwnersFile,
} from "@shared/boss/operations";

export const MAP_ROWS = parseOutboundMap(mapMd);
export const OWNERS = owners as OwnersFile;

export function buildOperations(roster: any, ledgers: OperationsLedgers | null, now = Date.now()) {
  const people: any[] = roster?.roster ?? [];
  const merged = mergeOperations({
    mapRows: MAP_ROWS,
    owners: OWNERS,
    rosterNames: people.map((e) => e.name),
    ledgers,
    now,
  });
  const duties = people.flatMap((e) => e.duties ?? []);
  return { ...merged, synopsis: synopsis({ rows: merged.rows, unassigned: merged.unassigned, dutiesToday: dutiesDueToday(duties, now), ledgers }) };
}

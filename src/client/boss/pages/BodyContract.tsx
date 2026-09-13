/**
 * THE BODY CONTRACT, WITH ITS KINDS TOLD APART.
 *
 * ─── The defect, in her words ──────────────────────────────────────────────
 *
 *   "reformat the today contract section. i need to make sure i can delineate between movment and
 *    etc..."
 *
 * `agenda.pillars.body` is a flat bag of ten fields, and Today rendered them as one undifferentiated
 * run: the movement floor, five launch movements, five somatic lanes, hydration, medication, the
 * food rule and the safety stop, all in the same weight, in the same column, with nothing saying
 * which was which. So MEDICATION — non-negotiable and time-boxed — read as another suggestion, and
 * the SAFETY STOP — the line that says when to stop — read as a sixth exercise.
 *
 * They are not the same kind of instruction, and this file's whole job is that they no longer look
 * like it. FOUR KINDS, each with its own label and its own rail colour:
 *
 *   MOVEMENT — what to do with the body, and the floor it must clear.
 *   INTAKE   — water and food, which are targets rather than sequences.
 *   MEDICAL  — the medicine, in the first hour, and the limits on what any of this claims.
 *   STOP     — the one condition under which the right answer is to stop.
 *
 * NOTHING HERE IS NEW CONTENT. Every string still comes from `buildBodyContract`; this changes only
 * how they are grouped and weighted. Density is the enemy on the screen she reads before she is
 * properly awake — so there are no counts, no streaks, no progress bars, and no completion state.
 */

import { useState, type ReactNode } from "react";
import { api } from "../api";

/** The four kinds. A field belongs to exactly one. */
export type BodyKind = "movement" | "intake" | "medical" | "stop";

/**
 * EVERY FIELD OF THE BODY CONTRACT, CLASSIFIED.
 *
 * This registry is the reason a field added to `BodyContract` next year cannot silently vanish from
 * her morning. `scripts/validate/the-body-contract-shows-its-kinds.mjs` reads the interface in
 * `src/worker/boss/today/body.ts` and THIS OBJECT, and fails the build when they disagree — so the
 * cost of adding a field is one line here, and the cost of forgetting is a red build rather than a
 * missing instruction nobody notices.
 */
export const BODY_FIELD_GROUPS: Record<string, BodyKind> = {
  movement_floor: "movement",
  launch_sequence: "movement",
  minimum_viable: "movement",
  somatic: "movement",
  bed_only: "movement",
  hydration: "intake",
  food_rule: "intake",
  medication: "medical",
  language_rule: "medical",
  safety_stop: "stop",
};

/** The label at the head of each kind, and the order they are read in. */
export const BODY_KIND_LABELS: { kind: BodyKind; label: string }[] = [
  { kind: "movement", label: "Movement" },
  { kind: "intake", label: "Water and food" },
  { kind: "medical", label: "Medicine" },
  { kind: "stop", label: "Stop if" },
];

export interface SomaticLane {
  lane: string;
  title: string;
  movement: string;
  because: string;
  /** When she marked the rotation done today, or null. The only record of DOING in this system. */
  done_at?: number | null;
}

export interface BodyPayload {
  launch_sequence?: string[];
  somatic?: SomaticLane[];
  hydration?: string;
  medication?: string;
  food_rule?: string;
  movement_floor?: string;
  minimum_viable?: string[];
  safety_stop?: string;
  language_rule?: string;
  bed_only?: boolean;
}

/**
 * IS THE FALLBACK THE SAME LIST AS THE LAUNCH SEQUENCE? ON HER CONTRACT, YES — DELIBERATELY.
 *
 * `buildBodyContract` sets `minimum_viable: STORED_MORNING_SEQUENCE`, the same array it sets
 * `launch_sequence` to, and that looked like a copy-paste accident. It is not. §6.9's stored
 * sequence is five bed-based movements — leg raises, knee-to-chest pulls, torso twists, shoulder
 * rolls, breathing — and §6.8 requires the minimum-viable fallback to be completable WITHOUT
 * GETTING OUT OF BED. The launch sequence already satisfies that, so on the worst day there is
 * nothing to cut: the fallback IS the sequence.
 *
 * That is a fact worth one line and worth reading. Printing the same five movements twice under two
 * headings is not — it reads as a bug and it doubles the length of the thing she reads first.
 *
 * So the relationship is DERIVED rather than assumed: should the two ever diverge, the fallback
 * prints as its own list. The screen tells the truth either way.
 */
export function minimumViableIsTheLaunchSequence(body: BodyPayload): boolean {
  const launch = body.launch_sequence ?? [];
  const fallback = body.minimum_viable ?? [];
  if (launch.length === 0 || fallback.length === 0) return false;
  return launch.length === fallback.length && launch.every((m, i) => m === fallback[i]);
}

/**
 * THE ONE REASON, SAID ONCE.
 *
 * The novelty engine attaches a `because` to each of the five somatic lanes, and on a fresh
 * `movement_log` all five read "Not done before." That is a REAL SIGNAL — nothing has been recorded
 * yet — but five identical reasons stacked down the screen look like a rendering bug, and she has
 * to read all five to discover they are the same. When every lane agrees it is one fact about the
 * log, printed once beneath the rotation; when they differ, each lane keeps its own.
 */
export function sharedBecause(somatic: SomaticLane[]): string | null {
  if (somatic.length < 2) return null;
  const first = somatic[0]?.because ?? "";
  if (first === "") return null;
  return somatic.every((s) => s.because === first) ? first : null;
}

function Group({ kind, label, children }: { kind: BodyKind; label: string; children: ReactNode }) {
  return (
    <section className={`bodygroup bodygroup-${kind}`}>
      <p className="bodygroup-label">{label}</p>
      {children}
    </section>
  );
}

export function BodyContractView({ body, onChanged }: { body: BodyPayload; onChanged?: () => void }) {
  const somatic = body.somatic ?? [];
  const shared = sharedBecause(somatic);
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const doneToday = somatic.some((s) => Boolean(s.done_at));

  /*
   * ── THE CONTROL THAT MAKES EVERY REASON LINE TRUE ─────────────────────────
   *
   * Every line under these lanes said "Not done before." — five times — because `movement_log`
   * recorded which movement was OFFERED and nothing anywhere recorded her doing one. The sentence
   * was a claim the database could not support.
   *
   * ONE MARK FOR THE ROTATION, NOT FIVE. Five ticks at 7am is five chances to decide this screen is
   * work. IT UNDOES, because a mis-tap that cannot be taken back teaches her not to touch it.
   *
   * NO COUNT, NO STREAK, NO PROGRESS BAR. The standing rule against guilt binds here as it does on
   * the contribution practice; an unmarked day stays UNKNOWN rather than failed.
   */
  const mark = async (next: boolean) => {
    setMarking(true);
    setMarkError(null);
    try {
      await api.markRotationDone(next);
      onChanged?.();
    } catch (e: any) {
      setMarkError(e?.message ?? "That could not be recorded.");
    } finally {
      setMarking(false);
    }
  };
  const fallbackIsLaunch = minimumViableIsTheLaunchSequence(body);
  const label = (kind: BodyKind) => BODY_KIND_LABELS.find((k) => k.kind === kind)?.label ?? kind;

  return (
    <div className="bodycontract">
      <Group kind="movement" label={label("movement")}>
        {body.movement_floor && <p className="bodygroup-floor">{body.movement_floor}</p>}
        {body.bed_only && <p className="bodygroup-note">A bed-only day. Nothing below asks you to stand up.</p>}

        <ol className="bodyseq">
          {(body.launch_sequence ?? []).map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ol>

        {fallbackIsLaunch ? (
          <p className="bodygroup-note">
            That list is also the minimum viable version — all five are doable in bed, so on a hard day
            there is nothing to cut.
          </p>
        ) : (
          (body.minimum_viable ?? []).length > 0 && (
            <>
              <p className="bodygroup-note">If today is a hard day, this is the whole of it:</p>
              <ol className="bodyseq">
                {(body.minimum_viable ?? []).map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ol>
            </>
          )
        )}

        {somatic.length > 0 && (
          <>
            <p className="bodygroup-note">Then today's somatic rotation, one per lane:</p>
            <ul className="bodylanes">
              {somatic.map((sm) => (
                <li key={sm.lane}>
                  <span className="bodylane-move">{sm.movement}</span>
                  <span className="bodylane-why">
                    {sm.title}
                    {shared ? "" : ` · ${sm.because}`}
                  </span>
                </li>
              ))}
            </ul>
            {/*
              * ONE FACT, SAID ONCE. When every lane agrees, it is a statement about the RECORD
              * rather than five statements about five movements — and now that the record can tell
              * "done" from "offered" apart, the lines differentiate themselves as soon as there is
              * anything to differentiate.
              */}
            {shared && <p className="bodygroup-note">{shared} — the same for all five.</p>}
            {somatic.length > 0 && (
              <>
                <button
                  className="btn btn-small"
                  disabled={marking}
                  onClick={() => void mark(!doneToday)}
                >
                  {doneToday ? "Done today — undo" : "Mark the rotation done"}
                </button>
                {markError && <p className="bodygroup-note">{markError}</p>}
              </>
            )}
          </>
        )}
      </Group>

      {(body.hydration || body.food_rule) && (
        <Group kind="intake" label={label("intake")}>
          <dl className="bodyfacts">
            {body.hydration && (
              <>
                <dt>Water</dt>
                <dd>{body.hydration}</dd>
              </>
            )}
            {body.food_rule && (
              <>
                <dt>Food</dt>
                <dd>{body.food_rule}</dd>
              </>
            )}
          </dl>
        </Group>
      )}

      {(body.medication || body.language_rule) && (
        <Group kind="medical" label={label("medical")}>
          {body.medication && <p className="bodygroup-firm">{body.medication}</p>}
          {body.language_rule && <p className="bodygroup-fine">{body.language_rule}</p>}
        </Group>
      )}

      {body.safety_stop && (
        <Group kind="stop" label={label("stop")}>
          <p className="bodygroup-stopline">{body.safety_stop}</p>
        </Group>
      )}
    </div>
  );
}

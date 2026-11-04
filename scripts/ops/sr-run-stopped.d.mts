export const SR_RUN_TITLE: string;
export function repairTask(code: string, sentence: string): {
  title: string; lane: string; employee_id: string;
  input: { origin: "repair"; repair_kind: "failed_task"; prompt: string };
};
export const WAITING_STOPS: readonly string[];
export function waitingNote(code: string, sentence: string, cleared?: boolean): {
  repo: string; stop: string; owner: string; business: string; title: string;
  finish_line: string; next_step: string; cleared?: boolean;
};
export function reportStop(api: { post(path: string, body: unknown): Promise<unknown> }, code: string, sentence: string, cleared?: boolean): Promise<"NOTE" | "REPAIR">;

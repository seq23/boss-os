export const SR_RUN_TITLE: string;
export function repairTask(code: string, sentence: string): {
  title: string; lane: string; employee_id: string;
  input: { origin: "repair"; repair_kind: "failed_task"; prompt: string };
};

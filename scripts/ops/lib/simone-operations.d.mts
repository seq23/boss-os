type Evidence = { state: string; evidence: string };
type CheckInputs = {
  schedule: { rows: { id: string; name: string; what: string; slots?: string[]; trigger: { duty?: string; launchd?: string[]; repo?: string; file?: string; crons?: string[] } }[];
    workerJobs?: Record<string, { owner: string; kind: string; source?: { count: string }; handled?: { count: string } }> };
  scorecard: { rows: { id: string; initiative: string; result: string; jobs: string[]; real: { label: string } }[]; exempt: object };
  senders: { rows: { id: string; sender: string; what: string }[] };
  sites: { rows: { id: string; name: string; url: string; status: string }[] };
  inputs: {
    agents: { id: string; name: string; role: string; paused?: boolean }[];
    duties: { id: string; name: string; employeeId: string; scheduled: boolean; paused?: boolean }[];
    mailboxes: { id: string; name: string; handler: string }[];
    workerEvidence?: { day: string; duties: Record<string, { source: number; handled: number }> | null };
  };
  launchd: { configured: Set<string>; loaded: Set<string> | null; disabled: Set<string> | null };
  files: { repo: string; files: { file: string; crons: string[]; dispatch?: string[] }[]; active: Set<string> | null }[];
  readSite: (site: CheckInputs["sites"]["rows"][number]) => Promise<Evidence>;
  readOutreach: () => Promise<Evidence>;
  readScore: (row: CheckInputs["scorecard"]["rows"][number]) => Promise<Evidence>;
  day: string;
  senderDrift?: string[];
  deployed?: Map<string, Set<string>>;
};
export function checkOperations(inputs: CheckInputs): Promise<{
  rows: (Evidence & { kind: string; id: string; name: string; aim: string; coverage: string })[];
  issues: string[];
  proposal: string | null;
}>;
export function outreachReceipt(status: unknown, search: (query: string) => Promise<{ id: string }[]>): Promise<Evidence>;

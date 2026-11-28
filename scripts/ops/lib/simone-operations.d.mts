type Evidence = { state: string; evidence: string };
type CheckInputs = {
  schedule: { rows: { id: string; name: string; what: string; slots?: string[]; trigger: { duty?: string; launchd?: string[]; repo?: string; file?: string; crons?: string[] } }[];
    workerJobs?: Record<string, { owner: string; kind: string; source?: { count: string }; handled?: { count: string } }> };
  scorecard: { rows: { id: string; initiative: string; result: string; jobs: string[]; real: { label: string } }[]; exempt: object };
  senders: { rows: { id: string; sender: string; what: string; from?: string; runs?: string }[] };
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
  readSender?: (row: CheckInputs["senders"]["rows"][number]) => Promise<Evidence>;
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
type SentRow = { id: string; message_id?: string | null; from_addr?: string | null; layout?: string | null; sent_at: number };
export function receiptFor(row: Partial<SentRow>, o?: { mailbox?: ((id: string) => Promise<unknown>) | null; resend?: ((row: Partial<SentRow>) => Promise<unknown>) | null; now?: number }): Promise<string>;
export function rowAddresses(row: { runs?: string; from?: string }): string[];
export function readArrivals(o: { arrivals: { sent: SentRow[]; mornings: { day: string; built_at: number; keys: string[]; mail: SentRow | null }[] } | undefined;
  feed: { replies: unknown[] } | null; mailbox?: ((id: string) => Promise<unknown>) | null; resend?: ((row: Partial<SentRow>) => Promise<unknown>) | null; now?: number }): Promise<{ forSender: (row: { runs?: string; from?: string }) => Evidence; replies: Evidence }>;
export function personalSearch(env: Record<string, string | undefined>, fetchImpl?: typeof fetch): Promise<(id: string) => Promise<boolean>>;
export function resendEvent(row: Partial<SentRow>, env?: Record<string, string | undefined>, fetchImpl?: typeof fetch): Promise<string | null>;

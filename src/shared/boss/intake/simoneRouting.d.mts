export type SimoneAssignment = {
  employee: string;
  words: string;
  delivery?: "ordinary" | "research_page" | "repository" | "chrome";
  start?: { at: string; words: string };
  hunt?: { asset: string; size: string; side: "buy" | "sell" };
  follows?: string;
};
export interface RoutingCall {
  receivedAt?: string;
  roster: { id: string; name: string; role: string; department?: string | null }[];
  message: {
    body: string; context?: string; to?: string;
    thread_jobs?: Array<{ id: string; employee: string; title: string; status: string }>;
  };
}
export const SIMONE_ROUTING: { name: string; schema: { type: string; additionalProperties: boolean; properties: Record<string, unknown>; required: string[] } };
export const routingInstructions: string;
export function routingRequest(call: RoutingCall): string;
export function readAssignments(value: unknown, call: RoutingCall): SimoneAssignment[] | null;

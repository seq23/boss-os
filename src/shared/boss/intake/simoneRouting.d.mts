export type SimoneAssignment = { employee: string; words: string };
export interface RoutingCall {
  roster: { id: string; name: string; role: string; department?: string | null }[];
  message: { body: string; context?: string; to?: string };
}
export const SIMONE_ROUTING: { name: string; schema: Record<string, unknown> };
export const routingInstructions: string;
export function routingRequest(call: RoutingCall): string;
export function readAssignments(value: unknown, call: RoutingCall): SimoneAssignment[] | null;

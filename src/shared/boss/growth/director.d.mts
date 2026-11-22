import type { RosterEntry } from "./roster.mjs";
export const MAX_CARDS: number;
export const MAX_QUEUE_PER_BUSINESS: number;
export const STATES: readonly string[];
export interface Decision { decision: string; evidence: string[]; test: { channel: string; format: string; what: string; number: string; stop: string } | null; queue: { channel: string; format: string; draft: string; why: string }[]; proposals: { what: string; why: string; evidence: string; costs_money?: boolean }[]; next_check: string | null }
export function numbersFor(summary: any): string;
export function decisionPrompt(a: { playbook: string; entry: RosterEntry; summary: any; trends: string[]; today: string; todos: string[]; first?: boolean }): { role: string; content: string }[];
export function parseDecision(text: string | null | undefined): Decision | null;
export function enforceHolds(decision: Decision, summary: any): { decision: Decision; dropped: string | null };
export function claimsPrompt(a: { entry: { label: string }; rules: { id: string; text: string }[]; draft: string }): { role: string; content: string }[];
export function parseClaims(text: string | null | undefined): { pass: boolean; broken: string[]; why: string } | null;
export function ruleText(riskMd: string, id: string): string | null;
export function routeItem(roster: RosterEntry[], business: string, item: { channel: string; format: string }): { to: "claims" | "card" | "refused"; stop?: string; why?: string };
export function routeProposal(roster: RosterEntry[], business: string, p: { what: string; costs_money?: boolean }): { to: "card" | "refused"; stop?: string; why?: string };
export function cycleEnd(results: { key: string; state: string }[]): { ok: boolean; stop?: string; line: string };

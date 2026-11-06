export interface PartiesAsk { company: string; side: "buy" | "sell" }
export interface PartiesRow { company: string; side: string; size_text?: string | null; price_text?: string | null; from_text?: string | null; received_on: string; parties?: string | null }
export function partiesAskIn(text: string): PartiesAsk | null;
export function companyMatches(rowCompany: string, asked: string): boolean;
export function rowsForCompany<T extends PartiesRow>(rows: T[], company: string): T[];
export function partiesReply(ask: PartiesAsk, rows: PartiesRow[], now?: number): string;

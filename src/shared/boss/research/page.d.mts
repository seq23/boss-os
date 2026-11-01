/** Types for Camille's research page. See page.mjs. */
export const RESEARCH_PAGE_DELIVERS: "research_page";
export const RESEARCH_PAGE_SEAT: string;
export const RESEARCH_PAGE_BACKEND: string;
export const RESEARCH_PAGE_DIR: string;
export const RESEARCH_PAGE_REQUESTED: Readonly<{ repo_path: string; allowed_paths: readonly string[]; web_tools: readonly string[]; max_seconds: number }>;
export const RESEARCH_PAGE_ROUTE: string;
export const BOSS_ORIGIN: string;
export function parseResearchPage(parts: unknown): { question: string } | null;
export function researchPageUrl(id: string): string;
export function composeResearchPrompt(args: { id: string; question: string }): string;
export function markdownToHtml(md: string): string;
export type ResearchPage = {
  title: string; summary: string; markdown: string;
  sources: { title: string; url: string }[]; gaps: string[]; status: "complete" | "partial";
};
export function readResearchDelivery(payload: unknown): { ok: true; page: ResearchPage } | { ok: false; why: string };
export function renderResearchPageHtml(args: {
  title: string; summary?: string; markdown: string; sources?: { title: string; url: string }[];
  gaps?: string[]; question?: string; delivered_at?: number | null;
}): string;

export function actionNotTaken(payload: unknown): string | null;

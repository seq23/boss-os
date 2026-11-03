/** Types for boss-mail-tail-report.mjs. See that file. */
export function tailLine(report: string, subject: string): { line: string; incomplete: boolean };
export function cleanSubjects(subject: string | null | undefined): string | null;

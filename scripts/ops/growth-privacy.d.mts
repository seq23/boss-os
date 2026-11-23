export interface PrivacyRow { business: string; chars: number; private: number; mail: number; where: string[] }
export function checkPrompts(mds: Record<string, string | null>, opts?: { playbook?: string; today?: string }): { ok: boolean; exit: 0 | 1 | 2; stop: string | null; rows: PrivacyRow[]; prompts: number; terms: number };

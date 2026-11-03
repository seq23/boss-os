export declare const WORKER: "worker";
export declare const BRAIN: "brain";
export type AiRole = "worker" | "brain";
export declare const CODEX_LIMIT_EXIT: 75;
export declare const CODEX_LIMIT_WAITS: boolean;
export declare const AI_ROLES: Readonly<Record<string, { role: AiRole; why: string }>>;
export declare function roleFor(key: string): AiRole;

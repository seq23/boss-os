export type AlarmRead = { state: "absent" | "open" | "closed" | "not read"; reason?: string; at?: number; text?: string; seen?: number; why?: string };
export type DeployRead = { state: "live" | "not live" | "not read"; prod?: string; fix?: string | null; why?: string; at?: number };
export function alarmState(alarms: Array<Record<string, unknown>> | null | undefined, key: string): AlarmRead;
export function deployState(fixSha: string | null | undefined, prodSha: string | null | undefined, compareStatus: string | null | undefined): DeployRead;
export function stopWords(key: string, minutes: number, deploy: DeployRead, alarm: AlarmRead): string;

export function watchMinutes(value?: number | string): number;

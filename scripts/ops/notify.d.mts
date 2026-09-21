export interface EmployeeSender { from: string; key: string | undefined; reply_to: string; tag: string | null }
export function sendersFor(who: string | null | undefined): EmployeeSender[];
export function employeeMail(sender: EmployeeSender, msg: { to: string | string[]; subject: string; text: string; html?: string }): { from: string; to: string[]; reply_to: string; subject: string; text: string; html?: string };
export const EMPLOYEE_LOCAL_PARTS: string[];

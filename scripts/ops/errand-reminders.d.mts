export function ancestralReminder(api: any, send?: (sender: any, payload: any) => Promise<any>, senders?: (who: string) => any[]): Promise<{ line: string; sent: boolean; failed?: string }>;

export const STASH_FAILED: string;
export function handle(event: any, o?: { stash?: string; append?: (path: string, data: string) => void }): { output: any };

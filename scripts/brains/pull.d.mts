export function header(at?: Date): string;
export function fileFor(brain: { body_md: string }, at?: Date): string;
export function pull(opts?: { out?: string; passcode?: string; fetchImpl?: typeof fetch; origin?: string; now?: Date }): Promise<string[]>;

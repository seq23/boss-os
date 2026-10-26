/** Types for Simone's meeting-prep runner (meeting-prep.mjs). */
export declare const HER_ADDRESSES: string[];
export declare function dealRowsOf(grid: any): Array<{ company: string; side: string; size: string | null; price: string | null; from_email: string | null; hers: boolean }>;
export declare function prepEmail(event: any, data: any, opts?: any): { key: string; subject: string; who: string; sections: any[]; happened: string; laid: { subject: string; text: string; html: string } };

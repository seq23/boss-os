export interface GalleryArtifact { title: string; url: string; updated: string; source: string }
export const GALLERY_EXPORT_PATH: string;
export const OPEN_LOOPS_MIRROR: string;
export const ARTIFACT_URL_RE: RegExp;
export function gallerySources(home?: string): string[];
export function titleBeside(line: string, url: string): string | null;
export function collectArtifacts(files: string[], read?: (p: string) => string, mtime?: (p: string) => Date): GalleryArtifact[];
export function writeGalleryExport(opts?: { print?: boolean; home?: string; now?: Date }): { ok: boolean; count: number; why?: string; export?: unknown };

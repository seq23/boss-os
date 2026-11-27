export function chiefSignoff(pr: {
  head: string;
  branch: string;
  messages: string[];
  paths: string[];
  ownerText: string[];
}): string | null;

/** The one pure piece of the credential prober, exported so a Node test can hold it to its wording. */
export interface CredentialProbe {
  id: string;
  state: "live" | "dead" | "unknown";
  detail: string;
}

export declare function connectorStartFailure(error: { code?: string } | undefined | null): CredentialProbe;
export declare function feedState(text: unknown): { state: "live" | "dead"; detail: string };
/** The read-only grant on her personal Gmail: OK / MISSING / REJECTED / UNKNOWN, never an address. */
export declare function probePersonalGrant(opts?: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch }): Promise<CredentialProbe>;

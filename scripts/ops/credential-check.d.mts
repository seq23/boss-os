/** The one pure piece of the credential prober, exported so a Node test can hold it to its wording. */
export interface CredentialProbe {
  id: string;
  state: "live" | "dead" | "unknown";
  detail: string;
}

export declare function connectorStartFailure(error: { code?: string } | undefined | null): CredentialProbe;

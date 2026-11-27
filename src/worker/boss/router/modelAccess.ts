/** A backend recorded as non-training must ask its vendor to honor that setting. */
export function isPrivateModelRoute(dataUse: string | null | undefined): boolean {
  return dataUse === "NO_TRAINING_CONTRACTUAL";
}

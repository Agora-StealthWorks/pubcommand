/** True only for the local viewport check. Never set this in a deployed environment. */
export function viewportCheckEnabled(): boolean {
  return process.env["VIEWPORT_CHECK"] === "1";
}

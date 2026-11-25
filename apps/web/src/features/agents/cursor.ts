/**
 * Cursor (the AI code editor; it runs Grok, Claude, GPT and other models) connects to
 * PubCommand's MCP server like any MCP client. These build its one-click install link
 * (cursor.com/docs/mcp/install-links) and its mcp.json entry.
 */

/** Opens Cursor with PubCommand added as an MCP server; Cursor then asks the person to sign in. No key in the link. */
export function cursorInstallLink(name: string, mcpUrl: string): string {
  const config = Buffer.from(JSON.stringify({ url: mcpUrl }), "utf8").toString("base64");
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(name)}&config=${encodeURIComponent(config)}`;
}

/** The mcp.json entry (~/.cursor/mcp.json or .cursor/mcp.json). With a key: header auth; without: Cursor signs in with OAuth. */
export function cursorMcpJson(name: string, mcpUrl: string, key?: string): string {
  const server: Record<string, unknown> = { url: mcpUrl };
  if (key) server.headers = { Authorization: `Bearer ${key}` };
  return JSON.stringify({ mcpServers: { [name]: server } }, null, 2);
}

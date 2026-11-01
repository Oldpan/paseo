// Codex lists MCP tools under their server (mcp__paseo__bigbang_send) and newer versions defer
// them behind tool search, so a model told about "bigbang-send" may run it in a shell or decide
// it has no such tool. Every prompt that names the bigbang tools carries this note.
export const BIGBANG_TOOLS_NOTE =
  'The bigbang-* tools are MCP tools on the "paseo" server (some clients show them as mcp__paseo__bigbang_send and so on), not shell commands. If one is not in your tool list, search your tools for "bigbang" first.';

import { AgentState } from "@/src/agentState";

/**
 *
 * @param state
 * @param summary
 * @returns A promise that resolves to the formatted context string.
 */
export async function formatContext(
  state: AgentState,
  summary: string,
): Promise<string> {
  const tabInfo = await state.getTabInfo();
  return `
# 現在の状況
- 現在アクティブなタブのURL: ${state.getActivePage().url()}
- 開いているタブ一覧:
\`\`\`json
${JSON.stringify(tabInfo, null, 2)}
\`\`\`
- ページ内容の要約 (先頭2000文字):
\`\`\`
${summary}
\`\`\`
`;
}

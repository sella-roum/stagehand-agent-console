import { AgentState } from "@/src/agentState";

/**
 * エージェントの次の思考のために、現在の状況をフォーマットして文字列として提供します。
 * 長期記憶、ワーキングメモリ、直近の履歴を組み合わせて、簡潔かつ効果的なコンテキストを生成します。
 * @param state - 現在のエージェントの状態。
 * @param summary - 現在のページのコンテンツ要約。
 * @returns LLMに渡すためのフォーマットされたコンテキスト文字列。
 */
export async function formatContext(
  state: AgentState,
  summary: string,
): Promise<string> {
  const tabInfo = await state.getTabInfo();
  const longTermMemory = state.getLongTermMemory();
  const workingMemory = state.getWorkingMemory();
  const recentHistory = state.getHistory().slice(-3); // 直近3件の履歴に絞る

  const longTermMemorySection =
    longTermMemory.length > 0
      ? `
# 長期記憶 (タスク全体で記憶している重要事実)
${longTermMemory.map((fact) => `- ${fact}`).join("\n")}
`
      : "";

  const workingMemorySection =
    workingMemory.length > 0
      ? `
# ワーキングメモリ (現在のサブゴールに関する短期的な記憶・要約)
${workingMemory.map((fact) => `- ${fact}`).join("\n")}
`
      : "";

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
${longTermMemorySection}
${workingMemorySection}
# 直近の実行履歴 (最大3件)
\`\`\`json
${JSON.stringify(
  recentHistory.map((r) => ({
    toolName: r.toolCall.toolName,
    args: r.toolCall.args,
    result: r.result
      ? String(r.result).substring(0, 200) +
        (String(r.result).length > 200 ? "..." : "")
      : "N/A",
    error: r.error,
  })),
  null,
  2,
)}
\`\`\`
`;
}

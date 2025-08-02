import { AgentState } from "../agentState.js";

/**
 *
 * @param state
 * @returns The formatted history string.
 */
export function formatHistory(state: AgentState): string {
  const history = state.getHistory();
  const lastRecord = history[history.length - 1];
  let observationContext = "";
  if (
    lastRecord &&
    lastRecord.observationResult &&
    lastRecord.observationResult.length > 0
  ) {
    observationContext = `
# 直前のobserveコマンドの結果
- 以下の要素が見つかりました。この情報を利用して次のステップを計画してください。
\`\`\`json
${JSON.stringify(lastRecord.observationResult.slice(0, 5), null, 2)}
\`\`\`
`;
  }

  return `
- これまでのステップの実行履歴:
\`\`\`json
${JSON.stringify(state.getHistory(), null, 2)}
\`\`\`
${observationContext}
`;
}

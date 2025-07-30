import { AgentState } from "../agentState.js";

export function formatHistory(state: AgentState): string {
  return `
- これまでのステップの実行履歴:
\`\`\`json
${JSON.stringify(state.getHistory(), null, 2)}
\`\`\`
`;
}

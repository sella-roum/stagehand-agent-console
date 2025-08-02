import { AgentState } from "../agentState.js";
import { PlanStep, ReflectionResult } from "../types.js";

/**
 *
 * @param task
 * @param error
 * @param lastStep
 * @param state
 * @param summary
 * @returns The generated prompt string for reflection.
 */
export function getReflectionPrompt(
  task: string,
  error: Error,
  lastStep: PlanStep,
  state: AgentState,
  summary: string,
): string {
  return `
あなたはブラウザ操作のデバッグを行うエキスパートです。
直前のステップで以下のエラーが発生しました。原因を分析し、タスクを達成するための代替案を提案してください。

# 最終目標
${task}

# エラー情報
- エラーメッセージ: "${error.message}"
- 実行しようとしたコマンド: ${lastStep.command}
- 引数: ${lastStep.argument}

# エラー発生時の状況
- URL: ${state.getActivePage().url()}
- ページ要約:
\`\`\`
${summary}
\`\`\`

# あなたのタスク
1. このエラーの最も可能性の高い原因を分析してください。
2. この問題を回避し、最終目標を達成するための代替アプローチを具体的に3つ提案してください。
3. **重要:** もしエラーメッセージに 'Timeout', 'not found', 'no element' といった文言が含まれている場合、それは探している要素が画面外に存在する可能性があります。代替案として、ページを下にスクロールするステップ（例: \`act:'ページを一番下までスクロールする'\`）を必ず含めてください。

# 出力形式
必ず以下のJSONスキーマに従ってください。
{
  "cause_analysis": "（エラー原因の分析）",
  "alternative_approaches": [
    "（代替案1）",
    "（代替案2）",
    "（代替案3）"
  ]
}
`;
}

/**
 *
 * @param reflection
 * @returns The formatted reflection string.
 */
export function formatReflection(reflection: ReflectionResult): string {
  return `
# 直前の情報: 直前のステップでエラーが発生したため、AIによる自己反省を行いました。これを考慮して計画を修正してください。
- AIによる原因分析: ${reflection.cause_analysis}
- AIによる代替案: ${reflection.alternative_approaches.join(" / ")}
`;
}

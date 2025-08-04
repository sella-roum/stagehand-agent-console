import { AgentState } from "@/src/agentState";
import { ReflectionResult } from "@/src/types";

/**
 * エラー発生時に自己修復のための反省を促すプロンプトを生成します。
 * @param task - ユーザーが与えた最終目標。
 * @param error - 発生したエラーオブジェクト。
 * @param lastStepArgs - 失敗したステップの引数。
 * @param state - エラー発生時のエージェントの状態。
 * @param summary - エラー発生時のページ内容の要約。
 * @returns LLMに渡すためのプロンプト文字列。
 */
export function getReflectionPrompt(
  task: string,
  error: Error,
  lastStepArgs: any,
  state: AgentState,
  summary: string,
): string {
  // エラーオブジェクトを構造化されたJSON文字列に変換
  // これにより、カスタムエラーのプロパティ（toolName, argsなど）もLLMに渡される
  const errorContext = JSON.stringify(
    // エラーオブジェクトが持つ追加プロパティを展開し、nameとmessageも含む
    // JSON.stringifyはenumerableなプロパティのみをシリアライズするため、
    // Errorオブジェクトのnameやmessageは直接展開されない場合がある。
    { ...error, name: error.name, message: error.message },
    null,
    2,
  );

  return `
あなたはブラウザ操作のデバッグを行うエキスパートAIです。
直前のステップでエラーが発生しました。原因を深く分析し、タスクを達成するための代替案を提案してください。

# 最終目標
${task}

# エラー情報 (構造化データ)
\`\`\`json
${errorContext}
\`\`\`

# エラー発生時の状況
- URL: ${state.getActivePage().url()}
- ページ要約:
\`\`\`
${summary}
\`\`\`

# あなたのタスク
1.  上記の「エラー情報 (構造化データ)」を注意深く分析してください。特に \`name\` (エラーの種類) と \`message\`、そしてツール固有のプロパティ（例: \`instruction\`, \`url\`）に着目し、エラーの根本原因を特定してください。
2.  この問題を回避し、最終目標を達成するための、具体的で異なるアプローチを3つ提案してください。
3.  **重要:** エラー名が \`ElementNotFoundError\` やメッセージに 'Timeout' が含まれる場合、探している要素が画面外にあるか、まだ読み込まれていない可能性が高いです。代替案には、ページをスクロールするステップや、少し待機するステップを必ず含めてください。

# 出力形式
必ず以下のJSONスキーマに従ってください。
{
  "cause_analysis": "（エラー原因の分析）",
  "alternative_approaches": [
    "（代替案1: 具体的なツール呼び出しの形で記述）",
    "（代替案2: 具体的なツール呼び出しの形で記述）",
    "（代替案3: 具体的なツール呼び出しの形で記述）"
  ]
}
`;
}

/**
 * LLMによる反省結果を、後続のプロンプトで利用しやすい形式にフォーマットします。
 * @param reflection - LLMから返された反省結果オブジェクト。
 * @returns フォーマットされた文字列。
 */
export function formatReflection(reflection: ReflectionResult): string {
  return `
# 直前の情報: 直前のステップでエラーが発生したため、AIによる自己反省を行いました。これを考慮して計画を修正してください。
- AIによる原因分析: ${reflection.cause_analysis}
- AIによる代替案: ${reflection.alternative_approaches.join(" / ")}
`;
}

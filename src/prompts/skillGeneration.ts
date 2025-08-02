import { z } from "zod";

export const skillGenerationSchema = z.object({
  should_generate_skill: z.boolean().describe("一連の操作が、既存のスキルでは達成できない新しい汎用的なスキルとして抽象化する価値がある場合はtrue。"),
  skill_name: z.string().nullable().describe("キャメルケースのスキル名。例: 'loginToGitHub'"),
  skill_description: z.string().nullable().describe("このスキルが何をするかの簡潔な説明。"),
  skill_code: z.string().nullable().describe("引数を受け取れるTypeScriptの非同期関数としてのスキルコード。`state: AgentState`を第一引数に、`args`オブジェクトを第二引数に取ること。"),
  reasoning: z.string().describe("スキルを生成すべきかどうかの判断理由。既存スキルで代用できる場合は、そのスキル名を挙げて説明すること。"),
});

export function getSkillGenerationPrompt(history: string, existingSkills: { name: string; description: string }[]): string {
  const existingSkillsText = existingSkills.length > 0
    ? `
# 既存のスキル一覧
以下は現在利用可能なスキルです。新しいスキルを生成する前に、これらのスキルで目的を達成できないか必ず確認してください。
${existingSkills.map(s => `- ${s.name}: ${s.description}`).join('\n')}
`
    : "# 既存のスキル一覧\n現在、利用可能なスキルはありません。";

  return `
あなたは、AIエージェントの行動履歴を分析し、再利用可能なスキルを抽出する専門家です。

# あなたの役割
以下の行動履歴を分析し、これが一つのまとまった、再利用可能な「スキル」として抽象化できるかを判断してください。
例えば、「特定のウェブサイトへのログイン」「特定の形式のデータを検索して抽出する」といった一連の操作は、良いスキルの候補です。

${existingSkillsText}

# 行動履歴
\`\`\`json
${history}
\`\`\`

# あなたのタスク
1.  まず、上記の行動履歴が達成しようとしている目的を分析してください。
2.  次に、その目的が上記の「既存のスキル一覧」のいずれかで達成可能かどうかを厳密に判断してください。
3.  もし既存のスキルで達成可能、または意味的に重複している場合は、\`should_generate_skill\`を\`false\`にし、利用すべき既存のスキル名を\`reasoning\`に記述してください。
4.  既存のスキルでは達成不可能な、全く新しい汎用的な操作である場合にのみ、\`should_generate_skill\`を\`true\`にし、新しいスキルを生成してください。
5.  スキルを生成する場合、以下の要件を満たしてください:
    -   **skill_name:** \`loginToGitHub\` のような、処理内容がわかるキャメルケースの関数名。
    -   **skill_description:** このスキルが何をするかの簡潔な説明。
    -   **skill_code:**
        -   TypeScriptの非同期関数（async function）であること。
        -   第一引数として \`state: AgentState\` を、第二引数として必要なパラメータを持つオブジェクト \`args\` を受け取ること。
        -   内部では \`state.getActivePage().act()\` などのツールを呼び出すこと。
        -   成功メッセージを返すこと。

# 出力形式
必ず指定されたJSON形式で出力してください。
`;
}

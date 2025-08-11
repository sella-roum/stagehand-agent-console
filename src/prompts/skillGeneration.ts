import { z } from "zod";

export const skillGenerationSchema = z.object({
  should_generate_skill: z
    .boolean()
    .describe(
      "一連の操作が、既存のスキルでは達成できない新しい汎用的なスキルとして抽象化する価値がある場合はtrue。",
    ),
  skill_name: z
    .string()
    .nullable()
    .describe("キャメルケースのスキル名。例: 'loginToGitHub'"),
  skill_description: z
    .string()
    .nullable()
    .describe("このスキルが何をするかの簡潔な説明。"),
  skill_code: z
    .string()
    .nullable()
    .describe(
      "引数を受け取れるTypeScriptの非同期関数としてのスキルコード。`export async function execute(state: AgentState, args: any, llm: LanguageModel, initialTask: string): Promise<string>` のシグネチャに厳密に従うこと。",
    ),
  reasoning: z
    .string()
    .describe(
      "スキルを生成すべきかどうかの判断理由。既存スキルで代用できる場合は、そのスキル名を挙げて説明すること。",
    ),
});

/**
 *
 * @param history
 * @param existingSkills
 * @returns The generated prompt string for skill generation.
 */
export function getSkillGenerationPrompt(
  history: string,
  existingSkills: { name: string; description: string }[],
): string {
  const existingSkillsText =
    existingSkills.length > 0
      ? `
# 既存のスキル一覧
以下は現在利用可能なスキルです。新しいスキルを生成する前に、これらのスキルで目的を達成できないか必ず確認してください。
${existingSkills.map((s) => `- ${s.name}: ${s.description}`).join("\n")}
`
      : "# 既存のスキル一覧\n現在、利用可能なスキルはありません。";

  return `
あなたは、AIエージェントの行動履歴を分析し、再利用可能なスキルを抽出する専門家です。

# あなたの役割
以下の行動履歴を分析し、これが一つのまとまった、再利用可能な「スキル」として抽象化できるかを判断してください。
例えば、「特定のウェブサイトへのログイン」「特定の形式のデータを検索して抽出する」といった一連の操作は、良いスキルの候補です。

${existingSkillsText}

# 行動履歴
この履歴には、あるサブゴールを達成するために実行された一連のツール呼び出しとその結果が含まれます。
\`subgoalDescription\`と\`successCriteria\`フィールドは、この履歴が目指していた目標を示します。
\`\`\`json
${history}
\`\`\`

# あなたのタスク
1.  まず、上記の行動履歴が達成しようとしている目的（\`subgoalDescription\`）を分析してください。
2.  次に、その目的が上記の「既存のスキル一覧」のいずれかで達成可能かどうかを厳密に判断してください。
3.  もし既存のスキルで達成可能、または意味的に重複している場合は、\`should_generate_skill\`を\`false\`にし、利用すべき既存のスキル名を\`reasoning\`に記述してください。
4.  既存のスキルでは達成不可能な、全く新しい汎用的な操作である場合にのみ、\`should_generate_skill\`を\`true\`にし、新しいスキルを生成してください。
5.  スキルを生成する場合、以下の要件を満たしてください:
    -   **skill_name:** \`loginToGitHub\` のような、処理内容がわかるキャメルケースの関数名。
    -   **skill_description:** このスキルが何をするかの簡潔な説明。
    -   **skill_code:** 以下の「スキルコードの厳格な要件」に完全に従ってコードを生成してください。

# スキルコードの厳格な要件
-   **構造:** すべてのロジックは \`export async function execute(state: AgentState, args: any, llm: LanguageModel, initialTask: string): Promise<string>\` の中に直接記述してください。**内部で別の関数を定義してはいけません。**
-   **API使用法:**
    -   ブラウザ操作には \`state.getActivePage().act("指示")\` または \`state.getActivePage().act({ action: "指示" })\` を使用します。
    -   情報抽出には \`state.getActivePage().extract("指示")\` または \`state.getActivePage().extract({ instruction: "指示" })\` を使用します。
    -   \`llm\` と \`initialTask\` は未使用であっても関数シグネチャに必ず含めてください。高度な判断が必要な場合にのみ参照し、基本的なブラウザ操作では \`state\` と \`args\` を主に使用します。
-   **引数:** スキルが必要とする外部からの入力（例：ユーザー名、URL）は、\`args\` オブジェクトから取得してください (例: \`args.username\`)。
-   **戻り値:** 必ず操作の成功を示す文字列を \`return\` してください。抽出したデータを返すこともできます。

# スキルコードの良い例（この形式に厳密に従ってください）
\`\`\`typescript
export async function execute(
  state: AgentState,
  args: any,
  llm: LanguageModel,
  initialTask: string
): Promise<string> {
  const page = state.getActivePage();
  await page.goto("https://example.com/login");
  await page.act(\`'ユーザー名'の入力欄に「\${args.username}」と入力して\`);
  await page.act(\`'パスワード'の入力欄に「\${args.password}」と入力して\`);
  await page.act("'ログイン'ボタンをクリックして");
  await page.waitForURL("**/dashboard");
  return "ログインに成功しました。";
}
\`\`\`

# 出力形式
必ず指定されたJSON形式で出力してください。
`;
}

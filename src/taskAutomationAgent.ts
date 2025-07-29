/**
 * @file 高レベルなタスクを自律的に計画・実行するAIエージェント機能を提供します。
 * このバージョンは、Vercel AI SDKを利用してGoogle Gemini, Groq, OpenRouterを動的に切り替え可能です。
 */

import type { Page } from "@browserbasehq/stagehand";
import { z } from "zod";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// Vercel AI SDKのコア機能と各プロバイダをインポート
import { generateObject, LanguageModel } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai"; // OpenRouter用にOpenAIプロバイダを使用

// --- プランナーAIの出力形式をZodスキーマで厳密に定義 ---
const planStepSchema = z.object({
  step: z.number().describe("ステップ番号"),
  command: z.enum(["goto", "act", "extract", "observe", "finish"])
    .describe("実行するコマンドの種類"),
  argument: z.string().nullable().describe("コマンドに渡す引数。不要な場合はnull。"),
  reasoning: z.string().describe("このステップを実行する思考プロセス"),
  /**
   * ユーザーへの状況報告、質問、確認などを格納する。
   * AIがユーザーに伝えたいことがある場合のみ設定する。
   */
  messageToUser: z.string().nullable().optional().describe("ユーザーへのメッセージや質問。不要な場合はnull。"),
});

const planSchema = z.array(planStepSchema).describe("実行ステップの計画");

/**
 * 汎用的なプランナーAI呼び出し関数 (Google/Groq/OpenRouter対応)
 * @param prompt - モデルに渡すプロンプト文字列
 * @returns - AIによって生成され、Zodスキーマで検証された実行計画の配列
 */
async function callPlannerAI(prompt: string): Promise<z.infer<typeof planSchema>> {
  const LLM_PROVIDER = process.env.LLM_PROVIDER || 'google';
  
  let llm: LanguageModel;

  // プロバイダに応じてAIモデルのインスタンスを生成
  if (LLM_PROVIDER === 'groq') {
    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) throw new Error("GROQ_API_KEYが.envファイルに設定されていません。");
    const groq = createGroq({ apiKey: groqApiKey });
    llm = groq(process.env.GROQ_MODEL || 'compound-beta-mini');
  } else if (LLM_PROVIDER === 'openrouter') {
    const openRouterApiKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterApiKey) throw new Error("OPENROUTER_API_KEYが.envファイルに設定されていません。");
    // OpenAI互換APIとしてOpenRouterを設定
    const openrouter = createOpenAI({
      apiKey: openRouterApiKey,
      baseURL: "https://openrouter.ai/api/v1",
      headers: {
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Stagehand Agent Console',
      }
    });
    llm = openrouter(process.env.OPENROUTER_MODEL || 'anthropic/claude-3-haiku-20240307');
  } else {
    const googleApiKey = process.env.GOOGLE_API_KEY;
    if (!googleApiKey) throw new Error("GOOGLE_API_KEYが.envファイルに設定されていません。");
    const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
    llm = google(process.env.GEMINI_MODEL || 'gemini-2.5-flash');
  }

  console.log("\n🧠 AIが思考しています...");

  // Vercel AI SDKの `generateObject` を使用して構造化された計画を取得
  const { object: planJson } = await generateObject({
    model: llm,
    prompt: prompt,
    schema: planSchema,
  });

  return planJson;
}

/**
 * プランナーAIに渡すプロンプトを動的に組み立てます。
 * @param task - ユーザーが入力した最終目標
 * @param url - 現在のブラウザのURL
 * @param summary - 現在のページ内容の要約
 * @param history - これまでのステップの実行履歴
 * @param errorOrFeedback - 直前のステップで発生したエラーメッセージまたはユーザーからのフィードバック
 * @returns - AIへの指示として整形されたプロンプト文字列
 */
function buildPrompt(task: string, url: string, summary: string, history: any[], errorOrFeedback?: string): string {
    const promptTemplate = `
あなたは、Stagehandというブラウザ自動化ツールを駆使する専門家アシスタントです。あなたの役割は、ユーザーから与えられた最終目標を達成するまで、現在の状況を分析し、段階的に行動計画を立案し続けることです。

# 利用可能なコマンド
- "goto": "指定されたURLに移動する。引数はURL文字列。"
- "act": "ページ上で特定の操作を行う。引数は自然言語による指示（例: '検索ボックスに「AI」と入力'）。"
- "extract": "ページから情報を抽出する。引数は抽出したい内容の指示（例: '記事のタイトル'）。"
- "observe": "ページ上の操作可能な要素を探す。引数は探したい要素の説明（例: 'すべてのボタン'）。"
- "finish": "タスクが完了したことを示す。引数はユーザーへの最終的な回答。"

# messageToUser プロパティの利用ガイドライン
- 次のステップに進む前にユーザーに確認したいことがある場合や、質問がある場合は "messageToUser" フィールドにその内容を記述してください。
- 例えば、「どちらの'詳細'ボタンをクリックしますか？」や「ログイン情報が必要です。」といったメッセージです。
- ユーザーに伝えるべきことがない場合は、"messageToUser" フィールドは省略するか、nullにしてください。
- 致命的なエラーでタスク続行が不可能だと判断した場合は、commandを"finish"にし、"messageToUser"にその理由を記述してください。

# 現在の状況
- 現在のURL: ${url}
- ページ内容の要約 (先頭2000文字):
\`\`\`
${summary}
\`\`\`
- これまでのステップの実行履歴:
\`\`\`json
${JSON.stringify(history, null, 2)}
\`\`\`

# ユーザーの最終目標
${task}

${errorOrFeedback ? `# 直前の情報: 直前のステップで以下のエラーが発生したか、ユーザーから以下のフィードバックがありました。これを考慮して計画を修正してください。\n情報: ${errorOrFeedback}` : ''}

# 出力に関する厳格な指示
- あなたの応答は、必ず指定されたJSONスキーマに従うJSONオブジェクトの配列でなければなりません。
- **最終目標を達成するために、次に実行すべき3〜5ステップの具体的な行動計画を立案してください。**
- **もし直前の計画が成功裏に完了した場合は、現在のページ状態からタスクを続行するための次のステップを計画してください。**
- **最終目標が完全に達成されたと確信できる場合にのみ、"finish"コマンドを使用してください。まだタスクの途中である場合は、絶対に"finish"を使用しないでください。**
- JSON配列の前後に、いかなるテキスト（挨拶、説明、前置きなど）やマークダウンのコードブロック指定（\`\`\`json ... \`\`\`）も絶対に追加しないでください。
- あなたの応答は、必ず \`[\` で始まり、 \`]\` で終わる純粋なJSON配列でなければなりません。
`;
    return promptTemplate;
}


/**
 * 高レベルなタスクを受け取り、AIによる計画立案と実行を自律的に繰り返します。
 * @param task - ユーザーから与えられたタスク文字列（例: "PlaywrightのGitHubスター数を調べて"）
 * @param page - 操作対象のStagehand/PlaywrightのPageオブジェクト
 */
export async function taskAutomationAgent(task: string, page: Page) {
  let executionHistory: any[] = [];
  let loopCount = 0;
  const maxLoops = 10; // 無限ループを防止するためのカウンター
  
  let totalStepsExecuted = 0;

  console.log(`🚀 タスク開始: ${task}`);

  // 最初のページの状態を取得
  let currentSummary = '';
  try {
    const initialExtraction = await page.extract();
    if (initialExtraction?.page_text) {
      currentSummary = initialExtraction.page_text.substring(0, 2000);
    }
  } catch (e) {
    console.warn("初期ページの要約取得に失敗しました。");
  }


  let userFeedback: string | undefined = undefined;

  // 計画→実行のループ
  while (loopCount < maxLoops) {
    loopCount++;
    
    // 1. 現在の状況を基に、AIに次の行動計画を立てさせる
    const prompt = buildPrompt(task, page.url(), currentSummary, executionHistory, userFeedback);
    userFeedback = undefined; // フィードバックは一度使ったらクリア
    
    const plan = await callPlannerAI(prompt);

    if (plan.length === 0) {
        console.log("🤔 AIが次の行動を計画できませんでした。処理を終了します。");
        break;
    }

    // 複数ステップの計画を順番に実行するループ
    for (const currentStep of plan) {
      totalStepsExecuted++;

      // 2. 計画の各ステップを取り出す
      
      // ユーザーへのメッセージング処理
      if (currentStep.messageToUser) {
          console.log(`\n💬 AIからのメッセージ: ${currentStep.messageToUser}`);
          
          if (currentStep.messageToUser.includes('?')) {
              const rl = readline.createInterface({ input, output });
              const answer = await rl.question("  あなたの応答 > ");
              userFeedback = answer;
              rl.close();
              executionHistory.push({ step: currentStep, userFeedback: answer });
              // ユーザーからの応答を得たので、この計画の実行を中断し、再計画へ
              break; // forループを抜ける
          }
      }
      
      console.log(`\n[ステップ ${totalStepsExecuted}] ${currentStep.reasoning}`);
      console.log(`  コマンド: ${currentStep.command}, 引数: ${currentStep.argument || 'なし'}`);

      try {
          let result: any = "成功";
          switch (currentStep.command) {
              case "goto":
                  if (!currentStep.argument) throw new Error("gotoコマンドにはURLの引数が必要です。");
                  await page.goto(currentStep.argument);
                  break;
              case "act":
                  if (!currentStep.argument) throw new Error("actコマンドには操作内容の引数が必要です。");
                  await page.act(currentStep.argument);
                  break;
              case "extract":
                  if (currentStep.argument) {
                      result = await page.extract(currentStep.argument);
                  } else {
                      result = await page.extract();
                  }
                  console.log("  📝 抽出結果:", result);
                  break;
              case "observe":
                  if (currentStep.argument) {
                      result = await page.observe(currentStep.argument);
                  } else {
                      result = await page.observe();
                  }
                  console.log("  👀 観察結果:", result);
                  break;
              case "finish":
                  console.log(`\n🎉 タスク完了！ 最終回答: ${currentStep.argument}`);
                  return; // タスク完了のためエージェント全体を終了
          }
          console.log("  ✅ 成功");
          executionHistory.push({ step: currentStep, result });

      } catch (error: any) {
          // 3. エラーが発生した場合（自己修正）
          console.error(`  ❌ ステップ実行中にエラー: ${error.message}`);
          userFeedback = `前のステップでエラーが発生しました: ${error.message}`;
          executionHistory.push({ step: currentStep, error: error.message });
          // エラーが発生したので、この計画の実行を中断し、再計画へ
          break; // forループを抜ける
      }
    }

    // 4. 次の計画のためにページの状態を更新
    // ユーザーからのフィードバックがある場合、または計画の実行が完了した場合にページ状態を更新
    try {
        const nextExtraction = await page.extract();
        if (nextExtraction?.page_text) {
          currentSummary = nextExtraction.page_text.substring(0, 2000);
        }
    } catch(e) {
        console.warn("ページ要約の更新に失敗しました。");
        currentSummary = "ページの要約を取得できませんでした。";
    }
    
    // ネットワークの状態が安定するのを待つ
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (loopCount >= maxLoops) {
      console.warn(`⚠️ 最大試行回数（${maxLoops}回）に達したため、処理を中断しました。`);
  }
}

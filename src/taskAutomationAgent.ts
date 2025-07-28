/**
 * @file 高レベルなタスクを自律的に計画・実行するAIエージェント機能を提供します。
 */

import { GoogleGenAI } from "@google/genai";
import type { Page } from "@browserbasehq/stagehand";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "";
if (!GOOGLE_API_KEY) {
  throw new Error("GOOGLE_API_KEYが設定されていません。");
}

const GEMINI_MODEL = process.env.GEMINI_MODEL || "";
if (!GEMINI_MODEL) {
  throw new Error("GEMINI_MODELが設定されていません。");
}

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
 * Geminiモデルを呼び出して、タスクの実行計画を生成します。
 * Google AIのJSONモードを利用して、信頼性の高い構造化データを取得します。
 * @param prompt - モデルに渡すプロンプト文字列
 * @returns - AIによって生成され、Zodスキーマで検証された実行計画の配列
 * @throws {Error} APIキーが設定されていない場合や、AIからの応答が不正な場合にエラーをスローします。
 */
async function callPlannerAI(prompt: string): Promise<z.infer<typeof planSchema>> {
  const genAI = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });

  // ZodスキーマをGoogle AIが解釈できるJSONスキーマ形式に変換
  const jsonSchema = zodToJsonSchema(planSchema, "planSchema");

  console.log("\n🧠 プランナーAIに思考させています...");
  
  const result = await genAI.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      // JSONモードを有効化し、出力スキーマを厳密に指定
      responseMimeType: "application/json",
      responseJsonSchema: jsonSchema,
    },
  });

  const responseText = result.text;
  if (!responseText) {
    throw new Error("プランナーAIから空の応答が返されました。");
  }

  // AIのJSON出力をパースし、Zodスキーマで検証
  const planJson = JSON.parse(responseText);
  return planSchema.parse(planJson);
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
あなたは、Stagehandというブラウザ自動化ツールを駆使する専門家アシスタントです。ユーザーから与えられた最終目標を達成するために、具体的な行動計画をステップ・バイ・ステップで立案してください。

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

# 出力
あなたの回答は、必ず指定されたJSONスキーマに従うJSONオブジェクトの配列としてください。
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
  const maxLoops = 15; // 無限ループを防止するためのカウンター

  console.log(`🚀 タスク開始: ${task}`);

  // 最初のページの状態を取得
  let currentSummary = '';
  const initialExtraction = await page.extract();
  if (initialExtraction?.page_text) {
    currentSummary = initialExtraction.page_text.substring(0, 2000);
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

    // 2. 計画の最初のステップを取り出す
    const currentStep = plan[0];

    // ユーザーへのメッセージング処理
    if (currentStep.messageToUser) {
        console.log(`\n💬 AIからのメッセージ: ${currentStep.messageToUser}`);
        
        // メッセージが質問形式の場合、ユーザーの応答を待つ
        if (currentStep.messageToUser.includes('?')) {
            const rl = readline.createInterface({ input, output });
            const answer = await rl.question("  あなたの応答 > ");
            userFeedback = answer; // ユーザーの応答を次のプロンプトへのフィードバックとする
            rl.close();
            // ユーザーからの応答を得たので、このステップは実行せずに、新しい計画を立てるためにループの先頭に戻る
            executionHistory.push({ step: currentStep, userFeedback: answer });
            continue; 
        }
    }
    
    console.log(`\n[ステップ ${loopCount}/${maxLoops}] ${currentStep.reasoning}`);
    console.log(`  コマンド: ${currentStep.command}, 引数: ${currentStep.argument || 'なし'}`);

    try {
        let result: any = "成功";
        switch (currentStep.command) {
            case "goto":
                await page.goto(currentStep.argument!);
                break;
            case "act":
                await page.act(currentStep.argument!);
                break;
            case "extract":
                const extraction = await page.extract(currentStep.argument!);
                result = extraction;
                console.log("  📝 抽出結果:", result);
                break;
            case "observe":
                result = await page.observe(currentStep.argument!);
                console.log("  👀 観察結果:", result);
                break;
            case "finish":
                console.log(`\n🎉 タスク完了！ 最終回答: ${currentStep.argument}`);
                return; // タスク完了のため正常終了
        }
        console.log("  ✅ 成功");
        executionHistory.push({ step: currentStep, result });

    } catch (error: any) {
        // 3. エラーが発生した場合（自己修正）
        console.error(`  ❌ ステップ ${loopCount} でエラー: ${error.message}`);
        userFeedback = `前のステップでエラーが発生しました: ${error.message}`; // エラーを次の計画立案のインプットにする
        executionHistory.push({ step: currentStep, error: error.message });
    }

    // 4. 次の計画のためにページの状態を更新
    const nextExtraction = await page.extract();
    if (nextExtraction?.page_text) {
      currentSummary = nextExtraction.page_text.substring(0, 2000);
    }
    // ネットワークの状態が安定するのを待つ
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (loopCount >= maxLoops) {
      console.warn("⚠️ 最大ループ回数に達したため、処理を中断しました。");
  }
}

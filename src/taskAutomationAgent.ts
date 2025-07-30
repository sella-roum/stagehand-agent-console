/**
 * @file 高レベルなタスクを自律的に計画・実行するAIエージェント機能を提供します。
 * このバージョンは、Vercel AI SDKを利用してGoogle Gemini, Groq, OpenRouterを動的に切り替え可能です。
 * フェーズ1: 状態管理クラス、プロンプトモジュール化、自己反省ループを導入。
 * フェーズ2: マルチタブ管理、安全なファイルシステム連携機能を導入。
 */

import { Page, Stagehand } from "@browserbasehq/stagehand";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

// Vercel AI SDKのコア機能と各プロバイダをインポート
import { generateObject, LanguageModel, generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai"; // OpenRouter用にOpenAIプロバイダを使用

// --- (変更点) 型定義と状態管理クラスをインポート ---
import { AgentState } from "./agentState.js";
import { PlanStep, planStepSchema, ReflectionResult, reflectionSchema } from "./types.js";

// --- (変更点) プロンプトモジュールをインポート ---
import { getBasePrompt } from "./prompts/base.js";
import { formatContext } from "./prompts/context.js";
import { formatHistory } from "./prompts/history.js";
import { getReflectionPrompt, formatReflection } from "./prompts/reflection.js";

// --- (新規) フェーズ2で追加したモジュール ---
import { confirmAction } from "./debugConsole.js";
import { getSafePath } from "../utils.js";
import fs from "fs/promises";
import { z } from "zod";


// --- プランナーAIの出力形式をZodスキーマで厳密に定義 ---
const planSchemaArray = z.array(planStepSchema).describe("実行ステップの計画");


/**
 * 汎用的なプランナーAI呼び出し関数 (Google/Groq/OpenRouter対応)
 * @param prompt - モデルに渡すプロンプト文字列
 * @returns - AIによって生成され、Zodスキーマで検証された実行計画の配列
 */
async function callPlannerAI(prompt: string): Promise<PlanStep[]> {
  const LLM_PROVIDER = process.env.LLM_PROVIDER || 'google';
  
  let llm: LanguageModel;

  // プロバイダに応じてAIモデルのインスタンスを生成
  if (LLM_PROVIDER === 'groq') {
    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) throw new Error("GROQ_API_KEYが.envファイルに設定されていません。");
    const groq = createGroq({ apiKey: groqApiKey });
    llm = groq(process.env.GROQ_MODEL || '');
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
    llm = openrouter(process.env.OPENROUTER_MODEL || '');
  } else {
    const googleApiKey = process.env.GOOGLE_API_KEY;
    if (!googleApiKey) throw new Error("GOOGLE_API_KEYが.envファイルに設定されていません。");
    const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
    llm = google(process.env.GEMINI_MODEL || '');
  }

  console.log("\n🧠 AIが思考しています...");

  // Vercel AI SDKの `generateObject` を使用して構造化された計画を取得
  const { object: planJson } = await generateObject({
    model: llm,
    prompt: prompt,
    schema: planSchemaArray,
  });

  return planJson;
}

// --- (新規) 自己反省AI呼び出し関数 ---
async function callReflectionAI(task: string, error: Error, lastStep: PlanStep, state: AgentState, summary: string): Promise<ReflectionResult> {
    const LLM_PROVIDER = process.env.LLM_PROVIDER || 'google';
    let llm: LanguageModel;
    // ... (callPlannerAIと同様のLLMインスタンス化ロジック)
    if (LLM_PROVIDER === 'groq') {
        const groqApiKey = process.env.GROQ_API_KEY;
        if (!groqApiKey) throw new Error("GROQ_API_KEYが.envファイルに設定されていません。");
        const groq = createGroq({ apiKey: groqApiKey });
        llm = groq(process.env.GROQ_MODEL || '');
      } else if (LLM_PROVIDER === 'openrouter') {
        const openRouterApiKey = process.env.OPENROUTER_API_KEY;
        if (!openRouterApiKey) throw new Error("OPENROUTER_API_KEYが.envファイルに設定されていません。");
        const openrouter = createOpenAI({
          apiKey: openRouterApiKey,
          baseURL: "https://openrouter.ai/api/v1",
          headers: {
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'Stagehand Agent Console',
          }
        });
        llm = openrouter(process.env.OPENROUTER_MODEL || '');
      } else {
        const googleApiKey = process.env.GOOGLE_API_KEY;
        if (!googleApiKey) throw new Error("GOOGLE_API_KEYが.envファイルに設定されていません。");
        const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
        llm = google(process.env.GEMINI_MODEL || '');
      }

    console.log("\n🤔 AIがエラーについて反省しています...");
    const prompt = getReflectionPrompt(task, error, lastStep, state, summary);

    const { object: reflectionJson } = await generateObject({
        model: llm,
        prompt: prompt,
        schema: reflectionSchema,
    });

    return reflectionJson;
}


/**
 * プランナーAIに渡すプロンプトを動的に組み立てます。
 * @param task - ユーザーが入力した最終目標
 * @param state - 現在のエージェントの状態
 * @param summary - 現在のページ内容の要約
 * @param feedbackContext - 直前のステップで発生したエラーメッセージまたはユーザーからのフィードバック
 * @returns - AIへの指示として整形されたプロンプト文字列
 */
async function buildPrompt(task: string, state: AgentState, summary: string, feedbackContext?: string): Promise<string> {
    const base = getBasePrompt();
    const context = await formatContext(state, summary);
    const history = formatHistory(state);
    
    const finalPrompt = `
${base}
${context}
${history}

# ユーザーの最終目標
${task}

${feedbackContext ? `# 直前の情報\n${feedbackContext}` : ''}
`;
    return finalPrompt;
}


/**
 * 高レベルなタスクを受け取り、AIによる計画立案と実行を自律的に繰り返します。
 * @param task - ユーザーから与えられたタスク文字列（例: "PlaywrightのGitHubスター数を調べて"）
 * @param stagehand - 操作対象のStagehandインスタンス
 */
export async function taskAutomationAgent(task: string, stagehand: Stagehand) {
  const state = new AgentState(stagehand);
  let loopCount = 0;
  const maxLoops = 10; // 無限ループを防止するためのカウンター
  
  let totalStepsExecuted = 0;
  let feedbackContext: string | undefined = undefined;

  console.log(`🚀 タスク開始: ${task}`);

  // 計画→実行のループ
  while (loopCount < maxLoops) {
    loopCount++;
    
    // 1. 現在の状況を基に、AIに次の行動計画を立てさせる
    let currentSummary = '';
    try {
      const activePage = state.getActivePage();
      if (!activePage.isClosed()) {
        const initialExtraction = await activePage.extract();
        if (initialExtraction?.page_text) {
          currentSummary = initialExtraction.page_text.substring(0, 2000);
        }
      } else {
        currentSummary = "現在アクティブなタブは閉じられています。";
      }
    } catch (e) {
      console.warn("ページの要約取得に失敗しました。");
      currentSummary = "ページの要約を取得できませんでした。";
    }

    const prompt = await buildPrompt(task, state, currentSummary, feedbackContext);
    feedbackContext = undefined; // フィードバックは一度使ったらクリア
    
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
              feedbackContext = `ユーザーからのフィードバック: ${answer}`;
              rl.close();
              state.addHistory({ step: currentStep, userFeedback: answer });
              // ユーザーからの応答を得たので、この計画の実行を中断し、再計画へ
              break; // forループを抜ける
          }
      }

      console.log(`\n[ステップ ${totalStepsExecuted}] ${currentStep.reasoning}`);
      console.log(`  コマンド: ${currentStep.command}, 引数: ${currentStep.argument || 'なし'}`);
      console.log(`  🔍 期待される結果: ${currentStep.expected_outcome}`);

      try {
          let result: any = "成功";
          
          // --- ページハンドルの検証と再取得 ---
          let activePage = state.getActivePage();
          if (activePage.isClosed()) {
              console.log("  ...アクティブページが閉じられていたため、状態を更新します。");
              await state.updatePages();
              activePage = state.getActivePage();
              if (activePage.isClosed()) {
                  throw new Error("操作可能なアクティブページが見つかりません。");
              }
          }

          switch (currentStep.command) {
              case "goto":
                  if (!currentStep.argument) throw new Error("gotoコマンドにはURLの引数が必要です。");
                  await activePage.goto(currentStep.argument);
                  break;
              case "act":
                  if (!currentStep.argument) throw new Error("actコマンドには操作内容の引数が必要です。");
                  await activePage.act(currentStep.argument);
                  break;
              case "extract":
                  if (currentStep.argument) {
                      result = await activePage.extract(currentStep.argument);
                  } else {
                      result = await activePage.extract();
                  }
                  console.log("  📝 抽出結果:", result);
                  break;
              case "observe":
                  if (currentStep.argument) {
                      result = await activePage.observe(currentStep.argument);
                  } else {
                      result = await activePage.observe();
                  }
                  console.log("  👀 観察結果:", result);
                  break;
              case "new_tab":
                  if (!currentStep.argument) throw new Error("new_tabにはURLが必要です。");
                  const newPage = await activePage.context().newPage();
                  await newPage.goto(currentStep.argument);
                  await state.updatePages();
                  break;
              case "switch_tab":
                  if (!currentStep.argument) throw new Error("switch_tabにはタブのインデックスが必要です。");
                  const tabIndex = parseInt(currentStep.argument, 10);
                  const targetPage = state.getPageAtIndex(tabIndex);
                  await targetPage.bringToFront();
                  await state.updatePages();
                  break;
              case "close_tab":
                  if (!currentStep.argument) throw new Error("close_tabにはタブのインデックスが必要です。");
                  const closeTabIndex = parseInt(currentStep.argument, 10);
                  const pageToClose = state.getPageAtIndex(closeTabIndex);
                  if (pageToClose && !pageToClose.isClosed()) {
                    await pageToClose.close();
                  }
                  await state.updatePages();
                  break;
              case "write_file":
                  if (!currentStep.argument) throw new Error("write_fileにはJSON形式の引数が必要です。");
                  const { filename, content } = JSON.parse(currentStep.argument);
                  if (!filename || content === undefined) throw new Error("引数にはfilenameとcontentが必要です。");
                  
                  const writeConfirmation = await confirmAction(`🤖 AIがファイル '${filename}' への書き込みを要求しています。許可しますか？`);
                  if (!writeConfirmation) throw new Error("ユーザーがファイル書き込みを拒否しました。");

                  const writePath = getSafePath(filename);
                  await fs.writeFile(writePath, content);
                  result = `ファイル '${filename}' に正常に書き込みました。`;
                  break;
              case "read_file":
                  if (!currentStep.argument) throw new Error("read_fileにはファイル名の引数が必要です。");

                  const readConfirmation = await confirmAction(`🤖 AIがファイル '${currentStep.argument}' の読み込みを要求しています。許可しますか？`);
                  if (!readConfirmation) throw new Error("ユーザーがファイル読み込みを拒否しました。");

                  const readPath = getSafePath(currentStep.argument);
                  result = await fs.readFile(readPath, 'utf-8');
                  console.log("  📂 ファイル内容:", result);
                  break;
              case "finish":
                  console.log(`\n🎉 タスク完了！ 最終回答: ${currentStep.argument}`);
                  return; // タスク完了のためエージェント全体を終了
          }

          // --- 自己検証ステップ ---
          console.log("  ...操作結果を検証中...");
          const verificationPrompt = `
            直前の操作「${currentStep.command}: ${currentStep.argument}」を実行しました。
            その操作が成功したかどうかを検証してください。
            期待される結果: 「${currentStep.expected_outcome}」
            
            現在のページの状態を観察し、期待される結果が達成されたかどうかを「はい」か「いいえ」で答えてください。
            あなたの応答は必ず "判定: [はい/いいえ]\\n理由: [判定の根拠]" の形式でなければなりません。
          `;
          
          const currentPageText = await activePage.extract().then(e => e?.page_text?.substring(0, 4000) || "ページの要約を取得できませんでした。").catch(() => "ページの要約を取得できませんでした。");

          const LLM_PROVIDER = process.env.LLM_PROVIDER || 'google';
          let llm: LanguageModel;
          if (LLM_PROVIDER === 'groq') {
            const groqApiKey = process.env.GROQ_API_KEY;
            if (!groqApiKey) throw new Error("GROQ_API_KEYが.envファイルに設定されていません。");
            const groq = createGroq({ apiKey: groqApiKey });
            llm = groq(process.env.GROQ_MODEL || '');
          } else if (LLM_PROVIDER === 'openrouter') {
            const openRouterApiKey = process.env.OPENROUTER_API_KEY;
            if (!openRouterApiKey) throw new Error("OPENROUTER_API_KEYが.envファイルに設定されていません。");
            const openrouter = createOpenAI({
              apiKey: openRouterApiKey,
              baseURL: "https://openrouter.ai/api/v1",
              headers: {
                'HTTP-Referer': 'http://localhost:3000',
                'X-Title': 'Stagehand Agent Console',
              }
            });
            llm = openrouter(process.env.OPENROUTER_MODEL || '');
          } else {
            const googleApiKey = process.env.GOOGLE_API_KEY;
            if (!googleApiKey) throw new Error("GOOGLE_API_KEYが.envファイルに設定されていません。");
            const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
            llm = google(process.env.GEMINI_MODEL || '');
          }

          const { text: verificationResult } = await generateText({
              model: llm,
              prompt: `${verificationPrompt}\n\n現在のページ内容:\n${currentPageText}`
          });

          console.log(`  🔎 検証結果: ${verificationResult}`);

          if (!verificationResult.toLowerCase().includes("判定: はい")) {
              throw new Error(`検証失敗: 期待される結果「${currentStep.expected_outcome}」に到達しませんでした。AIの判断理由: ${verificationResult}`);
          }
          // --- 自己検証ステップここまで ---

          // --- 安定待機処理 ---
          if (["goto", "act", "new_tab", "switch_tab", "close_tab"].includes(currentStep.command)) {
              try {
                  await activePage.waitForLoadState('networkidle', { timeout: 5000 });
              } catch (e) {
                  console.log("  ...ネットワーク待機がタイムアウトしましたが、処理を続行します。");
              }
          }

          console.log("  ✅ 成功 (検証済み)");
          state.addHistory({ step: currentStep, result });

      } catch (error: any) {
          // 3. エラーが発生した場合（自己修正）
          console.error(`  ❌ ステップ実行中にエラー: ${error.message}`);

          let errorSummary = "エラー発生時のページ要約取得に失敗しました。";
          try {
            const pageForError = state.getActivePage();
            if (!pageForError.isClosed() && pageForError.url() !== 'about:blank') { // about:blank の場合は抽出しない
                errorSummary = await pageForError.extract().then(e => e?.page_text?.substring(0, 2000) || "ページの要約を取得できませんでした。").catch(() => "ページの要約を取得できませんでした。");
            }
          } catch (e) {
            // ignore
          }

          const reflection = await callReflectionAI(task, error, currentStep, state, errorSummary);
          feedbackContext = formatReflection(reflection);
          
          state.addHistory({ step: currentStep, error: error.message });
          // エラーが発生したので、この計画の実行を中断し、再計画へ
          break; // forループを抜ける
      }
    }

    // 4. 次の計画のためにページの状態を更新
    await state.updatePages();
    
    // ネットワークの状態が安定するのを待つ
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (loopCount >= maxLoops) {
      console.warn(`⚠️ 最大試行回数（${maxLoops}回）に達したため、処理を中断しました。`);
  }
}

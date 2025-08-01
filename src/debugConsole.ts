/**
 * @file 対話型のデバッグコンソール機能を提供します。
 * ユーザーからのコマンド入力を受け付け、AIへの指示やPlaywrightの操作を実行します。
 */

import type { Stagehand } from "@browserbasehq/stagehand";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { taskAutomationAgent, getLlmInstance } from "./taskAutomationAgent.js";
import { AgentState } from "./agentState.js";
import { InterventionMode } from "./types.js";
import { ToolCall } from "ai";
import { planSubgoals } from "./chiefAgent.js";

/**
 * ユーザーにy/nの確認を求める関数
 * @param prompt - 表示するプロンプトメッセージ
 * @returns ユーザーが 'y' を入力した場合は true, それ以外は false
 */
export async function confirmAction(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(`${prompt} (y/n) `);
  rl.close();
  return answer.toLowerCase() === 'y';
}

/**
 * コンソールに表示されるヘルプメッセージ。
 * 利用可能なコマンドとその説明が含まれています。
 */
const helpMessage = `
--- 対話型デバッグコンソール ---
利用可能なコマンド:

  agent:<タスク>     - [推奨] AIにタスクを依頼し、自律的に計画・実行・自己修復させます。
                     例: agent:StagehandのGitHubリポジトリのスター数を調べて

  act:<指示>         - AIに単一の具体的な操作を自然言語で指示します。
                     例: act:'Issues'タブをクリックして

  observe:[指示]     - 現在のページで操作可能な要素をAIに探させます。
                     例: observe:クリックできる全てのボタン

  extract:[指示]     - ページから情報を抽出します。引数なしで全テキストを抽出。
                     例: extract:記事のタイトル

  inspect            - Playwright Inspectorを起動し、GUIでページを調査します。

  eval:<コード>      - 任意のPlaywright/JavaScriptコードをその場で実行します。
                     例: eval:console.log(await page.title())

  goto:<URL>         - 指定したURLにページを移動させます。
                     例: goto:https://www.stagehand.dev/

  mode:<mode>        - 介入モードを設定 (autonomous, confirm, edit)。引数なしで現在値表示。
                     例: mode:autonomous

  help               - このヘルプメッセージを表示します。

  exit               - デバッグコンソールを終了します。
------------------------------------
`;

/**
 * ユーザーに計画の承認を求める関数。現在の介入モードに応じて動作が変わる。
 * @param state - 現在のエージェントの状態
 * @param plan - AIが生成した実行計画 (ToolCallの配列)
 * @returns 承認または編集された計画。ユーザーが拒否した場合はnull。
 */
export async function requestUserApproval(
  state: AgentState,
  plan: ToolCall<string, any>[]
): Promise<ToolCall<string, any>[] | null> {
  const mode = state.getInterventionMode();

  console.log("\n--- 実行計画 ---");
  plan.forEach((step, index) => {
    console.log(`${index + 1}. ${step.toolName}(${JSON.stringify(step.args)})`);
  });
  console.log("-----------------");

  if (mode === 'autonomous') {
    console.log("🤖 自律モード: 計画を自動的に承認します。 (2秒後に実行...)");
    await new Promise(resolve => setTimeout(resolve, 2000));
    return plan;
  }

  const rl = readline.createInterface({ input, output });
  let prompt = "この計画で実行しますか？ (y/n";
  if (mode === 'edit') {
    prompt += "/edit";
  }
  prompt += ") ";

  const answer = await rl.question(prompt);
  rl.close();

  switch (answer.toLowerCase()) {
    case 'y':
    case 'yes':
      return plan;
    case 'n':
    case 'no':
      return null;
    case 'edit':
      if (mode === 'edit') {
        return await startPlanEditor(plan);
      }
      console.log("無効な入力です。'y'または'n'で回答してください。");
      return requestUserApproval(state, plan);
    default:
      console.log("無効な入力です。");
      return requestUserApproval(state, plan);
  }
}

/**
 * 計画を対話的に編集するためのシンプルなCLIインターフェース
 * @param plan - 編集対象の計画
 * @returns 編集後の計画
 */
async function startPlanEditor(plan: ToolCall<string, any>[]): Promise<ToolCall<string, any>[]> {
    console.log("\n--- 計画編集モード ---");
    console.log("コマンド: list, delete <番号>, done");
    let currentPlan = [...plan];
    const rl = readline.createInterface({ input, output });

    while (true) {
        const userInput = await rl.question("編集 > ");
        const [command, ...args] = userInput.split(" ");

        switch (command.toLowerCase()) {
            case 'list':
                currentPlan.forEach((step, index) => {
                    console.log(`${index + 1}. ${step.toolName}(${JSON.stringify(step.args)})`);
                });
                break;
            case 'delete':
                const index = parseInt(args[0], 10) - 1;
                if (index >= 0 && index < currentPlan.length) {
                    currentPlan.splice(index, 1);
                    console.log(`ステップ ${index + 1} を削除しました。`);
                } else {
                    console.log("無効な番号です。");
                }
                break;
            case 'done':
                rl.close();
                console.log("--- 編集完了 ---");
                return currentPlan;
            default:
                console.log("不明な編集コマンドです。");
        }
    }
}

/**
 * 対話型のデバッグコンソールを起動し、ユーザーからの入力を待ち受けます。
 * ユーザーはAIへの指示、Playwright Inspectorの起動、コードの直接実行などを
 * コマンドを通じて行えます。
 * @param stagehand - 操作対象となるStagehandのインスタンス
 * @param state - エージェントの状態を管理するインスタンス
 */
export async function interactiveDebugConsole(stagehand: Stagehand, state: AgentState): Promise<void> {
  const page = stagehand.page;
  const rl = readline.createInterface({ input, output });
  console.log(helpMessage);

  while (true) {
    const userInput = await rl.question("> ");
    const [command, ...args] = userInput.split(/:(.*)/s);
    const argument = args.join(":").trim();

    try {
      switch (command.trim().toLowerCase()) {
        case "act":
          if (!argument) {
            console.log("指示を指定してください。例: act: 'OK'ボタンをクリック");
            break;
          }
          console.log(`🤖 AIに指示を実行中: "${argument}"...`);
          const actResult = await page.act(argument);
          console.log("✅ 実行完了:", actResult);
          break;

        case "observe":
          console.log(`🤖 AIにページを観察させています: "${argument || 'すべて'}"...`);
          const observations = await page.observe(argument);
          console.log("👀 発見された要素:", observations);
          break;

        case "extract":
          console.log(`🤖 AIに情報を抽出させています: "${argument || 'ページ全体のテキスト'}"...`);
          const extraction = argument ? await page.extract(argument) : await page.extract();
          console.log("📊 抽出された情報:", extraction);
          break;

        case "agent":
          if (!argument) {
            console.log("実行するタスクを指定してください。例: agent: playwrightのgithubのスター数を調べて");
            break;
          }
          console.log(`👑 司令塔エージェントにタスクを依頼しました: "${argument}"`);
          
          const llm = getLlmInstance();
          const subgoals = await planSubgoals(argument, llm);

          for (const [index, subgoal] of subgoals.entries()) {
              console.log(`\n▶️ サブゴール ${index + 1}/${subgoals.length} 実行中: "${subgoal}"`);
              const success = await taskAutomationAgent(subgoal, stagehand, state, argument);
              if (!success) {
                  console.error(`サブゴール "${subgoal}" の実行に失敗しました。エージェントの処理を中断します。`);
                  break;
              }
          }
          console.log("✅ 全てのサブゴールの処理が完了しました。");
          break;

        case "inspect":
          console.log("🔍 Playwright Inspectorを起動します。Inspectorを閉じると再開します...");
          await page.pause(); // Playwright Inspectorを起動して一時停止
          console.log("▶️ Inspectorが閉じられました。");
          break;

        case "eval":
          if (!argument) {
            console.log("実行するコードを指定してください。例: eval: await page.title()");
            break;
          }
          console.log(`⚡ コードを実行中: \`${argument}\`...`);
          // ユーザー入力を非同期関数として動的に生成・実行
          // 'page'オブジェクトを関数のスコープ内で利用可能にする
          const result = await new Function('page', `return (async () => { ${argument} })()`)(page);
          console.log("✅ 実行結果:", result);
          break;
        
        case "goto":
          if (!argument) {
            console.log("URLを指定してください。例: goto: https://google.com");
            break;
          }
          console.log(`🚀 ${argument} に移動中...`);
          await page.goto(argument);
          console.log("✅ 移動完了");
          break;

        case "mode":
          if (!argument) {
            console.log(`現在の介入モード: ${state.getInterventionMode()}`);
            break;
          }
          state.setInterventionMode(argument as InterventionMode);
          break;

        case "help":
          console.log(helpMessage);
          break;

        case "exit":
          rl.close(); // readlineインターフェースを閉じる
          return; // ループを抜けて関数を終了

        default:
          console.log(`不明なコマンドです: "${command}"。「help」でコマンド一覧を確認できます。`);
      }
    } catch (e: any) {
      console.error("❌ コマンドの実行中にエラーが発生しました:", e.message);
    }
  }
}

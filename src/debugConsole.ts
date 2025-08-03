/**
 * @file 対話型のデバッグコンソール機能を提供します。
 * ユーザーからのコマンド入力を受け付け、AIへの指示やPlaywrightの操作を実行します。
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { clearLine, cursorTo } from "node:readline";
import { AgentState } from "./agentState.js";
import { InterventionMode } from "./types.js";
import { ToolCall } from "ai";
import { executeCommand } from "./commandExecutor.js";
import { eventHub } from "./eventHub.js";
import open from "open";
import chalk from "chalk";
import { ClientToServerEvents } from "../types/protocol.js";

/**
 * ユーザーにy/nの確認を求める関数
 * @param prompt - 表示するプロンプトメッセージ
 * @returns ユーザーが 'y' を入力した場合は true, それ以外は false
 */
export async function confirmAction(prompt: string): Promise<boolean> {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(`${prompt} (y/n) `);
  rl.close();
  return answer.toLowerCase() === "y";
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
  
  gui                - ブラウザでGUIデバッグコンソールを開きます。

  help               - このヘルプメッセージを表示します。

  exit               - デバッグコンソールを終了します。
------------------------------------
`;

/**
 * 計画を対話的に編集するためのシンプルなCLIインターフェース
 * @param plan - 編集対象の計画
 * @returns 編集後の計画
 */
async function startPlanEditor(
  plan: ToolCall<string, any>[],
): Promise<ToolCall<string, any>[]> {
  console.log(chalk.magenta("\n--- 計画編集モード ---"));
  console.log(chalk.magenta("コマンド: list, delete <番号>, done"));
  const currentPlan = [...plan];
  const rl = readline.createInterface({ input, output });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const userInput = await rl.question(chalk.magenta("編集 > "));
    const [command, ...args] = userInput.split(" ");

    switch (command.toLowerCase()) {
      case "list":
        currentPlan.forEach((step, index) => {
          console.log(
            `${index + 1}. ${step.toolName}(${JSON.stringify(step.args)})`,
          );
        });
        break;
      case "delete": {
        const index = parseInt(args[0], 10) - 1;
        if (index >= 0 && index < currentPlan.length) {
          currentPlan.splice(index, 1);
          console.log(`ステップ ${index + 1} を削除しました。`);
        } else {
          console.log("無効な番号です。");
        }
        break;
      }
      case "done":
        rl.close();
        console.log(chalk.magenta("--- 編集完了 ---"));
        return currentPlan;
      default:
        console.log("不明な編集コマンドです。");
    }
  }
}

/**
 * CUI側で承認リクエストを処理するハンドラをセットアップします。
 * この関数はCUIモードでのみ呼び出されるべきです。
 * @param state - エージェントの状態。介入モードの確認に使用します。
 */
export function setupApprovalHandler(state: AgentState) {
  eventHub.on("agent:approval-request", async ({ plan }) => {
    const mode = state.getInterventionMode();
    if (mode === "autonomous") {
      return;
    }

    // CUIに直接プロンプトを表示して応答を待つ
    const rl = readline.createInterface({ input, output });
    let prompt = "この計画で実行しますか？ (y/n";
    if (mode === "edit") {
      prompt += "/edit";
    }
    prompt += ") ";
    const answer = await rl.question(chalk.green(prompt));
    rl.close();

    let response: Parameters<ClientToServerEvents["agent:approval-response"]>[0] = { approved: false };

    switch (answer.toLowerCase()) {
      case "y":
      case "yes":
        response = { approved: true, editedPlan: plan };
        break;
      case "n":
      case "no":
        response = { approved: false };
        break;
      case "edit":
        if (mode === "edit") {
          const editedPlan = await startPlanEditor(plan);
          response = { approved: true, editedPlan: editedPlan };
        } else {
          console.log("編集モードではありません。");
        }
        break;
      default:
        console.log("無効な入力です。計画は拒否されました。");
    }
    
    eventHub.emit("agent:approval-response", response);
  });
}

/**
 * ユーザーに計画の承認を非同期で要求します。
 * 実行モード（CUI/GUI）に応じて、適切な方法でユーザーに応答を求めます。
 * @param state - 現在のエージェントの状態。
 * @param plan - AIが生成した実行計画。
//  * @param isGuiMode - GUIモードで実行されているかどうか。
 * @returns 承認された場合は計画、拒否された場合はnull。
 */
export function requestUserApproval(
  state: AgentState,
  plan: ToolCall<string, any>[],
  // isGuiMode: boolean,
): Promise<ToolCall<string, any>[] | null> {
  const mode = state.getInterventionMode();
  if (mode === "autonomous") {
    eventHub.emit("agent:log", {
      level: "system",
      message: "🤖 自律モード: 計画を自動的に承認します。",
      timestamp: new Date().toISOString(),
    });
    return Promise.resolve(plan);
  }

  // 承認要求のログは共通で送信
  let planLogMessage = "--- 実行計画 ---\n";
  plan.forEach((step, index) => {
      planLogMessage += `${index + 1}. ${step.toolName}(${JSON.stringify(step.args)})\n`;
  });
  planLogMessage += "-----------------";
  eventHub.emit("agent:log", {
      level: 'system',
      message: planLogMessage,
      timestamp: new Date().toISOString(),
  });

  return new Promise((resolve) => {
    state.setIsAwaitingApproval(true);

    const handleResponse = (payload: {
      approved: boolean;
      editedPlan?: ToolCall<string, any>[];
    }) => {
      eventHub.off("agent:approval-response", handleResponse);
      state.setIsAwaitingApproval(false);
      if (payload.approved) {
        resolve(payload.editedPlan || plan);
      } else {
        resolve(null);
      }
    };

    eventHub.on("agent:approval-response", handleResponse);

    // どのモードでも承認要求イベントを発行する
    // CUIモードの場合はsetupApprovalHandlerが、GUIモードの場合はGUIがこのイベントを拾う
    eventHub.emit("agent:approval-request", { plan });
  });
}

/**
 * 対話型のデバッグコンソールを起動し、ユーザーからの入力を待ち受けます。
 * @param state - エージェントの状態を管理するインスタンス
 */
export async function interactiveDebugConsole(state: AgentState): Promise<void> {
  // CUI専用のログハンドラをここに移動
  eventHub.on("agent:log", (payload) => {
    const colorMap = {
      info: chalk.white,
      error: chalk.red,
      warn: chalk.yellow,
      system: chalk.cyan,
    };
    const color = colorMap[payload.level] || colorMap.info;
    
    // readlineがアクティブな場合、プロンプトを再描画するために一手間かける
    const rl = (input as any)._readableState?.pipes?.find((p: any) => p.constructor.name === 'Interface');
    if (rl && typeof (rl as any).getCursorPos === 'function') {
      clearLine(process.stdout, 0);
      cursorTo(process.stdout, 0);
      console.log(color(`[${payload.level.toUpperCase()}] ${payload.message}`));
      rl.prompt(true);
    } else {
      console.log(color(`[${payload.level.toUpperCase()}] ${payload.message}`));
    }
  });

  const rl = readline.createInterface({ input, output });
  console.log(helpMessage);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const userInput = await rl.question(chalk.bold("> "));
    const [command, ...args] = userInput.split(/:(.*)/s);
    const argument = args.join(":").trim();

    const commandLower = command.trim().toLowerCase();

    if (commandLower === "exit") {
      rl.close();
      return;
    }

    if (commandLower === "gui") {
      const url = "http://localhost:3000";
      console.log(
        chalk.cyan(
          `[SYSTEM] GUIモードに移行します。ブラウザで ${url} を開いています...`,
        ),
      );
      await open(url);
      continue;
    }

    if (commandLower === "help") {
      console.log(helpMessage);
      continue;
    }

    if (commandLower === "mode") {
      if (!argument) {
        console.log(
          chalk.cyan(`[SYSTEM] 現在の介入モード: ${state.getInterventionMode()}`),
        );
      } else {
        state.setInterventionMode(argument as InterventionMode);
      }
      continue;
    }

    try {
      const response = await executeCommand(command, argument, state, "cui");
      if (response.success) {
        console.log(
          chalk.green(`✅ 成功: ${response.message}`),
          response.data || "",
        );
      } else {
        console.error(chalk.red(`❌ 失敗: ${response.message}`));
      }
    } catch (e: any) {
      console.error(chalk.red("❌ コマンド実行中に致命的なエラー:"), e.message);
    }
  }
}

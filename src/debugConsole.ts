/**
 * @file 対話型のデバッグコンソール機能を提供します。
 * ユーザーからのコマンド入力を受け付け、AIへの指示やPlaywrightの操作を実行します。
 */

import type { Page, Stagehand } from "@browserbasehq/stagehand";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { taskAutomationAgent } from "./taskAutomationAgent.js";

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
  act:<指示>       - AIに自然言語で操作を指示します (例: act:'ログイン'ボタンをクリック)
  observe:[指示]   - ページ上の操作可能な要素をAIに探させます (例: observe:クリックできるリンク)
  agent:<タスク>   - AIに高レベルなタスクを自律的に実行させます (例: agent:'https://www.stagehand.dev/' にアクセスして、ページ内にあるGithubリンクへアクセスし、そのリポジトリのスターの数を教えて)
  inspect          - Playwright Inspectorを起動します。閉じるまで待機します。
  eval:<コード>    - 任意のPlaywright/JSコードを実行します (例: eval:await page.title())
  goto:<URL>       - 指定したURLに移動します。
  help             - このヘルプメッセージを表示します。
  exit             - デバッグを終了し、スクリプトを閉じます。
------------------------------------
`;

/**
 * 対話型のデバッグコンソールを起動し、ユーザーからの入力を待ち受けます。
 * ユーザーはAIへの指示、Playwright Inspectorの起動、コードの直接実行などを
 * コマンドを通じて行えます。
 * @param stagehand - 操作対象となるStagehandのインスタンス
 */
export async function interactiveDebugConsole(stagehand: Stagehand): Promise<void> {
  const page = stagehand.page;
  // 標準入出力を受け付けるためのreadlineインターフェースを作成
  const rl = readline.createInterface({ input, output });
  console.log(helpMessage);

  // 'exit'コマンドが入力されるまでループ
  while (true) {
    const userInput = await rl.question("> ");

    // 入力をコロン(:)で分割し、コマンドと引数を取得
    // `split(/:(.*)/s)` は最初のコロンでのみ分割するための正規表現
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

        case "agent":
          if (!argument) {
            console.log("実行するタスクを指定してください。例: agent: playwrightのgithubのスター数を調べて");
            break;
          }
          console.log(`🤖 エージェントにタスクを依頼しました: "${argument}"`);
          await taskAutomationAgent(argument, stagehand);
          console.log("✅ エージェントのタスク処理が完了しました。");
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

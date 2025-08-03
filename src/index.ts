/**
 * @file プロジェクトのエントリーポイントです。
 * Stagehandを初期化し、バックエンドサーバーと対話型デバッグコンソールを起動します。
 */

import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "../stagehand.config.js";
import { interactiveDebugConsole, setupApprovalHandler } from "./debugConsole.js";
import { initializeTools } from "./tools/index.js";
import { AgentState } from "./agentState.js";
import { InterventionMode } from "./types.js";
import { startServer } from "./server.js";
import chalk from "chalk";

/**
 * メイン実行関数
 */
async function main() {
  // アプリケーション起動時に動的スキルを読み込む
  await initializeTools();

  // Stagehandのインスタンスを生成
  const stagehand = new Stagehand({
    ...StagehandConfig,
    localBrowserLaunchOptions: { headless: false },
  });

  // Stagehandセッションを初期化し、ブラウザを起動
  await stagehand.init();

  // セッション全体で共有するAgentStateインスタンスを作成
  const state = new AgentState(stagehand);

  // 起動時引数を解釈
  const args = process.argv.slice(2);
  const noCui = args.includes("--no-cui"); // --no-cuiフラグがあるかチェック

  const modeArg = args.find((arg) => arg.startsWith("--mode="));
  if (modeArg) {
    const initialMode = modeArg.split("=")[1] as InterventionMode;
    state.setInterventionMode(initialMode);
  }

  // バックエンドサーバーを起動
  startServer(3000, state);

  if (noCui) {
    // --no-cuiフラグがある場合（dev:guiで起動された場合）
    console.log(chalk.green("バックエンドサーバーがGUIモードで起動しました。"));
    console.log(chalk.yellow("CUIは無効です。GUIから操作してください。"));
    // プロセスが終了しないように待機
    await new Promise(() => {});
  } else {
    // デフォルト（devまたはstartで起動された場合）
    
    // CUIの承認リクエストハンドラはCUIモードでのみセットアップする
    setupApprovalHandler(state);

    try {
      // 対話型デバッグコンソールを開始
      await interactiveDebugConsole(state);
    } catch (error: any) {
      console.error(`\n❌ 致命的なエラーが発生しました: ${error.message}`);
    } finally {
      // CUIが終了したら、プロセス全体を終了
      console.log("\nセッションを終了します。");
      await stagehand.close();
      process.exit(0);
    }
  }
}

// スクリプトのエントリーポイントとしてmain関数を実行
main();

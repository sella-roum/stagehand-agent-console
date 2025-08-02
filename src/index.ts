/**
 * @file プロジェクトのエントリーポイントです。
 * Stagehandを初期化し、対話型デバッグコンソールを起動します。
 */

import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "../stagehand.config.js";
import { interactiveDebugConsole } from "./debugConsole.js";
import { initializeTools } from "./tools/index.js";
import { AgentState } from "./agentState.js";
import { InterventionMode } from "./types.js";

/**
 * メイン実行関数
 * Stagehandのセッションをセットアップし、デバッグコンソールを開始します。
 * 予期せぬエラーが発生した場合もコンソールを起動し、
 * 最終的にセッションを安全にクローズします。
 */
async function main() {
  // アプリケーション起動時に動的スキルを読み込む
  await initializeTools();

  // Stagehandのインスタンスを生成
  const stagehand = new Stagehand({
      ...StagehandConfig,
      // InspectorやAgentの動作確認のためにheadedモード（GUIあり）を推奨
      localBrowserLaunchOptions: { headless: false },
  });

  // Stagehandセッションを初期化し、ブラウザを起動
  await stagehand.init();

  // セッション全体で共有するAgentStateインスタンスを作成
  const state = new AgentState(stagehand);

  // 起動時引数から介入モードを設定
  const args = process.argv.slice(2);
  const modeArg = args.find(arg => arg.startsWith('--mode='));
  if (modeArg) {
    const initialMode = modeArg.split('=')[1] as InterventionMode;
    state.setInterventionMode(initialMode);
  }

  try {
    console.log("自動化処理を開始します...");

    // 初期状態でデバッグコンソールを起動する
    console.log("対話型デバッグコンソールを開始します。");
    await interactiveDebugConsole(stagehand, state);

    console.log("対話型デバッグが終了しました。");

  } catch (error: any) {
    // 予期せぬエラーが発生した場合のフォールバック処理
    console.error(`\n❌ 致命的なエラーが発生しました: ${error.message}`);
    console.log("フォールバックとして、再度デバッグコンソールを開始します。");
    
    try {
      // エラー発生時の状態からでもデバッグを試みられるようにする
      await interactiveDebugConsole(stagehand, state);
    } catch (debugError: any) {
      console.error(`\n❌ デバッグコンソールの起動に失敗しました: ${debugError.message}`);
    }

  } finally {
    // 正常終了、エラー発生に関わらず、必ずセッションを閉じる
    console.log("\nセッションを終了します。");
    await stagehand.close();
  }
}

// スクリプトのエントリーポイントとしてmain関数を実行
main();

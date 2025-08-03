/**
 * @file Playwrightの標準的な操作とAIエージェントのタスク実行を組み合わせた
 * デモテストを定義します。
 */

import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/stagehand.config";
import { runAgentTask } from "@/src/agentRunner";

// AIエージェントの応答には時間がかかるため、テストのタイムアウトを5分に設定
test.setTimeout(300000);

test.describe("Stagehand AI Agent", () => {
  let stagehand: Stagehand;

  // 各テストの実行前に、新しいStagehandインスタンスを初期化する
  test.beforeEach(async () => {
    stagehand = new Stagehand({
      ...StagehandConfig,
      // テスト中はGUIを表示しないヘッドレスモードでブラウザを実行
      localBrowserLaunchOptions: { headless: true },
    });
    await stagehand.init();
  });

  // 各テストの実行後に、Stagehandセッションをクリーンアップする
  test.afterEach(async () => {
    await stagehand.close();
  });

  /**
   * @description Google検索で初期状態を設定した後、AIエージェントに後続のタスクを
   * 引き継がせるハイブリッドな自動化テスト。
   */
  test("should navigate to Stagehand GitHub and find the star count", async () => {
    // --- ステップ1: Playwright/Stagehandによる初期状態の設定 ---
    // 複雑なログイン処理やテストデータの準備など、決まった手順はコードで記述する
    const page = stagehand.page;
    await page.goto("https://www.google.com");
    await page.act("'Stagehand AI'と入力して");
    await page.keyboard.press("Enter");
    await stagehand.page.waitForURL("**/search**");

    // --- ステップ2: AIエージェントへのタスクの引き継ぎ ---
    // 検索結果ページという動的な状態から、後続の探索・操作をAIに任せる
    const task =
      "Stagehandの公式サイトを見つけてアクセスし、GitHubリポジトリのスター数を報告して";

    const result = await runAgentTask(task, stagehand);

    // --- ステップ3: エージェントの実行結果の検証 ---
    // エージェントがタスクを成功したと自己評価しているか
    expect(result.is_success).toBe(true);
    // 最終回答に'star'という単語が含まれているか（緩い検証）
    expect.soft(result.reasoning.toLowerCase()).toContain("star");
    // 最終回答に何らかの数字（スター数）が含まれているか
    expect(result.reasoning).toMatch(/\d+/);

    // --- ステップ4: 最終的なブラウザの状態の検証 ---
    // タスク完了後、ブラウザが期待通りのページ（GitHub）にいるか
    const finalUrl = stagehand.page.url();
    expect(finalUrl).toContain("github.com/browserbase/stagehand");
  });
});

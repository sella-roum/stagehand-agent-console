/**
 * @file AIエージェントのE2E(エンドツーエンド)テストを定義します。
 * `runAgentTask`関数を使用して、高レベルなタスクをエージェントに実行させ、
 * その結果と最終的なブラウザの状態を検証します。
 */

import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "../stagehand.config.js";
import { runAgentTask } from "../src/agentRunner.js";

// AIエージェントの応答には時間がかかるため、テストのタイムアウトを5分に設定
test.setTimeout(300000);

test.describe("Stagehand AI Agent", () => {
  let stagehand: Stagehand;

  // 各テストの実行前に、新しいStagehandインスタンスを初期化する
  test.beforeEach(async () => {
    // CI/CD環境で実行されることを想定し、環境変数NODE_ENVを'test'に設定
    process.env.NODE_ENV = "test";

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
   * @description Stagehandの公式サイトにアクセスし、GitHubリポジトリのスター数を
   * 報告させるタスクが正常に完了するかをテストします。
   */
  test("should navigate to Stagehand GitHub and find the star count", async () => {
    // 1. エージェントに与える高レベルなタスクを定義
    const task =
      "https://www.stagehand.dev/ にアクセスして、ページ内にあるGithubリンクへアクセスし、そのリポジトリのスターの数を教えて";

    // 2. 非対話モードでエージェントのタスク実行を開始
    const result = await runAgentTask(task, stagehand, {
      maxSubgoals: 5, // 計画の最大ステップ数を制限
      maxLoopsPerSubgoal: 8, // 各ステップの最大試行回数を制限
    });

    // 3. エージェントの実行結果を検証
    // エージェント自身がタスクの成功を報告しているか（自己評価）
    expect(result.is_success).toBe(true);

    // 4. 最終的なブラウザの状態を検証
    // 最終的にGitHubリポジトリのページに到達しているか
    const finalUrl = stagehand.page.url();
    expect(finalUrl).toContain("github.com/browserbase/stagehand");
  });

  /**
   * @description 実行不可能なタスクを与えた場合に、エージェントが
   * 適切に失敗し、エラーをスローするかをテストします。
   */
  test("should throw an error for an impossible task", async () => {
    const impossibleTask = "月に行ってチーズがあるか確認してきて";

    // 実行不可能なタスクは、最終的にエラーで終了することを期待する
    await expect(
      runAgentTask(impossibleTask, stagehand, {
        maxSubgoals: 3,
        maxLoopsPerSubgoal: 3,
      }),
    ).rejects.toThrow();
  });
});

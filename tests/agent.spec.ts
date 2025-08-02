// runAgentTaskを使用したPlaywrightのテストコードサンプル。
import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "../stagehand.config.js";
import { runAgentTask } from "../src/agentRunner.js";

// テストのタイムアウトを5分に設定
test.setTimeout(300000);

test.describe("Stagehand AI Agent", () => {
  let stagehand: Stagehand;

  test.beforeEach(async () => {
    // 環境変数NODE_ENVを'test'に設定
    process.env.NODE_ENV = 'test';
    
    stagehand = new Stagehand({
      ...StagehandConfig,
      // テスト中はヘッドレスで実行
      localBrowserLaunchOptions: { headless: true }, 
    });
    await stagehand.init();
  });

  test.afterEach(async () => {
    await stagehand.close();
  });

  test("should navigate to Stagehand GitHub and find the star count", async () => {
    const task = "https://www.stagehand.dev/ にアクセスして、ページ内にあるGithubリンクへアクセスし、そのリポジトリのスターの数を教えて";
    
    const result = await runAgentTask(task, stagehand, {
      maxSubgoals: 5,
      maxLoopsPerSubgoal: 8,
    });

    // 自己評価が成功していることを確認
    expect(result.is_success).toBe(true);

    // 最終的なページがGitHubリポジトリであることを確認
    const finalUrl = stagehand.page.url();
    expect(finalUrl).toContain("github.com/browserbase/stagehand");
  });

  test("should throw an error for an impossible task", async () => {
    const impossibleTask = "月に行ってチーズがあるか確認してきて";

    await expect(runAgentTask(impossibleTask, stagehand, {
        maxSubgoals: 3,
        maxLoopsPerSubgoal: 3,
    })).rejects.toThrow();
  });
});

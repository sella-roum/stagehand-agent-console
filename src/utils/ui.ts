/**
 * @file UI関連のユーティリティ関数を提供します。
 */
import { ObserveResult, Page } from "@browserbasehq/stagehand";
import boxen from "boxen";
import chalk from "chalk";

/**
 * 専門エージェントの役割に応じたログプレフィックスとスタイルを定義します。
 */
const agentStyles = {
  Analyst: { prefix: "🤔 [Analyst]", color: chalk.cyan },
  Executor: { prefix: "⚡️ [Executor]", color: chalk.yellow },
  QA: { prefix: "✅ [QA]", color: chalk.green },
  "QA-Fail": { prefix: "❌ [QA]", color: chalk.red },
  Chief: { prefix: "👑 [Chief]", color: chalk.magenta },
  Orchestrator: { prefix: "🎼 [Orchestrator]", color: chalk.blue },
};

export type AgentRole = keyof typeof agentStyles;

/**
 * 役割に応じたスタイルでコンソールにログを出力します。
 * @param role - ログを出力するエージェントの役割。
 * @param message - 表示するメッセージ。
 */
export function logAgentMessage(role: AgentRole, message: string) {
  const style = agentStyles[role];
  console.log(style.color(`${style.prefix} ${message}`));
}

/**
 * コンソールに目立つ枠線付きのメッセージを表示します。
 * @param message - 表示するメッセージ本文。
 * @param title - (オプション) 枠の上部に表示するタイトル。
 */
export function announce(message: string, title?: string) {
  console.log(
    boxen(message, {
      padding: 1,
      margin: 3,
      title: title || "Stagehand",
    }),
  );
}

/**
 * `observe`の結果に基づき、ページ上の該当要素に視覚的なオーバーレイを描画します。
 * デバッグやユーザーへのフィードバックに利用します。
 * @param page - 操作対象のStagehand Pageオブジェクト。
 * @param results - `observe`コマンドから返された結果の配列。
 */
export async function drawObserveOverlay(page: Page, results: ObserveResult[]) {
  // 既存オーバーレイをクリア
  await clearOverlays(page);

  const selectors = results
    .map((r) => r.selector)
    .filter((s): s is string => !!s && s.trim() !== "" && s !== "xpath=");

  await page.evaluate((selectors) => {
    selectors.forEach((selector) => {
      try {
        let element: Element | null = null;
        if (selector.startsWith("xpath=")) {
          const xpath = selector.substring(6);
          element = document.evaluate(
            xpath,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null,
          ).singleNodeValue as Element | null;
        } else {
          element = document.querySelector(selector);
        }

        if (element instanceof HTMLElement) {
          const overlay = document.createElement("div");
          overlay.setAttribute("stagehandObserve", "true");
          const rect = element.getBoundingClientRect();
          overlay.style.position = "fixed";
          overlay.style.left = rect.left + "px";
          overlay.style.top = rect.top + "px";
          overlay.style.width = rect.width + "px";
          overlay.style.height = rect.height + "px";
          overlay.style.backgroundColor = "rgba(255, 255, 0, 0.3)";
          overlay.style.pointerEvents = "none";
          overlay.style.zIndex = "10000";
          document.body.appendChild(overlay);
        }
      } catch {
        // 無効セレクタ等はスキップ
      }
    });
  }, selectors);
}

/**
 * `drawObserveOverlay`によって描画されたすべてのオーバーレイをページから削除します。
 * @param page - 操作対象のStagehand Pageオブジェクト。
 */
export async function clearOverlays(page: Page) {
  await page.evaluate(() => {
    const elements = document.querySelectorAll('[stagehandObserve="true"]');
    elements.forEach((el) => {
      el.parentNode?.removeChild(el);
    });
  });
}

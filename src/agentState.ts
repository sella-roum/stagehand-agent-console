import { Page, BrowserContext, Stagehand } from "@browserbasehq/stagehand";
import { ExecutionRecord, TabInfo } from "./types.js";

export class AgentState {
  private history: ExecutionRecord[] = [];
  private pages: Page[] = [];
  private stagehand: Stagehand; 
  private context: BrowserContext;

  constructor(stagehandInstance: Stagehand) {
    this.stagehand = stagehandInstance;
    this.context = stagehandInstance.page.context();
    this.pages = [stagehandInstance.page];
  }

  /**
   * 実行履歴に新しいレコードを追加します。
   * @param record - 追加する実行レコード
   */
  addHistory(record: ExecutionRecord): void {
    this.history.push(record);
  }

  /**
   * 現在の実行履歴を取得します。
   * @returns 実行レコードの配列
   */
  getHistory(): ExecutionRecord[] {
    return this.history;
  }

  /**
   * 現在のブラウザコンテキストからページリストを更新します。
   */
  async updatePages(): Promise<void> {
    this.pages = this.context.pages() as Page[];
  }

  /**
   * 現在アクティブなページオブジェクトを返します。
   * このオブジェクトはStagehandによって拡張されたメソッドを持ちます。
   * @returns StagehandのPageプロキシオブジェクト
   */
  getActivePage(): Page {
    // Stagehandの設計上、stagehand.pageが常にアクティブなタブを指すため、これを信頼する。
    return this.stagehand.page;
  }

  /**
   * 指定されたインデックスのページオブジェクトを取得します。
   * @param index - ページのインデックス
   * @returns PlaywrightのPageオブジェクト
   */
  getPageAtIndex(index: number): Page {
    if (index < 0 || index >= this.pages.length) {
      throw new Error(`無効なタブインデックスです: ${index}。利用可能なインデックスは 0 から ${this.pages.length - 1} です。`);
    }
    return this.pages[index];
  }

  /**
   * 現在開いているすべてのタブの情報を取得します。
   * @returns タブ情報の配列
   */
  async getTabInfo(): Promise<TabInfo[]> {
    await this.updatePages();
    const activePage = this.getActivePage();
    return Promise.all(
      this.pages.map(async (p, index) => ({
        index,
        title: p.isClosed() ? "[Closed]" : await p.title().catch(() => "[Error]"),
        url: p.isClosed() ? "[Closed]" : p.url(),
        isActive: !p.isClosed() && p.url() === activePage.url(),
      })),
    );
  }
}

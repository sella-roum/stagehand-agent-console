/**
 * @file エージェントの状態管理機能を提供します。
 * このファイルでは、セッション全体で共有される状態（実行履歴、タブ情報、介入モードなど）を
 * 一元的に管理する `AgentState` クラスを定義しています。
 */

import { Page, BrowserContext, Stagehand } from "@browserbasehq/stagehand";
import { ExecutionRecord, TabInfo, InterventionMode } from "./types.js";
import { eventHub } from "./eventHub.js";

/**
 * エージェントのセッション全体の状態を管理するクラス。
 * エージェントの「記憶」として機能し、実行履歴、開いているタブ、
 * 現在の介入モードなどを保持します。
 */
export class AgentState {
  // 実行履歴を保持するプライベートプロパティ
  private history: ExecutionRecord[] = [];
  // 現在開いているページのリストを保持するプライベートプロパティ
  private pages: Page[] = [];
  // Stagehandのインスタンス
  private stagehand: Stagehand;
  // ブラウザのコンテキスト
  private context: BrowserContext;
  // ユーザーの介入モード
  private interventionMode: InterventionMode = "confirm"; // デフォルトは確認モード
  // 承認待ち状態フラグを追加
  private isAwaitingApproval: boolean = false;

  /**
   * AgentStateの新しいインスタンスを生成します。
   * @param stagehandInstance - 初期化済みのStagehandインスタンス。
   */
  constructor(stagehandInstance: Stagehand) {
    this.stagehand = stagehandInstance;
    this.context = stagehandInstance.page.context();
    this.pages = [stagehandInstance.page];
    // 初期状態をブロードキャスト
    this.broadcastState();
  }

  /**
   * このStateが管理しているStagehandインスタンスを取得します。
   * @returns Stagehandインスタンス。
   */
  public getStagehandInstance(): Stagehand {
    return this.stagehand;
  }

  /**
   * 実行履歴に新しいレコードを追加します。
   * @param record - 追加する実行レコード。
   */
  addHistory(record: ExecutionRecord): void {
    this.history.push(record);
  }

  /**
   * 現在の実行履歴の完全なリストを取得します。
   * @returns 実行レコードの配列。
   */
  getHistory(): ExecutionRecord[] {
    return this.history;
  }

  /**
   * ユーザーの介入モードを設定します。
   * モードによって、AIの自律レベルが変化します。
   * @param mode - 設定する介入モード ('autonomous', 'confirm', 'edit')。
   */
  public setInterventionMode(mode: InterventionMode): void {
    if (["autonomous", "confirm", "edit"].includes(mode)) {
      this.interventionMode = mode;
      const message = `✅ 介入モードが '${mode}' に設定されました。`;
      // CUIとGUIの両方に通知
      console.log(message);
      eventHub.emit("agent:log", {
        level: "system",
        message,
        timestamp: new Date().toISOString(),
      });
      // 状態が変化したのでブロードキャスト
      this.broadcastState();
    } else {
      console.error(
        `❌ 無効なモードです: ${mode}。'autonomous', 'confirm', 'edit' のいずれかを指定してください。`,
      );
    }
  }

  /**
   * 現在の介入モードを取得します。
   * @returns 現在の介入モード。
   */
  public getInterventionMode(): InterventionMode {
    return this.interventionMode;
  }

  /**
   * エージェントがユーザーの承認を待っている状態かどうかを取得します。
   * @returns 承認待ちの場合はtrue。
   */
  public getIsAwaitingApproval(): boolean {
    return this.isAwaitingApproval;
  }

  /**
   * エージェントの承認待ち状態を設定します。
   * @param isWaiting - 新しい承認待ち状態。
   */
  public setIsAwaitingApproval(isWaiting: boolean): void {
    this.isAwaitingApproval = isWaiting;
    // TODO: この状態変更もGUIに通知すると、UIをより適切に制御できる
  }

  /**
   * 現在のブラウザコンテキストからページリストを最新の状態に更新します。
   * 新しいタブが開かれたり、タブが閉じられた際に呼び出されることを想定しています。
   */
  async updatePages(): Promise<void> {
    this.pages = this.context.pages() as Page[];
    // 状態が変化したのでブロードキャスト
    await this.broadcastState();
  }

  /**
   * 現在アクティブな（ユーザーが見ている）ページオブジェクトを返します。
   * このオブジェクトはStagehandによって拡張されたメソッド（act, extractなど）を持ちます。
   * @returns StagehandのPageプロキシオブジェクト。
   */
  getActivePage(): Page {
    // Stagehandの設計上、stagehand.pageが常にアクティブなタブを指すため、これを信頼する。
    return this.stagehand.page;
  }

  /**
   * 指定されたインデックスのページオブジェクトを取得します。
   * @param index - 取得したいページのインデックス番号。
   * @returns Stagehandによって拡張されたPageオブジェクト。
   * @throws {Error} 指定されたインデックスが無効な場合にエラーをスローします。
   */
  getPageAtIndex(index: number): Page {
    if (index < 0 || index >= this.pages.length) {
      throw new Error(
        `無効なタブインデックスです: ${index}。利用可能なインデックスは 0 から ${
          this.pages.length - 1
        } です。`,
      );
    }
    return this.pages[index];
  }

  /**
   * 現在開いているすべてのタブの情報を取得します。
   * @returns 各タブの情報（インデックス、タイトル、URL、アクティブ状態）を含む配列。
   */
  async getTabInfo(): Promise<TabInfo[]> {
    // updatePagesは外部から呼ばれるため、ここでは直接更新せず、現在のコンテキストから取得
    const currentPages = this.context.pages() as Page[];
    const activePage = this.getActivePage();
    return Promise.all(
      currentPages.map(async (p, index) => ({
        index,
        title: p.isClosed()
          ? "[Closed]"
          : await p.title().catch(() => "[Error]"),
        url: p.isClosed() ? "[Closed]" : p.url(),
        isActive: !p.isClosed() && p.url() === activePage.url(),
      })),
    );
  }

  /**
   * 現在のエージェントの状態をすべてのクライアントにブロードキャストします。
   * 状態が変化した際に呼び出されることを想定しています。
   */
  public async broadcastState(): Promise<void> {
    const tabInfo = await this.getTabInfo();
    eventHub.emit("agent:state-changed", {
      url: this.getActivePage().url(),
      tabs: tabInfo,
      interventionMode: this.interventionMode,
    });
  }
}

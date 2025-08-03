/**
 * @file エージェントの状態管理機能を提供します。
 * このファイルでは、セッション全体で共有される状態（実行履歴、タブ情報、介入モードなど）を
 * 一元的に管理する `AgentState` クラスを定義しています。
 */

import { Page, BrowserContext, Stagehand } from "@browserbasehq/stagehand";
import { ExecutionRecord, TabInfo, InterventionMode } from "./types.js";
import * as readline from "node:readline/promises";

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
  public rl?: readline.Interface;

  /**
   * AgentStateの新しいインスタンスを生成します。
   * @param stagehandInstance - 初期化済みのStagehandインスタンス。
   */
  constructor(stagehandInstance: Stagehand) {
    this.stagehand = stagehandInstance;
    this.context = stagehandInstance.page.context();
    this.pages = [stagehandInstance.page];
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
   * 共有のreadlineインターフェースをセットします。
   * @param rl - アプリケーション全体で共有するreadline.Interfaceインスタンス。
   */
  setReadlineInterface(rl: readline.Interface): void {
    this.rl = rl;
  }

  /**
   * ユーザーの介入モードを設定します。
   * モードによって、AIの自律レベルが変化します。
   * @param mode - 設定する介入モード ('autonomous', 'confirm', 'edit')。
   */
  public setInterventionMode(mode: InterventionMode): void {
    if (["autonomous", "confirm", "edit"].includes(mode)) {
      this.interventionMode = mode;
      console.log(`✅ 介入モードが '${mode}' に設定されました。`);
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
   * 現在のブラウザコンテキストからページリストを最新の状態に更新します。
   * 新しいタブが開かれたり、タブが閉じられた際に呼び出されることを想定しています。
   */
  async updatePages(): Promise<void> {
    this.pages = this.context.pages() as Page[];
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
        `無効なタブインデックスです: ${index}。利用可能なインデックスは 0 から ${this.pages.length - 1} です。`,
      );
    }
    return this.pages[index];
  }

  /**
   * 現在開いているすべてのタブの情報を取得します。
   * @returns 各タブの情報（インデックス、タイトル、URL、アクティブ状態）を含む配列。
   */
  async getTabInfo(): Promise<TabInfo[]> {
    await this.updatePages();
    const activePage = this.getActivePage();
    return Promise.all(
      this.pages.map(async (p, index) => ({
        index,
        title: p.isClosed()
          ? "[Closed]"
          : await p.title().catch(() => "[Error]"),
        url: p.isClosed() ? "[Closed]" : p.url(),
        isActive: !p.isClosed() && p.url() === activePage.url(),
      })),
    );
  }
}

/**
 * @file エージェントの状態管理機能を提供します。
 * このファイルでは、セッション全体で共有される状態（実行履歴、タブ情報、介入モードなど）を
 * 一元的に管理する `AgentState` クラスを定義しています。
 */

import { Page, BrowserContext, Stagehand } from "@browserbasehq/stagehand";
import {
  ExecutionRecord,
  TabInfo,
  InterventionMode,
  Subgoal,
  TacticalPlan,
} from "@/src/types";
import * as readline from "node:readline/promises";
import fs from "fs/promises";
import { getSafePath } from "@/src/utils/file";

const MEMORY_FILE = "memory.json";

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
  // 現在のサブゴールに関連する短期的な事実を保持するワーキングメモリ
  private workingMemory: string[] = [];
  // タスク全体を通じて不変の重要な事実を保持する長期記憶
  private longTermMemory: string[] = [];
  // 完了したサブゴールを記録する
  private completedSubgoals: string[] = [];
  // 現在実行中のサブゴール
  private currentSubgoal: Subgoal | null = null;
  // Tactical Plannerによって生成されたサブゴールのキュー
  private taskQueue: Subgoal[] = [];

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
   * 戦術計画（サブゴールのリスト）をタスクキューの末尾に追加します。
   * @param plan - 追加する戦術計画 (サブゴールの配列)。
   */
  public enqueuePlan(plan: TacticalPlan): void {
    this.taskQueue.push(...plan);
    console.log(
      `📋 タスクキューに${plan.length}件のサブゴールを追加しました。`,
    );
  }

  /**
   * タスクキューの先頭からサブゴールを一つ取り出します。
   * @returns キューの先頭にあるサブゴール。キューが空の場合はundefined。
   */
  public dequeueSubgoal(): Subgoal | undefined {
    return this.taskQueue.shift();
  }

  /**
   * タスクキューが空かどうかを確認します。
   * @returns キューが空の場合はtrue、そうでない場合はfalse。
   */
  public isQueueEmpty(): boolean {
    return this.taskQueue.length === 0;
  }

  /**
   * 現在実行中のサブゴールを設定します。
   * @param subgoal - 現在のサブゴールオブジェクト。
   */
  public setCurrentSubgoal(subgoal: Subgoal): void {
    this.currentSubgoal = subgoal;
  }

  /**
   * 実行履歴に新しいレコードを追加します。
   * @param record - 追加する実行レコード。
   */
  addHistory(
    record: Omit<ExecutionRecord, "subgoalDescription" | "successCriteria">,
  ): void {
    const fullRecord: ExecutionRecord = {
      ...record,
      subgoalDescription: this.currentSubgoal?.description,
      successCriteria: this.currentSubgoal?.successCriteria,
    };
    this.history.push(fullRecord);
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
   * ワーキングメモリに事実を追加します。
   * @param fact - 現在のサブゴールに関連する情報。
   */
  public addToWorkingMemory(fact: string): void {
    this.workingMemory.push(fact);
  }

  /**
   * QA Agentの検証失敗フィードバックをワーキングメモリに追加します。
   * @param reason - 検証が失敗した理由。
   */
  public addQAFailureFeedback(reason: string): void {
    this.addToWorkingMemory(
      `[検証失敗] 直前の行動の結果、成功条件が満たされませんでした。理由: ${reason}`,
    );
  }

  /**
   * ワーキングメモリの内容を取得します。
   * @returns ワーキングメモリの事実の配列。
   */
  public getWorkingMemory(): string[] {
    return this.workingMemory;
  }

  /**
   * ワーキングメモリをクリアします。通常、サブゴールが完了した際に呼び出されます。
   */
  public clearWorkingMemory(): void {
    this.workingMemory = [];
  }

  /**
   * 長期記憶に事実を追加します。重複は自動的に排除されます。
   * @param fact - タスク全体で重要な、永続化すべき情報。
   */
  public addToLongTermMemory(fact: string): void {
    // 堅牢な重複チェック
    const normalizedFact = fact.trim().toLowerCase();
    const isDuplicate = this.longTermMemory.some(
      (existing) => existing.trim().toLowerCase() === normalizedFact,
    );
    if (!isDuplicate) {
      this.longTermMemory.push(fact);
    }
    // TODO: 将来的な改善として、長期記憶のサイズに上限を設け、
    // 古い情報や重要度の低い情報を削除する戦略（例: FIFO, LRU, LLMによる要約）を検討する。
  }

  /**
   * 長期記憶の内容を取得します。
   * @returns 長期記憶の事実の配列。
   */
  public getLongTermMemory(): string[] {
    return this.longTermMemory;
  }

  /**
   * 完了したサブゴールのリストに新しいゴールを追加します。
   * @param subgoal - 完了したサブゴールの文字列。
   */
  public addCompletedSubgoal(subgoal: string): void {
    this.completedSubgoals.push(subgoal);
  }

  /**
   * 完了したすべてのサブゴールのリストを取得します。
   * @returns 完了したサブゴールの文字列の配列。
   */
  public getCompletedSubgoals(): string[] {
    return this.completedSubgoals;
  }

  /**
   * 長期記憶をファイルに保存します。
   * ワーキングメモリはセッション固有のため保存しません。
   */
  async saveMemory(): Promise<void> {
    try {
      const memoryPath = getSafePath(MEMORY_FILE);
      const dataToSave = {
        longTermMemory: this.longTermMemory,
      };
      const data = JSON.stringify(dataToSave, null, 2);
      await fs.writeFile(memoryPath, data);
      console.log(`🧠 記憶を ${memoryPath} に保存しました。`);
    } catch (error) {
      console.warn("⚠️ 記憶の保存に失敗しました:", error);
    }
  }

  /**
   * 長期記憶をファイルから読み込みます。
   * アプリケーション起動時に呼び出されることを想定しています。
   */
  async loadMemory(): Promise<void> {
    try {
      const memoryPath = getSafePath(MEMORY_FILE);
      const data = await fs.readFile(memoryPath, "utf-8");
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed.longTermMemory)) {
        this.longTermMemory = parsed.longTermMemory;
        console.log(
          `🧠 ${this.longTermMemory.length}件の記憶を ${memoryPath} から読み込みました。`,
        );
      }
    } catch (error: any) {
      if (error.code !== "ENOENT") {
        // ファイルが存在しない(ENOENT)場合は初回起動なのでエラー表示しない
        console.warn("⚠️ 記憶の読み込みに失敗しました:", error);
      }
    }
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

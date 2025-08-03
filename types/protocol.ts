/**
 * @file バックエンド、CUI、GUI間でやり取りされるメッセージのデータ構造（プロトコル）を定義します。
 * このファイルを共通の「言葉」とすることで、各コンポーネント間の通信を型安全にします。
 */

import { ToolCall } from "ai";

/**
 * サーバー（バックエンド）からクライアント（CUI/GUI）へ送信されるイベントの型定義。
 */
export interface ServerToClientEvents {
  /**
   * エージェントのログを通知します。
   * @param payload - ログの内容を含むオブジェクト。
   */
  "agent:log": (payload: LogPayload) => void;

  /**
   * 司令塔エージェントが生成した新しい計画を通知します。
   * @param payload - 計画の内容を含むオブジェクト。
   */
  "agent:plan-updated": (payload: { plan: ToolCall<string, any>[] }) => void;

  /**
   * エージェントの内部状態（現在のURL、タブ情報など）の変更を通知します。
   * @param payload - 最新の状態を含むオブジェクト。
   */
  "agent:state-changed": (payload: AgentStatePayload) => void;

  /**
   * ブラウザの最新のスクリーンショットを通知します。
   * @param payload - Base64エンコードされた画像データを含むオブジェクト。
   */
  "browser:screenshot-updated": (payload: { image: string }) => void; // Base64 string

  /**
   * ユーザーに計画の承認を要求します。
   * @param payload - 承認を求める計画の内容。
   */
  "agent:approval-request": (payload: { plan: ToolCall<string, any>[] }) => void;
}

/**
 * クライアント（CUI/GUI）からサーバー（バックエンド）へ送信されるイベントの型定義。
 */
export interface ClientToServerEvents {
  /**
   * エージェントにコマンドの実行を要求します。
   * @param payload - 実行するコマンド、引数、および実行元（CUI/GUI）の情報。
   * @param ack - コマンドの実行結果を非同期で受け取るためのコールバック関数。
   */
  "agent:run-command": (
    payload: { command: string; args: string; source: "cui" | "gui" },
    // コマンド実行結果を返すためのコールバック
    ack: (response: CommandResponse) => void,
  ) => void;

  /**
   * AIが生成した計画の承認・拒否をサーバーに通知します。
   * @param payload - 承認結果と、編集された場合は新しい計画を含むオブジェクト。
   */
  "agent:approve-plan": (payload: {
    approved: boolean;
    editedPlan?: ToolCall<string, any>[];
  }) => void;

  /**
   * GUIクライアントが接続した際に、現在のエージェントの全状態を要求します。
   */
  "gui:request-initial-state": () => void;

  /**
   * ユーザーからの計画への応答をサーバーに送信します。
   * @param payload - 承認結果と、編集された場合は新しい計画を含むオブジェクト。
   */
  "agent:approval-response": (payload: {
    approved: boolean;
    editedPlan?: ToolCall<string, any>[];
  }) => void;
}

// --- ペイロードの具体的な型定義 ---

/**
 * `agent:log`イベントで送信されるログデータの構造。
 */
export type LogPayload = {
  level: "info" | "error" | "warn" | "system";
  message: string;
  timestamp: string;
};

/**
 * `agent:state-changed`イベントで送信されるタブ情報の構造。
 */
export type TabInfo = {
  index: number;
  title: string;
  url: string;
  isActive: boolean;
};

/**
 * `agent:state-changed`イベントで送信されるエージェント状態全体の構造。
 */
export type AgentStatePayload = {
  url: string;
  tabs: TabInfo[];
  interventionMode: "autonomous" | "confirm" | "edit";
};

/**
 * `agent:run-command`のackコールバックで返されるレスポンスの構造。
 */
export type CommandResponse = {
  success: boolean;
  message: string;
  data?: any;
};

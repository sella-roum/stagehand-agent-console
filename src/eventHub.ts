/**
 * @file プロジェクト全体で利用されるイベントハブを提供します。
 * Node.jsのEventEmitterをベースに、型安全なシングルトンインスタンスを実装します。
 * これにより、バックエンド内の各モジュールが互いに直接依存することなく、
 * イベントを通じて疎結合に連携できます。
 */

import { EventEmitter } from "node:events";
import { ServerToClientEvents, ClientToServerEvents } from "../types/protocol.js";

// サーバー内部通信と、サーバーからクライアントへの通知の両方を扱う型を定義
type HubEvents = ServerToClientEvents & ClientToServerEvents;

/**
 * EventEmitterに型情報を付与するためのユーティリティインターフェース。
 * これにより、`on`や`emit`メソッドでイベント名やペイロードの型チェックが有効になります。
 */
interface TypedEventEmitter<TEvents extends Record<string, any>> {
  on<TEvent extends keyof TEvents>(
    event: TEvent,
    listener: TEvents[TEvent],
  ): this;
  emit<TEvent extends keyof TEvents>(
    event: TEvent,
    ...args: Parameters<TEvents[TEvent]>
  ): boolean;
  off<TEvent extends keyof TEvents>(
    event: TEvent,
    listener: TEvents[TEvent],
  ): this;
  removeAllListeners<TEvent extends keyof TEvents>(event?: TEvent): this;
}

/**
 * HubEventsの型情報を持つEventEmitterクラス。
 */
class EventHub extends (EventEmitter as {
  new (): TypedEventEmitter<HubEvents>;
}) {}

/**
 * アプリケーション全体で共有されるシングルトンインスタンス。
 * 各モジュールはこれをインポートしてイベントを送受信します。
 */
export const eventHub = new EventHub();

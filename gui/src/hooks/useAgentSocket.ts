/**
 * @file WebSocket接続を管理し、バックエンドからのイベントを購読して
 * Zustandストアを更新するためのカスタムReactフック。
 */

import { useEffect } from "react";
import { useStore } from "../store.js";
import {
  CommandResponse,
  ServerToClientEvents,
} from "../../../types/protocol.js";
import { ToolCall } from "ai";

// WebSocketインスタンスをモジュールスコープで管理
let ws: WebSocket | null = null;

// ackコールバックを管理するためのMap
const ackCallbacks = new Map<number, (response: CommandResponse) => void>();
let ackIdCounter = 1;

/**
 * バックエンドのWebSocketサーバーに接続し、リアルタイムで状態を同期するカスタムフック。
 * @param url - 接続先のWebSocketサーバーのURL (例: 'ws://localhost:3000/ws')。
 */
export function useAgentSocket(url: string) {
  useEffect(() => {
    // 既に接続がある場合は何もしない
    if (ws && ws.readyState === WebSocket.OPEN) {
      return;
    }

    // WebSocket接続を確立
    ws = new WebSocket(url);

    // 接続成功時の処理
    ws.onopen = () => {
      console.log("WebSocket connected");
      // 接続が確立したら、サーバーに現在のエージェントの完全な状態を要求する
      ws?.send(JSON.stringify({ event: "gui:request-initial-state" }));
    };

    // サーバーからメッセージを受信したときの処理
    ws.onmessage = (event) => {
      try {
        const { event: eventName, payload, ackId, response } = JSON.parse(
          event.data,
        );
        // Zustandの最新の状態を取得するためのgetState()を使用
        const storeActions = useStore.getState();

        // サーバーからのack応答を処理
        if (eventName === "ack" && ackId && ackCallbacks.has(ackId)) {
          const callback = ackCallbacks.get(ackId);
          callback?.(response);
          ackCallbacks.delete(ackId);
          return;
        }

        switch (eventName as keyof ServerToClientEvents) {
          case "agent:log":
            storeActions.addLog(payload);
            break;
          case "browser:screenshot-updated":
            storeActions.setScreenshot(payload.image);
            break;
          case "agent:state-changed":
            storeActions.setState(payload);
            break;
          case "agent:plan-updated":
            // TODO: 計画表示用の状態をストアに追加する
            console.log("Plan updated:", payload.plan);
            break;
          case "agent:approval-request":
            storeActions.setPlanForApproval(payload.plan);
            break;
          default:
            // ackなどのクライアントが送信しないイベントは無視
            if (eventName !== "ack") {
              console.warn("Unknown WebSocket event received:", eventName);
            }
        }
      } catch (error) {
        console.error("Failed to parse WebSocket message:", error);
      }
    };

    // 接続切断時の処理
    ws.onclose = () => {
      console.log("WebSocket disconnected");
      ws = null;
      // TODO: 必要であれば再接続ロジックをここに追加
    };

    // エラー発生時の処理
    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };

    // コンポーネントがアンマウントされる際にWebSocket接続をクリーンアップ
    return () => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.close();
      }
      ws = null;
    };
  }, [url]);
}

/**
 * GUIからバックエンドにコマンドを送信し、その応答をPromiseとして待機する関数。
 * @param command - 実行するコマンド名。
 * @param args - コマンドの引数。
 * @returns サーバーからのコマンド実行結果を含むPromise。
 */
export function sendCommand(
  command: string,
  args: string,
): Promise<CommandResponse> {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const ackId = ackIdCounter++;
      ackCallbacks.set(ackId, resolve);

      // タイムアウト処理
      setTimeout(() => {
        if (ackCallbacks.has(ackId)) {
          ackCallbacks.delete(ackId);
          reject(new Error("Command timed out."));
        }
      }, 10000); // 10秒のタイムアウト

      ws.send(
        JSON.stringify({
          event: "agent:run-command",
          payload: { command, args, source: "gui" },
          ackId,
        }),
      );
    } else {
      reject(new Error("サーバーに接続されていません。"));
    }
  });
}

/**
 * GUIから計画への応答を送信するための関数。
 * @param approved - 承認したかどうか。
 * @param editedPlan - (オプション) 編集された計画。
 */
export function sendApprovalResponse(
  approved: boolean,
  editedPlan?: ToolCall<string, any>[],
) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(
      JSON.stringify({
        event: "agent:approval-response",
        payload: { approved, editedPlan },
      }),
    );
  }
}

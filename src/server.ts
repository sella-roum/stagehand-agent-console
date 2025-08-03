/**
 * @file WebサーバーとWebSocketサーバーを起動し、GUIクライアントとの通信を管理します。
 * Expressを使用してフロントエンドの静的ファイル配信とAPIエンドポイントを提供し、
 * wsライブラリを使用してリアルタイムの双方向通信を実現します。
 */

import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import path from "path";
import { fileURLToPath } from "url";
import { eventHub } from "./eventHub.js";
import {
  CommandResponse,
  ServerToClientEvents,
} from "../types/protocol.js";
import { AgentState } from "./agentState.js";
import { executeCommand } from "./commandExecutor.js";
import { createProxyMiddleware } from "http-proxy-middleware";

/**
 * WebサーバーとWebSocketサーバーを起動します。
 * @param port - サーバーがリッスンするポート番号。
 * @param state - 現在のエージェントの状態。GUI接続時に初期状態を送信するために使用します。
 */
export function startServer(port: number, state: AgentState) {
  const app = express();
  const server = http.createServer(app);
  // WebSocketサーバーを `/ws` パスで初期化
  const wss = new WebSocketServer({ noServer: true });

  // 新しいGUIクライアントからの接続を処理
  wss.on("connection", (ws) => {
    console.log("[Server] GUIクライアントが接続しました。");

    // GUIクライアントからメッセージを受信したときの処理
    ws.on("message", (message) => {
      try {
        const parsed = JSON.parse(message.toString());
        const { event, payload, ackId } = parsed;

        // GUIからのコマンド実行要求を処理
        if (event === "agent:run-command") {
          executeCommand(
            payload.command,
            payload.args,
            state,
            payload.source,
          ).then((response: CommandResponse) => {
            if (ackId) {
              ws.send(JSON.stringify({ event: "ack", ackId, response }));
            }
          });
        } else if (event === "gui:request-initial-state") {
          // GUIが接続時に現在のエージェント状態を要求した場合
          state.broadcastState();
        } else {
          // その他のイベントはそのままイベントハブに流す
          eventHub.emit(event as any, payload as any);
        }
      } catch (e) {
        console.error("[Server] WebSocketメッセージの解析に失敗:", e);
      }
    });
    
    ws.on("close", () => {
      console.log("[Server] GUIクライアントが切断しました。");
    });
  });

  /**
   * イベントハブからのイベントを、接続されているすべてのGUIクライアントに送信（ブロードキャスト）します。
   * @param event - 送信するイベント名。
   * @param payload - 送信するデータ。
   */
  const broadcast = <T extends keyof ServerToClientEvents>(
    event: T,
    payload: Parameters<ServerToClientEvents[T]>[0],
  ) => {
    const message = JSON.stringify({ event, payload });
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  };

  // イベントハブを購読し、イベントが発生したらブロードキャストする
  eventHub.on("agent:log", (payload) => broadcast("agent:log", payload));
  eventHub.on("agent:plan-updated", (payload) =>
    broadcast("agent:plan-updated", payload),
  );
  eventHub.on("agent:state-changed", (payload) =>
    broadcast("agent:state-changed", payload),
  );
  eventHub.on("browser:screenshot-updated", (payload) =>
    broadcast("browser:screenshot-updated", payload),
  );

  // --- フロントエンド配信設定の修正 ---
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  if (process.env.NODE_ENV === "production") {
    // --- 本番モード ---
    // ビルドされた静的ファイルを配信
    const guiDistPath = path.join(__dirname, "../../gui/dist");
    app.use(express.static(guiDistPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(guiDistPath, "index.html"));
    });
    console.log("[Server] 本番モードで起動。静的ファイルを配信します。");
  } else {
    // --- 開発モード ---
    // プロキシミドルウェアをインスタンスとして作成
    const viteProxy = createProxyMiddleware({
      target: "http://localhost:5173",
      changeOrigin: true,
      ws: true, // WebSocketのプロキシを有効にする
    });
    // HTTPリクエストをプロキシに渡す
    app.use("/", viteProxy);
    console.log(
      "[Server] 開発モードで起動。Vite開発サーバー(5173)へプロキシします。",
    );
  }

  // HTTPサーバーのアップグレードリクエストをハンドル
  server.on("upgrade", (request, socket, head) => {
    // WebSocketリクエストをURLパスに基づいてルーティングする
    if (request.url === "/ws") {
      // エージェント用のWebSocket通信は、我々のwssサーバーが処理
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      // それ以外のWebSocket通信（ViteのHMRなど）は、プロキシミドルウェアに処理を委譲
      const viteProxy = app.get("viteProxy"); // Expressアプリからプロキシインスタンスを取得
      if (viteProxy && viteProxy.upgrade) {
        viteProxy.upgrade(request, socket, head);
      } else {
        socket.destroy();
      }
    }
  });

  // 開発モード時にプロキシインスタンスをアプリに保存
  if (process.env.NODE_ENV !== "production") {
    const viteProxy = createProxyMiddleware({
      target: "http://localhost:5173",
      changeOrigin: true,
      ws: true,
    });
    app.set("viteProxy", viteProxy); // upgradeハンドラで参照できるようにインスタンスを保存
    app.use("/", viteProxy);
  }

  server.listen(port, () => {
    console.log(`[Server] サーバーが http://localhost:${port} で起動しました。`);
  });
}

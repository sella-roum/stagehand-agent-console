/**
 * @file GUIアプリケーションのメインコンポーネント。
 * 全体のレイアウトを定義し、WebSocket接続を開始します。
 */
import React from 'react';
import { useAgentSocket, sendApprovalResponse } from './hooks/useAgentSocket.js';
import { BrowserView } from './components/BrowserView.js';
import { LogPanel } from './components/LogPanel.js';
import { StatePanel } from './components/StatePanel.js';
import { CommandBar } from './components/CommandBar.js';
import { useStore } from './store.js';
import { ApprovalModal } from './components/ApprovalModal.jsx';

/**
 * アプリケーションのルートコンポーネントです。
 * 主要なUIパネルを配置し、バックエンドとのWebSocket接続を確立します。
 * @returns アプリケーション全体のJSX要素。
 */
function App() {
  // WebSocketフックを呼び出してバックエンドとの接続を開始・維持
  useAgentSocket('ws://localhost:3000/ws');
  const { planForApproval, clearPlanForApproval } = useStore((state) => ({
    planForApproval: state.planForApproval,
    clearPlanForApproval: state.clearPlanForApproval,
  }));

  /**
   * GUIで計画が承認されたときのハンドラ。
   */
  const handleApprove = () => {
    if (planForApproval) {
      sendApprovalResponse(true, planForApproval);
      clearPlanForApproval();
    }
  };

  /**
   * GUIで計画が拒否されたときのハンドラ。
   */
  const handleReject = () => {
    sendApprovalResponse(false);
    clearPlanForApproval();
  };

  return (
    <div className="app-container">
      <main className="main-panel">
        <BrowserView />
        <CommandBar />
      </main>
      <aside className="side-panel">
        <StatePanel />
        <LogPanel />
      </aside>
      {planForApproval && (
        <ApprovalModal
          plan={planForApproval}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      )}
    </div>
  );
}

export default App;

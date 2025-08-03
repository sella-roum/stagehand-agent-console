/**
 * @file ユーザーがエージェントにコマンドを送信するためのUIコンポーネント。
 * チャット形式の入力欄と送信ボタンを提供します。
 */
import React, { useState } from 'react';
import './CommandBar.css';
import { sendCommand } from '../hooks/useAgentSocket.js';
import { useStore } from '../store.js';

/**
 * ユーザーが自然言語でタスクを指示するためのチャット形式のUIコンポーネントです。
 * @returns コマンドバーのJSX要素。
 */
export function CommandBar() {
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const addLog = useStore((state) => state.addLog);

  /**
   * 送信ボタンがクリックされたときに呼び出されるハンドラ。
   * 入力されたテキストを解析し、コマンドと引数に分割して送信します。
   */
  const handleSend = async () => {
    if (!inputValue.trim() || isSending) return;

    setIsSending(true);
    const commandInput = inputValue;
    
    const [command, ...argsArray] = commandInput.split(/:(.*)/s);
    const args = argsArray.join(':').trim();

    const finalCommand = args ? command.trim() : 'agent';
    const finalArgs = args ? args : command.trim();

    // ユーザーの入力をログに追加
    addLog({
      level: 'info',
      message: `> ${commandInput}`,
      timestamp: new Date().toISOString(),
    });

    try {
      // WebSocket経由でコマンドを送信し、応答を待つ
      const response = await sendCommand(finalCommand, finalArgs);

      // サーバーからの応答をログに追加
      if (response.success) {
        let message = `✅ ${response.message}`;
        if (response.data) {
          // データがオブジェクトなら見やすく整形
          const dataStr = typeof response.data === 'object' 
            ? JSON.stringify(response.data, null, 2) 
            : response.data;
          message += `\n--- Data ---\n${dataStr}`;
        }
        addLog({ level: 'system', message, timestamp: new Date().toISOString() });
      } else {
        addLog({ level: 'error', message: `❌ ${response.message}`, timestamp: new Date().toISOString() });
      }
    } catch (error: any) {
      // タイムアウトなどのエラーをログに追加
      addLog({ level: 'error', message: `Error: ${error.message}`, timestamp: new Date().toISOString() });
    } finally {
      setIsSending(false);
      setInputValue('');
    }
  };

  /**
   * テキストエリアでのキー入力イベントを処理するハンドラ。
   * Shift + Enterで改行、Enterのみでの送信を防ぎます。
   * @param event - キーボードイベントオブジェクト。
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enterキーが押され、かつShiftキーが押されていない場合に送信
    if (event.key === 'Enter' && !event.shiftKey) {
      // デフォルトの改行動作をキャンセル
      event.preventDefault();
      handleSend();
    }
    // Shift + Enterの場合は、通常の改行動作が行われる
  };

  return (
    <div className="command-bar panel">
      <h2 className="panel-title">Input Command</h2>
      <div className="chat-input-container">
        <textarea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="例: agent:StagehandのGitHubリポジトリのスター数を調べて"
          rows={3}
          disabled={isSending}
        />
        <button onClick={handleSend} disabled={isSending}>
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
}

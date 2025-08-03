/**
 * @file エージェントのログを時系列で表示するコンポーネント。
 */
import { useEffect, useRef } from 'react';
import { useStore } from '../store.js';
import './LogPanel.css';

/**
 * バックエンドから受信したログをリアルタイムで表示するUIコンポーネントです。
 * 新しいログが追加されると自動的に最下部までスクロールします。
 * @returns ログパネルのJSX要素。
 */
export function LogPanel() {
  const logs = useStore((state) => state.logs);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新しいログが追加されたら自動でスクロール
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="log-panel panel">
      <h2 className="panel-title">Agent Logs</h2>
      <div className="log-content" ref={scrollRef}>
        {logs.map((log, index) => (
          <div key={index} className={`log-entry log-${log.level}`}>
            <span className="log-timestamp">{new Date(log.timestamp).toLocaleTimeString()}</span>
            <span className="log-message">{log.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

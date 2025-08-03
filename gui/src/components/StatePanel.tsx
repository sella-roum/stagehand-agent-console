/**
 * @file エージェントの現在の状態（URL、タブ情報など）を表示するコンポーネント。
 */
import { useStore } from '../store.js';
import './StatePanel.css';

/**
 * エージェントの現在の状態（URL、開いているタブ、介入モード）を
 * リアルタイムで表示するUIコンポーネントです。
 * @returns 状態パネルのJSX要素。
 */
export function StatePanel() {
  const { currentUrl, tabs, interventionMode } = useStore((state) => ({
    currentUrl: state.currentUrl,
    tabs: state.tabs,
    interventionMode: state.interventionMode,
  }));

  return (
    <div className="state-panel panel">
      <h2 className="panel-title">Agent State</h2>
      <div className="state-content">
        <div className="state-item">
          <strong>URL:</strong> <span>{currentUrl}</span>
        </div>
        <div className="state-item">
          <strong>Mode:</strong> <span>{interventionMode}</span>
        </div>
        <div className="state-item">
          <strong>Tabs:</strong>
          <ul>
            {tabs.map((tab) => (
              <li key={tab.index} className={tab.isActive ? 'active' : ''}>
                [{tab.index}] {tab.title}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

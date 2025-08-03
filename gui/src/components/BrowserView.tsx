/**
 * @file エージェントが操作しているブラウザのスクリーンショットを表示するコンポーネント。
 */
import { useStore } from '../store.js';
import './BrowserView.css';

/**
 * バックエンドから受信したスクリーンショットをリアルタイムで表示するUIコンポーネントです。
 * @returns ブラウザビューのJSX要素。
 */
export function BrowserView() {
  const screenshot = useStore((state) => state.screenshot);

  return (
    <div className="browser-view panel">
      <h2 className="panel-title">Browser View</h2>
      <div className="screenshot-container">
        {screenshot ? (
          <img src={screenshot} alt="Live browser screenshot" />
        ) : (
          <div className="placeholder">
            <p>Waiting for browser screenshot...</p>
          </div>
        )}
      </div>
    </div>
  );
}

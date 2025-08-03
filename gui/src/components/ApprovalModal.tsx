/**
 * @file AIの実行計画をユーザーに提示し、承認または拒否を求めるモーダルUI。
 */
import { ToolCall } from 'ai';
import './ApprovalModal.css';

interface ApprovalModalProps {
  plan: ToolCall<string, any>[];
  onApprove: () => void;
  onReject: () => void;
}

/**
 * AIの実行計画をユーザーに提示し、承認または拒否を求めるモーダルコンポーネント。
 * @param props - コンポーネントのプロパティ。
 * @param props.plan
 * @param props.onApprove
 * @param props.onReject
 * @returns 承認モーダルのJSX要素。
 */
export function ApprovalModal({ plan, onApprove, onReject }: ApprovalModalProps) {
  return (
    <div className="modal-overlay">
      <div className="modal-content panel">
        <h2 className="panel-title">実行計画の承認</h2>
        <p>AIは以下の計画を実行しようとしています。よろしいですか？</p>
        <ul className="plan-list">
          {plan.map((step, index) => (
            <li key={index}>
              {index + 1}. {step.toolName}({JSON.stringify(step.args)})
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button className="reject-button" onClick={onReject}>Reject</button>
          <button className="approve-button" onClick={onApprove}>Approve</button>
        </div>
      </div>
    </div>
  );
}

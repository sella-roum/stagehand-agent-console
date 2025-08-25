import { ToolCall } from "ai";
import { createHash } from "crypto";
import { AgentState } from "./agentState";
import { FailureContext } from "./types";

const MAX_CONSECUTIVE_FAILURES = 5;
const MAX_REPEATED_FAILURES = 3;
const MAX_STAGNATION_COUNT = 3;

/**
 * エージェントの失敗パターンと進捗の停滞を追跡・分析するクラス。
 * 「賢明なギブアップ」ロジックの中核を担う。
 */
export class FailureTracker {
  private consecutiveFailures = 0;
  private stagnationCount = 0;
  private lastStateSnapshot: string | null = null;
  private failureHistory = new Map<
    string,
    { count: number; toolCall: ToolCall<string, any> }
  >();

  /**
   * 成功が確認された際に内部状態を一部リセットする。
   */
  public recordSuccess(): void {
    this.consecutiveFailures = 0;
    // 進捗があったとみなし、停滞カウンタもリセット
    this.stagnationCount = 0;
    // 履歴は学習用途で残す判断もあるが、必要に応じて減衰/クリア戦略を検討
  }

  /**
   * ツール呼び出しオブジェクトを、キーの順序に依存しない安定したハッシュに変換する。
   * @param toolCall - ハッシュ化するツール呼び出し。
   * @returns ハッシュ化された文字列。
   */
  private hashToolCall(toolCall: ToolCall<string, any>): string {
    const stable = (obj: any): any =>
      obj && typeof obj === "object"
        ? Array.isArray(obj)
          ? obj.map(stable)
          : Object.keys(obj)
              .sort()
              .reduce((acc, k) => ((acc[k] = stable(obj[k])), acc), {} as any)
        : obj;
    const data = JSON.stringify({
      toolName: toolCall.toolName,
      args: stable(toolCall.args),
    });
    return createHash("sha256").update(data).digest("hex");
  }

  /**
   * 失敗が発生するたびに呼び出され、内部状態を更新する。
   * @param toolCall - 失敗したツール呼び出し。
   * @param state - 現在のエージェントの状態。
   */
  public async recordFailure(
    toolCall: ToolCall<string, any>,
    state: AgentState,
  ): Promise<void> {
    this.consecutiveFailures++;

    // 失敗パターンの追跡
    const callHash = this.hashToolCall(toolCall);
    const history = this.failureHistory.get(callHash) || { count: 0, toolCall };
    history.count++;
    this.failureHistory.set(callHash, history);

    // 停滞の検知
    const page = state.getActivePage();
    const currentStateSnapshot = `${page.url()}::${(await page.title().catch(() => "")) ?? ""}`;
    if (
      this.lastStateSnapshot &&
      this.lastStateSnapshot === currentStateSnapshot
    ) {
      this.stagnationCount++;
    } else {
      this.stagnationCount = 0; // 状態が変化したらリセット
    }
    this.lastStateSnapshot = currentStateSnapshot;
  }

  /**
   * エージェントが解決不可能なループに陥っているかを判断する。
   * @returns ループに陥っている場合はtrue。
   */
  public isStuck(): boolean {
    if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) return true;
    if (this.stagnationCount >= MAX_STAGNATION_COUNT) return true;
    for (const { count } of this.failureHistory.values()) {
      if (count >= MAX_REPEATED_FAILURES) return true;
    }
    return false;
  }

  /**
   * Chief Agentに渡すための、失敗状況の要約を生成する。
   * @returns 失敗コンテキストオブジェクト。
   */
  public getFailureContext(): FailureContext {
    let summary = `エージェントは${this.consecutiveFailures}回連続で失敗しています。`;
    const repeated = [...this.failureHistory.values()].find(
      (h) => h.count >= MAX_REPEATED_FAILURES,
    );

    if (repeated) {
      summary += ` 特に、ツール「${repeated.toolCall.toolName}」が同じ引数で${repeated.count}回失敗しました。`;
    }
    if (this.stagnationCount >= MAX_STAGNATION_COUNT) {
      summary += ` さらに、${this.stagnationCount}回の試行の間、ブラウザの状態（URLとタイトル）が変化しておらず、進捗が停滞しています。`;
    }

    const mask = (v: any): any => {
      const SENSITIVE_KEYS = new Set([
        "password",
        "token",
        "apiKey",
        "authorization",
        "cookie",
        "cookies",
      ]);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const out: any = {};
        for (const k of Object.keys(v)) {
          out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? "[REDACTED]" : v[k];
        }
        return out;
      }
      return v;
    };

    return {
      consecutiveFailures: this.consecutiveFailures,
      repeatedFailure: repeated
        ? {
            toolName: repeated.toolCall.toolName,
            args: mask(repeated.toolCall.args),
            count: repeated.count,
          }
        : undefined,
      stagnationCount: this.stagnationCount,
      summary,
    };
  }
}

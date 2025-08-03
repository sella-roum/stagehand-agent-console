/**
 * @file CUIとGUIの両方から呼び出されるコマンド実行エンジンを定義します。
 * コマンドの解釈、実行、および結果の返却を一元管理します。
 */

import { AgentState } from "./agentState.js";
import { taskAutomationAgent } from "./taskAutomationAgent.js";
import { getLlmInstance } from "./taskAutomationAgent.js";
import { planSubgoals } from "./chiefAgent.js";
import { CommandResponse } from "../types/protocol.js";
import { eventHub } from "./eventHub.js";

/** コマンドの実行元（CUIかGUIか）を示す型 */
type CommandSource = "cui" | "gui";

/**
 * 指定されたコマンドを実行し、結果を返します。
 * @param command - 実行するコマンド名 (例: 'act', 'goto')。
 * @param args - コマンドに渡す引数文字列。
 * @param state - 現在のエージェントの状態。
 * @param source - コマンドの実行元。GUIからの場合は一部コマンドが制限されます。
 * @returns コマンドの実行結果を含むオブジェクト。
 */
export async function executeCommand(
  command: string,
  args: string,
  state: AgentState,
  source: CommandSource,
): Promise<CommandResponse> {
  // 承認待ちの場合は新しいコマンドをブロック
  if (state.getIsAwaitingApproval()) {
    return {
      success: false,
      message: "現在、別の計画の承認待ちです。応答してから再度お試しください。",
    };
  }

  const page = state.getActivePage();

  switch (command.trim().toLowerCase()) {
    case "act": {
      if (!args) return { success: false, message: "指示を指定してください。" };
      await page.act(args);
      return { success: true, message: `Act: "${args}" を実行しました。` };
    }

    case "observe": {
      const observations = await page.observe(args);
      return {
        success: true,
        message: "Observeコマンドを実行しました。",
        data: observations,
      };
    }

    case "extract": {
      const extraction = args ? await page.extract(args) : await page.extract();
      return {
        success: true,
        message: "Extractコマンドを実行しました。",
        data: extraction,
      };
    }

    case "agent": {
      if (!args) return { success: false, message: "タスクを指定してください。" };
      const llm = getLlmInstance();
      const subgoals = await planSubgoals(args, llm);
      // agentコマンドは長時間実行されるため、非同期で実行を開始し、即座にレスポンスを返す
      (async () => {
        for (const subgoal of subgoals) {
          const success = await taskAutomationAgent(
            subgoal,
            state.getStagehandInstance(),
            state,
            args,
          );
          if (!success) {
            eventHub.emit("agent:log", {
              level: "error",
              message: `サブゴール "${subgoal}" の実行に失敗しました。`,
              timestamp: new Date().toISOString(),
            });
            break;
          }
        }
      })();
      return { success: true, message: `Agentタスク "${args}" を開始しました。` };
    }

    case "inspect": {
      await page.pause();
      return { success: true, message: "Inspectorを閉じました。" };
    }

    case "eval": {
      // GUIからのeval実行はセキュリティリスクのため禁止
      if (source === "gui") {
        return {
          success: false,
          message: "セキュリティエラー: 'eval'コマンドはGUIモードでは無効です。",
        };
      }
      if (!args) return { success: false, message: "実行するコードを指定してください。" };
      const result = await new Function(
        "page",
        `return (async () => { ${args} })()`,
      )(page);
      return {
        success: true,
        message: "Evalコマンドを実行しました。",
        data: result,
      };
    }

    case "goto": {
      if (!args) return { success: false, message: "URLを指定してください。" };
      await page.goto(args);
      return { success: true, message: `${args} に移動しました。` };
    }

    default:
      return { success: false, message: `不明なコマンドです: "${command}"` };
  }
}

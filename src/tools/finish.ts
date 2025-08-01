import { z } from "zod";
import { AgentState } from "../agentState.js";
import { getEvaluationPrompt, evaluationSchema } from "../prompts/evaluation.js";
import { LanguageModel, generateObject } from "ai";

export const finishSchema = z.object({
  answer: z.string().describe("ユーザーの初期タスクに対する最終的な回答。"),
});

export const finishTool = {
  name: "finish",
  description: "全てのタスクが完了したと判断した場合に、最終的な回答をユーザーに報告して終了するために使用します。",
  schema: finishSchema,
  execute: async (state: AgentState, { answer }: z.infer<typeof finishSchema>, llm: LanguageModel, initialTask: string): Promise<string> => {
    console.log(`\n🏁 エージェントがタスク完了を報告しました。最終回答: ${answer}`);
    console.log("  ...自己評価を実行中...");

    const historySummary = JSON.stringify(state.getHistory().slice(-5)); // 直近5件の履歴
    const evalPrompt = getEvaluationPrompt(initialTask, answer, historySummary);

    const { object: evaluationResult } = await generateObject({
      model: llm,
      prompt: evalPrompt,
      schema: evaluationSchema,
    });

    console.log("\n--- 自己評価結果 ---");
    if (evaluationResult.is_success) {
      console.log("  ✅ 評価: 成功");
    } else {
      console.log("  ❌ 評価: 失敗");
    }
    console.log(`  理由: ${evaluationResult.reasoning}`);
    console.log("--------------------");

    // "finish"が呼ばれたことを示す特別な文字列を返す
    return `SELF_EVALUATION_COMPLETE: ${JSON.stringify(evaluationResult)}`;
  },
};

/**
 * @file `ask_user`ツールを定義します。
 * このツールは、エージェントが自律的に解決できない問題に直面した際に、
 * ユーザーに直接質問し、回答を得るための機能を提供します。
 */

import { z } from "zod";
import { AgentState } from "@/src/agentState";
import { CustomTool } from "@/src/types";

/**
 * `ask_user`ツールの入力スキーマ。
 */
export const askUserSchema = z.object({
  question: z
    .string()
    .describe(
      "ユーザーに尋ねる具体的な質問。はい/いいえで答えられる質問や、特定の情報を求める質問など。",
    ),
});

/**
 * `ask_user`ツールの定義オブジェクト。
 */
export const askUserTool: CustomTool<typeof askUserSchema> = {
  name: "ask_user",
  description:
    "自分だけでは解決できない問題に直面した際に、ユーザーに助けを求めるために使用します。曖昧な指示の明確化、ログイン情報やCAPTCHAの解決、または完全に行き詰まった場合などに使用してください。",
  schema: askUserSchema,
  /**
   * `ask_user`ツールを実行します。
   * コンソールを通じてユーザーに質問を提示し、入力を待ち受けます。
   * @param state - 現在のエージェントの状態。
   * @param args - `askUserSchema`に基づいた引数。
   * @param args.question
   * @returns ユーザーからの回答文字列。
   * @throws {Error} テスト環境など、非対話モードで呼び出された場合にエラーをスローします。
   */
  execute: async (
    state: AgentState,
    { question }: z.infer<typeof askUserSchema>,
  ): Promise<string> => {
    // このツールは非対話モードでは呼び出されない想定だが、安全のためにエラーをスローする
    if (process.env.NODE_ENV === "test") {
      throw new Error("ユーザーへの質問はテスト環境では許可されていません。");
    }

    // AgentStateに保存されている共有のreadlineインスタンスを取得
    const rl = state.rl;
    if (!rl) {
      // 共有インスタンスが存在しない場合はエラー（通常は発生しないはず）
      throw new Error("Readline interface is not available. Cannot ask user.");
    }

    console.log(`\n🤔 AIがあなたに質問しています...`);
    const answer = await rl.question(`  ${question}\n  > `);
    // 共有インスタンスなので、ここでは絶対にclose()しない
    return `ユーザーは次のように回答しました: "${answer}"`;
  },
};

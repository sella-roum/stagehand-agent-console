import { z } from "zod";
import { AgentState } from "../agentState.js";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export const askUserSchema = z.object({
  question: z.string().describe("ユーザーに尋ねる具体的な質問。はい/いいえで答えられる質問や、特定の情報を求める質問など。"),
});

export const askUserTool = {
  name: "ask_user",
  description: "自分だけでは解決できない問題に直面した際に、ユーザーに助けを求めるために使用します。曖昧な指示の明確化、ログイン情報やCAPTCHAの解決、または完全に行き詰まった場合などに使用してください。",
  schema: askUserSchema,
  execute: async (state: AgentState, { question }: z.infer<typeof askUserSchema>): Promise<string> => {
    // このツールは非対話モードでは呼び出されない想定だが、
    // 安全のためにエラーをスローする
    if (process.env.NODE_ENV === 'test') {
        throw new Error("ユーザーへの質問はテスト環境では許可されていません。");
    }
    
    const rl = readline.createInterface({ input, output });
    console.log(`\n🤔 AIがあなたに質問しています...`);
    const answer = await rl.question(`  ${question}\n  > `);
    rl.close();
    return `ユーザーは次のように回答しました: "${answer}"`;
  },
};

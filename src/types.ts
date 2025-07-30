import { z } from "zod";

// planStepSchemaをここで定義する方がより適切
export const planStepSchema = z.object({
  step: z.number().describe("ステップ番号"),
  command: z.enum([
    "goto", 
    "act", 
    "extract", 
    "observe", 
    "finish",
    "new_tab",
    "switch_tab",
    "close_tab",
    "write_file",
    "read_file"
  ])
    .describe("実行するコマンドの種類"),
  argument: z.string().nullable().describe("コマンドに渡す引数。不要な場合はnull。"),
  reasoning: z.string().describe("このステップを実行する思考プロセス"),
  expected_outcome: z.string().describe("このステップが成功した後に期待されるページの状態変化の簡潔な説明。例えば、「ログイン後のダッシュボードページにいるはず」「検索結果が表示されているはず」など。"),
  messageToUser: z.string().nullable().optional().describe("ユーザーへのメッセージや質問。不要な場合はnull。"),
});

export type PlanStep = z.infer<typeof planStepSchema>;

export type ExecutionRecord = {
  step: PlanStep;
  result?: any;
  error?: string;
  userFeedback?: string;
};

export type TabInfo = {
  index: number;
  title: string;
  url: string;
  isActive: boolean;
};

export const reflectionSchema = z.object({
    cause_analysis: z.string().describe("エラーの最も可能性の高い原因の分析"),
    alternative_approaches: z.array(z.string()).describe("問題を回避し、最終目標を達成するための代替アプローチのリスト"),
});

export type ReflectionResult = z.infer<typeof reflectionSchema>;

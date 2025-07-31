import { z } from "zod";
import { AgentState } from "../agentState.js";
import { confirmAction } from "../debugConsole.js";
import { getSafePath } from "../../utils.js";
import fs from "fs/promises";

// --- writeFile Tool ---
export const writeFileSchema = z.object({
  filename: z.string().describe("書き込むファイル名。例: 'report.txt'"),
  content: z.string().describe("ファイルに書き込むテキスト内容。"),
});

export const writeFileTool = {
  name: "write_file",
  description: "テキストコンテンツをローカルの'workspace'ディレクトリ内のファイルに書き出します。",
  schema: writeFileSchema,
  execute: async (state: AgentState, { filename, content }: z.infer<typeof writeFileSchema>): Promise<string> => {
    const writeConfirmation = await confirmAction(`🤖 AIがファイル '${filename}' への書き込みを要求しています。許可しますか？`);
    if (!writeConfirmation) throw new Error("ユーザーがファイル書き込みを拒否しました。");

    const writePath = getSafePath(filename);
    await fs.writeFile(writePath, content);
    return `ファイル '${filename}' に正常に書き込みました。`;
  },
};

// --- readFile Tool ---
export const readFileSchema = z.object({
  filename: z.string().describe("読み込むファイル名。例: 'input.txt'"),
});

export const readFileTool = {
  name: "read_file",
  description: "ローカルの'workspace'ディレクトリ内のファイルの内容を読み込みます。",
  schema: readFileSchema,
  execute: async (state: AgentState, { filename }: z.infer<typeof readFileSchema>): Promise<string> => {
    const readConfirmation = await confirmAction(`🤖 AIがファイル '${filename}' の読み込みを要求しています。許可しますか？`);
    if (!readConfirmation) throw new Error("ユーザーがファイル読み込みを拒否しました。");

    const readPath = getSafePath(filename);
    return await fs.readFile(readPath, 'utf-8');
  },
};

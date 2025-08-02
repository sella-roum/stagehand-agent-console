/**
 * @file ローカルファイルシステムを操作するためのツールを定義します。
 * `workspace`ディレクトリ内での安全なファイルの読み書き機能を提供します。
 */

import { z } from "zod";
import { AgentState } from "../agentState.js";
import { confirmAction } from "../debugConsole.js";
import { getSafePath } from "../../utils.js";
import fs from "fs/promises";

// --- writeFile Tool ---

/**
 * `write_file`ツールの入力スキーマ。
 */
export const writeFileSchema = z.object({
  filename: z.string().describe("書き込むファイル名。例: 'report.txt'"),
  content: z.string().describe("ファイルに書き込むテキスト内容。"),
});

/**
 * `write_file`ツールの定義オブジェクト。
 */
export const writeFileTool = {
  name: "write_file",
  description: "テキストコンテンツをローカルの'workspace'ディレクトリ内のファイルに書き出します。",
  schema: writeFileSchema,
  /**
   * `write_file`ツールを実行します。
   * セキュリティのため、ユーザーに書き込みの許可を求めます。
   * @param state - 現在のエージェントの状態。
   * @param args - `writeFileSchema`に基づいた引数。
   * @returns ファイル書き込みの成功メッセージ。
   * @throws {Error} ユーザーが操作を拒否した場合、またはファイルパスが安全でない場合にエラーをスローします。
   */
  execute: async (state: AgentState, { filename, content }: z.infer<typeof writeFileSchema>): Promise<string> => {
    // セキュリティ上のリスクを避けるため、ファイル書き込み前にユーザーの確認を必須とする
    const writeConfirmation = await confirmAction(`🤖 AIがファイル '${filename}' への書き込みを要求しています。許可しますか？`);
    if (!writeConfirmation) throw new Error("ユーザーがファイル書き込みを拒否しました。");

    const writePath = getSafePath(filename);
    await fs.writeFile(writePath, content);
    return `ファイル '${filename}' に正常に書き込みました。`;
  },
};

// --- readFile Tool ---

/**
 * `read_file`ツールの入力スキーマ。
 */
export const readFileSchema = z.object({
  filename: z.string().describe("読み込むファイル名。例: 'input.txt'"),
});

/**
 * `read_file`ツールの定義オブジェクト。
 */
export const readFileTool = {
  name: "read_file",
  description: "ローカルの'workspace'ディレクトリ内のファイルの内容を読み込みます。",
  schema: readFileSchema,
  /**
   * `read_file`ツールを実行します。
   * セキュリティのため、ユーザーに読み込みの許可を求めます。
   * @param state - 現在のエージェントの状態。
   * @param args - `readFileSchema`に基づいた引数。
   * @returns 読み込んだファイルの内容。
   * @throws {Error} ユーザーが操作を拒否した場合、またはファイルパスが安全でない場合にエラーをスローします。
   */
  execute: async (state: AgentState, { filename }: z.infer<typeof readFileSchema>): Promise<string> => {
    // セキュリティ上のリスクを避けるため、ファイル読み込み前にユーザーの確認を必須とする
    const readConfirmation = await confirmAction(`🤖 AIがファイル '${filename}' の読み込みを要求しています。許可しますか？`);
    if (!readConfirmation) throw new Error("ユーザーがファイル読み込みを拒否しました。");

    const readPath = getSafePath(filename);
    return await fs.readFile(readPath, 'utf-8');
  },
};

/**
 * @file ローカルファイルシステムを操作するためのツールを定義します。
 * `workspace`ディレクトリ内での安全なファイルの読み書き機能を提供します。
 */

import { z } from "zod";
import { AgentState } from "@/src/agentState";
import { confirmAction } from "@/src/debugConsole";
import { getSafePath } from "@/src/utils/file";
import fs from "fs/promises";
import { PreconditionResult, CustomTool } from "@/src/types";
import { InvalidToolArgumentError } from "../errors";
import { Buffer } from "buffer";

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
export const writeFileTool: CustomTool<typeof writeFileSchema, string> = {
  name: "write_file",
  description:
    "テキストコンテンツをローカルの'workspace'ディレクトリ内のファイルに書き出します。",
  schema: writeFileSchema,
  /**
   * `write_file`ツールを実行します。
   * セキュリティのため、ユーザーに書き込みの許可を求めます。
   * @param state - 現在のエージェントの状態。
   * @param args - `writeFileSchema`に基づいた引数。
   * @param args.filename
   * @param args.content
   * @returns ファイル書き込みの成功メッセージ。
   * @throws {Error} ユーザーが操作を拒否した場合、またはファイルパスが安全でない場合にエラーをスローします。
   */
  execute: async (
    state: AgentState,
    { filename, content }: z.infer<typeof writeFileSchema>,
  ): Promise<string> => {
    const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MBの上限を設定

    if (Buffer.byteLength(content, "utf8") > MAX_FILE_SIZE_BYTES) {
      throw new InvalidToolArgumentError(
        `書き込みコンテンツがサイズ上限(${MAX_FILE_SIZE_BYTES}バイト)を超えています。`,
        "write_file",
        { filename, content: `(コンテンツ省略: ${content.length}文字)` },
      );
    }

    // AgentStateから共有のreadlineインターフェースを取得
    if (!state.rl) {
      throw new Error(
        "Readline interface is not available for user confirmation.",
      );
    }
    // セキュリティ上のリスクを避けるため、ファイル書き込み前にユーザーの確認を必須とする
    const writeConfirmation = await confirmAction(
      `🤖 AIがファイル '${filename}' への書き込みを要求しています。許可しますか？`,
      state.rl,
    );
    if (!writeConfirmation)
      throw new Error("ユーザーがファイル書き込みを拒否しました。");

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
export const readFileTool: CustomTool<typeof readFileSchema, string> = {
  name: "read_file",
  description:
    "ローカルの'workspace'ディレクトリ内のファイルの内容を読み込みます。",
  schema: readFileSchema,
  /**
   * read_fileの事前条件チェック
   * @param state
   * @param args
   * @returns 事前条件の結果。成功した場合は { success: true }、失敗した場合は { success: false, message: string }。
   */
  precondition: async (
    state: AgentState,
    args: z.infer<typeof readFileSchema>,
  ): Promise<PreconditionResult> => {
    const { filename } = args;
    try {
      const filePath = getSafePath(filename);
      await fs.access(filePath); // ファイルの存在とアクセス権を確認
      return { success: true };
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (error) {
      return {
        success: false,
        message: `ファイル '${filename}' が存在しないか、アクセスできません。`,
      };
    }
  },
  /**
   * `read_file`ツールを実行します。
   * セキュリティのため、ユーザーに読み込みの許可を求めます。
   * @param state - 現在のエージェントの状態。
   * @param args - `readFileSchema`に基づいた引数。
   * @param args.filename
   * @returns 読み込んだファイルの内容。
   * @throws {Error} ユーザーが操作を拒否した場合、またはファイルパスが安全でない場合にエラーをスローします。
   */
  execute: async (
    state: AgentState,
    { filename }: z.infer<typeof readFileSchema>,
  ): Promise<string> => {
    // AgentStateから共有のreadlineインターフェースを取得
    if (!state.rl) {
      throw new Error(
        "Readline interface is not available for user confirmation.",
      );
    }
    // セキュリティ上のリスクを避けるため、ファイル読み込み前にユーザーの確認を必須とする
    const readConfirmation = await confirmAction(
      `🤖 AIがファイル '${filename}' の読み込みを要求しています。許可しますか？`,
      state.rl,
    );
    if (!readConfirmation)
      throw new Error("ユーザーがファイル読み込みを拒否しました。");

    const readPath = getSafePath(filename);
    const stat = await fs.stat(readPath);
    const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
    if (stat.size > MAX_FILE_SIZE_BYTES) {
      throw new InvalidToolArgumentError(
        `読み込み対象ファイルがサイズ上限(${MAX_FILE_SIZE_BYTES}バイト)を超えています。`,
        "read_file",
        { filename, size: stat.size },
      );
    }
    return await fs.readFile(readPath, "utf-8");
  },
};

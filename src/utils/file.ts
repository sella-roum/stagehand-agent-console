/**
 * @file ファイルシステム関連のユーティリティ関数を提供します。
 */
import fs from "fs/promises";
import path from "node:path";

/**
 * 安全なファイルパスを取得し、ディレクトリトラバーサル攻撃を防ぎます。
 * ファイルパスが`workspace`ディレクトリ内に収まっていることを保証します。
 * @param filename - 操作対象のファイル名。
 * @returns `workspace`ディレクトリをルートとする絶対パス。
 * @throws {Error} パスが`workspace`ディレクトリ外を指している場合にセキュリティエラーをスローします。
 */
export function getSafePath(filename: string): string {
  const workspaceDir = path.resolve(process.cwd(), "workspace");
  const intendedPath = path.resolve(workspaceDir, filename);

  // パスがworkspaceディレクトリ内に収まっているか検証
  if (!intendedPath.startsWith(workspaceDir)) {
    throw new Error(
      `セキュリティエラー: ディレクトリトラバーサルが検出されました。ファイル操作は 'workspace' ディレクトリ内に限定されています。`,
    );
  }

  // ファイルが配置されるディレクトリが存在しない場合は再帰的に作成
  const dir = path.dirname(intendedPath);
  fs.mkdir(dir, { recursive: true });

  return intendedPath;
}

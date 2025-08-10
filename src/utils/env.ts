/**
 * @file 環境変数関連のユーティリティ関数を提供します。
 */

/**
 * 環境変数を取得します。必須の変数が設定されていない場合はエラーをスローします。
 * @param name - 取得する環境変数の名前。
 * @param required - (オプション) この変数が必須かどうか。デフォルトはtrue。
 * @returns 環境変数の値。必須でない場合はundefinedの可能性があります。
 * @throws {Error} 必須の環境変数が設定されていない場合にエラーをスローします。
 */
export function getEnvVar(name: string, required = true): string | undefined {
  const value = process.env[name];
  if (!value && required) {
    throw new Error(`${name} not found in environment variables`);
  }
  return value;
}

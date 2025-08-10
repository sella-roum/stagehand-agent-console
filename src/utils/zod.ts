/**
 * @file Zodスキーマ関連のユーティリティ関数を提供します。
 */
import { z } from "zod";

/**
 * 与えられたデータがZodスキーマに準拠しているか検証します。
 * @param schema - 検証に使用するZodスキーマ。
 * @param data - 検証対象のデータ。
 * @returns データがスキーマに準拠していればtrue、そうでなければfalse。
 */
export function validateZodSchema(
  schema: z.ZodTypeAny,
  data: unknown,
): boolean {
  return schema.safeParse(data).success;
}

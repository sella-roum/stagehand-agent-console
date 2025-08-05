/**
 * @file ツール実行時に発生するカスタムエラークラスを定義します。
 * これにより、エラーの種類とコンテキストを構造化してエージェントに伝えることができます。
 */

import { ZodError } from "zod";

/**
 * ツール実行時に発生するすべてのエラーの基底クラス。
 * どのツールがどのような引数で失敗したかを記録します。
 */
export class ToolExecutionError extends Error {
  public toolName: string;
  public args: any;

  /**
   * @param message - エラーメッセージ。
   * @param toolName - 失敗したツールの名前。
   * @param args - ツールに渡された引数。
   */
  constructor(message: string, toolName: string, args: any) {
    super(message);
    this.name = this.constructor.name;
    this.toolName = toolName;
    this.args = args;
  }
}

/**
 * 指定された要素が見つからなかった、または操作がタイムアウトした場合のエラー。
 */
export class ElementNotFoundError extends ToolExecutionError {
  public instruction: string;
  public selector?: string;

  /**
   * @param message - エラーメッセージ。
   * @param toolName - 失敗したツールの名前。
   * @param args - ツールに渡された引数。
   * @param instruction - 要素を探すために使用された自然言語の指示。
   * @param selector - (オプション) 内部的に使用されたセレクタ。
   */
  constructor(
    message: string,
    toolName: string,
    args: any,
    instruction: string,
    selector?: string,
  ) {
    super(message, toolName, args);
    this.instruction = instruction;
    this.selector = selector;
  }
}

/**
 * ページ遷移がタイムアウトした場合のエラー。
 */
export class NavigationTimeoutError extends ToolExecutionError {
  public url: string;

  /**
   * @param message - エラーメッセージ。
   * @param toolName - 失敗したツールの名前。
   * @param args - ツールに渡された引数。
   * @param url - 遷移しようとしたURL。
   */
  constructor(message: string, toolName: string, args: any, url: string) {
    super(message, toolName, args);
    this.url = url;
  }
}

/**
 * ツールに渡された引数が不正だった場合のエラー。
 */
export class InvalidToolArgumentError extends ToolExecutionError {
  /**
   * @param message - エラーメッセージ。
   * @param toolName - 失敗したツールの名前。
   * @param args - ツールに渡された引数。
   */
  constructor(message: string, toolName: string, args: any) {
    super(message, toolName, args);
  }
}

/**
 * LLMの出力が期待されたZodスキーマの検証に失敗した場合のエラー。
 */
export class SchemaValidationError extends ToolExecutionError {
  public validationErrors: ZodError;
  public rawOutput: any;

  /**
   * @param message - エラーメッセージ。
   * @param toolName - 失敗したツールの名前。
   * @param args - ツールに渡された引数。
   * @param validationErrors - Zodから返された詳細なエラー情報。
   * @param rawOutput - LLMから返された生の出力。
   */
  constructor(
    message: string,
    toolName: string,
    args: any,
    validationErrors: ZodError,
    rawOutput: any,
  ) {
    super(message, toolName, args);
    this.validationErrors = validationErrors;
    this.rawOutput = rawOutput;
  }
}

import { LanguageModel } from "ai";
import { ExecutionRecord } from "@/src/types";
import {
  getSkillGenerationPrompt,
  skillGenerationSchema,
} from "@/src/prompts/skillGeneration";
import { getSafePath } from "@/src/utils/file";
import fs from "fs/promises";
import path from "path";
import { AgentState } from "@/src/agentState";
import { availableTools } from "@/src/tools";
import { generateObjectWithRetry } from "@/src/utils/llm";

/**
 * 動的に生成・ロードされるスキルのインターフェース
 */
export interface Skill {
  name: string;
  description: string;
  execute: (
    state: AgentState,
    args: any,
    llm: LanguageModel,
    initialTask: string,
  ) => Promise<string>;
}

/**
 * 実行履歴を分析し、再利用可能なスキルを生成してファイルに保存します。
 * 生成されたスキルは 'workspace/skills/candidates' ディレクトリに保存されます。
 * @param history - 分析対象のエージェント実行履歴
 * @param llm - スキル生成に使用する言語モデル
 */
export async function generateAndSaveSkill(
  history: ExecutionRecord[],
  llm: LanguageModel,
): Promise<void> {
  // スキル生成に値する十分な履歴があるかチェック
  if (history.length < 3) {
    console.log("💡 履歴が短いため、スキル生成はスキップします。");
    return;
  }

  console.log("💡 スキル生成の可能性を分析中...");
  const historyJson = JSON.stringify(history, null, 2);

  // 現在利用可能なすべてのツール（静的ツール＋動的スキル）の名前と説明を取得
  const existingSkills = availableTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));

  const prompt = getSkillGenerationPrompt(historyJson, existingSkills);

  try {
    const { object: result } = await generateObjectWithRetry({
      model: llm,
      prompt,
      schema: skillGenerationSchema,
    });

    console.log(`  - 分析結果: ${result.reasoning}`);
    if (
      result.should_generate_skill &&
      result.skill_name &&
      result.skill_code &&
      result.skill_description
    ) {
      console.log(`✨ 新しいスキル候補 '${result.skill_name}' を生成します。`);

      // これにより、ディレクトリの存在確認と作成も自動的に行われる
      const safeName = result.skill_name.replace(/[^a-zA-Z0-9_-]/g, "_");
      const relativePath = path.join("skills", "candidates", `${safeName}.ts`);
      const filePath = getSafePath(relativePath);

      const fileContent = `
import { AgentState } from "@/src/agentState";
import { LanguageModel } from "ai";
// @ts-nocheck
// このファイルはAIによって自動生成されました。
// 人間によるレビューと承認を経て 'workspace/skills/approved' に移動されるまで、このスキルは有効になりません。

export const description = "${result.skill_description}";

export async function execute(state: AgentState, args: any, llm: LanguageModel, initialTask: string): Promise<string> {
  ${result.skill_code}
}
`;
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, fileContent);
      console.log(
        `✅ スキル候補を ${filePath} に保存しました。レビューと承認後に有効になります。`,
      );
    }
  } catch (e: any) {
    console.error(`❌ スキル生成中にエラーが発生しました: ${e.message}`);
  }
}

/**
 * 'workspace/skills/approved' ディレクトリから承認済みの動的スキルを読み込みます。
 * @returns スキル名とスキルオブジェクトのMap
 */
export async function loadSkills(): Promise<Map<string, Skill>> {
  const skills = new Map<string, Skill>();
  const skillsDir = path.resolve(
    process.cwd(),
    "workspace",
    "skills",
    "approved",
  );

  try {
    await fs.access(skillsDir);
    const files = await fs.readdir(skillsDir);

    for (const file of files) {
      if (file.endsWith(".ts")) {
        const skillName = path.basename(file, ".ts");
        try {
          // WindowsパスとUnixパスの両方に対応するため、URLオブジェクトを使用
          const modulePath = new URL(`file://${path.join(skillsDir, file)}`)
            .href;
          const skillModule = await import(modulePath);

          if (
            typeof skillModule.execute === "function" &&
            typeof skillModule.description === "string"
          ) {
            skills.set(skillName, {
              name: skillName,
              description: skillModule.description,
              execute: skillModule.execute,
            });
            console.log(`📚 承認済みスキル '${skillName}' を読み込みました。`);
          }
        } catch (e: any) {
          console.error(
            `スキル '${skillName}' の読み込みに失敗しました:`,
            e.message,
          );
        }
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (e) {
    // 'approved' ディレクトリが存在しない場合は何もしない（初回起動時など）
  }
  return skills;
}

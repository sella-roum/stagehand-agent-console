import { LanguageModel, generateObject } from "ai";
import { ExecutionRecord } from "@/src/types";
import {
  getSkillGenerationPrompt,
  skillGenerationSchema,
} from "@/src/prompts/skillGeneration";
import { getSafePath } from "@/utils";
import fs from "fs/promises";
import path from "path";
import { AgentState } from "@/src/agentState";
import { availableTools } from "@/src/tools";

/**
 * 動的に生成・ロードされるスキルのインターフェース
 */
export interface Skill {
  name: string;
  description: string;
  execute: (state: AgentState, args: any) => Promise<string>;
}

/**
 * 実行履歴を分析し、再利用可能なスキルを生成してファイルに保存します。
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
    const { object: result } = await generateObject({
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
      console.log(`✨ 新しいスキル '${result.skill_name}' を生成します。`);

      const skillDir = path.dirname(getSafePath("skills/placeholder.ts"));
      await fs.mkdir(skillDir, { recursive: true });

      const filePath = getSafePath(`skills/${result.skill_name}.ts`);
      const fileContent = `
import { AgentState } from "@/src/agentState";
// @ts-nocheck
// このファイルはAIによって自動生成されました。

export const description = "${result.skill_description}";

export async function execute(state: AgentState, args: any): Promise<string> {
  ${result.skill_code}
}
`;
      await fs.writeFile(filePath, fileContent);
      console.log(
        `✅ スキルを ${filePath} に保存しました。次回起動時から利用可能です。`,
      );
    }
  } catch (e: any) {
    console.error(`❌ スキル生成中にエラーが発生しました: ${e.message}`);
  }
}

/**
 * 'workspace/skills' ディレクトリから動的スキルを読み込みます。
 * @returns スキル名とスキルオブジェクトのMap
 */
export async function loadSkills(): Promise<Map<string, Skill>> {
  const skills = new Map<string, Skill>();
  const skillsDir = path.resolve(process.cwd(), "workspace", "skills");

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
            console.log(`📚 動的スキル '${skillName}' を読み込みました。`);
          }
        } catch (e: any) {
          console.error(
            `スキル '${skillName}' の読み込みに失敗しました:`,
            e.message,
          );
        }
      }
    }
  } catch (e) {
    // skillsディレクトリが存在しない場合は何もしない（初回起動時など）
  }
  return skills;
}

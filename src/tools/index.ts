/**
 * @file エージェントが利用可能なすべてのツールを集約し、初期化するエントリーポイントです。
 * 静的なツールと、動的に生成されるスキル（カスタムツール）を統合し、
 * エージェントが利用できる形で提供します。
 */

import { z } from "zod";
import { gotoTool } from "./goto.js";
import { actTool } from "./act.js";
import { cachedActTool } from "./cached_act.js";
import { extractTool } from "./extract.js";
import { observeTool } from "./observe.js";
import { summarizeTool } from "./summarize.js";
import { writeFileTool, readFileTool } from "./fileSystem.js";
import { newTabTool, switchTabTool, closeTabTool } from "./tabManagement.js";
import { askUserTool } from "./askUser.js";
import { finishTool } from "./finish.js";
import { visionAnalyzeTool, clickAtCoordinatesTool } from "./vision.js";
import { loadSkills } from "../skillManager.js";
import { CustomTool } from "../types.js";

/**
 * @description 静的に定義された、エージェントの基本的なツールセット。
 * アプリケーション起動時に動的スキルが追加される前の初期状態です。
 */
export const availableTools: CustomTool[] = [
  gotoTool,
  actTool,
  cachedActTool,
  extractTool,
  observeTool,
  summarizeTool,
  writeFileTool,
  readFileTool,
  newTabTool,
  switchTabTool,
  closeTabTool,
  askUserTool,
  finishTool,
  visionAnalyzeTool,
  clickAtCoordinatesTool,
];

/**
 * @description ツール名で高速に検索するためのMap。
 * `availableTools`配列から生成されます。
 */
export let toolRegistry = new Map<string, CustomTool>(
  availableTools.map((tool) => [tool.name, tool]),
);

/**
 * 動的に生成されたスキルを`workspace/skills`ディレクトリから読み込み、
 * 利用可能なツールセットに統合します。
 * この関数はアプリケーションの起動時に一度だけ呼び出されるべきです。
 */
export async function initializeTools() {
  const dynamicSkills = await loadSkills();

  dynamicSkills.forEach((skill, name) => {
    const skillTool: CustomTool = {
      name: name,
      description: skill.description,
      // スキルに渡す引数を汎用的に受け入れるためのスキーマ
      schema: z.object({
        args: z.any().describe("スキルに渡す引数（JSONオブジェクト形式）"),
      }),
      // スキルモジュールのexecute関数を呼び出すラッパー関数
      execute: (state: any, { args }: any) => skill.execute(state, args),
    };
    availableTools.push(skillTool);
  });

  // 新しいツールセットでtoolRegistryを再構築
  toolRegistry = new Map<string, CustomTool>(
    availableTools.map((tool) => [tool.name, tool]),
  );
}

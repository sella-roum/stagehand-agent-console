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

// すべてのツールを配列としてエクスポート
export let availableTools = [
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

// 名前でツールを高速に検索するためのMapを作成
export let toolRegistry = new Map(
  availableTools.map(tool => [tool.name, tool])
);

/**
 * 動的に生成されたスキルを読み込み、利用可能なツールセットに統合します。
 * この関数はアプリケーションの起動時に一度だけ呼び出されるべきです。
 */
export async function initializeTools() {
  const dynamicSkills = await loadSkills();
  
  dynamicSkills.forEach((skill, name) => {
    const skillTool = {
      name: name,
      description: skill.description,
      // スキルに渡す引数を汎用的に受け入れるスキーマ
      schema: z.object({ args: z.any().describe("スキルに渡す引数（JSONオブジェクト形式）") }),
      // スキルモジュールのexecute関数を呼び出すラッパー
      execute: (state: any, { args }: any) => skill.execute(state, args),
    };
    // `any`へのキャストは、動的ツールと静的ツールの型をマージするために必要
    availableTools.push(skillTool as any);
  });

  // 新しいツールセットでtoolRegistryを再構築
  toolRegistry = new Map(
    availableTools.map(tool => [tool.name, tool])
  );
}

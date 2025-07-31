import { gotoTool } from "./goto.js";
import { actTool } from "./act.js";
import { cachedActTool } from "./cached_act.js";
import { extractTool } from "./extract.js";
import { observeTool } from "./observe.js";
import { summarizeTool } from "./summarize.js";
import { writeFileTool, readFileTool } from "./fileSystem.js";
import { newTabTool, switchTabTool, closeTabTool } from "./tabManagement.js";
import { askUserTool } from "./askUser.js";

// すべてのツールを配列としてエクスポート
export const availableTools = [
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
];

// 名前でツールを高速に検索するためのMapを作成
export const toolRegistry = new Map(
  availableTools.map(tool => [tool.name, tool])
);

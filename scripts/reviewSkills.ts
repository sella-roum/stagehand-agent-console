/**
 * @file AIによって生成されたスキル候補をレビューするための対話型CLIツール。
 */

import fs from "fs/promises";
import path from "path";
import inquirer from "inquirer";
import chalk from "chalk";

const CANDIDATES_DIR = path.resolve(
  process.cwd(),
  "workspace",
  "skills",
  "candidates",
);
const APPROVED_DIR = path.resolve(
  process.cwd(),
  "workspace",
  "skills",
  "approved",
);
// 拒否されたスキルを保存するディレクトリ
const REJECTED_DIR = path.resolve(
  process.cwd(),
  "workspace",
  "skills",
  "rejected",
);

/**
 * スキル管理に必要なディレクトリが存在することを保証する関数
 */
async function ensureSkillDirsExist(): Promise<void> {
  try {
    await fs.mkdir(CANDIDATES_DIR, { recursive: true });
    await fs.mkdir(APPROVED_DIR, { recursive: true });
    await fs.mkdir(REJECTED_DIR, { recursive: true });
  } catch (error) {
    console.error(
      chalk.red("❌ スキルディレクトリの作成中にエラーが発生しました:"),
      error,
    );
    // ディレクトリが作成できない場合、スクリプトを続行できないため終了する
    process.exit(1);
  }
}

/**
 * スキルレビューCLIのメイン関数。
 */
async function reviewSkills() {
  console.log(chalk.bold.yellow("🚀 AIスキルレビューツールを開始します..."));

  // スクリプトの実行前にディレクトリの存在を確認・作成
  await ensureSkillDirsExist();

  try {
    // 候補ディレクトリが存在し、ファイルがあるか確認
    await fs.access(CANDIDATES_DIR);
    const files = (await fs.readdir(CANDIDATES_DIR)).filter((f) =>
      f.endsWith(".ts"),
    );

    if (files.length === 0) {
      console.log(chalk.green("✅ レビュー待ちのスキル候補はありません。"));
      return;
    }

    console.log(`🔍 ${files.length}件のスキル候補が見つかりました。`);

    // 各ファイルを順番にレビュー
    for (const file of files) {
      const filePath = path.join(CANDIDATES_DIR, file);
      const content = await fs.readFile(filePath, "utf-8");

      console.log("\n" + "-".repeat(process.stdout.columns));
      console.log(chalk.bold.cyan(`レビュー中のスキル: ${file}`));
      console.log("-".repeat(process.stdout.columns));
      // 長いコンテンツを切り詰めて表示
      const displayContent =
        content.length > 2000
          ? content.substring(0, 2000) + "\n... (truncated)"
          : content;
      console.log(chalk.gray(displayContent));
      console.log("-".repeat(process.stdout.columns));

      const { action } = await inquirer.prompt([
        {
          type: "list",
          name: "action",
          message: "このスキルをどうしますか？",
          choices: [
            { name: "✅ 承認 (Approve)", value: "approve" },
            { name: "❌ 拒否 (Reject)", value: "reject" },
            { name: "🤔 スキップ (Skip)", value: "skip" },
          ],
        },
      ]);

      if (action === "approve") {
        const destPath = path.join(APPROVED_DIR, file);
        // ファイルが既に存在する場合の処理を追加
        try {
          await fs.access(destPath);
          const { overwrite } = await inquirer.prompt([
            {
              type: "confirm",
              name: "overwrite",
              message: chalk.yellow(
                `⚠️ ファイル '${file}' は既に承認済みディレクトリに存在します。上書きしますか？`,
              ),
              default: false,
            },
          ]);
          if (!overwrite) {
            console.log(
              chalk.yellow(`⏭️ スキル '${file}' の承認をスキップしました。`),
            );
            continue;
          }
        } catch (error) {
          // ファイルが存在しない場合は正常に続行
        }
        await fs.rename(filePath, destPath);
        console.log(
          chalk.green(`👍 スキル '${file}' を承認し、移動しました。`),
        );
      } else if (action === "reject") {
        // 削除する代わりにrejectedディレクトリに移動
        const destPath = path.join(REJECTED_DIR, file);
        await fs.rename(filePath, destPath);
        console.log(
          chalk.red(
            `🗑️ スキル '${file}' を拒否し、rejectedディレクトリに移動しました。`,
          ),
        );
      } else {
        console.log(chalk.yellow(`⏭️ スキル '${file}' をスキップしました。`));
      }
    }

    console.log(
      chalk.bold.green("\n✨ 全てのスキル候補のレビューが完了しました。"),
    );
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.log(
        chalk.green(
          "✅ 'candidates'ディレクトリが存在しないため、レビュー待ちのスキルはありません。",
        ),
      );
    } else {
      console.error(chalk.red("❌ エラーが発生しました:"), error);
    }
  }
}

reviewSkills();

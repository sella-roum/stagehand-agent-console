# Stagehand Agent Console

このプロジェクトは、AIを活用したブラウザ自動化フレームワーク [Stagehand](https://github.com/browserbase/stagehand) を基盤とし、**階層型マルチエージェント・アーキテクチャ**を採用した高度な自律型AIエージェントのサンプルプロジェクトです。

司令塔となる**Chief Agent**がタスクを計画し、現場担当の**Task Automation Agent**がそれを実行します。エージェントは単にコマンドを実行するだけでなく、自らの行動結果を**検証**し、エラー発生時にはその原因を**反省**して**自己修復**を試みます。さらに、実行履歴から汎用的な操作を学習し、**新しいスキル（ツール）を動的に自動生成する**能力も備えています。

実行時やエラー発生時には、インタラクティブなデバッグコンソールが起動し、AIエージェントの自律的な動作をリアルタイムで監視・介入できます。

## ✨ 主な機能

-   **階層型マルチエージェント**: 司令塔AIがタスクを計画し、実行AIがサブゴールを一つずつ達成する、信頼性の高いアーキテクチャ。
-   **自己修復・自己検証ループ**: 各ステップの実行後に結果を検証し、失敗した場合は原因を自己分析して代替案を試し、タスクの続行を目指します。
-   **動的なスキル生成**: 実行履歴から再利用可能な操作パターンを学習し、新しいツール（スキル）をTypeScriptコードとして自動生成。エージェントが経験から成長します。
-   **マルチLLM対応**: `.env`ファイルを変更するだけで、Google Gemini, Groq, OpenRouter上の様々なモデルを簡単に切り替え可能。
-   **高度なツールセット**: マルチタブ操作、安全なローカルファイル読み書き、視覚AIによる画像認識・クリックなど、複雑なタスクを遂行するためのツールを標準装備。
-   **対話型デバッグコンソール**: エラー発生時や任意のタイミングで起動し、AIとの対話や手動介入を可能にします。自律レベル（完全自動/確認/編集）も動的に変更可能。
-   **Playwrightテストとの統合**: エージェントの機能を通常のテストコードから呼び出せる非対話モードをサポート。CI/CDでの自動テストを容易にします。

## 🧠 エージェントアーキテクチャと思考サイクル

このエージェントは、2種類のAIが連携し、以下の思考サイクルに基づいて自律的に動作します。

1.  **司令塔エージェント (Chief Agent)**: ユーザーからの高レベルなタスクを受け取り、達成までの**サブゴールリスト（計画）**を作成します。
2.  **実行エージェント (Task Automation Agent)**: 計画リストからサブゴールを一つずつ取り出し、達成するまで**思考と行動のループ**を実行します。
    -   `[ 状況認識 ] -> [ ツール選択 ] -> [ 実行 ] -> [ 検証 ]`
    -   **失敗した場合**: `[ 反省 (エラー分析) ] -> [ 再計画 (代替案考案) ]` という自己修復ループに入ります。
3.  **ループ**: 一つのサブゴールが完了すると、実行エージェントは司令塔（の計画リスト）に戻り、次のサブゴールを取得して実行を続けます。すべてのサブゴールが完了すると、タスク全体が終了します。

このプロセスを図で示すと以下のようになります。

```mermaid
graph TD
    subgraph User Interaction
        A[ユーザーからの高レベルなタスク]
    end

    subgraph Chief Agent [司令塔エージェント]
        B(タスクを分解してサブゴールリストを計画)
    end

    subgraph Task Automation Agent [実行エージェント]
        C{サブゴール実行ループ}
        D[状況認識]
        E[ツール選択]
        F[実行]
        G{検証}
        H[反省: エラー分析]
        I[再計画: 代替案考案]
    end

    subgraph System
        J{全サブゴール完了？}
        K[タスク完了]
    end

    A --> B
    B -->|次のサブゴールを渡す| C
    C --> D
    D --> E
    E --> F
    F --> G
    G -- 成功 --> J
    G -- 失敗 --> H
    H --> I
    I --> C

    J -- No --> B
    J -- Yes --> K
```

## 🛠️ セットアップ

### 1. プロジェクトのクローンと依存関係のインストール

まず、プロジェクトをクローンし、依存関係をインストールします。

```bash
# プロジェクトをクローン
git clone https://github.com/sella-roum/stagehand-agent-console.git
cd stagehand-agent-console

# 依存関係のインストール
npm install
# または
pnpm install
```

### 2. 環境変数の設定

AI機能を利用するには、各種サービスのAPIキーが必要です。

`.env.example` ファイルをコピーして `.env` ファイルを作成し、利用したいAIプロバイダのAPIキーを設定してください。

```bash
cp .env.example .env
```

次に、`.env` ファイルを開き、設定を編集します。**少なくとも1つのプロバイダのAPIキーを設定し、`LLM_PROVIDER`で使用するプロバイダを指定してください。**

```.env
# .env

# --- Google Gemini Settings ---
GOOGLE_API_KEY="YOUR_GOOGLE_API_KEY"
GEMINI_MODEL="gemini-2.5-flash"

# --- Groq Cloud Settings ---
GROQ_API_KEY="YOUR_GROQ_API_KEY"
GROQ_MODEL="meta-llama/llama-4-scout-17b-16e-instruct"

# --- OpenRouter Settings ---
OPENROUTER_API_KEY="YOUR_OPENROUTER_API_KEY"
# モデル名は https://openrouter.ai/models で確認できます
OPENROUTER_MODEL=""

# --- Provider Selection ---
# 'google', 'groq', または 'openrouter' を指定
LLM_PROVIDER="google"

# 'text' または 'vision' を指定。'vision' にすると画像認識を利用します。
AGENT_MODE="text"

```

-   **`LLM_PROVIDER`**: `agent`コマンドが使用するAIプロバイダを`google`, `groq`, `openrouter`の中から選択します。
-   **`*_API_KEY`**: 利用するサービスのAPIキーを設定します。
-   **`*_MODEL`**: 各プロバイダで使用するモデル名を指定します。
-   **`AGENT_MODE`**: LLMモデルが画像認識を使用できる場合は、`vision`にすると画像認識を利用します。

## 🚀 実行方法

### 対話型コンソールでの実行

セットアップが完了したら、以下のコマンドでプロジェクトを起動します。

```bash
npm start
```

スクリプトが起動すると、対話型デバッグコンソールが開始されます。`workspace`ディレクトリは、ファイル操作コマンドが初めて実行される際に自動的に作成されます。

### Playwrightテスト内での実行（非対話テストモード）

このエージェントは、通常のPlaywrightテストケース内で直接呼び出すことができます。これにより、AIエージェントの複雑な振る舞いをCI/CDパイプラインで自動的にテストすることが可能です。

`runAgentTask`関数をインポートし、`test`ブロック内で呼び出すだけで、指定したタスクをエージェントが非対話的に実行します。

**使用例: `tests/agent-demo.spec.ts`**

```typescript
import { test, expect } from "@playwright/test";
import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "../stagehand.config.js";
import { runAgentTask } from "../src/agentRunner.js";

// テストのタイムアウトを5分に設定
test.setTimeout(300000);

test.describe("Stagehand AI Agent", () => {
  let stagehand: Stagehand;

  test.beforeEach(async () => {
    stagehand = new Stagehand({
      ...StagehandConfig,
      localBrowserLaunchOptions: { headless: true }, // テスト中はヘッドレスで実行
    });
    await stagehand.init();
  });

  test.afterEach(async () => {
    await stagehand.close();
  });

  test("should navigate to Stagehand GitHub and find the star count", async () => {
    // 1. 通常のPlaywright/Stagehandコードで初期状態を設定
    const page = stagehand.page;
    await page.goto("https://www.google.com");
    await page.act("'Stagehand AI'と入力して");
    await page.keyboard.press("Enter");
    await stagehand.page.waitForURL("**/search**");

    // 2. AIエージェントに後続のタスクを依頼
    const task = "Stagehandの公式サイトを見つけてアクセスし、GitHubリポジトリのスター数を報告して";
    
    const result = await runAgentTask(task, stagehand);

    // 3. エージェントの実行結果を検証
    expect(result.is_success).toBe(true);
    expect.soft(result.reasoning.toLowerCase()).toContain('star');
    expect(result.reasoning).toMatch(/\d+/); // 結果に数字が含まれているか

    // 4. 最終的なブラウザの状態を検証
    const finalUrl = stagehand.page.url();
    expect(finalUrl).toContain("github.com/browserbase/stagehand");
  });
});
```

## 🤖 コンソールの使い方

コンソールが起動したら、`>` プロンプトに対して以下のコマンドを入力できます。

| コマンド | 説明 | 使用例 |
| :--- | :--- | :--- |
| **`agent`** | **[推奨]** AIにタスクを依頼し、自律的に計画・実行・自己修復させます。 | `agent:StagehandのGitHubリポジトリのスター数を調べて` |
| **`act`** | AIに単一の具体的な操作を自然言語で指示します。 | `act:'Issues'タブをクリックして` |
| **`observe`** | 現在のページで操作可能な要素をAIに探させます。 | `observe:クリックできる全てのボタン` |
| **`extract`** | ページから情報を抽出します。引数なしで全テキストを抽出。 | `extract:記事のタイトル` |
| **`inspect`** | Playwright Inspectorを起動し、GUIでページを調査します。 | `inspect` |
| **`eval`** | 任意のPlaywright/JavaScriptコードをその場で実行します。 | `eval:console.log(await page.title())` |
| **`goto`** | 指定したURLにページを移動させます。 | `goto:https://www.stagehand.dev/` |
| **`mode`** | 介入モードを設定 (`autonomous`, `confirm`, `edit`)。引数なしで現在値表示。 | `mode:autonomous` |
| **`help`** | コマンドの一覧を表示します。 | `help` |
| **`exit`** | デバッグコンソールを終了します。 | `exit` |

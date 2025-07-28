# Stagehand Agent Console

このプロジェクトは、AIを活用したブラウザ自動化フレームワーク [Stagehand](https://github.com/browserbase/stagehand) と、**Google Gemini**, **Groq Cloud (Llama 3など)**, **OpenRouter** といった複数の大規模言語モデル（LLM）を組み合わせ、**対話型AIエージェント**を構築するサンプルプロジェクトです。

実行時やエラー発生時に、インタラクティブなデバッグコンソールが起動し、以下の強力な機能を組み合わせてリアルタイムに問題解決を行えます。

-   **AIへの自然言語指示:** 「ログインボタンを押して」のような曖昧な指示でブラウザを操作
-   **自律型AIエージェント:** 「Playwrightのスター数を調べて」のような高レベルなタスクをAIが計画・実行
-   **Playwright Inspector連携:** GUIで要素を調査し、確実なセレクタを取得
-   **コードの直接実行:** その場で任意のPlaywright/JavaScriptコードを実行して動作を検証

## ✨ 主な機能

-   **マルチLLM対応:** `.env`ファイルを変更するだけで、Google Gemini, Groq, OpenRouter上の様々なモデルを簡単に切り替え可能。
-   **対話型デバッグコンソール:** エラー発生時に起動し、AIとの対話や手動介入を可能にします。
-   **プランナーAI (`agent`コマンド):** ユーザーが与えた高レベルなタスクをAIが分析し、具体的な実行ステップに分解して自律的に実行します。
-   **AIによる直接操作 (`act`, `observe`コマンド):** 単一の操作を自然言語でAIに指示し、即座に実行・確認できます。
-   **Playwrightネイティブ機能へのアクセス:** `inspect`コマンドでPlaywright Inspectorを、`eval`コマンドで任意のコードを実行でき、AIの操作とシームレスに連携できます。

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
GROQ_MODEL="compound-beta-mini"

# --- OpenRouter Settings ---
OPENROUTER_API_KEY="YOUR_OPENROUTER_API_KEY"
# モデル名は https://openrouter.ai/models で確認できます
OPENROUTER_MODEL=""

# --- Provider Selection ---
# 'google', 'groq', または 'openrouter' を指定
LLM_PROVIDER="google"
```

-   **`LLM_PROVIDER`**: `agent`コマンドが使用するAIプロバイダを`google`, `groq`, `openrouter`の中から選択します。
-   **`*_API_KEY`**: 利用するサービスのAPIキーを設定します。
-   **`*_MODEL`**: 各プロバイダで使用するモデル名を指定します。

## 🚀 実行方法

セットアップが完了したら、以下のコマンドでプロジェクトを起動します。

```bash
npm start
```
または、Windowsの場合は `start.bat` ファイルをダブルクリックしても実行できます。

スクリプトが起動すると、対話型デバッグコンソールが開始されます。

## 🤖 コンソールの使い方

コンソールが起動したら、`>` プロンプトに対して以下のコマンドを入力できます。

| コマンド | 説明 | 使用例 |
| :--- | :--- | :--- |
| **`act`** | AIに単一の具体的な操作を自然言語で指示します。 | `act:'Issues'タブをクリックして` |
| **`observe`** | 現在のページで操作可能な要素をAIに探させます。 | `observe:クリックできる全てのボタン` |
| **`agent`** | **[推奨]** AIに高レベルなタスクを依頼し、自律的に実行させます。 | `agent:PlaywrightのGitHubリポジトリにアクセスして、スターの数を教えて` |
| **`inspect`** | Playwright Inspectorを起動し、GUIでページを調査します。 | `inspect` |
| **`eval`** | 任意のPlaywright/JavaScriptコードをその場で実行します。 | `eval:console.log(await page.title())` |
| **`goto`** | 指定したURLにページを移動させます。 | `goto:https://google.com` |
| **`help`** | コマンドの一覧を表示します。 | `help` |
| **`exit`** | デバッグコンソールを終了します。 | `exit` |

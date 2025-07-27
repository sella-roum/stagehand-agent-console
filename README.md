# Stagehand Agent Console

このプロジェクトは、AIを活用したブラウザ自動化フレームワーク [Stagehand](https://github.com/browserbase/stagehand) と Googleの [Gemini API](https://ai.google.dev/) を組み合わせ、**対話型AIエージェント**を構築するサンプルプロジェクトです。

エラー発生時には、インタラクティブなデバッグコンソールが起動し、以下の強力な機能を組み合わせてリアルタイムに問題解決を行えます。

-   **AIへの自然言語指示:** 「ログインボタンを押して」のような曖昧な指示でブラウザを操作
-   **自律型AIエージェント:** 「Playwrightのスター数を調べて」のような高レベルなタスクをAIが計画・実行
-   **Playwright Inspector連携:** GUIで要素を調査し、確実なセレクタを取得
-   **コードの直接実行:** その場で任意のPlaywright/JavaScriptコードを実行して動作を検証

## ✨ 主な機能

-   **対話型デバッグコンソール:** エラー発生時に起動し、AIとの対話や手動介入を可能にします。
-   **プランナーAI (`agent`コマンド):** ユーザーが与えた高レベルなタスクをAIが分析し、具体的な実行ステップに分解して自律的に実行します。
-   **AIによる直接操作 (`act`, `observe`コマンド):** 単一の操作を自然言語でAIに指示し、即座に実行・確認できます。
-   **Playwrightネイティブ機能へのアクセス:** `inspect`コマンドでPlaywright Inspectorを、`eval`コマンドで任意のコードを実行でき、AIの操作とシームレスに連携できます。

## 🛠️ セットアップ

### 1. プロジェクトのクローンと依存関係のインストール

まず、プロジェクトをクローンし、依存関係をインストールします。

```bash
# プロジェクトをクローン（もしクローン済みでなければ）
# git clone <repository_url>
# cd stagehand-agent-console

# 依存関係のインストール
npm install
# または
pnpm install
```

### 2. 環境変数の設定

AI機能を利用するには、Google GeminiのAPIキーが必要です。

`.env.example` ファイルをコピーして `.env` ファイルを作成し、APIキーを追記してください。

```bash
cp .env.example .env
```

次に、`.env` ファイルを開き、APIキーを設定します。

```.env
# .env
GEMINI_API_KEY="AIza..."
```

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

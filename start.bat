@echo off
title Running Stagehand Project

:: --- このバッチファイルがあるディレクトリに移動 ---
:: ショートカットから実行しても正しく動作するようにするための重要な処理です。
:: /dスイッチは、必要に応じてドライブも変更します。
cd /d "%~dp0"

echo ===================================
echo  Starting the Stagehand project...
echo  Working directory: %cd%
echo ===================================
echo.

rem --- npm startコマンドを実行します ---
npm start

:: npm startの実行結果をチェック
if %errorlevel% neq 0 (
    echo.
    echo ==============================================================
    echo  ERROR: プロジェクトの実行中にエラーが発生しました。
    echo  上記のエラーメッセージを確認してください。
    echo ==============================================================
) else (
    echo.
    echo ===================================
    echo  Execution finished.
    echo ===================================
)

echo.
echo Press any key to exit.
pause >nul

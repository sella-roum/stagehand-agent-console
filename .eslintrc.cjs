module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "jsdoc"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:jsdoc/recommended-typescript-error",
  ],
  env: {
    node: true,
    es2022: true,
  },
  parserOptions: {
    project: ["./tsconfig.json"],
  },
  rules: {
    // JSDocの記述を必須にする（警告レベル）
    "jsdoc/require-jsdoc": [
      "warn",
      {
        require: {
          FunctionDeclaration: true,
          MethodDefinition: true,
          ClassDeclaration: true,
          ArrowFunctionExpression: true,
          FunctionExpression: true,
        },
        // publicなメソッドのみを対象とする
        publicOnly: true,
      },
    ],
    // パラメータと戻り値の説明は必須としない（型から自明な場合が多いため）
    "jsdoc/require-param-description": "off",
    "jsdoc/require-returns-description": "off",
    // anyの使用を許容する（AIからの動的な戻り値などで使用するため）
    "@typescript-eslint/no-explicit-any": "off",
  },
};

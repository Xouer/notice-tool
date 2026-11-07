// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * ESLint flat config / ESLint 平面配置。
 * TypeScript strict 项目 + Vitest 测试共用一套规则。
 */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "drizzle/**",
      "coverage/**",
      "*.cjs",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
    },
  },
  {
    // Node 运行脚本（构建/验证工具）：补充 Node 全局
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
      },
    },
  },
);

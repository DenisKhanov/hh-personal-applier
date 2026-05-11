import js from "@eslint/js";
import tseslint from "typescript-eslint";

const browserGlobals = {
  chrome: "readonly",
  console: "readonly",
  document: "readonly",
  fetch: "readonly",
  window: "readonly"
};

const nodeGlobals = {
  console: "readonly",
  process: "readonly",
  URL: "readonly"
};

export default [
  {
    ignores: ["dist/**", "node_modules/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: browserGlobals
    }
  },
  {
    files: ["test/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: nodeGlobals
    }
  },
  {
    files: ["*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: nodeGlobals
    }
  }
];

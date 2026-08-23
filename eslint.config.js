import js from "@eslint/js";
import typescriptEslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

export default typescriptEslint.config(
  {
    ignores: [
      "out/**",
      "release/**",
      "graphify-out/**",
      "build/**",
      "node_modules/**",
    ],
  },
  js.configs.recommended,
  ...typescriptEslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // JSX event handlers (onClick, onChange) are legitimately async. Only
      // that check is off; `if (asyncFn())` and `[].filter(asyncFn)` still error.
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      // Index access is written as `arr[i]!` throughout so the code stays
      // correct if `noUncheckedIndexedAccess` is ever enabled. Without that
      // flag the rule calls every one of those assertions unnecessary.
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      // `async` without `await` is used to satisfy Promise-returning
      // interface contracts (repositories, IPC handlers, test doubles).
      "@typescript-eslint/require-await": "off",
      // `interface X extends Pick<Y, ...> {}` is the project's way of naming
      // a structural slice of an SDK type so tests can build minimal fakes.
      "@typescript-eslint/no-empty-object-type": ["error", { allowInterfaces: "with-single-extends" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      "react-hooks/exhaustive-deps": "error",
      // Labels here wrap the control and put their text in a nested layout
      // div, one level deeper than the rule's default search depth of 2.
      "jsx-a11y/label-has-associated-control": ["error", { depth: 3 }],
    },
  },
  {
    files: ["src/main/**/*.ts", "src/preload/**/*.ts", "test/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // Plain Node scripts and this config are outside the TypeScript program,
    // so the type-aware rules cannot run on them.
    files: ["eslint.config.js", "scripts/**/*.mjs"],
    extends: [typescriptEslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
    },
  },
);

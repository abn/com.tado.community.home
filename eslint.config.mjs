import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";

export default [
    { ignores: [".node_modules/*", ".homeybuild/*"] },
    {
        files: ["**/*.{js,mjs,cjs,ts}"],
        languageOptions: { parser: "@typescript-eslint/parser", globals: globals.node },
    },
    pluginJs.configs.recommended,
    ...tseslint.configs.recommended,
    eslintPluginPrettierRecommended,
    {
        rules: {
            "@typescript-eslint/explicit-function-return-type": "error",
            "@typescript-eslint/ban-ts-comment": [
                "warn",
                {
                    "ts-ignore": "allow-with-description",
                },
            ],
        },
    },
];

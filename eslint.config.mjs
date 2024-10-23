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

// module.exports = {
//     root: true,
//     parser: '@typescript-eslint/parser',
//     plugins: ['@typescript-eslint'],
//     extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
//     rules: {
//         '@typescript-eslint/explicit-function-return-type': 'error',
//         // Mark as warning to not block during dev work, and allow with description
//         '@typescript-eslint/ban-ts-comment': [
//             'warn',
//             {
//                 'ts-ignore': 'allow-with-description',
//             },
//         ],
//     },
//     env: {
//         node: true,
//     },
// };

module.exports = {
    semi: true,
    trailingComma: "all",
    singleQuote: false,
    printWidth: 120,
    tabWidth: 4,
    useTabs: false,
    embeddedLanguageFormatting: "auto",

    overrides: [
        {
            files: ["*.json"],
            options: {
                tabWidth: 2,
            },
        },
    ],
};

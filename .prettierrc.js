module.exports = {
  // Core formatting
  semi: true,
  trailingComma: 'es5',
  singleQuote: true,
  quoteProps: 'as-needed',
  jsxSingleQuote: true,

  // Indentation
  tabWidth: 2,
  useTabs: false,

  // Line length and wrapping
  printWidth: 100,

  // JSX specific
  jsxBracketSameLine: false,
  bracketSpacing: true,

  // Arrow function parentheses
  arrowParens: 'avoid',

  // End of line
  endOfLine: 'lf',

  // Embedded language formatting
  embeddedLanguageFormatting: 'auto',

  // File overrides
  overrides: [
    {
      files: '*.md',
      options: {
        printWidth: 80,
        proseWrap: 'always',
      },
    },
    {
      files: '*.json',
      options: {
        printWidth: 120,
      },
    },
    {
      files: ['*.yml', '*.yaml'],
      options: {
        tabWidth: 2,
        singleQuote: false,
      },
    },
  ],
};

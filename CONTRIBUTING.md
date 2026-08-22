# Contributing Guidelines

## Commit Message Format

This repository uses
[Conventional Commits](https://www.conventionalcommits.org/) to ensure
consistent and meaningful commit messages.

### Format

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types

- **feat**: A new feature for the user
- **fix**: A bug fix for the user
- **docs**: Documentation changes
- **style**: Code style changes (formatting, missing semicolons, etc)
- **refactor**: Code changes that neither fix bugs nor add features
- **perf**: Performance improvements
- **test**: Adding or updating tests
- **chore**: Maintenance tasks, dependency updates
- **ci**: CI/CD pipeline changes
- **build**: Build system changes
- **revert**: Reverting previous commits

### Examples

#### Good commit messages:

```bash
feat: add user authentication with JWT tokens
fix: resolve CloudFront certificate validation issue
docs: update deployment guide with new directory structure
refactor: reorganize cdk stack architecture
chore: update dependencies to latest versions
ci: add commitlint to enforce conventional commits
```

#### Bad commit messages:

```bash
update stuff
fix bug
WIP
asdasd
Update file.ts
```

### Scopes (Optional)

You can add a scope to provide additional context:

```bash
feat(ui): add dark mode toggle
fix(api): handle missing user ID in signup validation
docs(infra): add certificate setup instructions
```

### Rules

- **Type**: lowercase, required
- **Description**: lowercase, required, max 100 characters
- **No period**: at the end of the description
- **Body**: separate with blank line, max 100 characters per line
- **Footer**: separate with blank line

### Automated Enforcement

This repository uses:

- **commitlint**: Validates commit messages on commit
- **husky**: Git hooks to run commitlint automatically

### Bypassing (Emergency Only)

If you absolutely need to bypass the commit message check:

```bash
git commit --no-verify -m "emergency: fix critical production issue"
```

**Note**: Use `--no-verify` sparingly and only for emergency fixes.

## Code Quality Standards

This repository enforces consistent code quality using:

### ESLint + Prettier Integration

- **ESLint**: Code quality and error detection
- **Prettier**: Code formatting
- **TypeScript**: Type safety
- **React**: Component best practices

### Available Scripts

```bash
# Lint and fix all files
npm run lint

# Check linting without fixing
npm run lint:check

# Format all files with Prettier
npm run format

# Check formatting without fixing
npm run format:check
```

### Automated Quality Checks

**Pre-commit hooks** automatically run:

1. **lint-staged**: Lints and formats only staged files
2. **ESLint**: Fixes code quality issues
3. **Prettier**: Formats code consistently

**Commit message hook** validates:

- Conventional commit format
- Message length and structure

## Getting Started

1. Clone the repository
2. Run `npm install` (this sets up git hooks automatically)
3. Make your changes
4. Commit with conventional format: `git commit -m "feat: add new feature"`
5. Push to your branch

The git hooks will automatically:

- Format your code with Prettier
- Fix ESLint issues where possible
- Validate your commit messages
- Prevent commits that don't meet quality standards

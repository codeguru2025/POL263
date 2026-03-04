# Testing the app with TestSprite

[TestSprite](https://www.testsprite.com/) is an AI-powered agentic testing platform that integrates with Cursor via MCP. Use it to generate and run frontend/backend tests against POL263.

## Prerequisites

1. **Node.js ≥ 22** — `node --version`
2. **TestSprite account** — [Sign up](https://www.testsprite.com/auth/cognito/sign-up) and get an API key from **Settings → API Keys**
3. **TestSprite MCP in Cursor** — Add the MCP server (see below)

## 1. Add TestSprite MCP in Cursor

**Option A — One-click (recommended)**  
Use the [one-click install link](https://cursor.directory/mcp/testsprite-mcp), enter your API key when prompted.

**Option B — Manual**  
1. Open **Cursor Settings** (⌘⇧J / Ctrl+Shift+J) → **Tools & Integration** → **Add custom MCP**
2. Paste the config from `docs/cursor-mcp-testsprite-snippet.json`, and set `API_KEY` to your key:

```json
{
  "mcpServers": {
    "TestSprite": {
      "command": "npx",
      "args": ["@testsprite/testsprite-mcp@latest"],
      "env": {
        "API_KEY": "your-actual-api-key"
      }
    }
  }
}
```

**Cursor sandbox**  
For TestSprite to run tests fully: **Chat → Auto-Run → Auto-Run Mode** → set to **"Ask Everytime"** or **"Run Everything"** (see [TestSprite docs](https://testspriteinc.mintlify.app/mcp/getting-started/installation#cursor-sandbox-mode-configuration)).

## 2. Start the app

The app must be running so TestSprite can reach it (default: **http://localhost:5000**).

```bash
npm run dev
```

Or:

```bash
npm run test:testsprite
```

(That script starts the same dev server; use it as a reminder you're about to test with TestSprite.)

Leave this terminal running.

## 3. Run tests from Cursor

In **Cursor Chat** (Composer), ask:

- **"Test the app with TestSprite"**, or  
- **"Help me test this project with TestSprite"**

The assistant will use TestSprite MCP to:

- Bootstrap tests (you may be asked for **project type**: frontend/backend, **scope**: codebase/diff, **port**: 5000)
- Generate test plans and cases
- Run tests and report results

Results appear in the **TestSprite Web Portal** under **TESTING → MCP Tests**, and locally in a `testsprite_tests/` directory if generated.

## Product Requirements Document (PRD)

TestSprite can use a PRD to understand scope and generate better tests. This project includes:

- **`docs/PRODUCT-REQUIREMENTS.md`** — Full PRD (overview, roles, features, acceptance criteria).
- **`docs/standard_prd.json`** — Machine-readable PRD (functional requirements, user stories, key flows) for TestSprite.

When bootstrapping or configuring tests, you can point TestSprite to these files or paste the PRD content into the TestSprite configuration portal if it asks for a PRD.

## Quick reference

| Step              | Action |
|-------------------|--------|
| App URL           | http://localhost:5000 |
| Default port      | 5000 (`PORT` in `.env` to override) |
| MCP config        | `docs/cursor-mcp-testsprite-snippet.json` |
| Troubleshooting   | [TestSprite docs](https://docs.testsprite.com/mcp/troubleshooting/test-execution-issues) — e.g. delete `testsprite_tests/` and retry; toggle MCP off/on |

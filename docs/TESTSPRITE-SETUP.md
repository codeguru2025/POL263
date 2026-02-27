# TestSprite setup for POL263

[TestSprite](https://www.testsprite.com) is an AI testing agent that runs in Cursor via MCP. Use it to analyze the codebase, generate tests, and find issues.

---

## 1. Prerequisites

- **Node.js ≥ 22**  
  Check: `node --version`  
  Download: [nodejs.org](https://nodejs.org/)

- **TestSprite account (free)**  
  Sign up: [testsprite.com/auth/cognito/sign-up](https://www.testsprite.com/auth/cognito/sign-up)

---

## 2. Get your API key

1. Sign in at [TestSprite Dashboard](https://www.testsprite.com/dashboard).
2. Go to **Settings** → **API Keys**.
3. Click **New API Key**, copy the key, and keep it safe (you’ll paste it into Cursor).

---

## 3. Add TestSprite MCP in Cursor

### Option A: One-click install (easiest)

1. In Cursor, go to **Cursor Settings** (gear icon or **File** → **Preferences** → **Cursor Settings**).
2. Open **Tools & MCP** (or **Features** → **MCP**).
3. Use TestSprite’s one-click link and enter your API key when prompted:  
   [One-click install](https://docs.testsprite.com/mcp/getting-started/installation#one-click-installation)

### Option B: Manual config

1. Open **Cursor Settings** (e.g. `Ctrl+,` or `Cmd+,`).
2. Go to **Tools & MCP** → **Add custom MCP** (or **Edit in settings.json**).
3. Add this (replace `YOUR_API_KEY` with your real key):

```json
{
  "mcpServers": {
    "TestSprite": {
      "command": "npx",
      "args": ["@testsprite/testsprite-mcp@latest"],
      "env": {
        "API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

4. Save. Confirm TestSprite shows with a green dot (connected).

---

## 4. Cursor sandbox setting (recommended)

So TestSprite can run tests fully:

1. **Chat** → **Auto-Run** → **Auto-Run Mode**.
2. Set to **“Ask every time”** or **“Run everything”** (avoid “Run in Sandbox” only).

---

## 5. Use TestSprite on this project

In a Cursor chat, try:

- **“Help me test this project with TestSprite.”**
- **“Use TestSprite to analyze the POL263 codebase and report issues.”**

TestSprite will analyze the repo, run tests in the cloud, and return results.

---

## Quick reference

| Step            | Action |
|-----------------|--------|
| Node.js         | `node --version` → must be ≥ 22 |
| Account         | Sign up at testsprite.com |
| API key         | Dashboard → Settings → API Keys → New API Key |
| Cursor MCP      | Settings → Tools & MCP → add TestSprite config above |
| Run tests       | In chat: “Help me test this project with TestSprite.” |

Docs: [docs.testsprite.com](https://docs.testsprite.com)

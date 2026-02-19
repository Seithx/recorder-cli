---
name: chrome-debug-setup
description: Set up Chrome DevTools MCP to connect to an existing logged-in Chrome browser on Windows (Git Bash). Use when needing to inspect authenticated websites, configure chrome-devtools-mcp, or debug MCP browser connection issues.
disable-model-invocation: true
---

# Chrome DevTools MCP - Windows/Git Bash Setup Guide

This skill documents how to connect the `chrome-devtools-mcp` server to an existing Chrome browser on Windows with Git Bash. It covers all the pitfalls we encountered and their solutions.

## The Goal

Connect Claude Code's chrome-devtools MCP to a **user's already-logged-in Chrome** so we can inspect authenticated web apps (e.g., Google Recorder, WhatsApp Web, etc.) without hitting Google's "This browser or app may not be secure" error.

## Architecture

```
User's Chrome (port 9222)  <---->  chrome-devtools-mcp  <---->  Claude Code
     (logged in)                    (connects via CDP)          (uses MCP tools)
```

## Step-by-step setup

### 1. Launch Chrome with remote debugging

Open **PowerShell** (not Git Bash - avoids path mangling):

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  --remote-debugging-port=9222 `
  --user-data-dir="C:\chrome-debug-profile" `
  https://example.com
```

**Key points:**
- `--user-data-dir` MUST be a separate directory (Chrome 136+ blocks debugging on default profile)
- This creates a fresh profile - you'll need to log in manually once
- The session persists across restarts if you reuse the same `--user-data-dir`

### 2. Log in manually

Sign into the target website in the Chrome window that just opened. The MCP will share this session.

### 3. Configure the MCP server

The correct flag to connect to existing Chrome is `--browser-url`:

```bash
MSYS_NO_PATHCONV=1 claude mcp add chrome-devtools -s user -- cmd /c npx chrome-devtools-mcp@latest --browser-url=http://127.0.0.1:9222
```

### 4. Restart Claude Code

The MCP only reads config at startup.

---

## Known Pitfalls & Solutions

### Pitfall 1: `npx` doesn't work directly on Windows
**Problem:** `"command": "npx"` fails on Windows because npx is a batch script.
**Solution:** Wrap with `cmd /c`:
```json
"command": "cmd",
"args": ["/c", "npx", "chrome-devtools-mcp@latest"]
```

### Pitfall 2: Git Bash mangles `/c` into `C:/`
**Problem:** Git Bash's MSYS path conversion turns `/c` (the cmd flag) into `C:/` (a path).
**Solution:** Prefix the command with `MSYS_NO_PATHCONV=1`:
```bash
MSYS_NO_PATHCONV=1 claude mcp add chrome-devtools -s user -- cmd /c npx chrome-devtools-mcp@latest
```
**Why:** Git Bash converts anything starting with `/` into a Windows path. `MSYS_NO_PATHCONV=1` disables this.

### Pitfall 3: MCP launches its own Chrome instead of connecting
**Problem:** Without `--browser-url`, the MCP spawns a fresh Chrome with no login session.
**Solution:** Use `--browser-url=http://127.0.0.1:9222` to connect to existing Chrome.
**Alternative:** Use `--wsEndpoint=ws://127.0.0.1:9222/devtools/browser/<id>` for direct WebSocket.

### Pitfall 4: Google blocks sign-in on automated browsers
**Problem:** Google detects DevTools Protocol control and shows "This browser or app may not be secure".
**Solution:** Don't try to sign in through the MCP-controlled browser. Launch Chrome manually, sign in, THEN connect the MCP.

### Pitfall 5: `--browser-url` may silently fail
**Problem:** Even with correct config, the MCP sometimes still launches its own Chrome.
**Solution:** Bypass the MCP entirely with puppeteer-core:
```bash
npm install puppeteer-core
```
Then connect directly:
```javascript
const puppeteer = require('puppeteer-core');
const browser = await puppeteer.connect({
  browserURL: 'http://127.0.0.1:9222',
  defaultViewport: null,
});
const pages = await browser.pages();
// Find your logged-in tab
const page = pages.find(p => p.url().includes('your-target-site.com'));
```

### Pitfall 6: Multi-line commands in Git Bash
**Problem:** Pasting multi-line commands splits them and the second part runs as a separate command.
**Solution:** Always paste MCP add commands as a single line.

### Pitfall 7: WebSocket endpoint is session-specific
**Problem:** The `--wsEndpoint` URL contains a browser ID that changes every time Chrome restarts.
**Solution:** Prefer `--browser-url` which auto-discovers the WebSocket. Or re-fetch from `http://127.0.0.1:9222/json/version`.

---

## Verification Commands

Check if Chrome debug port is reachable:
```bash
curl -s http://127.0.0.1:9222/json/version
```

List all tabs in the debuggable Chrome:
```bash
curl -s http://127.0.0.1:9222/json
```

Check MCP config:
```bash
claude mcp get chrome-devtools
```

---

## Fallback: Direct puppeteer-core Script

When the MCP won't cooperate, use this pattern:

```javascript
const puppeteer = require('puppeteer-core');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null,
  });

  const pages = await browser.pages();
  console.log(`Found ${pages.length} tabs`);
  for (const p of pages) {
    console.log(`  - ${p.url()} | ${await p.title()}`);
  }

  // Find your target tab
  const targetPage = pages.find(p => p.url().includes('target-site.com'));
  if (targetPage) {
    // Inspect, evaluate, interact...
    const result = await targetPage.evaluate(() => {
      return { title: document.title, url: location.href };
    });
    console.log(result);
  }

  browser.disconnect(); // disconnect, don't close
})();
```

**Important:** Use `browser.disconnect()` not `browser.close()` - you don't want to close the user's Chrome!

---

## Flag Reference (chrome-devtools-mcp)

| Flag | Description |
|------|-------------|
| `--browser-url`, `-u` | Connect to Chrome's HTTP debug endpoint (e.g., `http://127.0.0.1:9222`) |
| `--wsEndpoint`, `-w` | Connect via WebSocket (e.g., `ws://127.0.0.1:9222/devtools/browser/<id>`) |
| `--wsHeaders` | Custom WebSocket headers as JSON |

`--browser-url` and `--wsEndpoint` conflict with each other - use only one.

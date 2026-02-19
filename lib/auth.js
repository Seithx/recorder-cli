/**
 * Auth module: Manages Chrome connection and Google session.
 * Uses a persistent Chrome profile so login survives across runs.
 */
const puppeteer = require('puppeteer-core');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { execSync, spawn } = require('child_process');

const CHROME_DEBUG_PORT = 9222;
const PROFILE_DIR = path.join(process.env.LOCALAPPDATA || 'C:\\Users\\' + process.env.USERNAME + '\\AppData\\Local', 'recorder-cli', 'chrome-profile');
const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.CHROME_PATH,
].filter(Boolean);

const API_KEY = 'AIzaSyCqafaaFzCP07GzWUSRw0oXErxSlrEX2Ro';
const ORIGIN = 'https://recorder.google.com';

// ============================================
// Find Chrome executable
// ============================================
function findChrome() {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ============================================
// Check if Chrome is running on debug port
// ============================================
async function isChromeRunning() {
  return new Promise((resolve) => {
    const http = require('http');
    const req = http.get(`http://127.0.0.1:${CHROME_DEBUG_PORT}/json/version`, { timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ============================================
// Launch Chrome with persistent profile
// ============================================
function launchChrome(options = {}) {
  const chromePath = findChrome();
  if (!chromePath) {
    throw new Error(
      'Chrome not found. Set CHROME_PATH environment variable or install Chrome.'
    );
  }

  // Ensure profile dir exists
  fs.mkdirSync(PROFILE_DIR, { recursive: true });

  const args = [
    `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];

  if (options.headless) {
    args.push('--headless=new');
  }

  if (options.url) {
    args.push(options.url);
  }

  const child = spawn(chromePath, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  return child;
}

// ============================================
// Generate SAPISIDHASH auth header
// ============================================
function generateSAPISIDHASH(sapisid) {
  const timestamp = Math.floor(Date.now() / 1000);
  const input = `${timestamp} ${sapisid} ${ORIGIN}`;
  const hash = crypto.createHash('sha1').update(input).digest('hex');
  return `${timestamp}_${hash}`;
}

// ============================================
// Build auth headers for API requests
// ============================================
function buildAuthHeaders(sapisid, cookieStr) {
  return {
    'Authorization': `SAPISIDHASH ${generateSAPISIDHASH(sapisid)}`,
    'X-Goog-Api-Key': API_KEY,
    'X-Goog-AuthUser': '0',
    'X-User-Agent': 'grpc-web-javascript/0.1',
    'Content-Type': 'application/json+protobuf',
    'Cookie': cookieStr,
    'Origin': ORIGIN,
    'Referer': `${ORIGIN}/`,
  };
}

// ============================================
// Test if auth is valid
// ============================================
async function testAuth(authHeaders) {
  const https = require('https');
  return new Promise((resolve) => {
    const body = JSON.stringify([]);
    const req = https.request({
      hostname: 'pixelrecorder-pa.clients6.google.com',
      path: '/$rpc/java.com.google.wireless.android.pixel.recorder.protos.PlaybackService/ListLabels',
      method: 'POST',
      headers: { ...authHeaders, 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}

// ============================================
// Extract cookies from Chrome page
// ============================================
async function extractCookies(browser) {
  const pages = await browser.pages();
  let recorderPage = pages.find(p =>
    p.url().includes('recorder.google.com') && !p.url().includes('/about')
  );

  if (!recorderPage) {
    // Navigate any page to recorder
    recorderPage = pages[0] || await browser.newPage();
    await recorderPage.goto('https://recorder.google.com', {
      waitUntil: 'networkidle2',
      timeout: 15000,
    });
  }

  const url = recorderPage.url();

  // Check if we got redirected to login
  if (url.includes('accounts.google.com') || url.includes('/about')) {
    return null; // Not logged in
  }

  const cookies = await recorderPage.cookies();
  const sapisid = cookies.find(c => c.name === 'SAPISID');
  if (!sapisid) return null;

  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  return { sapisid: sapisid.value, cookieStr };
}

// ============================================
// Wait for user to log in
// ============================================
async function waitForLogin(browser, timeout = 300000) {
  const pages = await browser.pages();
  let page = pages.find(p => p.url().includes('recorder.google.com') || p.url().includes('accounts.google.com'));

  if (!page) {
    page = pages[0] || await browser.newPage();
    await page.goto('https://recorder.google.com', { waitUntil: 'networkidle2', timeout: 15000 });
  }

  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    const url = page.url();
    if (url.includes('recorder.google.com') && !url.includes('/about') && !url.includes('accounts.google.com')) {
      // Might be logged in - verify with cookies
      const cookies = await extractCookies(browser);
      if (cookies) return cookies;
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  throw new Error('Login timeout. Please log in within the Chrome window.');
}

// ============================================
// Main: Get authenticated session
// ============================================
async function getAuth(options = {}) {
  const log = options.silent ? () => {} : console.log;
  let browser;

  // Step 1: Check if Chrome is already running
  log('[AUTH] Checking for Chrome on port ' + CHROME_DEBUG_PORT + '...');
  const chromeInfo = await isChromeRunning();

  if (!chromeInfo) {
    // Step 2: Launch Chrome
    log('[AUTH] Chrome not running. Launching with persistent profile...');
    log(`[AUTH] Profile: ${PROFILE_DIR}`);
    launchChrome({ url: 'https://recorder.google.com' });

    // Wait for Chrome to start
    let retries = 10;
    while (retries-- > 0) {
      await new Promise(r => setTimeout(r, 1000));
      if (await isChromeRunning()) break;
    }
    if (retries <= 0) {
      throw new Error('Failed to launch Chrome. Check if port ' + CHROME_DEBUG_PORT + ' is available.');
    }
    log('[AUTH] Chrome launched.');
  } else {
    log('[AUTH] Chrome already running.');
  }

  // Step 3: Connect via puppeteer
  browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${CHROME_DEBUG_PORT}`,
    defaultViewport: null,
  });

  // Step 4: Try to extract cookies
  log('[AUTH] Checking login status...');
  let auth = await extractCookies(browser);

  if (auth) {
    // Step 5: Verify cookies still work
    const headers = buildAuthHeaders(auth.sapisid, auth.cookieStr);
    const valid = await testAuth(headers);
    if (valid) {
      log('[AUTH] [OK] Authenticated and verified.');
      browser.disconnect();
      return auth;
    }
    log('[AUTH] [WARNING] Cookies expired. Need re-login.');
    auth = null;
  }

  if (!auth) {
    // Step 6: Need login - navigate to recorder and wait
    log('[AUTH] Not logged in. Please log in to Google in the Chrome window...');
    log('[AUTH] Waiting for login (timeout: 5 minutes)...');

    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    const url = page.url();
    if (!url.includes('recorder.google.com')) {
      await page.goto('https://recorder.google.com', {
        waitUntil: 'networkidle2',
        timeout: 15000,
      });
    }

    auth = await waitForLogin(browser);
    log('[AUTH] [OK] Login successful!');
  }

  browser.disconnect();
  return auth;
}

module.exports = {
  getAuth,
  buildAuthHeaders,
  generateSAPISIDHASH,
  isChromeRunning,
  launchChrome,
  findChrome,
  CHROME_DEBUG_PORT,
  PROFILE_DIR,
  API_KEY,
  ORIGIN,
};

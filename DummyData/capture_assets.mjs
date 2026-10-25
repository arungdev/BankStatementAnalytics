import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from '../../arungdev.github.io/_build/node_modules/sharp/lib/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.BSA_URL || 'http://127.0.0.1:5085';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const REPO_SCREENSHOTS = path.resolve(__dirname, '../screenshots');
const SITE_SCREENSHOTS = path.resolve(__dirname, '../../arungdev.github.io/_build/screenshots');

fs.mkdirSync(REPO_SCREENSHOTS, { recursive: true });
fs.mkdirSync(SITE_SCREENSHOTS, { recursive: true });

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 1;
    this.pending = new Map();
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      const res = JSON.parse(event.data);
      if (res.id && this.pending.has(res.id)) {
        const p = this.pending.get(res.id);
        this.pending.delete(res.id);
        if (res.error) p.reject(res.error);
        else p.resolve(res.result);
      }
    };
  }

  send(method, params = {}, sessionId) {
    const reqId = this.id++;
    return new Promise((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      const msg = { id: reqId, method, params };
      if (sessionId) msg.sessionId = sessionId;
      this.ws.send(JSON.stringify(msg));
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function run() {
  console.log('1. Authenticating via API to retrieve auth cookie...');
  let loginRes = await fetch(`${APP_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'arun', password: 'Password123!' })
  });

  if (!loginRes.ok) {
    console.log('Creating initial admin user...');
    await fetch(`${APP_URL}/api/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'arun', password: 'Password123!' })
    });
    loginRes = await fetch(`${APP_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'arun', password: 'Password123!' })
    });
  }

  const setCookie = loginRes.headers.get('set-cookie');
  const cookieVal = setCookie.split(';')[0].split('=')[1];
  console.log('Auth cookie retrieved successfully.');

  console.log('2. Starting headless Chrome at 2400x1500...');
  const tempDir = path.join(process.env.TEMP || 'C:\\Temp', 'chrome-asset-capture-' + Date.now());
  fs.mkdirSync(tempDir, { recursive: true });

  const proc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9333',
    `--user-data-dir=${tempDir}`,
    '--window-size=2400,1500',
    '--hide-scrollbars',
    'about:blank'
  ]);

  await sleep(2500);

  const verRes = await fetch('http://127.0.0.1:9333/json/version');
  const ver = await verRes.json();
  console.log('Connected to Chrome:', ver.Browser);

  const cdp = new CdpClient(ver.webSocketDebuggerUrl);
  await cdp.connect();

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

  // Crisp 2400x1500 rendering
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 2400,
    height: 1500,
    deviceScaleFactor: 1,
    mobile: false
  }, sessionId);

  async function navigate(url, waitMs = 3000) {
    console.log(`Navigating to ${url}...`);
    await cdp.send('Page.navigate', { url }, sessionId);
    await sleep(waitMs);
  }

  async function evaluate(expression) {
    return await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    }, sessionId);
  }

  async function capture(name) {
    console.log(`Capturing [${name}]...`);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const buf = Buffer.from(data, 'base64');

    const pngPath = path.join(REPO_SCREENSHOTS, `${name}.png`);
    fs.writeFileSync(pngPath, buf);

    const webpPath = path.join(SITE_SCREENSHOTS, `${name}.webp`);
    await sharp(buf)
      .resize(2400, 1500, { fit: 'cover' })
      .webp({ quality: 85 })
      .toFile(webpPath);

    console.log(`  -> Saved ${name}.png (${(buf.length / 1024).toFixed(1)} KB) & ${name}.webp (${(fs.statSync(webpPath).size / 1024).toFixed(1)} KB)`);
  }

  // ── 1. LOGIN SCREEN ────────────────────────────────────────────────────────
  await navigate(`${APP_URL}/login`, 2000);
  await capture('00-login');

  // ── 2. INJECT AUTH COOKIE ──────────────────────────────────────────────────
  console.log('Injecting auth cookie into browser context...');
  await cdp.send('Network.setCookie', {
    name: 'BankStatementAnalytics.Auth',
    value: cookieVal,
    url: APP_URL
  }, sessionId);

  // Set initial localStorage preferences (Light theme, All accounts)
  await navigate(`${APP_URL}/`, 3000);
  await evaluate(`
    localStorage.setItem('themePreference', '"light"');
    localStorage.setItem('fontSizePreference', '"default"');
    localStorage.setItem('selectedAccountId', 'null');
    localStorage.setItem('guideSeen:arun', '1');
    document.documentElement.dataset.theme = 'light';
  `);
  await navigate(`${APP_URL}/`, 3500);

  // ── 3. OVERVIEW DASHBOARD (CLEAN, NO MODALS) ─────────────────────────────
  await navigate(`${APP_URL}/`, 3500);
  await capture('01-overview');

  // ── 4. ONBOARDING GUIDE MODAL ──────────────────────────────────────────────
  console.log('Opening onboarding guide modal...');
  await evaluate(`
    const helpBtn = document.querySelector('button[aria-label="Open the getting-started guide"]');
    if (helpBtn) helpBtn.click();
  `);
  await sleep(1500);
  await capture('00b-onboarding');

  // Dismiss onboarding guide by clicking Skip tour
  await evaluate(`
    const skipBtn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Skip tour'));
    if (skipBtn) skipBtn.click();
  `);
  await sleep(1000);

  // ── 5. TRENDS ──────────────────────────────────────────────────────────────
  await navigate(`${APP_URL}/trends`, 3500);
  await capture('02-trends');

  // ── 6. INSIGHTS ────────────────────────────────────────────────────────────
  await navigate(`${APP_URL}/insights`, 3500);
  await capture('03-insights');

  // ── 7. TRANSACTIONS LEDGER ─────────────────────────────────────────────────
  await navigate(`${APP_URL}/transactions`, 3000);
  await capture('04-transactions');

  // ── 8. MERCHANTS ───────────────────────────────────────────────────────────
  await navigate(`${APP_URL}/merchants`, 3000);
  await capture('05-merchants');

  // ── 9. TRANSFERS ───────────────────────────────────────────────────────────
  await navigate(`${APP_URL}/transfers`, 3000);
  await capture('06-transfers');

  // ── 10. RECURRING BILLS ────────────────────────────────────────────────────
  await navigate(`${APP_URL}/bills`, 3000);
  await capture('07-bills');

  // ── 11. CATEGORY BUDGETS ───────────────────────────────────────────────────
  await navigate(`${APP_URL}/budgets`, 3000);
  await capture('08-budgets');

  // ── 12. INVESTMENTS (DEPOSITS) ─────────────────────────────────────────────
  await navigate(`${APP_URL}/investments`, 3000);
  await capture('09-investments');

  // ── 13. MONTHLY REPORT ─────────────────────────────────────────────────────
  await navigate(`${APP_URL}/reports`, 3000);
  await capture('10-reports');

  // ── 14. STATEMENT UPLOAD ───────────────────────────────────────────────────
  await navigate(`${APP_URL}/upload`, 3000);
  await capture('11-upload');

  // ── 15. SETTINGS ───────────────────────────────────────────────────────────
  await navigate(`${APP_URL}/settings`, 3000);
  await capture('12-settings');

  // ── 16. CREDIT CARD OVERVIEW & REPORT ──────────────────────────────────────
  console.log('Switching account scope to Credit Card (ID: 3)...');
  await evaluate(`
    localStorage.setItem('selectedAccountId', '3');
  `);
  await navigate(`${APP_URL}/`, 3500);
  await capture('13-credit-card');

  await navigate(`${APP_URL}/reports`, 3000);
  await capture('14-cc-report');

  // Reset back to All Accounts
  await evaluate(`
    localStorage.setItem('selectedAccountId', 'null');
  `);

  // ── 17. DARK THEME ─────────────────────────────────────────────────────────
  console.log('Switching to Dark Theme...');
  await evaluate(`
    localStorage.setItem('themePreference', '"dark"');
    document.documentElement.dataset.theme = 'dark';
  `);

  await navigate(`${APP_URL}/`, 3500);
  await capture('15-dark-overview');

  await navigate(`${APP_URL}/insights`, 3500);
  await capture('16-dark-insights');

  await navigate(`${APP_URL}/trends`, 3500);
  await capture('17-dark-trends');

  // Reset to Light Theme
  await evaluate(`
    localStorage.setItem('themePreference', '"light"');
    document.documentElement.dataset.theme = 'light';
  `);

  // ── 18. BILL SPLITS & GROUP EXPENSES (NEW v3.0 FEATURE) ────────────────────
  await navigate(`${APP_URL}/splits`, 3500);
  await capture('18-splits');

  // ── 19. SAVINGS GOALS (NEW FEATURE) ────────────────────────────────────────
  await navigate(`${APP_URL}/goals`, 3000);
  await capture('19-goals');

  // ── 20. GLOBAL SEARCH MODAL (NEW v3.0 FEATURE) ─────────────────────────────
  await navigate(`${APP_URL}/`, 2500);
  console.log('Opening Global Search modal...');
  await evaluate(`
    const searchBtn = document.querySelector('.search-trigger-btn');
    if (searchBtn) searchBtn.click();
  `);
  await sleep(1500);
  await capture('20-search');

  console.log('All 21 asset images captured and saved successfully!');

  cdp.close();
  proc.kill();
}

run().catch(err => {
  console.error('Fatal error during asset capture:', err);
  process.exit(1);
});

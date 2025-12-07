require('dotenv').config();
const express = require('express');
const { chromium } = require('playwright-chromium');
const _ = require('lodash');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// ==================== 500 REPLIES/DAY CONFIG ====================
const BOT_CONFIG = {
  // SCALE SETTINGS
  DAILY_TARGET: 500,
  HOURLY_LIMIT: 50,
  BATCH_SIZE: 10,
  
  // SAFETY SETTINGS
  MIN_DELAY: 15000,      // 15 seconds minimum
  MAX_DELAY: 45000,      // 45 seconds maximum
  TYPING_DELAY: 30,      // Typing speed (ms per char)
  
  // PROXY SETTINGS
  USE_PROXY: !!process.env.APIFY_PROXY_TOKEN,
  
  // HUMAN BEHAVIOR
  RANDOM_MOUSE: true,
  RANDOM_SCROLL: true,
  RANDOM_TYPOS: true
};

// ==================== RANDOM USER AGENTS (No external package) ====================
const USER_AGENTS = [
  // Chrome - Windows
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  
  // Chrome - Mac
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  
  // Chrome - Linux
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  
  // Firefox
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/120.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13.5; rv:109.0) Gecko/20100101 Firefox/120.0',
  
  // Safari
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15',
  
  // Mobile - iPhone
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
  
  // Mobile - Android
  'Mozilla/5.0 (Linux; Android 13; SM-S901U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36'
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 375, height: 667 },   // iPhone
  { width: 414, height: 896 },   // iPhone XR
  { width: 360, height: 800 }    // Android
];

// ==================== STATE ====================
let state = {
  browser: null,
  page: null,
  loggedIn: false,
  stats: {
    repliesToday: 0,
    errorsToday: 0,
    startTime: Date.now(),
    lastReply: null,
    hourlyCount: 0,
    lastHourReset: Date.now()
  },
  currentFingerprint: null
};

// ==================== HELPER FUNCTIONS ====================
function getRandomUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getRandomViewport() {
  return VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
}

function getRandomDelay() {
  return _.random(BOT_CONFIG.MIN_DELAY, BOT_CONFIG.MAX_DELAY);
}

function shouldRotateFingerprint() {
  // Rotate every 25 replies or if error occurs
  return state.stats.repliesToday % 25 === 0 || state.stats.errorsToday > 0;
}

// ==================== BROWSER MANAGEMENT ====================
async function initBrowser() {
  console.log('🚀 Initializing browser for 500/day scale...');
  
  // Get random fingerprint
  state.currentFingerprint = {
    userAgent: getRandomUserAgent(),
    viewport: getRandomViewport()
  };
  
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    `--window-size=${state.currentFingerprint.viewport.width},${state.currentFingerprint.viewport.height}`,
    '--disable-blink-features=AutomationControlled',
    '--lang=en-US,en'
  ];
  
  // Proxy setup
  if (BOT_CONFIG.USE_PROXY && process.env.APIFY_PROXY_TOKEN) {
    args.push('--proxy-server=proxy.apify.com:8000');
  }
  
  const browser = await chromium.launch({ 
    headless: true,
    args 
  });
  
  const context = await browser.newContext({
    viewport: state.currentFingerprint.viewport,
    userAgent: state.currentFingerprint.userAgent
  });
  
  // Set proxy auth if using Apify
  if (BOT_CONFIG.USE_PROXY && process.env.APIFY_PROXY_TOKEN) {
    await context.setHTTPCredentials({
      username: 'auto',
      password: process.env.APIFY_PROXY_TOKEN
    });
  }
  
  const page = await context.newPage();
  
  // Human-like evasion
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  });
  
  state.browser = browser;
  state.page = page;
  
  console.log(`✅ Browser ready | UA: ${state.currentFingerprint.userAgent.substring(0, 50)}...`);
  return { browser, page };
}

// ==================== HUMAN BEHAVIOR ====================
async function simulateHuman(page) {
  if (!BOT_CONFIG.RANDOM_MOUSE) return;
  
  // Random mouse movements
  const moves = _.random(2, 5);
  for (let i = 0; i < moves; i++) {
    const x = _.random(50, state.currentFingerprint.viewport.width - 50);
    const y = _.random(50, state.currentFingerprint.viewport.height - 50);
    await page.mouse.move(x, y);
    await page.waitForTimeout(_.random(50, 200));
  }
  
  // Random scroll
  if (BOT_CONFIG.RANDOM_SCROLL && Math.random() > 0.3) {
    await page.evaluate(() => {
      window.scrollBy(0, _.random(100, 500));
    });
    await page.waitForTimeout(_.random(300, 800));
  }
}

async function humanType(page, text) {
  for (let char of text) {
    await page.keyboard.type(char, { delay: _.random(BOT_CONFIG.TYPING_DELAY, BOT_CONFIG.TYPING_DELAY * 2) });
    
    // Random pause between words
    if (char === ' ' && Math.random() > 0.7) {
      await page.waitForTimeout(_.random(200, 600));
    }
    
    // Random typo (makes it more human)
    if (BOT_CONFIG.RANDOM_TYPOS && Math.random() > 0.98 && text.length > 5) {
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(_.random(50, 150));
      await page.keyboard.type(char);
    }
  }
}

// ==================== LOGIN SYSTEM ====================
async function login() {
  console.log('🔐 Logging in...');
  
  if (!state.browser) await initBrowser();
  
  try {
    // Use mobile.twitter.com (faster, less detection)
    await state.page.goto('https://mobile.twitter.com/login', {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    // Human simulation before typing
    await simulateHuman(state.page);
    await page.waitForTimeout(_.random(1000, 3000));
    
    // Username
    await state.page.waitForSelector('input[autocomplete="username"]', { timeout: 10000 });
    await humanType(state.page, process.env.X_USERNAME);
    await state.page.keyboard.press('Enter');
    
    await page.waitForTimeout(_.random(2000, 4000));
    
    // Password
    await state.page.waitForSelector('input[autocomplete="current-password"]', { timeout: 5000 });
    await humanType(state.page, process.env.X_PASSWORD);
    await state.page.keyboard.press('Enter');
    
    // Wait for login
    await page.waitForTimeout(_.random(3000, 5000));
    
    // Verify login by checking for tweet box
    await state.page.goto('https://mobile.twitter.com/home', { waitUntil: 'networkidle' });
    
    try {
      await state.page.waitForSelector('[data-testid="tweetTextarea_0"], textarea', { timeout: 5000 });
      state.loggedIn = true;
      console.log('✅ Login successful');
      return true;
    } catch (e) {
      // Alternative verification
      const content = await state.page.content();
      if (content.includes('Home') || content.includes('Tweet')) {
        state.loggedIn = true;
        console.log('✅ Login successful (alternative check)');
        return true;
      }
      throw new Error('Login verification failed');
    }
    
  } catch (error) {
    console.error('❌ Login failed:', error.message);
    
    // Rotate fingerprint and retry
    if (state.browser) await state.browser.close();
    state.browser = null;
    state.page = null;
    state.loggedIn = false;
    
    // Retry once
    return login();
  }
}

// ==================== 500 REPLIES/DAY ENGINE ====================
async function sendReply(tweetId, replyText) {
  // Check hourly limit
  const now = Date.now();
  if (now - state.stats.lastHourReset > 3600000) {
    state.stats.hourlyCount = 0;
    state.stats.lastHourReset = now;
  }
  
  if (state.stats.hourlyCount >= BOT_CONFIG.HOURLY_LIMIT) {
    throw new Error(`Hourly limit reached: ${state.stats.hourlyCount}/${BOT_CONFIG.HOURLY_LIMIT}`);
  }
  
  if (!state.loggedIn) await login();
  
  // Rotate fingerprint if needed
  if (shouldRotateFingerprint()) {
    console.log('🔄 Rotating fingerprint...');
    if (state.browser) await state.browser.close();
    state.browser = null;
    state.page = null;
    await initBrowser();
    await login();
  }
  
  try {
    console.log(`💬 [${state.stats.repliesToday+1}/500] Replying to ${tweetId}`);
    
    // Random delay
    const delay = getRandomDelay();
    await page.waitForTimeout(delay);
    
    // Navigate to tweet
    await state.page.goto(`https://mobile.twitter.com/i/status/${tweetId}`, {
      waitUntil: 'networkidle',
      timeout: 15000
    });
    
    // Human simulation
    await simulateHuman(state.page);
    
    // Find reply button
    const replyButton = await state.page.$('a[href*="/compose/tweet"]') || 
                        await state.page.$('[data-testid="reply"]');
    
    if (!replyButton) throw new Error('Reply button not found');
    
    await replyButton.click();
    await page.waitForTimeout(_.random(800, 1500));
    
    // Type reply
    const textarea = await state.page.$('[data-testid="tweetTextarea_0"], textarea');
    if (textarea) {
      await textarea.click();
      await humanType(state.page, replyText);
    }
    
    await page.waitForTimeout(_.random(1000, 2000));
    
    // Send
    const sendButton = await state.page.$('[data-testid="tweetButton"]');
    if (sendButton) {
      await sendButton.click();
    }
    
    // Wait for confirmation
    await page.waitForTimeout(_.random(1000, 2000));
    
    // Update stats
    state.stats.repliesToday++;
    state.stats.hourlyCount++;
    state.stats.lastReply = new Date().toISOString();
    
    console.log(`✅ Reply #${state.stats.repliesToday} sent (Hourly: ${state.stats.hourlyCount}/${BOT_CONFIG.HOURLY_LIMIT})`);
    
    return {
      success: true,
      tweetId,
      replyNumber: state.stats.repliesToday,
      remainingToday: BOT_CONFIG.DAILY_TARGET - state.stats.repliesToday,
      remainingHourly: BOT_CONFIG.HOURLY_LIMIT - state.stats.hourlyCount,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    state.stats.errorsToday++;
    console.error('❌ Reply failed:', error.message);
    
    // Auto-recovery: Restart browser
    if (state.browser) await state.browser.close();
    state.browser = null;
    state.page = null;
    state.loggedIn = false;
    
    return {
      success: false,
      error: error.message,
      recovery: 'Browser restarted automatically'
    };
  }
}

// ==================== BATCH PROCESSING (For 500/day) ====================
async function processBatch(tweets) {
  const results = [];
  const batch = tweets.slice(0, BOT_CONFIG.BATCH_SIZE);
  
  for (const { tweetId, replyText } of batch) {
    if (state.stats.repliesToday >= BOT_CONFIG.DAILY_TARGET) break;
    
    // Variable delay between batch items
    if (results.length > 0) {
      await page.waitForTimeout(getRandomDelay() / 2);
    }
    
    const result = await sendReply(tweetId, replyText);
    results.push(result);
    
    // Check if we need to pause for hourly limit
    if (state.stats.hourlyCount >= BOT_CONFIG.HOURLY_LIMIT) {
      console.log(`⏸️ Hourly limit reached. Pausing for ${Math.ceil((3600000 - (Date.now() - state.stats.lastHourReset)) / 60000)} minutes`);
      break;
    }
  }
  
  return results;
}

// ==================== API ENDPOINTS ====================
app.get('/', (req, res) => {
  const uptime = Date.now() - state.stats.startTime;
  const hours = Math.floor(uptime / 3600000);
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>🔥 500/Day Twitter Bot</title>
      <style>
        body { font-family: Arial; background: #000; color: #0f0; padding: 20px; }
        .stats { font-size: 28px; font-weight: bold; margin: 20px 0; }
        .progress-bar { width: 100%; background: #333; height: 30px; border-radius: 5px; overflow: hidden; }
        .progress-fill { height: 100%; background: #0f0; width: ${(state.stats.repliesToday/BOT_CONFIG.DAILY_TARGET)*100}%; }
        .btn { display: inline-block; background: #0f0; color: #000; padding: 10px 20px; margin: 5px; text-decoration: none; font-weight: bold; }
      </style>
    </head>
    <body>
      <h1>🔥 500 REPLIES/DAY BOT</h1>
      <p>Enterprise-scale Twitter automation</p>
      
      <div class="stats">
        ${state.stats.repliesToday}/${BOT_CONFIG.DAILY_TARGET} replies today
      </div>
      
      <div class="progress-bar">
        <div class="progress-fill"></div>
      </div>
      
      <p>Hourly: ${state.stats.hourlyCount}/${BOT_CONFIG.HOURLY_LIMIT}</p>
      <p>Errors: ${state.stats.errorsToday}</p>
      <p>Status: ${state.loggedIn ? '✅ LOGGED IN' : '❌ NOT LOGGED'}</p>
      <p>Proxy: ${BOT_CONFIG.USE_PROXY ? '✅ ACTIVE' : '❌ NOT CONFIGURED'}</p>
      <p>Uptime: ${hours} hours</p>
      
      <div>
        <a class="btn" href="/login">🔐 Login</a>
        <a class="btn" href="/test">🧪 Test Reply</a>
        <a class="btn" href="/stats">📊 Stats</a>
        <a class="btn" href="/restart">🔄 Restart</a>
      </div>
      
      <h3>API Endpoints:</h3>
      <p><strong>POST /reply</strong> - Single reply</p>
      <p><strong>POST /batch</strong> - Multiple replies</p>
      <p><strong>GET /health</strong> - System health</p>
    </body>
    </html>
  `);
});

app.get('/login', async (req, res) => {
  try {
    await login();
    res.json({ success: true, loggedIn: state.loggedIn });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/test', async (req, res) => {
  try {
    const result = await sendReply(
      '1798869340253892810',
      '🚀 Testing 500/day scale bot... Ready for enterprise automation!'
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/stats', (req, res) => {
  res.json({
    target: BOT_CONFIG.DAILY_TARGET,
    replies_today: state.stats.repliesToday,
    hourly_count: state.stats.hourlyCount,
    hourly_limit: BOT_CONFIG.HOURLY_LIMIT,
    errors_today: state.stats.errorsToday,
    logged_in: state.loggedIn,
    fingerprint_rotated: state.currentFingerprint ? 'active' : 'none',
    proxy: BOT_CONFIG.USE_PROXY ? 'configured' : 'not configured'
  });
});

app.post('/reply', async (req, res) => {
  try {
    const { tweetId, replyText } = req.body;
    
    if (!tweetId || !replyText) {
      return res.status(400).json({ error: 'Need tweetId and replyText' });
    }
    
    const result = await sendReply(tweetId, replyText);
    res.json(result);
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/batch', async (req, res) => {
  try {
    const { tweets } = req.body;
    
    if (!tweets || !Array.isArray(tweets)) {
      return res.status(400).json({ 
        error: 'Need tweets array',
        example: { tweets: [{tweetId: '123', replyText: 'Hello'}] }
      });
    }
    
    const results = await processBatch(tweets);
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    res.json({
      batch_processed: true,
      successful,
      failed,
      total_today: state.stats.repliesToday,
      remaining_today: BOT_CONFIG.DAILY_TARGET - state.stats.repliesToday,
      remaining_hourly: BOT_CONFIG.HOURLY_LIMIT - state.stats.hourlyCount,
      details: results
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== START SERVER ====================
async function startServer() {
  try {
    await initBrowser();
    console.log(`
🔥🔥🔥 500 REPLIES/DAY BOT 🔥🔥🔥

✅ SCALE CONFIGURED:
• Daily Target: ${BOT_CONFIG.DAILY_TARGET} replies
• Hourly Limit: ${BOT_CONFIG.HOURLY_LIMIT} replies
• Batch Size: ${BOT_CONFIG.BATCH_SIZE} per batch
• Delays: ${BOT_CONFIG.MIN_DELAY/1000}-${BOT_CONFIG.MAX_DELAY/1000}s

✅ SECURITY FEATURES:
• Fingerprint Rotation (every 25 replies)
• Human Behavior Simulation
• Auto-Recovery System
• Proxy Support: ${BOT_CONFIG.USE_PROXY ? 'ACTIVE' : 'DISABLED'}

🚀 Ready on port ${PORT}
    `);
    
    app.listen(PORT, () => {
      console.log(`✅ Server running on port ${PORT}`);
    });
    
  } catch (error) {
    console.error('❌ Startup failed:', error.message);
    
    // Fallback server without browser
    app.listen(PORT, () => {
      console.log(`Server running (fallback) on ${PORT}`);
    });
  }
}

startServer();

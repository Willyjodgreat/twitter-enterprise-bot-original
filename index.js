require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const UserAgent = require('user-agents');
const _ = require('lodash');
const CryptoJS = require('crypto-js');

// Security plugins
puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// Config
const CONFIG = {
  DAILY_LIMIT: 100,
  MIN_DELAY: 25000,
  MAX_DELAY: 75000,
  USE_PROXY: !!process.env.APIFY_PROXY_TOKEN
};

// State
let state = {
  browser: null,
  page: null,
  loggedIn: false,
  stats: { replies: 0, errors: 0, startTime: Date.now() }
};

// Initialize browser
async function initBrowser() {
  console.log('🚀 Starting browser...');
  
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--window-size=1280,800',
    '--disable-blink-features=AutomationControlled'
  ];
  
  if (CONFIG.USE_PROXY && process.env.APIFY_PROXY_TOKEN) {
    args.push('--proxy-server=proxy.apify.com:8000');
  }
  
  const browser = await puppeteer.launch({
    headless: 'new',
    args,
    ignoreHTTPSErrors: true
  });
  
  const page = await browser.newPage();
  
  // Set random user agent
  const userAgent = new UserAgent().toString();
  await page.setUserAgent(userAgent);
  
  // Evasion
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  
  // Proxy auth
  if (CONFIG.USE_PROXY && process.env.APIFY_PROXY_TOKEN) {
    await page.authenticate({
      username: 'auto',
      password: process.env.APIFY_PROXY_TOKEN
    });
  }
  
  state.browser = browser;
  state.page = page;
  
  console.log('✅ Browser ready');
  return { browser, page };
}

// Login
async function login() {
  console.log('🔐 Logging in...');
  
  if (!state.browser) await initBrowser();
  
  try {
    await state.page.goto('https://mobile.twitter.com/login', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    // Username
    await state.page.waitForSelector('input[autocomplete="username"]', { timeout: 10000 });
    await state.page.type('input[autocomplete="username"]', process.env.X_USERNAME, { delay: 50 });
    await state.page.keyboard.press('Enter');
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Password
    await state.page.waitForSelector('input[autocomplete="current-password"]', { timeout: 5000 });
    await state.page.type('input[autocomplete="current-password"]', process.env.X_PASSWORD, { delay: 50 });
    await state.page.keyboard.press('Enter');
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Verify
    await state.page.goto('https://mobile.twitter.com/home', { waitUntil: 'domcontentloaded' });
    
    state.loggedIn = true;
    console.log('✅ Login successful');
    return true;
    
  } catch (error) {
    console.error('❌ Login failed:', error.message);
    throw error;
  }
}

// Reply
async function reply(tweetId, replyText) {
  if (!state.loggedIn) await login();
  
  if (state.stats.replies >= CONFIG.DAILY_LIMIT) {
    throw new Error(`Daily limit: ${state.stats.replies}/${CONFIG.DAILY_LIMIT}`);
  }
  
  try {
    console.log(`💬 Replying to ${tweetId}...`);
    
    // Random delay
    const delay = _.random(CONFIG.MIN_DELAY, CONFIG.MAX_DELAY);
    await new Promise(resolve => setTimeout(resolve, delay));
    
    await state.page.goto(`https://mobile.twitter.com/i/status/${tweetId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });
    
    // Find reply button
    const replyButton = await state.page.$('a[href*="/compose/tweet"]') || 
                        await state.page.$('[data-testid="reply"]');
    
    if (!replyButton) throw new Error('Reply button not found');
    
    await replyButton.click();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Type reply
    const textarea = await state.page.$('[data-testid="tweetTextarea_0"], textarea');
    if (textarea) {
      await textarea.click();
      await state.page.keyboard.type(replyText, { delay: 50 });
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Send
    const sendButton = await state.page.$('[data-testid="tweetButton"]');
    if (sendButton) {
      await sendButton.click();
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    state.stats.replies++;
    console.log(`✅ Reply #${state.stats.replies} sent`);
    
    return {
      success: true,
      tweetId,
      replies: state.stats.replies,
      remaining: CONFIG.DAILY_LIMIT - state.stats.replies
    };
    
  } catch (error) {
    state.stats.errors++;
    console.error('❌ Reply failed:', error.message);
    return { success: false, error: error.message };
  }
}

// API
app.get('/', (req, res) => {
  const uptime = Date.now() - state.stats.startTime;
  const hours = Math.floor(uptime / 3600000);
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>✅ Twitter Bot</title></head>
    <body>
      <h1>✅ Bot is Working!</h1>
      <p>Replies: ${state.stats.replies}/${CONFIG.DAILY_LIMIT}</p>
      <p>Uptime: ${hours}h</p>
      <a href="/login">Login</a> | 
      <a href="/test">Test</a> | 
      <a href="/health">Health</a>
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
    const result = await reply(
      '1798869340253892810',
      '🤖 Testing bot...'
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    replies: state.stats.replies,
    loggedIn: state.loggedIn,
    proxy: CONFIG.USE_PROXY ? 'active' : 'inactive'
  });
});

app.post('/reply', async (req, res) => {
  try {
    const { tweetId, replyText } = req.body;
    if (!tweetId || !replyText) {
      return res.status(400).json({ error: 'Need tweetId and replyText' });
    }
    const result = await reply(tweetId, replyText);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start
async function start() {
  try {
    await initBrowser();
    console.log('✅ Bot initialized');
    
    app.listen(PORT, () => {
      console.log(`
✅ BOT READY ON PORT ${PORT}
📊 Daily limit: ${CONFIG.DAILY_LIMIT}
🌐 Proxy: ${CONFIG.USE_PROXY ? 'active' : 'inactive'}
      `);
    });
  } catch (error) {
    console.error('❌ Startup failed:', error.message);
    app.listen(PORT, () => {
      console.log(`Server running (fallback) on ${PORT}`);
    });
  }
}

start();

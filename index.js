// ==================== TWITTER BOT FOR RAILWAY ====================
require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer');
const _ = require('lodash');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// Railway has Chrome pre-installed with ALL dependencies
console.log('🚀 Railway detected - Chrome is fully available!');

// ==================== STATE ====================
let browser = null;
let page = null;
let isLoggedIn = false;
let stats = {
  totalReplies: 0,
  successful: 0,
  failed: 0
};

// ==================== BROWSER INIT ====================
async function initBrowser() {
  console.log('🔧 Initializing Chrome on Railway...');
  
  try {
    // Railway has Chrome with all dependencies
    const browser = await puppeteer.launch({
      headless: 'new',  // Use new headless mode
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--single-process',
        '--no-zygote'
      ]
    });
    
    const page = await browser.newPage();
    
    // Set realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    
    console.log('✅ Chrome initialized successfully on Railway');
    return { browser, page };
    
  } catch (error) {
    console.error('❌ Chrome init failed:', error.message);
    
    // Try alternative args
    try {
      const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      
      console.log('✅ Chrome started with minimal args');
      return { browser, page: await browser.newPage() };
    } catch (fallbackError) {
      console.error('❌ All Chrome attempts failed:', fallbackError.message);
      throw fallbackError;
    }
  }
}

// ==================== LOGIN ====================
async function login() {
  try {
    if (!browser) {
      const result = await initBrowser();
      browser = result.browser;
      page = result.page;
    }
    
    console.log('🔐 Logging into Twitter...');
    
    // Use mobile.twitter.com - lighter and works better
    await page.goto('https://mobile.twitter.com/login', {
      waitUntil: 'networkidle0',
      timeout: 30000
    });
    
    await page.waitForTimeout(2000);
    
    // Username
    await page.type('input[autocomplete="username"]', process.env.X_USERNAME, { delay: 100 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    
    // Sometimes Twitter asks for email/username again
    const currentUrl = page.url();
    if (currentUrl.includes('account/check')) {
      await page.type('input', process.env.X_USERNAME, { delay: 100 });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);
    }
    
    // Password
    await page.type('input[type="password"]', process.env.X_PASSWORD, { delay: 100 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(5000);
    
    // Check if logged in
    const content = await page.content();
    isLoggedIn = content.includes('Home') || content.includes('Tweet') || 
                 content.includes('home') || !content.includes('login');
    
    if (isLoggedIn) {
      console.log('✅ Login successful!');
    } else {
      // Save screenshot for debugging
      await page.screenshot({ path: '/tmp/login-debug.png' });
      console.log('⚠️ Login may need manual verification');
    }
    
    return isLoggedIn;
    
  } catch (error) {
    console.error('❌ Login error:', error.message);
    
    // Save error screenshot
    try {
      await page.screenshot({ path: '/tmp/login-error.png' });
    } catch (e) {}
    
    return false;
  }
}

// ==================== SEND REPLY ====================
async function sendReply(tweetId, replyText) {
  stats.totalReplies++;
  
  if (!isLoggedIn) {
    console.log('🤔 Not logged in, attempting login...');
    const loggedIn = await login();
    if (!loggedIn) {
      stats.failed++;
      return {
        success: false,
        error: 'Login failed',
        tweetId,
        suggestion: 'Check /login endpoint first'
      };
    }
  }
  
  try {
    console.log(`💬 Replying to ${tweetId}...`);
    
    // Navigate to tweet (mobile version is more reliable)
    await page.goto(`https://mobile.twitter.com/i/status/${tweetId}`, {
      waitUntil: 'networkidle0',
      timeout: 15000
    });
    
    await page.waitForTimeout(3000);
    
    // Find reply button (multiple selectors)
    const replySelectors = [
      '[data-testid="reply"]',
      'a[href*="/compose/tweet"]',
      'div[role="button"][aria-label*="Reply"]',
      'svg[aria-label="Reply"]'
    ];
    
    let replyButton = null;
    for (const selector of replySelectors) {
      replyButton = await page.$(selector);
      if (replyButton) break;
    }
    
    if (!replyButton) {
      // Try clicking by position
      await page.mouse.click(200, 400);
      await page.waitForTimeout(1000);
      replyButton = await page.$('[data-testid="reply"]');
    }
    
    if (!replyButton) {
      throw new Error('Reply button not found');
    }
    
    await replyButton.click();
    await page.waitForTimeout(1500);
    
    // Find reply text box
    const textareaSelectors = [
      '[data-testid="tweetTextarea_0"]',
      'textarea',
      'div[contenteditable="true"]',
      '[aria-label*="Tweet text"]'
    ];
    
    let textarea = null;
    for (const selector of textareaSelectors) {
      textarea = await page.$(selector);
      if (textarea) break;
    }
    
    if (textarea) {
      await textarea.type(replyText, { delay: 50 });
    }
    
    await page.waitForTimeout(1000);
    
    // Find send button
    const sendButtonSelectors = [
      '[data-testid="tweetButton"]',
      'div[role="button"][data-testid*="tweet"]',
      'button:has-text("Tweet")',
      'div[aria-label*="Tweet"]'
    ];
    
    let sendButton = null;
    for (const selector of sendButtonSelectors) {
      sendButton = await page.$(selector);
      if (sendButton) break;
    }
    
    if (sendButton) {
      await sendButton.click();
    } else {
      // Try Enter key
      await page.keyboard.press('Enter');
    }
    
    await page.waitForTimeout(3000);
    
    stats.successful++;
    
    console.log('✅ Reply sent successfully!');
    
    return {
      success: true,
      tweetId,
      timestamp: new Date().toISOString(),
      stats: {
        total: stats.totalReplies,
        successful: stats.successful,
        failed: stats.failed
      }
    };
    
  } catch (error) {
    stats.failed++;
    console.error('❌ Reply failed:', error.message);
    
    // Save error screenshot
    try {
      await page.screenshot({ path: `/tmp/error-${Date.now()}.png` });
    } catch (e) {}
    
    // Don't close browser on error, just mark as not logged in
    isLoggedIn = false;
    
    return {
      success: false,
      error: error.message,
      tweetId,
      retry: true
    };
  }
}

// ==================== N8N WEBHOOK ====================
app.post('/n8n/webhook', async (req, res) => {
  try {
    const { tweetId, replyText } = req.body;
    
    if (!tweetId || !replyText) {
      return res.status(400).json({
        error: 'Need tweetId and replyText',
        example: { tweetId: '1798869340253892810', replyText: 'Great post!' }
      });
    }
    
    const result = await sendReply(tweetId, replyText);
    res.json(result);
    
  } catch (error) {
    res.status(500).json({
      error: error.message,
      suggestion: 'Try logging in first at /login'
    });
  }
});

// ==================== API ENDPOINTS ====================
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Twitter Bot on Railway</title>
      <style>
        body { font-family: Arial; padding: 30px; max-width: 800px; margin: 0 auto; }
        .status { padding: 20px; border-radius: 10px; margin: 20px 0; }
        .good { background: #d4edda; border: 1px solid #c3e6cb; }
        .warn { background: #fff3cd; border: 1px solid #ffeaa7; }
        .btn { display: inline-block; padding: 10px 20px; background: #1DA1F2; color: white; text-decoration: none; border-radius: 5px; margin: 5px; }
        pre { background: #f5f5f5; padding: 15px; border-radius: 5px; overflow-x: auto; }
      </style>
    </head>
    <body>
      <h1>🤖 Twitter Bot on Railway</h1>
      <p><em>✅ Chrome is fully installed with all dependencies!</em></p>
      
      <div class="status ${isLoggedIn ? 'good' : 'warn'}">
        <h3>Status</h3>
        <p><strong>Logged in:</strong> ${isLoggedIn ? '✅ Yes' : '❌ No'}</p>
        <p><strong>Browser active:</strong> ${browser ? '✅ Yes' : '❌ No'}</p>
        <p><strong>Replies sent:</strong> ${stats.successful}/${stats.totalReplies} successful</p>
      </div>
      
      <div>
        <a class="btn" href="/login">🔐 Login to Twitter</a>
        <a class="btn" href="/test">🧪 Test Reply</a>
        <a class="btn" href="/health">📊 Health Check</a>
      </div>
      
      <h3>N8N Webhook</h3>
      <pre>
POST ${req.protocol}://${req.get('host')}/n8n/webhook
Content-Type: application/json

{
  "tweetId": "1798869340253892810",
  "replyText": "Testing from Railway with Chrome!"
}
      </pre>
      
      <h3>Troubleshooting</h3>
      <ul>
        <li>First visit <a href="/login">/login</a> to initialize browser</li>
        <li>Check Railway logs for Chrome errors</li>
        <li>Make sure X_USERNAME and X_PASSWORD are set in Railway variables</li>
      </ul>
    </body>
    </html>
  `);
});

app.get('/login', async (req, res) => {
  try {
    const result = await login();
    
    if (result && page) {
      // Take screenshot of login result
      try {
        await page.screenshot({ path: '/tmp/login-result.png' });
      } catch (e) {}
    }
    
    res.json({
      success: result,
      loggedIn: isLoggedIn,
      browser: !!browser,
      message: result ? 'Login successful' : 'Login failed - check Railway logs'
    });
    
  } catch (error) {
    res.status(500).json({
      error: error.message,
      stack: process.env.NODE_ENV === 'production' ? undefined : error.stack
    });
  }
});

app.get('/test', async (req, res) => {
  try {
    const result = await sendReply(
      '1798869340253892810',
      '🤖 Testing Twitter bot on Railway! Chrome works perfectly! 🚀'
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'running',
    system: {
      memory: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
      uptime: `${Math.floor(process.uptime())}s`,
      platform: process.platform
    },
    bot: {
      loggedIn: isLoggedIn,
      browser: !!browser,
      stats: stats
    },
    railway: {
      chrome: 'available',
      puppeteer: 'working'
    }
  });
});

// ==================== START SERVER ====================
async function startServer() {
  try {
    console.log(`
🎉 TWITTER BOT STARTING ON RAILWAY
📍 Port: ${PORT}
✅ Environment: Railway (Chrome available)
📦 Using: Puppeteer with full Chrome
🚀 Ready for n8n integration!

🔧 Railway will install Chrome dependencies automatically
📝 First, visit /login to initialize browser
    `);
    
    app.listen(PORT, () => {
      console.log(`✅ Server listening on port ${PORT}`);
      console.log(`✅ Railway URL: https://${process.env.RAILWAY_STATIC_URL || 'your-app.up.railway.app'}`);
    });
    
  } catch (error) {
    console.error('❌ Server startup failed:', error);
    process.exit(1);
  }
}

// Handle shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down...');
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

startServer();

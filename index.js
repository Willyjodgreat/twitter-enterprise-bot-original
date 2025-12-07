// ==================== RENDER-COMPATIBLE TWITTER BOT WITH N8N ====================
require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer-core');
const _ = require('lodash');
const fs = require('fs');

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

// ==================== FIND CHROME ON RENDER ====================
function findChromePath() {
  const possiblePaths = [
    '/opt/google/chrome/chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  
  for (const path of possiblePaths) {
    if (fs.existsSync(path)) {
      console.log(`✅ Found Chrome at: ${path}`);
      return path;
    }
  }
  
  console.log('⚠️ No Chrome found, using default');
  return null;
}

const CHROME_PATH = findChromePath();

// ==================== CONFIG ====================
const CONFIG = {
  dailyLimit: process.env.DAILY_LIMIT || 50,
  hourlyLimit: process.env.HOURLY_LIMIT || 10,
  minDelay: 30000,
  maxDelay: 120000,
  maxQueueSize: 100,
  n8nSecret: process.env.N8N_SECRET || 'your-n8n-secret-key'
};

// ==================== QUEUE SYSTEM FOR N8N ====================
class TaskQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.completed = [];
    this.failed = [];
    this.stats = {
      totalProcessed: 0,
      totalFailed: 0,
      lastProcessed: null
    };
  }
  
  add(task) {
    if (this.queue.length >= CONFIG.maxQueueSize) {
      throw new Error('Queue is full');
    }
    
    const queueItem = {
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...task,
      status: 'queued',
      createdAt: new Date().toISOString(),
      attempts: 0,
      maxAttempts: 3
    };
    
    this.queue.push(queueItem);
    console.log(`📥 Task added to queue: ${queueItem.id}`);
    
    // Auto-start processing
    if (!this.processing) {
      this.processQueue();
    }
    
    return queueItem;
  }
  
  async processQueue() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    console.log(`🔄 Processing queue: ${this.queue.length} tasks`);
    
    while (this.queue.length > 0) {
      const task = this.queue[0];
      
      try {
        task.status = 'processing';
        task.startedAt = new Date().toISOString();
        
        console.log(`🎯 Processing task ${task.id}: ${task.tweetId}`);
        
        // Process the task (this will be replaced with actual sendReply)
        const result = await global.sendReply(task.tweetId, task.replyText);
        
        task.status = 'completed';
        task.completedAt = new Date().toISOString();
        task.result = result;
        
        this.completed.push(task);
        this.queue.shift(); // Remove from queue
        this.stats.totalProcessed++;
        this.stats.lastProcessed = new Date().toISOString();
        
        console.log(`✅ Task ${task.id} completed`);
        
      } catch (error) {
        task.attempts++;
        task.lastError = error.message;
        
        if (task.attempts >= task.maxAttempts) {
          task.status = 'failed';
          task.completedAt = new Date().toISOString();
          this.failed.push(task);
          this.queue.shift();
          this.stats.totalFailed++;
          console.log(`❌ Task ${task.id} failed after ${task.maxAttempts} attempts`);
        } else {
          // Move to end of queue for retry
          this.queue.shift();
          this.queue.push(task);
          console.log(`🔄 Task ${task.id} will retry (attempt ${task.attempts})`);
        }
      }
      
      // Rate limiting between tasks
      await new Promise(resolve => 
        setTimeout(resolve, _.random(CONFIG.minDelay, CONFIG.maxDelay))
      );
    }
    
    this.processing = false;
    console.log('🏁 Queue processing complete');
  }
  
  getStatus() {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      queued: this.queue.filter(t => t.status === 'queued').length,
      processingNow: this.queue.filter(t => t.status === 'processing').length,
      completed: this.completed.length,
      failed: this.failed.length,
      stats: this.stats
    };
  }
  
  clearCompleted() {
    const count = this.completed.length + this.failed.length;
    this.completed = [];
    this.failed = [];
    return count;
  }
}

// Initialize queue
const taskQueue = new TaskQueue();

// ==================== BROWSER MANAGEMENT ====================
let browser = null;
let page = null;
let isLoggedIn = false;

async function initBrowser() {
  console.log('🚀 Initializing browser...');
  
  try {
    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080'
      ]
    };
    
    if (CHROME_PATH) {
      launchOptions.executablePath = CHROME_PATH;
      console.log('📦 Using Render system Chrome');
    }
    
    browser = await puppeteer.launch(launchOptions);
    page = await browser.newPage();
    
    // Set realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1920, height: 1080 });
    
    console.log('✅ Browser ready');
    return { browser, page };
    
  } catch (error) {
    console.error('❌ Browser init failed:', error.message);
    
    try {
      browser = await puppeteer.launch({ 
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      page = await browser.newPage();
      console.log('✅ Browser started (fallback mode)');
      return { browser, page };
    } catch (fallbackError) {
      console.error('❌ Complete browser failure:', fallbackError.message);
      return null;
    }
  }
}

// ==================== LOGIN FUNCTION ====================
async function login() {
  if (!browser) {
    const result = await initBrowser();
    if (!result) throw new Error('Browser failed to initialize');
  }
  
  try {
    console.log('🔐 Logging into Twitter...');
    
    await page.goto('https://twitter.com/i/flow/login', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    await page.waitForTimeout(2000);
    
    // Username
    await page.type('input[autocomplete="username"]', process.env.X_USERNAME || '');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
    
    // Password
    await page.type('input[type="password"]', process.env.X_PASSWORD || '');
    await page.keyboard.press('Enter');
    
    // Wait for login
    await page.waitForTimeout(5000);
    
    // Verify login
    const url = page.url();
    isLoggedIn = url.includes('home') || url.includes('twitter.com/home');
    
    console.log(isLoggedIn ? '✅ Login successful' : '⚠️ Login may have failed');
    return isLoggedIn;
    
  } catch (error) {
    console.error('❌ Login error:', error.message);
    return false;
  }
}

// ==================== REPLY FUNCTION ====================
async function sendReply(tweetId, replyText) {
  if (!isLoggedIn) {
    console.log('🤔 Not logged in, attempting login...');
    const loggedIn = await login();
    if (!loggedIn) {
      throw new Error('Failed to login');
    }
  }
  
  try {
    console.log(`💬 Preparing reply to tweet ${tweetId}...`);
    
    // Navigate to tweet
    await page.goto(`https://twitter.com/i/status/${tweetId}`, {
      waitUntil: 'networkidle2',
      timeout: 15000
    });
    
    await page.waitForTimeout(3000);
    
    // Find reply button and click
    const replyButton = await page.$('[data-testid="reply"]');
    if (!replyButton) {
      throw new Error('Reply button not found');
    }
    
    await replyButton.click();
    await page.waitForTimeout(1000);
    
    // Type reply
    const tweetBox = await page.$('[data-testid="tweetTextarea_0"]');
    if (tweetBox) {
      await tweetBox.type(replyText, { delay: 50 });
    }
    
    await page.waitForTimeout(1000);
    
    // Send tweet
    const sendButton = await page.$('[data-testid="tweetButton"]');
    if (sendButton) {
      await sendButton.click();
    }
    
    await page.waitForTimeout(3000);
    
    console.log('✅ Reply sent successfully!');
    return { 
      success: true, 
      tweetId,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('❌ Reply failed:', error.message);
    
    // Reset login state on error
    isLoggedIn = false;
    
    return {
      success: false,
      error: error.message
    };
  }
}

// ==================== MIDDLEWARE: N8N SECURITY ====================
function validateN8NRequest(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['x-n8n-signature'];
  const secret = req.query.secret || req.body.secret;
  
  if (CONFIG.n8nSecret && CONFIG.n8nSecret !== 'your-n8n-secret-key') {
    if (!authHeader && !secret) {
      return res.status(401).json({ 
        error: 'Missing authentication',
        hint: 'Add ?secret=YOUR_SECRET or Authorization header'
      });
    }
    
    const providedSecret = authHeader?.replace('Bearer ', '') || secret;
    if (providedSecret !== CONFIG.n8nSecret) {
      return res.status(403).json({ error: 'Invalid authentication' });
    }
  }
  
  next();
}

// ==================== N8N WEBHOOK ENDPOINTS ====================

// Webhook to add tasks to queue
app.post('/n8n/webhook', validateN8NRequest, async (req, res) => {
  try {
    const { tweetId, replyText, priority = 5, metadata = {} } = req.body;
    
    if (!tweetId || !replyText) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['tweetId', 'replyText'],
        received: req.body
      });
    }
    
    const task = taskQueue.add({
      tweetId,
      replyText,
      priority,
      metadata,
      source: 'n8n-webhook'
    });
    
    res.json({
      success: true,
      message: 'Task queued successfully',
      taskId: task.id,
      queuePosition: taskQueue.queue.length,
      estimatedTime: `${Math.round((taskQueue.queue.length * 45) / 60)} minutes`
    });
    
  } catch (error) {
    res.status(500).json({ 
      error: error.message,
      queueStatus: taskQueue.getStatus()
    });
  }
});

// Batch webhook for multiple tasks
app.post('/n8n/batch', validateN8NRequest, async (req, res) => {
  try {
    const tasks = req.body.tasks || [];
    
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ 
        error: 'Expected tasks array',
        example: { tasks: [{tweetId: '123', replyText: 'Hello'}] }
      });
    }
    
    const results = [];
    for (const task of tasks.slice(0, 20)) { // Limit to 20 per batch
      if (task.tweetId && task.replyText) {
        const queuedTask = taskQueue.add({
          tweetId: task.tweetId,
          replyText: task.replyText,
          priority: task.priority || 5,
          metadata: task.metadata || {},
          source: 'n8n-batch'
        });
        results.push({
          taskId: task.tweetId,
          queueId: queuedTask.id,
          status: 'queued'
        });
      }
    }
    
    res.json({
      success: true,
      message: `Queued ${results.length} tasks`,
      results,
      queueStatus: taskQueue.getStatus()
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get queue status
app.get('/n8n/queue', validateN8NRequest, (req, res) => {
  const status = taskQueue.getStatus();
  const queueItems = taskQueue.queue.slice(0, 20); // Show first 20
  
  res.json({
    ...status,
    nextTasks: queueItems,
    system: {
      loggedIn: isLoggedIn,
      browser: !!browser,
      chromePath: CHROME_PATH,
      uptime: process.uptime()
    }
  });
});

// Clear completed tasks
app.delete('/n8n/queue/completed', validateN8NRequest, (req, res) => {
  const cleared = taskQueue.clearCompleted();
  res.json({
    success: true,
    message: `Cleared ${cleared} completed/failed tasks`,
    queueStatus: taskQueue.getStatus()
  });
});

// Immediate reply (bypasses queue)
app.post('/n8n/immediate', validateN8NRequest, async (req, res) => {
  try {
    const { tweetId, replyText } = req.body;
    
    if (!tweetId || !replyText) {
      return res.status(400).json({ 
        error: 'Missing tweetId or replyText' 
      });
    }
    
    const result = await sendReply(tweetId, replyText);
    res.json({
      ...result,
      immediate: true,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== REGULAR API ENDPOINTS ====================
app.get('/', (req, res) => {
  const queueStatus = taskQueue.getStatus();
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Twitter Bot with N8N Integration</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 30px; max-width: 1000px; margin: 0 auto; }
        .dashboard { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin: 30px 0; }
        .card { background: #f5f5f5; padding: 20px; border-radius: 10px; }
        .success { border-left: 5px solid #4CAF50; }
        .warning { border-left: 5px solid #ff9800; }
        .error { border-left: 5px solid #f44336; }
        .info { border-left: 5px solid #2196F3; }
        .btn { display: inline-block; background: #1DA1F2; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin: 5px; }
        .endpoint { background: #333; color: #fff; padding: 10px; border-radius: 5px; margin: 10px 0; font-family: monospace; }
        .queue-stats { display: flex; gap: 15px; margin: 15px 0; }
        .stat-box { background: white; padding: 15px; border-radius: 8px; flex: 1; text-align: center; }
        .stat-number { font-size: 24px; font-weight: bold; }
      </style>
    </head>
    <body>
      <h1>🤖 Twitter Bot + N8N Integration</h1>
      
      <div class="dashboard">
        <div class="card ${CHROME_PATH ? 'success' : 'warning'}">
          <h3>Browser Status</h3>
          <p><strong>Chrome:</strong> ${CHROME_PATH ? '✅ Found' : '⚠️ Not found'}</p>
          <p><strong>Initialized:</strong> ${browser ? '✅ Yes' : '❌ No'}</p>
          <p><strong>Logged in:</strong> ${isLoggedIn ? '✅ Yes' : '❌ No'}</p>
        </div>
        
        <div class="card info">
          <h3>Queue Status</h3>
          <div class="queue-stats">
            <div class="stat-box">
              <div class="stat-number">${queueStatus.queueLength}</div>
              <div>Queued</div>
            </div>
            <div class="stat-box">
              <div class="stat-number">${queueStatus.completed}</div>
              <div>Completed</div>
            </div>
            <div class="stat-box">
              <div class="stat-number">${queueStatus.failed}</div>
              <div>Failed</div>
            </div>
          </div>
          <p><strong>Processing:</strong> ${queueStatus.processing ? '✅ Active' : '⏸️ Idle'}</p>
          <p><strong>Total Processed:</strong> ${queueStatus.stats.totalProcessed}</p>
        </div>
      </div>
      
      <h3>N8N Webhook Endpoints</h3>
      
      <div class="endpoint">
        <strong>POST /n8n/webhook</strong><br>
        Add single task to queue<br>
        <small>Body: { "tweetId": "123", "replyText": "Hello", "secret": "your-secret" }</small>
      </div>
      
      <div class="endpoint">
        <strong>POST /n8n/batch</strong><br>
        Add multiple tasks (max 20)<br>
        <small>Body: { "tasks": [{ "tweetId": "123", "replyText": "Hi" }], "secret": "your-secret" }</small>
      </div>
      
      <div class="endpoint">
        <strong>GET /n8n/queue</strong><br>
        Get queue status and tasks<br>
        <small>Query: ?secret=your-secret</small>
      </div>
      
      <div class="endpoint">
        <strong>POST /n8n/immediate</strong><br>
        Immediate reply (bypasses queue)<br>
        <small>Body: { "tweetId": "123", "replyText": "Quick reply", "secret": "your-secret" }</small>
      </div>
      
      <h3>Quick Actions</h3>
      <div>
        <a class="btn" href="/login">🔐 Login</a>
        <a class="btn" href="/test">🧪 Test</a>
        <a class="btn" href="/n8n/queue?secret=${CONFIG.n8nSecret}">📊 Queue Status</a>
        <a class="btn" href="/health">🩺 Health</a>
      </div>
      
      <h3>Setup N8N Webhook</h3>
      <p>In n8n, create a <strong>Webhook node</strong> with:</p>
      <ul>
        <li>Method: POST</li>
        <li>URL: ${req.protocol}://${req.get('host')}/n8n/webhook?secret=${CONFIG.n8nSecret}</li>
        <li>Add JSON body with tweetId and replyText</li>
      </ul>
      
      <div class="card warning">
        <h3>⚠️ Security Note</h3>
        <p>Change the default N8N secret in Render environment variables:</p>
        <code>N8N_SECRET=your-strong-password-here</code>
      </div>
    </body>
    </html>
  `);
});

app.get('/login', async (req, res) => {
  try {
    const result = await login();
    res.json({ 
      success: result, 
      loggedIn: isLoggedIn,
      browser: !!browser
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/test', async (req, res) => {
  try {
    const result = await sendReply(
      '1798869340253892810',
      '🤖 Testing N8N integration! Ready to automate!'
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/reply', async (req, res) => {
  try {
    const { tweetId, replyText } = req.body;
    
    if (!tweetId || !replyText) {
      return res.status(400).json({ 
        error: 'Missing parameters',
        required: ['tweetId', 'replyText']
      });
    }
    
    const result = await sendReply(tweetId, replyText);
    res.json(result);
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  const queueStatus = taskQueue.getStatus();
  
  res.json({
    status: 'running',
    system: {
      chrome: CHROME_PATH || 'not_found',
      browser: !!browser,
      loggedIn: isLoggedIn,
      memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      uptime: Math.floor(process.uptime()) + 's'
    },
    queue: queueStatus,
    endpoints: {
      n8n: '/n8n/webhook',
      direct: '/reply',
      status: '/n8n/queue'
    }
  });
});

// ==================== START SERVER ====================
async function startServer() {
  try {
    // Make sendReply globally available for queue
    global.sendReply = sendReply;
    
    // Initialize browser in background
    setTimeout(async () => {
      try {
        await initBrowser();
        console.log('✅ Background browser initialization complete');
      } catch (err) {
        console.log('⚠️ Background browser init failed (will lazy-load):', err.message);
      }
    }, 2000);
    
    app.listen(PORT, () => {
      console.log(`
🎉 TWITTER BOT WITH N8N INTEGRATION STARTED
📍 Port: ${PORT}
🔗 URL: https://twitter-enterprise-bot-original.onrender.com
🛠️  Using: ${CHROME_PATH ? 'Render Chrome' : 'Puppeteer bundled'}

📡 N8N WEBHOOK ENDPOINTS:
   • /n8n/webhook     - Add tasks to queue
   • /n8n/batch       - Add multiple tasks
   • /n8n/queue       - View queue status
   • /n8n/immediate   - Immediate reply

🔐 SECURITY:
   • N8N Secret: ${CONFIG.n8nSecret === 'your-n8n-secret-key' ? '⚠️ CHANGE DEFAULT!' : '✅ Set'}
   • Twitter Login: ${process.env.X_USERNAME ? '✅ Configured' : '❌ Missing'}

🚀 Ready to connect with n8n!
      `);
    });
    
  } catch (error) {
    console.error('❌ Server startup failed:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 Shutting down gracefully...');
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});

// Start the server
startServer();

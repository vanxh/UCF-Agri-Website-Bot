const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { uploadFileToUploadThing } = require('./helpers/uploadthing');

// Import helpers
const { getGPTResponse, analyzeReceipt, getDiagnosisAdvice, answerProductQuestion } = require('./helpers/gpt');
const { processReceipt } = require('./helpers/ocr');
const { processPlantImage, formatDiseaseName } = require('./helpers/plantAI');
const { findNearestShops, formatShopsMessage } = require('./helpers/maps');
const { initializeDailyTips, sendTestTip, sendTargetedTip, listAllTips, getDailyTipsStats } = require('./helpers/dailyTips');
const {
  loadData,
  saveData,
  getUser,
  updateUser,
  isPremiumActive,
  generateReceiptHash,
  isReceiptUsed,
  saveReceipt,
  getRandomTip,
  searchProducts,
  formatProduct,
  formatProductList,
  getMainMenu,
  getPremiumPrompt,
  getPremiumMenu,
  getExpiryDate,
  formatDate,
  getExclusivePDFs,
  formatPDFList,
  getPDFById,
  calculateFertilizerQuantity,
  formatFertilizerCalculation,
  getFertilizerCalculatorPrompt,
  getCropFertilizerPlan,
  formatCropFertilizerPlan,
  loadSettings
} = require('./helpers/utils');

/**
 * Safely delete a directory with retry logic for Windows file locking
 */
function safeDeleteDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return true;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
      return true;
    } catch (e) {
      // Short blocking delay before retry
      const delayUntil = Date.now() + 300;
      while (Date.now() < delayUntil) {}
    }
  }
  return false;
}

/**
 * Clear WhatsApp cache and authentication directories
 * Used when cache becomes corrupted or outdated
 */
function clearWhatsAppCache() {
  console.log('🧹 Clearing WhatsApp cache and authentication...');

  const authPath = path.join(__dirname, '../.wwebjs_auth');
  const cachePath = path.join(__dirname, '../.wwebjs_cache');

  let cleared = false;

  if (fs.existsSync(authPath)) {
    if (safeDeleteDirectory(authPath)) {
      console.log('✅ Cleared authentication directory:', authPath);
      cleared = true;
    } else {
      console.warn('⚠️ Could not fully remove auth directory (files may be locked)');
    }
  }

  if (fs.existsSync(cachePath)) {
    if (safeDeleteDirectory(cachePath)) {
      console.log('✅ Cleared cache directory:', cachePath);
      cleared = true;
    } else {
      console.warn('⚠️ Could not fully remove cache directory (files may be locked)');
    }
  }

  if (cleared) {
    console.log('✅ Cache cleanup completed successfully');
  } else {
    console.log('ℹ️ No cache directories found to clear');
  }

  return cleared;
}

// Initialize WhatsApp client
const client = new Client({
  authStrategy: new LocalAuth({
    clientId: process.env.SESSION_NAME || 'UCF_AGRIBOT'
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  }
});

/**
 * Initialize WhatsApp client with automatic cache error recovery
 * Detects cache-related errors and automatically clears cache and retries
 */
async function initializeClient(retryCount = 0) {
  const MAX_RETRIES = 2;

  try {
    console.log('🚀 Initializing WhatsApp client...');
    await client.initialize();
  } catch (error) {
    console.error('❌ Client initialization error:', error.message);

    // Check if this is a cache-related error
    const isCacheError =
      error.message.includes('Cannot read properties of null') ||
      error.message.includes('manifest-') ||
      error.message.includes('LocalWebCache') ||
      error.message.includes('indexHtml.match');

    if (isCacheError && retryCount < MAX_RETRIES) {
      console.log(`⚠️ Cache error detected (attempt ${retryCount + 1}/${MAX_RETRIES})`);
      console.log('🔄 Attempting automatic recovery...');

      // Clear the cache
      clearWhatsAppCache();

      // Wait a bit before retrying
      console.log('⏳ Waiting 3 seconds before retry...');
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Retry initialization
      console.log('🔄 Retrying client initialization...');
      return initializeClient(retryCount + 1);
    } else {
      // Non-cache error or max retries reached
      if (retryCount >= MAX_RETRIES) {
        console.error(`❌ Failed to initialize after ${MAX_RETRIES} attempts`);
        console.log('💡 Tip: Try manually deleting .wwebjs_auth and .wwebjs_cache folders');
      }
      throw error;
    }
  }
}

/**
 * Safely send a WhatsApp message with retry logic
 * @param {string|object} chatId - Chat ID string or message object with .from property
 * @param {string} content - Message content (must be string)
 * @param {object} options - Additional options for sending
 */
async function safeSendMessage(chatId, content, options = {}) {
  const maxRetries = 3;
  let lastError;

  // Extract chat ID if a message object was passed
  const targetChatId = typeof chatId === 'string' ? chatId : chatId.from;

  // CRITICAL: Disable sendSeen for @lid (linked devices/business accounts)
  // These chat types don't support the markedUnread API and will throw errors
  const isLidChat = targetChatId.includes('@lid') || targetChatId.includes('@newsletter');
  const sendOptions = {
    ...options,
    sendSeen: isLidChat ? false : (options.sendSeen !== false) // Disable for @lid, default true for others
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
      return await client.sendMessage(targetChatId, content, sendOptions);

    } catch (error) {
      lastError = error;
      console.error(`❌ Message send error (attempt ${attempt}/${maxRetries}):`, error.message);

      if (attempt < maxRetries) {
        console.log(`Retrying... (${attempt + 1}/${maxRetries})`);
        continue;
      }
    }
  }
  console.error('❌ All send attempts failed. Last error:', lastError);
  throw lastError;
}

// Track user states with timestamps for cleanup
const userStates = new Map();

// Track activated users (users who have typed "crop")
const activatedUsers = new Set();

// Keep-alive interval reference
let keepAliveInterval = null;

// Track last message before disconnection
let lastMessageBeforeDisconnect = null;
const lastMessageFilePath = path.join(__dirname, '../temp/last_message.json');

// Message deduplication - track processed message IDs
const processedMessages = new Set();
const MESSAGE_CACHE_SIZE = 100; // Keep last 100 message IDs

// Clean up old message IDs periodically
setInterval(() => {
  if (processedMessages.size > MESSAGE_CACHE_SIZE) {
    const messagesToKeep = Array.from(processedMessages).slice(-MESSAGE_CACHE_SIZE);
    processedMessages.clear();
    messagesToKeep.forEach(id => processedMessages.add(id));
  }
}, 60000); // Clean every minute


// QR Code generation
// QR Code generation
client.on('qr', async (qr) => {
  console.log('📱 Scan this QR code with WhatsApp:');
  qrcode.generate(qr, { small: true });

  // Save QR code as image
  try {
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const qrImagePath = path.join(tempDir, 'qrcode.png');
    const timestamp = new Date().toISOString();

    await QRCode.toFile(qrImagePath, qr, {
      width: 400,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });

    // Save timestamp metadata to verify QR regeneration
    const metadataPath = path.join(tempDir, 'qr_metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify({
      status: 'qr_ready',
      generated_at: timestamp,
      qr_hash: qr.substring(0, 20) + '...',
      qr_raw: qr
    }, null, 2));

    console.log('✅ New QR code saved to:', qrImagePath);
    console.log('🕐 Generated at:', timestamp);
    console.log('🌐 Access QR code at: http://localhost:3000/qr');
  } catch (error) {
    console.error('❌ Error saving QR code image:', error);
  }
});

// Client ready
client.on('ready', async () => {
  console.log('✅ UCF Agri-Bot is ready!');
  console.log('🌾 Bot Name: Sam');
  console.log('📞 Waiting for messages...');

  try {
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const metadataPath = path.join(tempDir, 'qr_metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify({
      status: 'ready',
      ready_at: new Date().toISOString(),
      bot_name: 'Sam'
    }, null, 2));
  } catch (e) {}

  // Clear existing keep-alive interval if any
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
  }

  // Start keep-alive mechanism (ping every 30 seconds)
  let keepAliveFailures = 0;
  keepAliveInterval = setInterval(async () => {
    try {
      const state = await client.getState();
      console.log('💓 Keep-alive ping - State:', state);
      keepAliveFailures = 0; // Reset failure count on success
    } catch (error) {
      console.error(`❌ Keep-alive ping failed (${keepAliveFailures + 1}/3):`, error.message);
      keepAliveFailures++;

      if (keepAliveFailures >= 3) {
        console.error('🚨 Too many keep-alive failures. Forcing restart to recover...');
        process.exit(1); // Force exit to trigger Docker restart
      }
    }
  }, 30000);

  // Initialize daily tips system
  initializeDailyTips(client);

  // Check for last message before disconnection and reply to it
  try {
    if (fs.existsSync(lastMessageFilePath)) {
      const lastMessageData = JSON.parse(fs.readFileSync(lastMessageFilePath, 'utf8'));
      console.log('📨 Found last message before disconnection:', lastMessageData);

      // Wait a bit for the client to fully initialize
      setTimeout(async () => {
        try {
          // Create a mock message object to process
          const chat = await client.getChatById(lastMessageData.from);
          await chat.sendMessage('🔄 *Bot Reconnected*\n\nI\'m back online! Let me respond to your last message...');

          // Send the last message through the normal message handler
          // We'll simulate processing it by getting the chat and handling the message
          console.log('🔄 Processing last message:', lastMessageData.body);

          // Get user and process the message
          const user = getUser(lastMessageData.from);
          const userState = userStates.get(lastMessageData.from) || { state: 'main_menu' };

          // Handle based on state
          if (userState.state === 'main_menu') {
            // Send main menu as a response
            await chat.sendMessage(getMainMenu(user.name));
          } else {
            // Send a general response
            await chat.sendMessage('I received your message. Type "menu" to see available options.');
          }

          console.log('✅ Replied to last message successfully');
        } catch (replyError) {
          console.error('❌ Error replying to last message:', replyError);
        }
      }, 3000);

      // Delete the last message file after processing
      fs.unlinkSync(lastMessageFilePath);
      console.log('🗑️ Cleared last message file');
    }
  } catch (error) {
    console.error('❌ Error processing last message:', error);
  }
});

// Track authentication to prevent duplicate logs
let isAuthenticated = false;

// Handle authentication
client.on('authenticated', () => {
  if (!isAuthenticated) {
    console.log('🔐 Authentication successful!');
    isAuthenticated = true;
    try {
      const tempDir = path.join(__dirname, '../temp');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      const metadataPath = path.join(tempDir, 'qr_metadata.json');
      fs.writeFileSync(metadataPath, JSON.stringify({
        status: 'authenticated',
        authenticated_at: new Date().toISOString()
      }, null, 2));
    } catch (e) {}
  }
});

client.on('auth_failure', (msg) => {
  console.error('❌ Authentication failed:', msg);
  try {
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const metadataPath = path.join(tempDir, 'qr_metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify({
      status: 'auth_failure',
      message: String(msg),
      failed_at: new Date().toISOString()
    }, null, 2));
  } catch (e) {}
});

// Handle disconnection with auto-reconnect and QR regeneration
client.on('disconnected', (reason) => {
  console.log('⚠️ Client disconnected:', reason);
  isAuthenticated = false;

  // Clear keep-alive interval
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }

  // Save last message before disconnection
  if (lastMessageBeforeDisconnect) {
    try {
      const tempDir = path.join(__dirname, '../temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      fs.writeFileSync(lastMessageFilePath, JSON.stringify(lastMessageBeforeDisconnect, null, 2));
      console.log('💾 Saved last message before disconnection');
    } catch (error) {
      console.error('❌ Error saving last message:', error);
    }
  }

  console.log('🔄 Attempting to regenerate QR code...');

  // Destroy the client and clear auth session
  setTimeout(async () => {
    try {
      await client.destroy();
      console.log('✅ Client destroyed');
    } catch (err) {
      console.log('⚠️ Client destruction notice:', err.message);
    }

    try {
      // Clear auth session and cache directories safely
      const authPath = path.join(__dirname, '../.wwebjs_auth');
      safeDeleteDirectory(authPath);
      console.log('🗑️ Cleared authentication session');

      const cachePath = path.join(__dirname, '../.wwebjs_cache');
      safeDeleteDirectory(cachePath);
      console.log('🗑️ Cleared cache directory');

      const tempDir = path.join(__dirname, '../temp');
      const metadataPath = path.join(tempDir, 'qr_metadata.json');
      if (fs.existsSync(tempDir)) {
        fs.writeFileSync(metadataPath, JSON.stringify({
          status: 'regenerating',
          reason: String(reason),
          disconnected_at: new Date().toISOString()
        }, null, 2));
      }

      console.log('🔄 Re-initializing client to generate new QR code...');
      console.log('📱 A new QR code will be generated. Please scan it to reconnect.');
      console.log('🌐 Access QR code at: http://localhost:3000/qr');

      process.exit(1);
    } catch (error) {
      console.error('❌ Error during reconnection cleanup:', error);
      process.exit(1);
    }
  }, 2000);
});

// Main message handler
client.on('message', async (message) => {
  // Wrap message.reply with retry logic
  const originalReply = message.reply.bind(message);
  message.reply = async function (content, options) {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await originalReply(content, options);
      } catch (error) {
        const isLastAttempt = attempt === maxRetries;
        const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);

        if (error.message && (
          error.message.includes('markedUnread') ||
          error.message.includes('Protocol error') ||
          error.message.includes('Execution context was destroyed')
        )) {
          if (!isLastAttempt) {
            console.log(`⚠️ Retry ${attempt}/${maxRetries} after ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
        }
        throw error;
      }
    }
  };

  try {
    const phoneNumber = message.from;
    const messageBody = message.body.trim();
    const hasMedia = message.hasMedia;

    // Ignore status broadcasts
    if (phoneNumber === 'status@broadcast') {
      console.log('📢 Ignoring status broadcast message');
      return;
    }

    // Message deduplication - prevent processing the same message multiple times
    const messageId = message.id._serialized || message.id;
    if (processedMessages.has(messageId)) {
      console.log(`⏭️ Skipping duplicate message: ${messageId}`);
      return;
    }
    processedMessages.add(messageId);

    console.log(`\n📨 Message from ${phoneNumber}: ${messageBody.substring(0, 50)}...`);

    // Track this as the last message (for reconnection handling)
    lastMessageBeforeDisconnect = {
      from: phoneNumber,
      body: messageBody,
      hasMedia: hasMedia,
      timestamp: Date.now()
    };

    // Auto-activate bot for new users
    if (!activatedUsers.has(phoneNumber)) {
      activatedUsers.add(phoneNumber);
      console.log(`✅ Bot activated for user: ${phoneNumber}`);

      // Get or create user
      const user = getUser(phoneNumber);

      // Send activation message
      await safeSendMessage(message, `🌾 *Welcome to UCF Agri-Bot!*\n\nHello! I'm Sam, your agricultural assistant.\n\nMay I know your name? _(Just type your name only)_`);
      userStates.set(phoneNumber, {
        state: 'awaiting_name',
        lastActivity: Date.now()
      });
      return;
    }

    // Update last activity timestamp
    const currentState = userStates.get(phoneNumber);
    if (currentState) {
      currentState.lastActivity = Date.now();
    }

    // Get or create user
    const user = getUser(phoneNumber);
    const userState = userStates.get(phoneNumber) || { state: 'main_menu' };

    // Handle greetings (skip if user was just activated)
    if (isGreeting(messageBody) && userState.state === 'main_menu') {
      await handleGreeting(message, user);
      return;
    }

    // Handle greetings for users in awaiting_name state (they just got activated)
    if (isGreeting(messageBody) && userState.state === 'awaiting_name') {
      // User just got the welcome message from auto-activation, don't send another
      return;
    }

    // Handle media (images)
    if (hasMedia) {
      await handleMediaMessage(message, user, userState);
      return;
    }

    // Handle location
    if (message.location) {
      await handleLocation(message, user);
      return;
    }

    // Global menu command - works from ANY state
    if (messageBody.toLowerCase().trim() === 'menu') {
      await safeSendMessage(message, getMainMenu(user.name));
      userStates.set(phoneNumber, { state: 'main_menu' });
      return;
    }

    // Global: Show all UCF products from any state
    const showProductsRegex = /\b(show|list|display)\b.*\b(ucf\s*)?products\b/i;
    const productsOnlyRegex = /^\s*(ucf\s*)?products\s*$/i;
    if (showProductsRegex.test(messageBody) || productsOnlyRegex.test(messageBody)) {
      const products = loadData('products.json');
      await safeSendMessage(message, formatProductList(products) + '\n_Type your product question or "menu" to go back_');
      userStates.set(phoneNumber, { state: 'product_qa' });
      return;
    }

    // Admin commands for testing (hidden)
    if (messageBody.toLowerCase().trim() === 'test-tip') {
      await sendTestTip(phoneNumber);
      return;
    }

    if (messageBody.toLowerCase().trim() === 'tip-stats') {
      const stats = getDailyTipsStats();
      await safeSendMessage(message, `📊 *Daily Tips Statistics*\n\n👥 Total Users: ${stats.totalUsers}\n✅ Active Users: ${stats.activeUsers}\n💡 Available Tips: ${stats.totalTips}\n⏰ Schedule: ${stats.lastScheduledTime}`);
      return;
    }

    // Admin: list all available tips
    if (messageBody.toLowerCase().trim() === 'tip-list') {
      await safeSendMessage(message, listAllTips() + '\n\n_Use: send-tip <number or id> <phone> to send a targeted tip_');
      return;
    }

    // Admin: send a targeted tip  → send-tip <tipId|number> <phone>
    // Example: send-tip 3 263771234567@c.us
    // Example: send-tip tip_005 263771234567@c.us
    if (messageBody.toLowerCase().startsWith('send-tip ')) {
      const parts = messageBody.trim().split(/\s+/);
      // parts[0] = 'send-tip', parts[1] = tip identifier, parts[2] = phone
      if (parts.length < 3) {
        await safeSendMessage(message, `❌ *Usage:* send-tip <tipNumber or tipId> <phone>\n\nExamples:\n• send-tip 3 263771234567@c.us\n• send-tip tip_005 263771234567@c.us\n\nType *tip-list* to see available tips.`);
        return;
      }
      const tipIdentifier = parts[1];
      const targetPhone = parts[2];
      await safeSendMessage(message, `⏳ Sending tip to ${targetPhone}...`);
      const result = await sendTargetedTip(targetPhone, tipIdentifier);
      await safeSendMessage(message, result.message);
      return;
    }

    // Handle menu options
    if (userState.state === 'main_menu') {
      await handleMainMenu(message, user, messageBody);
    } else if (userState.state === 'premium_menu') {
      await handlePremiumMenu(message, user, messageBody);
    } else if (userState.state === 'awaiting_name') {
      await handleNameInput(message, user, messageBody);
    } else if (userState.state === 'awaiting_phone') {
      await handlePhoneInput(message, user, messageBody);
    } else if (userState.state === 'awaiting_expert_email') {
      await handleExpertEmailInput(message, user, messageBody);
    } else if (userState.state === 'awaiting_expert_issue') {
      await handleExpertIssueInput(message, user, messageBody);
    } else if (userState.state === 'product_qa') {
      await handleProductQuestion(message, user, messageBody);
    } else if (userState.state === 'awaiting_pdf_selection') {
      await handlePDFSelection(message, user, messageBody);
    } else if (userState.state === 'premium_access_info') {
      await handlePremiumAccessInfo(message, user, messageBody);
    } else if (userState.state === 'awaiting_image_choice') {
      await handleImageChoice(message, user, messageBody, userState);
    } else if (userState.state === 'calculator_plant') {
      await handleCalculatorPlant(message, user, messageBody);
    } else if (userState.state === 'calculator_yield') {
      await handleCalculatorYield(message, user, messageBody, userState);
    } else if (userState.state === 'calculator_soil_check') {
      await handleCalculatorSoilCheck(message, user, messageBody, userState);
    } else if (userState.state === 'fertilizer_crop') {
      await handleFertilizerCrop(message, user, messageBody);
    } else if (userState.state === 'fertilizer_field_size') {
      await handleFertilizerFieldSize(message, user, messageBody, userState);
    } else if (userState.state === 'fertilizer_npk_requirement') {
      await handleFertilizerNPKRequirement(message, user, messageBody, userState);
    } else if (userState.state === 'fertilizer_product_selection') {
      await handleFertilizerProductSelection(message, user, messageBody, userState);
    } else if (userState.state === 'fertilizer_custom_npk') {
      await handleFertilizerCustomNPK(message, user, messageBody, userState);
    } else if (userState.state === 'awaiting_promo_code') {
      await handlePromoCodeInput(message, user, messageBody);
    } else {
      // Default: try to understand with GPT
      await handleGeneralQuery(message, user, messageBody);
    }

  } catch (error) {
    console.error('❌ Error handling message:', error);
    await safeSendMessage(message, 'Sorry, I encountered an error. Please try again or type "menu" to return to main menu. 🙏');
  }
});

/**
 * Check if message is a greeting
 */
function isGreeting(message) {
  const greetings = ['hi', 'hello', 'hey', 'namaste', 'start', 'hola'];
  return greetings.some(g => message.toLowerCase().includes(g));
}

/**
 * Handle greeting messages
 */
async function handleGreeting(message, user) {
  const phoneNumber = message.from;

  if (!user.name) {
    await safeSendMessage(message, `👋 Hello! Welcome to UCF Agri-Bot!\n\nI'm Sam, your agricultural assistant. 🌾\n\nMay I know your name? _(Just type your name only)_`);
    userStates.set(phoneNumber, { state: 'awaiting_name' });
  } else {
    // Show premium menu for premium users, regular menu for others
    if (isPremiumActive(user)) {
      await safeSendMessage(message, getPremiumMenu(user.name));
      userStates.set(phoneNumber, { state: 'premium_menu' });
    } else {
      await safeSendMessage(message, getMainMenu(user.name));
      userStates.set(phoneNumber, { state: 'main_menu' });
    }
  }
}

/**
 * Handle name input
 */
/**
 * Handle name input
 */
async function handleNameInput(message, user, messageBody) {
  const phoneNumber = message.from;

  // Name is now required
  updateUser(phoneNumber, { name: messageBody });

  await safeSendMessage(message, `Thanks, ${messageBody}! 👋\n\nCould you please share your phone number before the next step \n\nExample: +263 798765432\n\n_(Don't forget to add + Country Code)_`);
  userStates.set(phoneNumber, { state: 'awaiting_phone' });
}

/**
 * Handle phone input
 */
async function handlePhoneInput(message, user, messageBody) {
  const phoneNumber = message.from;

  // Validate phone number - must contain at least 7 digits
  const digitCount = (messageBody.match(/\d/g) || []).length;
  if (digitCount < 7) {
    await safeSendMessage(message, `❌ That doesn\'t look like a valid phone number.\n\nPlease enter your phone number with country code.\n\nExample: *+263 798765432* or *+91 9876543210*\n\n_(Don\'t forget the + Country Code)_`);
    return; // Stay in awaiting_phone state
  }

  // Save phone number
  updateUser(phoneNumber, { phone_numeric: messageBody });

  // Get updated user to check premium status
  const updatedUser = getUser(phoneNumber);

  if (isPremiumActive(updatedUser)) {
    await safeSendMessage(message, `Perfect! All set. 😊\n\n${getPremiumMenu(user.name)}`);
    userStates.set(phoneNumber, { state: 'premium_menu' });
  } else {
    await safeSendMessage(message, `Perfect! All set. 😊\n\n${getMainMenu(user.name)}`);
    userStates.set(phoneNumber, { state: 'main_menu' });
  }
}

/**
 * Handle main menu options
 */
async function handleMainMenu(message, user, messageBody) {
  const phoneNumber = message.from;
  const input = messageBody.toLowerCase();

  // Option 1: Crop Diagnosis (Premium)
  if (input.includes('1') || input.includes('diagnosis') || input.includes('crop')) {
    if (isPremiumActive(user)) {
      await safeSendMessage(message, `🔬 *Crop Diagnosis Service*

Please send a clear photo of:
📸 Affected crop/plant leaves
📸 Soil Results Analysis

I'll analyze it and provide treatment recommendations! 🌿

_Type "menu" to go back to main menu_`);
      userStates.set(phoneNumber, { state: 'awaiting_crop_image' });
    } else {
      await safeSendMessage(message, getPremiumPrompt());
      userStates.set(phoneNumber, { state: 'awaiting_receipt' });
    }
    return;
  }

  // Option 2: Fertilizer Calculator (Premium)
  if (input.includes('2') || input.includes('fertilizer') || input.includes('calculator') || input.includes('quantity')) {
    if (isPremiumActive(user)) {
      await safeSendMessage(message, `🧮 *UCF Fertilizer Calculator*\n\nWelcome to the UCF Fertilizer Calculator!\n\nWhich plant are you planning to grow?\n\nExample: "Maize", "Cotton", "Cabbage"\n\n_Type "menu" to go back to main menu_`);
      userStates.set(phoneNumber, { state: 'calculator_plant' });
    } else {
      await safeSendMessage(message, getPremiumPrompt());
      userStates.set(phoneNumber, { state: 'awaiting_receipt' });
    }
    return;
  }

  // Option 3: Find Shop
  if (input.includes('3') || input.includes('shop') || input.includes('dealer') || input.includes('location')) {
    await safeSendMessage(message, `📍 *Find Nearest UCF Dealer*

Please share your live location so I can find the nearest shops.

_In WhatsApp: Tap 📎 → Location → Send your current location_

_Type "menu" to go back to main menu_`);
    userStates.set(phoneNumber, { state: 'awaiting_location' });
    return;
  }

  // Option 4: Expert Help (Premium Only)
  if (input.includes('4') || input.includes('expert') || input.includes('agronomist')) {
    if (isPremiumActive(user)) {
      if (!user.name) {
        await safeSendMessage(message, `To connect you with our expert, I need some information.

What's your name?

_Type "menu" to go back to main menu_`);
        userStates.set(phoneNumber, { state: 'awaiting_expert_name' });
      } else if (!user.email) {
        await safeSendMessage(message, `Thanks! What's your email address?

_Type "menu" to go back to main menu_`);
        userStates.set(phoneNumber, { state: 'awaiting_expert_email' });
      } else {
        await safeSendMessage(message, `👨‍🌾 *Expert Help Service*

Please describe your farming issue or question.

Your question will be forwarded directly to our agronomist's WhatsApp for personalized assistance.

_Type "menu" to go back to main menu_`);
        userStates.set(phoneNumber, { state: 'awaiting_expert_issue' });
      }
    } else {
      await safeSendMessage(message, getPremiumPrompt());
      userStates.set(phoneNumber, { state: 'awaiting_receipt' });
    }
    return;
  }

  // Option 5: Exclusive Farming Guides (Premium)
  if (input.includes('5') || input.includes('guide') || input.includes('pdf')) {
    if (isPremiumActive(user)) {
      const pdfs = getExclusivePDFs();
      await safeSendMessage(message, `📚 *Exclusive Farming Guides*\n\nChoose a guide to download:\n\n${formatPDFList(pdfs)}\n\nReply with the number (1-${pdfs.length}) to get your PDF!\n\n_Type "menu" to go back to main menu_`);
      userStates.set(phoneNumber, { state: 'awaiting_pdf_selection' });
    } else {
      await safeSendMessage(message, getPremiumPrompt());
      userStates.set(phoneNumber, { state: 'awaiting_receipt' });
    }
    return;
  }

  // Option 6: Product Q&A
  if (input.includes('6') || input.includes('product') || input.includes('fertilizer')) {
    const products = loadData('products.json');
    await safeSendMessage(message, `💬 *Product Q&A*\n\nAsk me anything about UCF products!\n\nExamples:\n• "Tell me about cabbagge farming"\n• "Which fertilizer is best for beans farming"\n• "Tell me about Pfumvudza"\n\n${formatProductList(products.slice(0, 3))}\n_Type your question or "menu" to go back_`);
    userStates.set(phoneNumber, { state: 'product_qa' });
    return;
  }

  // Option 7: Premium Access
  if (input.includes('7') || input.includes('premium') || input.includes('verify') || input.includes('receipt')) {
    if (isPremiumActive(user)) {
      await safeSendMessage(message, `✅ You already have premium access!\n\n🎉 Valid until: ${formatDate(user.premium_expiry_date)}\n\n*Premium Features:*\n1️⃣ Crop disease diagnosis and Soil results analysis\n2️⃣ Fertilizer Calculator\n3️⃣ Exclusive Farming Guides\n4️⃣ Priority support\n\n_Reply with 1-4 to use Premium Features, or type "menu" to go back to main menu._`);
      userStates.set(phoneNumber, { state: 'premium_access_info' });
    } else {
      await safeSendMessage(message, getPremiumPrompt());
      userStates.set(phoneNumber, { state: 'awaiting_receipt' });
    }
    return;
  }

  // Option 8: Promo Code
  if (input.includes('8') || input.includes('promo') || input.includes('code')) {
    if (isPremiumActive(user)) {
      await safeSendMessage(message, `✅ You already have *premium access* active!\n\n🎉 Valid until: ${formatDate(user.premium_expiry_date)}\n\nNo promo code needed. Enjoy your premium features! 🌟\n\n_Type "menu" to go back_`);
    } else {
      const settings = loadSettings();
      await safeSendMessage(message, `🎟️ *Promo Code*\n\nDo you have a promo code?\n\nEnter your promo code below to get *${settings.promo_code_description || '1 month free premium access'}*!\n\n_Type "menu" to go back to main menu_`);
      userStates.set(phoneNumber, { state: 'awaiting_promo_code' });
    }
    return;
  }

  // Menu command
  if (input === 'menu') {
    await safeSendMessage(message, getMainMenu(user.name));
    return;
  }

  // Default: Try to understand intent
  await handleGeneralQuery(message, user, messageBody);
}

/**
 * Handle promo code input
 */
async function handlePromoCodeInput(message, user, messageBody) {
  const phoneNumber = message.from;
  const input = messageBody.trim();

  // Allow user to go back
  if (input.toLowerCase() === 'menu') {
    await safeSendMessage(message, getMainMenu(user.name));
    userStates.set(phoneNumber, { state: 'main_menu' });
    return;
  }

  // Load the current promo code from settings (read live so admins can change it)
  const settings = loadSettings();
  const validCode = (settings.promo_code || '').trim();

  if (input === validCode) {
    // Grant 1 month premium
    const expiryDate = getExpiryDate();
    updateUser(phoneNumber, {
      is_premium: true,
      premium_expiry_date: expiryDate
    });

    const updatedUser = getUser(phoneNumber);
    await safeSendMessage(message, `🎉 *Promo Code Accepted!*\n\nCongratulations ${user.name || ''}! 🌟\n\nYou now have *${settings.promo_code_description || '1 month free premium access'}*!\n\n✅ Valid until: ${formatDate(expiryDate)}\n\n*Your Premium Features:*\n1️⃣ Crop disease diagnosis\n2️⃣ Fertilizer Calculator\n3️⃣ Exclusive Farming Guides\n4️⃣ Expert agronomist support\n\n${getPremiumMenu(updatedUser.name)}`);
    userStates.set(phoneNumber, { state: 'premium_menu' });
  } else {
    await safeSendMessage(message, `❌ *Invalid Promo Code*\n\nSorry, that code is not valid. Please check and try again.\n\nEnter your promo code:\n_(Type "menu" to go back)_`);
    // Stay in awaiting_promo_code state
  }
}

/**
 * Handle premium menu options
 */
async function handlePremiumMenu(message, user, messageBody) {
  const phoneNumber = message.from;
  const input = messageBody.toLowerCase();

  // Option 1: Crop Diagnosis
  if (input.includes('1') || input.includes('diagnosis') || input.includes('crop')) {
    await safeSendMessage(message, `🔬 *Crop Diagnosis Service*

Please send a clear photo of:
📸 Affected crop/plant leaves
📸 Soil Results Analysis

I'll analyze it and provide treatment recommendations! 🌿

_Type "menu" to go back to main menu_`);
    userStates.set(phoneNumber, { state: 'awaiting_crop_image' });
    return;
  }

  // Option 2: Expert Help (Premium Only)
  if (input.includes('2') || input.includes('expert') || input.includes('agronomist')) {
    if (!user.name) {
      await safeSendMessage(message, `To connect you with our expert, I need some information.

What's your name?

_Type "menu" to go back to main menu_`);
      userStates.set(phoneNumber, { state: 'awaiting_expert_name' });
    } else if (!user.email) {
      await safeSendMessage(message, `Thanks! What's your email address?

_Type "menu" to go back to main menu_`);
      userStates.set(phoneNumber, { state: 'awaiting_expert_email' });
    } else {
      await safeSendMessage(message, `👨‍🌾 *Expert Help Service*

Please describe your farming issue or question.

Your question will be forwarded directly to our agronomist's WhatsApp for personalized assistance.

_Type "menu" to go back to main menu_`);
      userStates.set(phoneNumber, { state: 'awaiting_expert_issue' });
    }
    return;
  }

  // Option 3: Exclusive PDFs (Premium Only)
  if (input.includes('3') || input.includes('pdf') || input.includes('guide')) {
    const pdfs = getExclusivePDFs();
    await safeSendMessage(message, `📚 *Exclusive Farming Guides*\n\nChoose a guide to download:\n\n${formatPDFList(pdfs)}\n\nReply with the number (1-${pdfs.length}) to get your PDF!\n\n_Type "menu" to go back to main menu_`);
    userStates.set(phoneNumber, { state: 'awaiting_pdf_selection' });
    return;
  }

  // Option 4: Fertilizer Calculator
  if (input.includes('4') || input.includes('fertilizer') || input.includes('calculator') || input.includes('quantity')) {
    await safeSendMessage(message, `🧮 *UCF Fertilizer Calculator*\n\nWelcome to the UCF Fertilizer Calculator!\n\nWhich plant are you planning to grow?\n\nExample: "Maize", "Cotton", "Cabbage"\n\n_Type "menu" to go back to main menu_`);
    userStates.set(phoneNumber, { state: 'calculator_plant' });
    return;
  }

  // Option 5: Find Shop
  if (input.includes('5') || input.includes('shop') || input.includes('dealer') || input.includes('location')) {
    await safeSendMessage(message, `📍 *Find Nearest UCF Dealer*

Please share your live location so I can find the nearest shops.

_In WhatsApp: Tap 📎 → Location → Send your current location_

_Type "menu" to go back to main menu_`);
    userStates.set(phoneNumber, { state: 'awaiting_location' });
    return;
  }

  // Option 6: Product Q&A
  if (input.includes('6') || input.includes('product') || input.includes('fertilizer')) {
    const products = loadData('products.json');
    await safeSendMessage(message, `💬 *Product Q&A*\n\nAsk me anything about UCF products!\n\nExamples:\n• "Tell me about cabbagge farming"\n• "Which fertilizer is best for beans farming"\n• "Tell me about Pfumvudza"\n
_Type "menu" to go back to main menu_`);
    userStates.set(phoneNumber, { state: 'product_qa' });
    return;
  }

  // Option 7: Main Menu
  if (input.includes('7') || input.includes('main') || input === 'menu') {
    await safeSendMessage(message, getMainMenu(user.name));
    userStates.set(phoneNumber, { state: 'main_menu' });
    return;
  }

  // Default: Try to understand intent
  await handleGeneralQuery(message, user, messageBody);
}

/**
 * Handle PDF selection for premium users
 */
async function handlePDFSelection(message, user, messageBody) {
  const phoneNumber = message.from;
  const input = messageBody.trim();

  // Check if user selected a valid number
  const pdfNumber = parseInt(input);
  const pdfs = getExclusivePDFs();

  if (isNaN(pdfNumber) || pdfNumber < 1 || pdfNumber > pdfs.length) {
    await safeSendMessage(message, `❌ Invalid selection. Please choose a number between 1 and ${pdfs.length}.\n\n_Type "menu" to go back to main menu_`);
    return;
  }

  const selectedPDF = pdfs[pdfNumber - 1];

  try {
    // Send PDF information and download link
    await safeSendMessage(message, `📚 *${selectedPDF.title}*

📄 **Description:** ${selectedPDF.description}

📊 **Details:**
• Pages: ${selectedPDF.pages}
• Size: ${selectedPDF.size}
• Category: ${selectedPDF.category}

🔗 **Download Link:** ${selectedPDF.url}

💡 *Note: This is a premium exclusive guide. Save the link for offline access.*

_Type "menu" to go back to main menu_`);

    userStates.set(phoneNumber, { state: 'premium_menu' });

  } catch (error) {
    console.error('❌ PDF selection error:', error);
    await safeSendMessage(message, `Sorry, there was an error accessing the PDF. Please try again or contact support.\n\n_Type "menu" to go back to main menu_`);
    userStates.set(phoneNumber, { state: 'premium_menu' });
  }
}
/**
 * Handle image choice (when user sends image without context)
 */
async function handleImageChoice(message, user, messageBody, userState) {
  const phoneNumber = message.from;
  const input = messageBody.trim();
  const imagePath = userState.imagePath;
  const imageUrl = userState.imageUrl;

  if (input === '1') {
    // Option 1: Diagnose crop disease
    if (isPremiumActive(user)) {
      if (imagePath && fs.existsSync(imagePath)) {
        await handleCropDiagnosis(message, user, imagePath, imageUrl);
      } else {
        await safeSendMessage(message, 'Image expired. Please send the image again. 📸\n\n_Type "menu" to go back to main menu_');
        userStates.set(phoneNumber, { state: 'main_menu' });
      }
    } else {
      await safeSendMessage(message, getPremiumPrompt());
      userStates.set(phoneNumber, { state: 'awaiting_receipt' });
    }
  } else if (input === '2') {
    // Option 2: Verify receipt / show premium status
    if (isPremiumActive(user)) {
      await safeSendMessage(message, `✅ You already have premium access!\n\n🎉 Valid until: ${formatDate(user.premium_expiry_date)}\n\n*Premium Features:*\n1️⃣ Crop disease diagnosis and Soil results analysis\n2️⃣ Fertilizer Calculator\n3️⃣ Exclusive Farming Guides\n4️⃣ Priority support\n\n_Reply with 1-4 to use Premium Features, or type "menu" to go back to main menu._`);
      userStates.set(phoneNumber, { state: 'premium_access_info' });
    } else {
      if (imagePath && fs.existsSync(imagePath)) {
        await handleReceiptVerification(message, user, imagePath, imageUrl);
      } else {
        await safeSendMessage(message, `Image expired. Please send the image again. 📸\n\n_Type "menu" to go back to main menu_`);
        userStates.set(phoneNumber, { state: 'main_menu' });
      }
    }
  } else if (input === '3') {
    if (isPremiumActive(user)) {
      if (imagePath && fs.existsSync(imagePath)) {
        await handleSoilAnalysis(message, user, imagePath, imageUrl);
      } else {
        await safeSendMessage(message, 'Image expired. Please send the image again. 📸\n\n_Type "menu" to go back to main menu_');
        userStates.set(phoneNumber, { state: 'main_menu' });
      }
    } else {
      await safeSendMessage(message, getPremiumPrompt());
      userStates.set(phoneNumber, { state: 'awaiting_receipt' });
    }
  } else {
    await safeSendMessage(message, `Please choose 1, 2 or 3.\n\n_Type "menu" to go back to main menu_`);
  }
}

/**
 * Direct media extraction fallback using Puppeteer page evaluation
 */
async function extractMediaDirectly(client, message) {
  if (!client || !client.pupPage) return null;

  try {
    const rawId = message.id;
    const serializedId = message.id?._serialized || message.id?.$1 || (typeof message.id === 'string' ? message.id : null);
    const msgKeyId = message.id?.id || (typeof message.id === 'string' ? message.id.split('_').pop() : null);

    const res = await client.pupPage.evaluate(async (serializedId, rawId, msgKeyId) => {
      try {
        const getMsg = async () => {
          const collections = window.require ? window.require('WAWebCollections') : window.Store;
          if (!collections) return null;

          const tryGet = (id) => {
            if (!id) return null;
            return collections?.Msg?.get?.(id) || window.Store?.Msg?.get?.(id);
          };

          let found = tryGet(serializedId);
          if (found) return found;

          if (rawId) {
            const ids = [
              rawId._serialized,
              rawId.$1,
              rawId.id,
              `${rawId.fromMe ? 'true' : 'false'}_${rawId.remote?._serialized || rawId.remote?.$1 || rawId.remote || ''}_${rawId.id || ''}`
            ].filter(Boolean);
            for (const id of ids) {
              found = tryGet(id);
              if (found) return found;
            }
          }

          const models = collections?.Msg?.models || window.Store?.Msg?.models || [];
          if (msgKeyId) {
            found = models.find(m => m.id?.id === msgKeyId || m.id?._serialized?.includes(msgKeyId) || m.id?.$1?.includes(msgKeyId));
            if (found) return found;
          }

          return null;
        };

        const msg = await getMsg();
        if (!msg) return null;

        if (msg.mediaData && msg.mediaData.mediaStage !== 'RESOLVED' && typeof msg.downloadMedia === 'function') {
          try {
            await msg.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1 });
          } catch (e) {}
        }

        const downloadManager = (window.require && window.require('WAWebDownloadManager')?.downloadManager) || window.Store?.DownloadManager;
        let decryptedMedia = null;

        const mockQpl = {
          addAnnotations: () => mockQpl,
          addPoint: () => mockQpl
        };

        if (downloadManager?.downloadAndMaybeDecrypt) {
          decryptedMedia = await downloadManager.downloadAndMaybeDecrypt({
            directPath: msg.directPath,
            encFilehash: msg.encFilehash,
            filehash: msg.filehash,
            mediaKey: msg.mediaKey,
            mediaKeyTimestamp: msg.mediaKeyTimestamp,
            type: msg.type,
            signal: new AbortController().signal,
            downloadQpl: mockQpl
          });
        } else if (downloadManager?.downloadAndDecrypt) {
          decryptedMedia = await downloadManager.downloadAndDecrypt({
            directPath: msg.directPath,
            encFilehash: msg.encFilehash,
            filehash: msg.filehash,
            mediaKey: msg.mediaKey,
            mediaKeyTimestamp: msg.mediaKeyTimestamp,
            type: msg.type,
            signal: new AbortController().signal
          });
        }

        if (!decryptedMedia && msg.mediaData?.renderableUrl) {
          const resp = await fetch(msg.mediaData.renderableUrl);
          decryptedMedia = await resp.arrayBuffer();
        }

        if (!decryptedMedia) return null;

        const base64 = await window.WWebJS.arrayBufferToBase64Async(decryptedMedia);
        return {
          data: base64,
          mimetype: msg.mimetype || 'image/jpeg',
          filename: msg.filename || 'image.jpg',
          filesize: msg.size || 0
        };
      } catch (err) {
        console.error('extractMediaDirectly in-page error:', err);
        return null;
      }
    }, serializedId, rawId, msgKeyId);

    return res;
  } catch (err) {
    console.error('extractMediaDirectly error:', err.message);
    return null;
  }
}

/**
 * Handle media messages (images)
 */
async function handleMediaMessage(message, user, userState) {
  const phoneNumber = message.from;

  try {
    let media = null;
    try {
      media = await message.downloadMedia();
    } catch (dmErr) {
      console.warn('⚠️ downloadMedia failed, attempting direct extraction fallback:', dmErr.message);
    }

    if (!media) {
      media = await extractMediaDirectly(client, message);
    }

    if (!media || !media.data || !(media.mimetype || '').startsWith('image/')) {
      await safeSendMessage(message, `Please send an image file (JPG, PNG, etc.) 📸

_Type "menu" to go back to main menu_`);
      return;
    }

    // Save image temporarily
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const timestamp = Date.now();
    const imagePath = path.join(tempDir, `${timestamp}.jpg`);
    const imageBuffer = Buffer.from(media.data, 'base64');
    fs.writeFileSync(imagePath, imageBuffer);

    console.log(`💾 Image saved: ${imagePath}`);

    // Upload to UploadThing to get a persistent URL
    let imageUrl = null;
    try {
      imageUrl = await uploadFileToUploadThing(imagePath, {
        fileName: `${timestamp}.jpg`,
        mimetype: media.mimetype
      });
      console.log(`☁️ Image uploaded to UploadThing: ${imageUrl}`);
    } catch (uploadError) {
      console.error('❌ UploadThing error:', uploadError);
    }

    // Handle receipt verification
    if (userState.state === 'awaiting_receipt' || !isPremiumActive(user)) {
      await handleReceiptVerification(message, user, imagePath, imageUrl);
    }
    // Handle crop diagnosis (premium feature)
    else if (userState.state === 'awaiting_crop_image' && isPremiumActive(user)) {
      await handleCropDiagnosis(message, user, imagePath, imageUrl);
    }
    else {
      await safeSendMessage(message, `I received your image. What would you like me to do with it?

1️⃣ Diagnose crop disease (Premium)
2️⃣ Verify receipt for premium access
3️⃣ Soil results analysis (Premium)

_Type "menu" to go back to main menu_`);
      userStates.set(phoneNumber, { state: 'awaiting_image_choice', imagePath: imagePath, imageUrl: imageUrl });
    }

    // Clean up temp file after processing
    setTimeout(() => {
      try {
        if (fs.existsSync(imagePath)) {
          fs.unlinkSync(imagePath);
          console.log(`🗑️ Cleaned up temp file: ${imagePath}`);
        }
      } catch (cleanupError) {
        console.log(`⚠️ Could not delete temp file (may be in use): ${imagePath}`);
      }
    }, 120000); // Delete after 2 minutes

  } catch (error) {
    console.error('❌ Error processing image:', error);
    await safeSendMessage(message, 'Sorry, I had trouble processing that image. Please try again with a clear photo. 📸');
  }
}

/**
 * Handle receipt verification
 */
async function handleReceiptVerification(message, user, imagePath, imageUrl) {
  const phoneNumber = message.from;

  try {
    await safeSendMessage(message, '📄 Analyzing your receipt... Please wait a moment.');

    // Forward receipt to admin
    try {
      const adminNumber = '263773526659@c.us';
      const media = MessageMedia.fromFilePath(imagePath);
      const caption = `🧾 *New Receipt Submission*\n\n👤 Name: ${user.name || 'Unknown'}\n📱 Phone: ${user.phone_numeric || phoneNumber}\n🆔 ID: ${phoneNumber}`;

      await safeSendMessage(adminNumber, media, { caption: caption });
      console.log(`✅ Receipt forwarded to admin: ${adminNumber}`);
    } catch (forwardError) {
      console.error('❌ Error forwarding receipt:', forwardError);
    }

    // Process receipt (QR detection + OCR)
    const receiptData = await processReceipt(imagePath);
    console.log('🔍 Receipt data:', receiptData);

    // MANDATORY: QR code must be present
    if (!receiptData.qr_url || receiptData.source !== 'qr') {
      await safeSendMessage(message, `❌ *QR Code Required*\n\nThis receipt does not have a valid ZIMRA QR code.\n\n*Requirements:*\n✓ Receipt must have ZIMRA QR code\n✓ QR code must be clearly visible\n✓ Receipt must be from authorized retailer\n\nPlease upload a valid fiscal receipt with QR code. 📸`);

      // Save as pending
      const pendingHash = generateReceiptHash(
        receiptData.retailer_name || 'unknown',
        new Date().toISOString(),
        receiptData.total_amount || '0'
      );
      saveReceipt(phoneNumber, pendingHash, {
        ...receiptData,
        image: imageUrl
      }, 'pending');
      return;
    }

    // Check if invoice is valid
    if (!receiptData.is_valid) {
      const errors = receiptData.validation_errors.join('\n• ');
      await safeSendMessage(message, `⚠️ *Invoice Validation Failed*\n\n*Issues Found:*\n• ${errors}\n\nPlease upload a valid recent receipt. 📅`);

      // Save as pending
      const pendingHash = generateReceiptHash(
        receiptData.retailer_name || 'unknown',
        receiptData.purchase_date || new Date().toISOString(),
        receiptData.total_amount || '0'
      );
      saveReceipt(phoneNumber, pendingHash, {
        ...receiptData,
        image: imageUrl
      }, 'pending');
      return;
    }

    // Enhance with GPT analysis
    const enhancedData = await analyzeReceipt(receiptData);
    console.log('🔍 Enhanced receipt analysis:', enhancedData);

    // Validate UCF keyword in receipt
    const hasUCFKeyword = enhancedData.raw_text &&
      enhancedData.raw_text.toUpperCase().includes('UCF');

    if (!hasUCFKeyword) {
      await safeSendMessage(message, `⚠️ *No UCF Products Found*\n\nThis receipt does not contain UCF products.\n\n*Please ensure:*\n✓ Receipt shows UCF branded products\n✓ Image is clear and readable\n✓ Receipt is from an authorized retailer\n\nTry again with a valid UCF purchase receipt. 📸`);

      // Save as pending
      const pendingHash = generateReceiptHash(
        enhancedData.retailer_name || 'unknown',
        enhancedData.purchase_date || new Date().toISOString(),
        enhancedData.total_amount || '0'
      );
      saveReceipt(phoneNumber, pendingHash, {
        ...enhancedData,
        image: imageUrl
      }, 'pending');
      return;
    }

    // Check purchase date (within 3 months)
    if (enhancedData.purchase_date) {
      const purchaseDate = new Date(enhancedData.purchase_date);
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      if (purchaseDate < threeMonthsAgo) {
        await safeSendMessage(message, `⚠️ *Receipt Too Old*\n\nThis receipt is older than 3 months.\n\nPlease upload a recent UCF purchase receipt (within last 3 months). 📅`);

        // Save as pending
        const pendingHash = generateReceiptHash(
          enhancedData.retailer_name || 'unknown',
          enhancedData.purchase_date || new Date().toISOString(),
          enhancedData.total_amount || '0'
        );
        saveReceipt(phoneNumber, pendingHash, {
          ...enhancedData,
          image: imageUrl
        }, 'pending');
        return;
      }
    }

    // Generate receipt hash to prevent reuse
    const hash = generateReceiptHash(
      enhancedData.retailer_name || 'unknown',
      enhancedData.purchase_date || 'unknown',
      enhancedData.total_amount || 'unknown'
    );

    if (isReceiptUsed(hash)) {
      await safeSendMessage(message, `⚠️ *Receipt Already Used*\n\nThis receipt has already been verified.\n\nEach receipt can only be used once. Please upload a different receipt. 🔒`);

      // Save as pending
      const pendingHash = generateReceiptHash(
        enhancedData.retailer_name || 'unknown',
        enhancedData.purchase_date || new Date().toISOString(),
        enhancedData.total_amount || '0'
      );
      saveReceipt(phoneNumber, pendingHash, {
        ...enhancedData,
        image: imageUrl
      }, 'pending');
      return;
    }

    // Grant premium access
    const expiryDate = getExpiryDate();
    const userUpdates = {
      is_premium: true,
      premium_expiry_date: expiryDate
    };
    if (imageUrl) {
      userUpdates.recipet = imageUrl;
    }
    updateUser(phoneNumber, userUpdates);

    // Save receipt record as APPROVED (Verified)
    saveReceipt(phoneNumber, hash, {
      ...enhancedData,
      image: imageUrl
    }, 'approved');

    // Success message with invoice details
    const productList = enhancedData.ucf_products.map(p => `• ${p}`).join('\n');
    await safeSendMessage(message, `✅ *Receipt Verified Successfully!* 🎉\n\n*Invoice Details:*\n📋 Invoice #: ${enhancedData.invoice_number || 'N/A'}\n🏪 Retailer: ${enhancedData.retailer_name || 'N/A'}\n📅 Date: ${enhancedData.purchase_date || 'N/A'}\n💰 Amount: ${enhancedData.currency} ${enhancedData.total_amount || 'N/A'}\n\n*UCF Products Found:*\n${productList}\n\n🎉 *Congratulations!* You now have premium access.\n\n*Valid Until:* ${formatDate(expiryDate)}\n\n*Unlocked Features:*\n🔬 Crop disease diagnosis\n🌱 Soil results analysis\n📄 Exclusive farming guides\n👨‍🌾 Priority expert support\n\n_Type "menu" to start using premium features!_ 🌾`);

    userStates.set(phoneNumber, { state: 'main_menu' });

  } catch (error) {
    console.error('❌ Receipt verification error:', error);
    await safeSendMessage(message, `⚠️ *Verification Error*\n\nI had trouble reading your receipt. Please ensure:\n\n✓ Image is clear and well-lit\n✓ All text is visible\n✓ Receipt is not blurry\n\nTry taking another photo and send it again. 📸`);
  }
}

/**
 * Handle crop diagnosis
 */
async function handleCropDiagnosis(message, user, imagePath, imageUrl) {
  const phoneNumber = message.from;

  try {
    await safeSendMessage(message, '🔬 Analyzing your crop image... This may take a moment.');

    // Analyze agricultural image using GPT-4 Vision
    const result = await processPlantImage(imagePath, 'crop');
    console.log('🌿 Agricultural analysis result:', result);

    // Send the structured diagnosis message produced by the vision model
    if (result.fullAnalysis) {
      await safeSendMessage(message, result.fullAnalysis);
    } else {
      // Fallback (should rarely happen with the new template)
      const diseaseName = result.disease;
      const confidence = (result.confidence * 100).toFixed(1);
      await safeSendMessage(message, `🌾 UCF Crop Diagnosis\n\nIDENTIFICATION:\nIssue Detected: ${diseaseName}\nAI Confidence: ${confidence}%\n\nFor a more detailed report, please send a clearer image or type "Expert" to contact an agronomist.`);
    }

    // Save crop diagnosis record with image URL
    if (imageUrl) {
      const cropRecords = loadData('crop_diagnosis.json');
      cropRecords.push({
        phone: phoneNumber,
        created_at: new Date().toISOString(),
        image: imageUrl
      });
      saveData('crop_diagnosis.json', cropRecords);
    }

    userStates.set(phoneNumber, { state: 'main_menu' });

  } catch (error) {
    console.error('❌ Crop diagnosis error:', error);
    await safeSendMessage(message, `⚠️ I had trouble analyzing that image.\n\nPlease send:\n✓ Clear photo of affected leaves\n✓ Good lighting\n✓ Close-up of symptoms\n\nTry again or type "expert" for human assistance. 👨‍🌾`);
  }
}

async function handleSoilAnalysis(message, user, imagePath, imageUrl) {
  const phoneNumber = message.from;

  try {
    await safeSendMessage(message, '🧪 Analyzing your soil results image... This may take a moment.');

    const result = await processPlantImage(imagePath, 'soil');
    console.log('🌱 Soil results analysis:', result);

    if (result.fullAnalysis) {
      await safeSendMessage(message, result.fullAnalysis);
    } else {
      const issueName = result.disease;
      const confidence = (result.confidence * 100).toFixed(1);
      await safeSendMessage(message, `🌱 UCF Soil Results Analysis\n\nIDENTIFICATION:\nIssue Detected: ${issueName}\nAI Confidence: ${confidence}%\n\nFor a more detailed report, please send a clearer image or type "Expert" to contact an agronomist.`);
    }

    // Save soil analysis record with image URL
    if (imageUrl) {
      const soilRecords = loadData('soil_analysis.json');
      soilRecords.push({
        phone: phoneNumber,
        created_at: new Date().toISOString(),
        image: imageUrl
      });
      saveData('soil_analysis.json', soilRecords);
    }

    userStates.set(phoneNumber, { state: 'main_menu' });

  } catch (error) {
    console.error('❌ Soil resultsanalysis error:', error);
    await safeSendMessage(message, `⚠️ I had trouble analyzing that soil results image.\n\nPlease send:\n✓ Clear photo of the soil or lab report\n✓ Good lighting\n\nTry again or type "expert" for human assistance. 👨‍🌾`);
  }
}

/**
 * Handle location sharing
 */
async function handleLocation(message, user) {
  const phoneNumber = message.from;

  try {
    const { latitude, longitude } = message.location;
    console.log(`📍 Location received: ${latitude}, ${longitude}`);

    await safeSendMessage(message, '🔍 Finding nearest UCF retailers...');

    // Find nearest shops
    const shops = await findNearestShops(latitude, longitude, 3);

    // Update user location
    updateUser(phoneNumber, {
      location: { latitude, longitude }
    });

    // Send shop information
    const shopsMessage = formatShopsMessage(shops, true);
    await safeSendMessage(message, shopsMessage);

    await safeSendMessage(message, '_Need anything else? Type "menu" to see all options._');
    userStates.set(phoneNumber, { state: 'main_menu' });

  } catch (error) {
    console.error('❌ Location handling error:', error);
    await safeSendMessage(message, 'Sorry, I had trouble finding shops near you. Please try again or contact us directly. 📞');
  }
}

/**
 * Handle product questions
 */
async function handleProductQuestion(message, user, messageBody) {
  const phoneNumber = message.from;

  if (messageBody.toLowerCase() === 'menu') {
    await safeSendMessage(message, getMainMenu(user.name));
    userStates.set(phoneNumber, { state: 'main_menu' });
    return;
  }

  // Show all products on explicit request
  const showProductsRegex = /\b(show|list|display)\b.*\b(ucf\s*)?products\b/i;
  const productsOnlyRegex = /^\s*(ucf\s*)?products\s*$/i;
  if (showProductsRegex.test(messageBody) || productsOnlyRegex.test(messageBody)) {
    const products = loadData('products.json');
    await safeSendMessage(message, formatProductList(products) + '\n_Ask another question or type "menu" to go back._');
    return;
  }

  try {
    // Search products first
    const products = loadData('products.json');
    const matchingProducts = searchProducts(messageBody);

    if (matchingProducts.length > 0) {
      // Found matching products
      if (matchingProducts.length === 1) {
        await safeSendMessage(message, formatProduct(matchingProducts[0]));
      } else {
        await safeSendMessage(message, formatProductList(matchingProducts));
      }
    } else {
      // Use GPT for general questions
      const answer = await answerProductQuestion(messageBody, products);
      await safeSendMessage(message, answer);
    }

    await safeSendMessage(message, '\n_Ask another question or type "menu" to go back._');

  } catch (error) {
    console.error('❌ Product question error:', error);
    try {
      const products = loadData('products.json');
      const names = products.map(p => {
        const npk = p.npk || (p.composition ? `${p.composition.N}-${p.composition.P}-${p.composition.K}` : '');
        return npk ? `${p.name} (${npk})` : p.name;
      }).join(', ');
      const context = `Available UCF products: ${names}`;
      const fallback = await getGPTResponse(`Answer this UCF product question: ${messageBody}`, context);
      await safeSendMessage(message, fallback + '\n\n_Ask another question or type "menu" to go back._');
    } catch (e2) {
      const products = loadData('products.json');
      await safeSendMessage(message, formatProductList(products) + '\n_Ask another question or type "menu" to go back._');
    }
  }
}

/**
 * Handle expert help flow
 */
async function handleExpertEmailInput(message, user, messageBody) {
  const phoneNumber = message.from;

  updateUser(phoneNumber, { email: messageBody });
  await safeSendMessage(message, `Great! Now please describe your farming issue or question.

Your question will be forwarded directly to our agronomist's WhatsApp for personalized assistance.`);
  userStates.set(phoneNumber, { state: 'awaiting_expert_issue' });
}

async function handleExpertIssueInput(message, user, messageBody) {
  const phoneNumber = message.from;
  const agronomistNumber = '263786066542@c.us';

  try {
    // Send to agronomist
    const expertMessage = `🌾 *[UCF Agri-Bot - Expert Request]*\n\n👤 *Farmer:* ${user.name || 'Not provided'}\n📞 *Phone:* ${phoneNumber}\n📧 *Email:* ${user.email || 'Not provided'}\n\n*Issue:*\n${messageBody}\n\n_Type "menu" to continue using the bot._`;
    const chatId = agronomistNumber;

    // Save to argonomist.json
    const questions = loadData('argonomist.json');
    questions.push({
      id: Date.now().toString(),
      phone: phoneNumber,
      name: user.name || 'Unknown',
      question: messageBody,
      created_at: new Date().toISOString(),
      status: 'pending'
    });
    saveData('argonomist.json', questions);

    try {
      await safeSendMessage(chatId, expertMessage);
      console.log(`✅ Expert request forwarded to ${agronomistNumber}`);

      await safeSendMessage(message, `✅ *Request Sent!* 👨‍🌾\n\nI've forwarded your question to our agronomist.\n\n*Your Question:*\n"${messageBody}"\n\nYou'll receive a response directly on WhatsApp soon!\n\n_Type "menu" to continue._`);
    } catch (sendError) {
      // If sending fails, still show fallback message
      await safeSendMessage(message, `✅ *Request Recorded!*\n\nYour query has been recorded and will be forwarded to our agronomist.\n\n*Your Details Recorded:*\n📞 Phone: ${phoneNumber}\n📧 Email: ${user.email || 'Not provided'}\n\n_Type "menu" to continue._`);
    }

    userStates.set(phoneNumber, { state: 'main_menu' });

  } catch (error) {
    console.error('❌ Expert help error:', error);
    await safeSendMessage(message, `Sorry, there was an error forwarding your message to our agronomist. Please try again or type "menu" to return to main menu.`);
  }
}

/**
 * FERTILIZER CALCULATOR - NEW YIELD-BASED FLOW
 * Step 1: Ask for crop/plant type
 */
async function handleCalculatorPlant(message, user, messageBody) {
  const phoneNumber = message.from;

  if (messageBody.toLowerCase() === 'menu') {
    await safeSendMessage(message, getMainMenu(user.name));
    userStates.set(phoneNumber, { state: 'main_menu' });
    return;
  }

  const plantType = messageBody.trim();

  if (!plantType) {
    await safeSendMessage(message, `❌ Please enter a valid crop name.\n\nExample: "Maize", "Cotton", "Cabbage"\n\n_Type "menu" to go back to main menu_`);
    return;
  }

  // Save plant type and move to yield input
  await safeSendMessage(message, `✅ Plant selected: *${plantType}*\n\n📊 *Step 2: Target Yield*\n\nHow many tonnes of ${plantType} are you looking to get?\n\nExample: "3" for 3 tonnes\n\n_Type "menu" to go back to main menu_`);

  userStates.set(phoneNumber, {
    state: 'calculator_yield',
    plant_type: plantType
  });

  // Update user record with calculator data
  updateUser(phoneNumber, {
    calculator_data: {
      plant_type: plantType,
      last_calculation: new Date().toISOString()
    }
  });
}

/**
 * Step 2: Ask for target yield and categorize
 */
async function handleCalculatorYield(message, user, messageBody, userState) {
  const phoneNumber = message.from;

  if (messageBody.toLowerCase() === 'menu') {
    await safeSendMessage(message, getMainMenu(user.name));
    userStates.set(phoneNumber, { state: 'main_menu' });
    return;
  }

  const targetYield = parseFloat(messageBody.trim());

  if (isNaN(targetYield) || targetYield <= 0) {
    await safeSendMessage(message, `❌ Please enter a valid yield amount.\n\nExample: "3.5" for 3.5 tonnes\n\n_Type "menu" to go back to main menu_`);
    return;
  }

  const plantType = userState.plant_type;

  // Update user record with yield data
  updateUser(phoneNumber, {
    calculator_data: {
      plant_type: plantType,
      target_yield: targetYield,
      last_calculation: new Date().toISOString()
    }
  });

  // Step 3: Categorize based on yield
  if (targetYield <= 2) {
    // Low yield: 150kg/ha recommendation
    await safeSendMessage(message, `📊 *UCF Fertilizer Calculator Results*\n\n🌾 *Crop:* ${plantType}\n🎯 *Target Yield:* ${targetYield} tonnes\n\n✅ *Recommended Rate:* 150kg/ha\n\n💡 This application rate is suitable for your target yield.\n\n_Thank you for using the UCF Fertilizer Calculator!_\n\nType "menu" to return to main menu.`);

    userStates.set(phoneNumber, { state: 'main_menu' });

  } else if (targetYield > 2 && targetYield <= 5) {
    // Medium yield: 300kg/ha + soil analysis suggestion
    await safeSendMessage(message, `📊 *UCF Fertilizer Calculator Results*\n\n🌾 *Crop:* ${plantType}\n🎯 *Target Yield:* ${targetYield} tonnes\n\n✅ *Recommended Rate:* 300kg/ha\n\n💡 *Pro Tip:* We recommend soil analysis to maximise performance of UCF fertilizer for your target yield.\n\n_Thank you for using the UCF Fertilizer Calculator!_\n\nType "menu" to return to main menu.`);

    userStates.set(phoneNumber, { state: 'main_menu' });

  } else {
    // High yield (>5): Ask about soil analysis
    await safeSendMessage(message, `📊 *UCF Fertilizer Calculator*\n\n🌾 *Crop:* ${plantType}\n🎯 *Target Yield:* ${targetYield} tonnes\n\n🧪 *Soil Analysis Check*\n\nDid you do a soil analysis?\n\n1️⃣ Yes - I have soil analysis results\n2️⃣ No - I haven't done soil analysis\n\nReply with 1 or 2.\n\n_Type "menu" to go back to main menu_`);

    userStates.set(phoneNumber, {
      state: 'calculator_soil_check',
      plant_type: plantType,
      target_yield: targetYield
    });
  }
}

/**
 * Step 4: Handle soil analysis check (for yields >5 tonnes)
 */
async function handleCalculatorSoilCheck(message, user, messageBody, userState) {
  const phoneNumber = message.from;

  if (messageBody.toLowerCase() === 'menu') {
    await safeSendMessage(message, getMainMenu(user.name));
    userStates.set(phoneNumber, { state: 'main_menu' });
    return;
  }

  const input = messageBody.trim().toLowerCase();
  const plantType = userState.plant_type;
  const targetYield = userState.target_yield;

  if (input === '1' || input === 'yes') {
    // User has soil analysis results
    await safeSendMessage(message, `✅ *Great!*\n\nPlease share your soil analysis results so our agronomist can give you personalized recommendations based on your soil.\n\n📸 You can send:\n• Photo of lab report\n• Soil analysis document\n\nOur expert will review and provide tailored fertilizer recommendations.\n\n_Thank you for using the UCF Fertilizer Calculator!_\n\nType "menu" to return to main menu.`);

    // Update user record
    updateUser(phoneNumber, {
      calculator_data: {
        plant_type: plantType,
        target_yield: targetYield,
        soil_analysis_status: 'yes',
        last_calculation: new Date().toISOString()
      }
    });

    userStates.set(phoneNumber, { state: 'main_menu' });

  } else if (input === '2' || input === 'no') {
    // User hasn't done soil analysis
    await safeSendMessage(message, `💡 *Soil Analysis Recommended*\n\nFor your target yield of ${targetYield} tonnes, we highly recommend soil analysis to maximise performance of UCF fertilizer.\n\n👨‍🌾 *Next Steps:*\nContact our expert agronomist for soil sampling and analysis services.\n\nThis will help us provide you with the most accurate fertilizer recommendations for optimal results.\n\n_Thank you for using the UCF Fertilizer Calculator!_\n\nType "menu" to return to main menu or "4" to contact our expert.`);

    // Update user record
    updateUser(phoneNumber, {
      calculator_data: {
        plant_type: plantType,
        target_yield: targetYield,
        soil_analysis_status: 'no',
        last_calculation: new Date().toISOString()
      }
    });

    userStates.set(phoneNumber, { state: 'main_menu' });

  } else {
    await safeSendMessage(message, `❌ Please reply with:\n\n1️⃣ for Yes\n2️⃣ for No\n\n_Type "menu" to go back to main menu_`);
  }
}

// Keep old handlers for backward compatibility (deprecated)
async function handleFertilizerCrop(message, user, messageBody) {
  // Redirect to new calculator
  await handleCalculatorPlant(message, user, messageBody);
}

async function handleFertilizerFieldSize(message, user, messageBody, userState) {
  const phoneNumber = message.from;
  await safeSendMessage(message, `ℹ️ The fertilizer calculator has been updated!\n\nPlease start again by typing "2" or "fertilizer" from the main menu.\n\n_Type "menu" to go back to main menu_`);
  userStates.set(phoneNumber, { state: 'main_menu' });
}

async function handleFertilizerNPKRequirement(message, user, messageBody, userState) {
  const phoneNumber = message.from;
  await safeSendMessage(message, `ℹ️ The fertilizer calculator has been updated!\n\nPlease start again by typing "2" or "fertilizer" from the main menu.\n\n_Type "menu" to go back to main menu_`);
  userStates.set(phoneNumber, { state: 'main_menu' });
}

async function handleFertilizerProductSelection(message, user, messageBody, userState) {
  const phoneNumber = message.from;
  await safeSendMessage(message, `ℹ️ The fertilizer calculator has been updated!\n\nPlease start again by typing "2" or "fertilizer" from the main menu.\n\n_Type "menu" to go back to main menu_`);
  userStates.set(phoneNumber, { state: 'main_menu' });
}

/**
 * Handle custom NPK input
 */
async function handleFertilizerCustomNPK(message, user, messageBody, userState) {
  const phoneNumber = message.from;
  await safeSendMessage(message, `ℹ️ The fertilizer calculator has been updated!\n\nPlease start again by typing "2" or "fertilizer" from the main menu.\n\n_Type "menu" to go back to main menu_`);
  userStates.set(phoneNumber, { state: 'main_menu' });
}

/**
 * Handle premium access info follow-up
 */
async function handlePremiumAccessInfo(message, user, messageBody) {
  const phoneNumber = message.from;
  const input = messageBody.toLowerCase().trim();

  if (input === 'menu') {
    await safeSendMessage(message, getMainMenu(user.name));
    userStates.set(phoneNumber, { state: 'main_menu' });
    return;
  }

  // 1: Crop/Soil Diagnosis
  if (input === '1' || input.includes('diagnosis') || input.includes('crop') || input.includes('soil')) {
    await safeSendMessage(message, `🔬 *Crop & Soil Diagnosis Service*\n\nPlease send a clear photo of either:\n📸 Affected crop/plant leaves\n📸 Soil results / soil condition\n\nI'll analyze it and provide recommendations! 🌿\n\n_Type "menu" to go back to main menu_`);
    userStates.set(phoneNumber, { state: 'awaiting_crop_image' });
    return;
  }

  // 2: Fertilizer Calculator
  if (input === '2' || input.includes('calculator') || input.includes('fertilizer')) {
    await safeSendMessage(message, getFertilizerCalculatorPrompt());
    userStates.set(phoneNumber, { state: 'fertilizer_crop' });
    return;
  }

  // 3: Exclusive PDFs
  if (input === '3' || input.includes('pdf') || input.includes('guide')) {
    const pdfs = getExclusivePDFs();
    await safeSendMessage(message, `📚 *Exclusive Premium PDFs*\n\nChoose a guide to download:\n\n${formatPDFList(pdfs)}\n\nReply with the number (1-${pdfs.length}) to get your PDF!\n\n_Type "menu" to go back to main menu_`);
    userStates.set(phoneNumber, { state: 'awaiting_pdf_selection' });
    return;
  }

  // 4: Priority support (expert help)
  if (input === '4' || input.includes('support') || input.includes('expert')) {
    if (!user.name) {
      await safeSendMessage(message, `To connect you with our expert, I need some information.\n\nWhat's your name?\n\n_Type "menu" to go back to main menu_`);
      userStates.set(phoneNumber, { state: 'awaiting_expert_name' });
    } else if (!user.email) {
      await safeSendMessage(message, `Thanks! What's your email address?\n\n_Type "menu" to go back to main menu_`);
      userStates.set(phoneNumber, { state: 'awaiting_expert_email' });
    } else {
      await safeSendMessage(message, `👨‍🌾 *Priority Expert Support*\n\nPlease describe your farming issue or question.\n\nYour question will be forwarded directly to our agronomist's WhatsApp for personalized assistance.\n\n_Type "menu" to go back to main menu_`);
      userStates.set(phoneNumber, { state: 'awaiting_expert_issue' });
    }
    return;
  }

  await safeSendMessage(message, `*Premium Features:*\n1️⃣ Crop disease diagnosis and Soil results analysis\n2️⃣ Fertilizer Calculator\n3️⃣ Exclusive PDFs\n4️⃣ Priority support\n\n_Reply with 1-4 to use Premium Features, or type "menu" to go back to main menu._`);
}

/**
 * Handle general queries with GPT
 */
async function handleGeneralQuery(message, user, messageBody) {
  try {
    // Quick intent: show all UCF products
    const showProductsRegex = /\b(show|list|display)\b.*\b(ucf\s*)?products\b/i;
    const productsOnlyRegex = /^\s*(ucf\s*)?products\s*$/i;
    if (showProductsRegex.test(messageBody) || productsOnlyRegex.test(messageBody)) {
      const products = loadData('products.json');
      await safeSendMessage(message, formatProductList(products) + '\n\n_Type "menu" for more options._');
      userStates.set(message.from, { state: 'product_qa' });
      return;
    }
    const context = `User is ${user.name || 'a farmer'}. Premium status: ${isPremiumActive(user) ? 'Active' : 'Inactive'}`;
    const response = await getGPTResponse(messageBody, context);
    await safeSendMessage(message, response + '\n\n_Type "menu" for more options._');
  } catch (error) {
    console.error('❌ General query error:', error);
    await safeSendMessage(message, 'I didn\'t quite understand that. Type "menu" to see what I can help you with! 🌾');
  }
}

// Memory cleanup function - removes old user states
function cleanupOldStates() {
  const now = Date.now();
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  let cleanedCount = 0;

  for (const [phoneNumber, state] of userStates.entries()) {
    if (state.lastActivity && (now - state.lastActivity) > maxAge) {
      userStates.delete(phoneNumber);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    console.log(`🧹 Cleaned up ${cleanedCount} old user state(s)`);
  }

  console.log(`📊 Active states: ${userStates.size}, Activated users: ${activatedUsers.size}`);
}

// Run cleanup every hour
setInterval(cleanupOldStates, 60 * 60 * 1000);

// Monitor connection state changes
client.on('change_state', (state) => {
  console.log('🔄 Connection state changed:', state);
});

// Handle unhandled promise rejections (catches initialization errors)
// MUST be set up BEFORE client initialization
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise);
  console.error('❌ Reason:', reason);

  // Check if this is a cache-related error
  const errorMessage = reason?.message || String(reason);
  const isCacheError =
    errorMessage.includes('Cannot read properties of null') ||
    errorMessage.includes('manifest-') ||
    errorMessage.includes('LocalWebCache') ||
    errorMessage.includes('indexHtml.match');

  if (isCacheError) {
    console.log('⚠️ Cache error detected in unhandled rejection');
    console.log('🧹 Attempting to clear cache...');
    clearWhatsAppCache();
    console.log('🔄 Please restart the bot to regenerate cache');
  }

  process.exit(1);
});

// Handle uncaught exceptions
// MUST be set up BEFORE client initialization
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);

  // Check if this is a cache-related error
  const isCacheError =
    error.message.includes('Cannot read properties of null') ||
    error.message.includes('manifest-') ||
    error.message.includes('LocalWebCache') ||
    error.message.includes('indexHtml.match');

  if (isCacheError) {
    console.log('⚠️ Cache error detected in uncaught exception');
    console.log('🧹 Attempting to clear cache...');
    clearWhatsAppCache();
    console.log('🔄 Please restart the bot to regenerate cache');
  }

  process.exit(1);
});

// Initialize the client
console.log('🚀 Starting UCF Agri-Bot...');
initializeClient().catch((error) => {
  console.error('❌ Fatal error during initialization:', error);
  console.log('💡 The bot will exit. Please check the error above and restart.');
  process.exit(1);
});

// Graceful shutdown handler
async function gracefulShutdown(signal) {
  console.log(`\n⚠️ Received ${signal}, shutting down gracefully...`);

  // Clear keep-alive interval
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    console.log('✅ Keep-alive interval cleared');
  }

  // Destroy client
  try {
    await client.destroy();
    console.log('✅ WhatsApp client destroyed successfully');
  } catch (error) {
    console.error('❌ Error destroying client:', error);
  }

  console.log('👋 Goodbye!');
  process.exit(0);
}

// Handle process termination signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));


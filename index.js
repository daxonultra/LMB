const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
require('dotenv').config();
const { searchSaavn, searchYouTube } = require('./services/search');
const { downloadYoutubeSong } = require('./services/youtubedown');
const { saavnUrlhandler, saavnQueryhandler } = require('./handlers/saavn');
const { youtubeQueryhandler } = require('./handlers/youtube');
const { spotifyUrlhandler } = require('./handlers/spotify');


// ============ Configuration ============
const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });
const OWNER_ID = Number(process.env.OWNER_ID);
const mongoUri = process.env.MONGO_URI;
const channelId = process.env.CHANNEL_ID;

// ============ Force Join Channel Configuration ============
const FORCE_JOIN_CHANNEL = '@innoshiv'; // Channel username (with @)
const FORCE_JOIN_CHANNEL_ID = process.env.FORCE_JOIN_CHANNEL_ID || '@innoshiv'; // Can be username or numeric ID

// ============ MongoDB Connection ============
const dbConnection = mongoose.createConnection(mongoUri);

dbConnection.on('connected', () => {
  console.log('✅ Connected to MongoDB');
});

dbConnection.on('error', (err) => {
  console.error('❌ MongoDB connection error:', err);
});

// ============ User Schema & Model ============
const userSchema = new mongoose.Schema({
  userId: { type: Number, unique: true, required: true },
  firstName: { type: String, default: '' },
  lastName: { type: String, default: '' },
  username: { type: String, default: '' },
  isBlocked: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  lastActive: { type: Date, default: Date.now },
  totalInteractions: { type: Number, default: 0 }
});

const User = dbConnection.model('User', userSchema);

// ============ YouTube Schema ============
const Youtube = dbConnection.model('Youtube', new mongoose.Schema({
  videoId: { type: String, required: true, unique: true, index: true },
  title: String,
  artist: String,
  messageId: Number,
  duration: Number,
  createdAt: { type: Date, default: Date.now }
}));

// ============ JioSaavan Schema ============
const Saavan = dbConnection.model('Saavan', new mongoose.Schema({
  songId: { type: String, required: true, unique: true, index: true },
  title: String,
  artist: String,
  messageId: Number,
  duration: Number,
  saavnUrl: String,
  createdAt: { type: Date, default: Date.now }
}));

// ============ Spotify Schema ============
const Spotify = dbConnection.model('Spotify', new mongoose.Schema({
  songId: { type: String, required: true, unique: true, index: true },
  title: String,
  artist: String,
  messageId: Number,
  duration: Number,
  createdAt: { type: Date, default: Date.now }
}));

bot.setMyCommands([
  { command: "start", description: "Start the bot" }
]);


// ============ Force Join Helper Functions ============

/**
 * Check if user is a member of the required channel
 * @param {number} userId - Telegram user ID
 * @returns {Promise<boolean>} - true if member, false otherwise
 */
async function isChannelMember(userId) {
  try {
    const chatMember = await bot.getChatMember(FORCE_JOIN_CHANNEL_ID, userId);
    // Valid statuses: 'creator', 'administrator', 'member'
    // Invalid statuses: 'left', 'kicked', 'restricted' (if not a member)
    const validStatuses = ['creator', 'administrator', 'member'];
    return validStatuses.includes(chatMember.status);
  } catch (err) {
    // If error occurs (user never interacted with channel, bot not admin, etc.)
    console.error(`Error checking channel membership for ${userId}:`, err.message);
    return false;
  }
}

/**
 * Send force join message to user
 * @param {number} chatId - Chat ID to send message to
 * @param {number} replyToMessageId - Optional message ID to reply to
 */
async function sendForceJoinMessage(chatId, replyToMessageId = null) {
  const message = `
🔒 *Access Restricted*

To use this bot, you must join our channel first!

📢 *Channel:* ${FORCE_JOIN_CHANNEL}

👇 Click the button below to join, then click "✅ I've Joined"
  `.trim();

  const options = {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '📢 Join Channel', url: `https://t.me/${FORCE_JOIN_CHANNEL.replace('@', '')}` }],
        [{ text: '✅ I\'ve Joined', callback_data: 'check_membership' }]
      ]
    }
  };

  if (replyToMessageId) {
    options.reply_to_message_id = replyToMessageId;
  }

  return bot.sendMessage(chatId, message, options);
}

/**
 * Middleware to check force join before processing
 * @param {object} msg - Telegram message object
 * @returns {Promise<boolean>} - true if user can proceed, false if blocked
 */
async function checkForceJoin(msg) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;

  // Owner bypasses force join
  if (isOwner(userId)) {
    return true;
  }

  const isMember = await isChannelMember(userId);

  if (!isMember) {
    await sendForceJoinMessage(chatId, msg.message_id);
    return false;
  }

  return true;
}

/**
 * Middleware for callback queries to check force join
 * @param {object} callbackQuery - Telegram callback query object
 * @returns {Promise<boolean>} - true if user can proceed, false if blocked
 */
async function checkForceJoinCallback(callbackQuery) {
  const userId = callbackQuery.from.id;
  const chatId = callbackQuery.message.chat.id;

  // Owner bypasses force join
  if (isOwner(userId)) {
    return true;
  }

  // Allow check_membership callback to pass through
  if (callbackQuery.data === 'check_membership') {
    return true;
  }

  const isMember = await isChannelMember(userId);

  if (!isMember) {
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: `❌ Please join ${FORCE_JOIN_CHANNEL} first!`,
      show_alert: true
    });
    await sendForceJoinMessage(chatId);
    return false;
  }

  return true;
}


// ============ Helper Functions ============

/**
 * Save or update user in database
 */
async function saveUser(msg) {
  const { id: userId, first_name, last_name, username } = msg.from;

  try {
    await User.findOneAndUpdate(
      { userId },
      {
        userId,
        firstName: first_name || '',
        lastName: last_name || '',
        username: username || '',
        lastActive: new Date(),
        $inc: { totalInteractions: 1 }
      },
      { upsert: true, new: true }
    );
  } catch (err) {
    console.error('Error saving user:', err);
  }
}

/**
 * Check if user is owner/admin
 */
function isOwner(userId) {
  return userId === OWNER_ID;
}

/**
 * Get all active users
 */
async function getAllUsers() {
  try {
    return await User.find({ isBlocked: false });
  } catch (err) {
    console.error('Error fetching users:', err);
    return [];
  }
}

/**
 * Get user statistics
 */
async function getUserStats() {
  try {
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ isBlocked: false });
    const blockedUsers = await User.countDocuments({ isBlocked: true });

    // Users active in last 24 hours
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentActiveUsers = await User.countDocuments({
      lastActive: { $gte: oneDayAgo }
    });

    return { totalUsers, activeUsers, blockedUsers, recentActiveUsers };
  } catch (err) {
    console.error('Error getting stats:', err);
    return { totalUsers: 0, activeUsers: 0, blockedUsers: 0, recentActiveUsers: 0 };
  }
}

/**
 * Broadcast message to all users
 */
async function broadcastMessage(msg, fromChatId) {
  const users = await getAllUsers();

  if (users.length === 0) {
    return { success: 0, failed: 0, blocked: 0 };
  }

  let success = 0;
  let failed = 0;
  let blocked = 0;

  const statusMsg = await bot.sendMessage(fromChatId, 
    `📤 Starting broadcast to ${users.length} users...\n\n⏳ Please wait...`
  );

  for (let i = 0; i < users.length; i++) {
    const user = users[i];

    try {
      // Forward the message to user
      await bot.forwardMessage(user.userId, msg.chat.id, msg.message_id);
      success++;

      // Update progress every 10 users
      if ((i + 1) % 10 === 0 || i === users.length - 1) {
        await bot.editMessageText(
          `📤 Broadcasting...\n\n` +
          `✅ Success: ${success}\n` +
          `❌ Failed: ${failed}\n` +
          `🚫 Blocked: ${blocked}\n\n` +
          `📊 Progress: ${i + 1}/${users.length}`,
          { chat_id: fromChatId, message_id: statusMsg.message_id }
        ).catch(() => {});
      }

      // Rate limiting - small delay between messages
      await new Promise(res => setTimeout(res, 50));

    } catch (err) {
      if (err.response?.statusCode === 403) {
        // User blocked the bot
        blocked++;
        await User.updateOne({ userId: user.userId }, { isBlocked: true });
      } else {
        failed++;
      }
      console.error(`Failed to send to ${user.userId}:`, err.message);
    }
  }

  // Final status
  await bot.editMessageText(
    `✅ Broadcast Complete!\n\n` +
    `📊 Results:\n` +
    `✅ Success: ${success}\n` +
    `❌ Failed: ${failed}\n` +
    `🚫 Blocked: ${blocked}\n` +
    `📝 Total: ${users.length}`,
    { chat_id: fromChatId, message_id: statusMsg.message_id }
  ).catch(() => {});

  return { success, failed, blocked };
}

// ============ Command Handlers ============

/**
 * /start command
 */
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || 'User';

  // Save user to database (always save, even if not member)
  await saveUser(msg);

  // Check force join
  const canProceed = await checkForceJoin(msg);
  if (!canProceed) return;

  const welcomeMessage = `
👋 *Welcome, ${firstName}!*

I'm your friendly bot. Here's what I can do:

🎵 Send me a song name to search
🔗 Send a YouTube link to download
📋 Send a YouTube playlist link

*Commands:*
/start - Show this message
/help - Get help
/stats - View your stats

Enjoy using the bot! 🎉
  `.trim();

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [{ text: '📊 My Stats', callback_data: 'my_stats' }],
        [{ text: '❓ Help', callback_data: 'help' }]
      ]
    },
    parse_mode: 'Markdown'
  };

  await bot.sendMessage(chatId, welcomeMessage, keyboard);
});

/**
 * /help command
 */
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  await saveUser(msg);

  // Check force join
  const canProceed = await checkForceJoin(msg);
  if (!canProceed) return;

  const helpMessage = `
📖 *Help Guide*

*How to use:*
1️⃣ Send a song name to search
2️⃣ Send a YouTube video link
3️⃣ Send a YouTube playlist link

*Tips:*
• Be specific with song names
• Include artist name for better results
• Playlists may take time to process

Need more help? Contact @YourSupportUsername
  `.trim();

  await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
});

/**
 * /stats command (for users)
 */
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  await saveUser(msg);

  // Check force join
  const canProceed = await checkForceJoin(msg);
  if (!canProceed) return;

  try {
    const user = await User.findOne({ userId: msg.from.id });

    if (!user) {
      return bot.sendMessage(chatId, '❌ User data not found.');
    }

    const statsMessage = `
📊 *Your Statistics*

👤 Name: ${user.firstName} ${user.lastName}
🆔 User ID: \`${user.userId}\`
📅 Joined: ${user.createdAt.toDateString()}
🕐 Last Active: ${user.lastActive.toDateString()}
📈 Total Interactions: ${user.totalInteractions}
    `.trim();

    await bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Error fetching user stats:', err);
    await bot.sendMessage(chatId, '❌ Error fetching your stats.');
  }
});

/**
 * /broadcast command (Owner only)
 * Usage: Reply to a message with /broadcast
 */
bot.onText(/\/broadcast/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Check if user is owner (no force join check for owner)
  if (!isOwner(userId)) {
    return bot.sendMessage(chatId, '❌ This command is only available for the bot owner.');
  }

  // Check if replying to a message
  if (!msg.reply_to_message) {
    return bot.sendMessage(chatId, 
      '📢 *Broadcast Usage:*\n\n' +
      'Reply to any message with /broadcast to forward it to all users.\n\n' +
      '*Supported message types:*\n' +
      '• Text\n' +
      '• Photos\n' +
      '• Videos\n' +
      '• Audio\n' +
      '• Documents\n' +
      '• Stickers',
      { parse_mode: 'Markdown' }
    );
  }

  const messageToForward = msg.reply_to_message;

  // Confirm broadcast
  const confirmMsg = await bot.sendMessage(chatId, 
    '⚠️ *Confirm Broadcast*\n\n' +
    'Are you sure you want to forward this message to ALL users?',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Yes, Broadcast', callback_data: `confirm_broadcast:${messageToForward.message_id}` },
            { text: '❌ Cancel', callback_data: 'cancel_broadcast' }
          ]
        ]
      }
    }
  );

  // Store the message reference temporarily
  if (!global.pendingBroadcasts) global.pendingBroadcasts = {};
  global.pendingBroadcasts[chatId] = {
    messageId: messageToForward.message_id,
    confirmMsgId: confirmMsg.message_id
  };
});

/**
 * /users command (Owner only) - Show user statistics
 */
bot.onText(/\/users/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isOwner(userId)) {
    return bot.sendMessage(chatId, '❌ This command is only available for the bot owner.');
  }

  const stats = await getUserStats();

  const statsMessage = `
📊 *Bot User Statistics*

👥 Total Users: ${stats.totalUsers}
✅ Active Users: ${stats.activeUsers}
🚫 Blocked Bot: ${stats.blockedUsers}
🕐 Active (24h): ${stats.recentActiveUsers}
  `.trim();

  await bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
});

/**
 * /export command (Owner only) - Export user list
 */
bot.onText(/\/export/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isOwner(userId)) {
    return bot.sendMessage(chatId, '❌ This command is only available for the bot owner.');
  }

  try {
    const users = await User.find({}).lean();

    if (users.length === 0) {
      return bot.sendMessage(chatId, '📭 No users found.');
    }

    // Create CSV content
    let csv = 'UserID,FirstName,LastName,Username,Blocked,JoinedDate,LastActive,Interactions\n';

    users.forEach(user => {
      csv += `${user.userId},${user.firstName || ''},${user.lastName || ''},${user.username || ''},${user.isBlocked},${user.createdAt},${user.lastActive},${user.totalInteractions}\n`;
    });

    // Send as document
    const buffer = Buffer.from(csv, 'utf-8');
    await bot.sendDocument(chatId, buffer, {
      caption: `📋 User Export - ${users.length} users`
    }, {
      filename: `users_${Date.now()}.csv`,
      contentType: 'text/csv'
    });

  } catch (err) {
    console.error('Error exporting users:', err);
    await bot.sendMessage(chatId, '❌ Error exporting users.');
  }
});

// ============ Callback Query Handler ============

bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;

  try {
    // Handle membership check callback (special case - always allow)
    if (data === 'check_membership') {
      const isMember = await isChannelMember(userId);

      if (isMember) {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: '✅ Verified! You can now use the bot.',
          show_alert: true
        });

        // Delete the force join message
        await bot.deleteMessage(chatId, messageId).catch(() => {});

        // Send welcome message
        const firstName = callbackQuery.from.first_name || 'User';
        const welcomeMessage = `
✅ *Membership Verified!*

Welcome, ${firstName}! You now have full access to the bot.

🎵 Send me a song name to search
🔗 Send a YouTube link to download
📋 Send a YouTube playlist link

Enjoy! 🎉
        `.trim();

        await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
      } else {
        await bot.answerCallbackQuery(callbackQuery.id, {
          text: `❌ You haven't joined ${FORCE_JOIN_CHANNEL} yet! Please join first.`,
          show_alert: true
        });
      }
      return;
    }

    // Check force join for other callbacks
    const canProceed = await checkForceJoinCallback(callbackQuery);
    if (!canProceed) return;

    // Handle my_stats callback
    if (data === 'my_stats') {
      await bot.answerCallbackQuery(callbackQuery.id);

      const user = await User.findOne({ userId });
      if (!user) {
        return bot.sendMessage(chatId, '❌ User data not found.');
      }

      const statsMessage = `
📊 *Your Statistics*

👤 Name: ${user.firstName} ${user.lastName}
🆔 User ID: \`${user.userId}\`
📅 Joined: ${user.createdAt.toDateString()}
📈 Total Interactions: ${user.totalInteractions}
      `.trim();

      await bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
    }

    // Handle help callback
    else if (data === 'help') {
      await bot.answerCallbackQuery(callbackQuery.id);

      const helpMessage = `
📖 *Help Guide*

*How to use:*
1️⃣ Send a song name to search
2️⃣ Send a YouTube video link
3️⃣ Send a YouTube playlist link

Need more help? Contact support.
      `.trim();

      await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
    }

    // Handle broadcast confirmation
    else if (data.startsWith('confirm_broadcast:')) {
      if (!isOwner(userId)) {
        return bot.answerCallbackQuery(callbackQuery.id, { 
          text: '❌ Unauthorized', 
          show_alert: true 
        });
      }

      await bot.answerCallbackQuery(callbackQuery.id, { text: '📤 Starting broadcast...' });

      const broadcastMsgId = parseInt(data.split(':')[1]);

      // Delete confirmation message
      await bot.deleteMessage(chatId, messageId).catch(() => {});

      // Create a fake message object for broadcast
      const msgToForward = {
        chat: { id: chatId },
        message_id: broadcastMsgId
      };

      await broadcastMessage(msgToForward, chatId);

      // Clean up
      if (global.pendingBroadcasts) {
        delete global.pendingBroadcasts[chatId];
      }
    }

    // Handle broadcast cancellation
    else if (data === 'cancel_broadcast') {
      if (!isOwner(userId)) {
        return bot.answerCallbackQuery(callbackQuery.id, { 
          text: '❌ Unauthorized', 
          show_alert: true 
        });
      }

      await bot.answerCallbackQuery(callbackQuery.id, { text: '❌ Broadcast cancelled' });
      await bot.deleteMessage(chatId, messageId).catch(() => {});

      // Clean up
      if (global.pendingBroadcasts) {
        delete global.pendingBroadcasts[chatId];
      }
    }

  } catch (err) {
    console.error('Callback query error:', err);
    await bot.answerCallbackQuery(callbackQuery.id, { 
      text: '❌ An error occurred', 
      show_alert: true 
    });
  }
});

// ============ Message Handler (Save user on any message) ============

// In-memory cache for search results
const searchCache = new Map();        // chatId -> results[]
const searchMessageMap = new Map();   // chatId -> messageId

function buildSearchRegex(text) {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .join('.*');

  return new RegExp(cleaned, 'i');
}

const PAGE_SIZE = 10;

function paginateResults(results, page = 1) {
  const totalResults = results.length;
  const totalPages = Math.ceil(totalResults / PAGE_SIZE);

  const start = (page - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;

  return {
    pageResults: results.slice(start, end),
    totalResults,
    totalPages
  };
}

function startIndex(page) {
  return (page - 1) * PAGE_SIZE;
}

async function sendSearchResults({
  bot,
  chatId,
  messageId = null,
  results,
  page = 1
}) {
  const { pageResults, totalResults, totalPages } = paginateResults(results, page);

  let text = `🎵 *Search Results*\n`;
  text += `📄 Page *${page}* / *${totalPages}*\n`;
  text += `🔢 Total Results: *${totalResults}*\n\n`;

  const buttons = [];

  pageResults.forEach((item, index) => {
    const globalIndex = startIndex(page) + index;

    // Source icon: 🔴 = YouTube, 🟢 = Saavn
    let sourceIcon;
    if (item.source === 'youtube' || item.source === 'youtube_api') {
      sourceIcon = '🔴';
    } else {
      sourceIcon = '🟢';
    }

    // Duration formatting
    let durationStr = '';
    if (item.duration) {
      if (typeof item.duration === 'number') {
        durationStr = ` [${formatDuration(item.duration)}]`;
      } else {
        durationStr = ` [${item.duration}]`;
      }
    }

    const btnText = `${globalIndex + 1}. ${sourceIcon} ${item.title} - ${item.artist}${durationStr}`;

    // Create callback data based on source
    let callbackData;
    if (item.source === 'youtube') {
      // DB YouTube result
      callbackData = `play|youtube|${item._id}`;
    } else if (item.source === 'saavan') {
      // DB Saavn result
      callbackData = `play|saavan|${item._id}`;
    } else if (item.source === 'saavan_api') {
      // API Saavn result
      callbackData = `play|saavan_api|${item.songId}`;
    } else if (item.source === 'youtube_api') {
      // API YouTube result
      callbackData = `play|youtube_api|${item.videoId}`;
    }

    buttons.push([{
      text: btnText.length > 60 ? btnText.substring(0, 57) + '...' : btnText,
      callback_data: callbackData
    }]);
  });

  // Pagination buttons
  const navButtons = [];
  if (page > 1) {
    navButtons.push({ text: '⬅️ Prev', callback_data: `page|${page - 1}` });
  }
  if (page < totalPages) {
    navButtons.push({ text: '➡️ Next', callback_data: `page|${page + 1}` });
  }
  if (navButtons.length) {
    buttons.push(navButtons);
  }

  // Cancel button
  buttons.push([{ text: '❌ Cancel', callback_data: 'cancel_search' }]);

  const options = {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: buttons }
  };

  if (messageId) {
    return bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      ...options
    });
  } else {
    return bot.sendMessage(chatId, text, options);
  }
}

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}



bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  // Skip commands (they're handled separately)
  if (msg.text && msg.text.startsWith('/')) return;

  // Save/update user in database (always save)
  await saveUser(msg);

  // Check force join before processing any message
  const canProceed = await checkForceJoin(msg);
  if (!canProceed) return;

  // Check if a YouTube link is sent of any type
  if (msg.text && msg.text.startsWith('http') && (msg.text.includes('youtube.com') || msg.text.includes('youtu.be') || msg.text.includes('youtube.com/shorts/') || msg.text.includes('youtube.com/live/') || msg.text.includes('youtube.com/watch?v='))) {
    // Extract the video id from the link
    const videoId = msg.text.split('v=')[1] || msg.text.split('youtu.be/')[1] || msg.text.split('shorts/')[1] || msg.text.split('live/')[1];

    const existvid = await Youtube.findOne({ videoId });
    if (existvid) {
      bot.copyMessage(chatId, channelId, existvid.messageId, {
        caption: `🎵 ${existvid.title}\n👤 ${existvid.artist}\n\nSupport @LuneMusic_Bot`,
        reply_to_message_id: msg.message_id
      });
    } else {
      const downloadingMsg = await bot.sendMessage(chatId, '⏳ Downloading from YouTube... Please wait!', {
        reply_to_message_id: msg.message_id
      });

      // Call your YouTube download function
      const result = await downloadYoutubeSong(videoId, chatId, msg.message_id, { bot, Youtube, channelId });
      
      if (!result.success) {
        console.error(`❌ YouTube download failed for ${songId}: ${result.error}`);
      }
      
      await bot.deleteMessage(chatId, downloadingMsg.message_id).catch(() => {});
      return;
    }
    
  } else if (msg.text && msg.text.startsWith('http') && (msg.text.includes('jiosaavn.com') || msg.text.includes('saavn.com'))) {

    await saavnUrlhandler(msg, { bot, Saavan, channelId });
  
    } else if (msg.text && msg.text.startsWith('http') && (msg.text.includes('spotify.com') || msg.text.includes('open.spotify.com'))) {
    // estract the song id / track from like like 
    
    const spotifyUrl = msg.text;
    const songId = spotifyUrl.split('track/')[1].split('?')[0];

  await spotifyUrlhandler(msg, spotifyUrl, songId, { bot, Saavan, Spotify, channelId });

  }

  if (msg.text && !msg.text.startsWith('http')) {

    const searchRegex = buildSearchRegex(msg.text);

    // Search in database
    const [youtubeResults, saavanDbResults, spotifyDbResults] = await Promise.all([
      Youtube.find({
        $or: [
          { title: { $regex: searchRegex } },
          { artist: { $regex: searchRegex } }
        ]
      }).lean(),
      Saavan.find({
        $or: [
          { title: { $regex: searchRegex } },
          { artist: { $regex: searchRegex } }
        ]
      }).lean(),
      Spotify.find({
        $or: [
          { title: { $regex: searchRegex } },
          { artist: { $regex: searchRegex } }
        ]
      }).lean()
    ]);

    // Format database results
    let combinedResults = [
      ...youtubeResults.map(v => ({ 
        ...v, 
        source: 'youtube',
        isFromApi: false 
      })),
      ...saavanDbResults.map(s => ({ 
        ...s, 
        source: 'saavan',
        isFromApi: false 
      })),
      ...spotifyDbResults.map(s => ({
        ...s,
        source: 'spotify',
        isFromApi: false
      }))
    ];

    // If no results in database, search from both APIs
    if (combinedResults.length === 0) {
      const [saavnApiResults, youtubeApiResults] = await Promise.all([
        searchSaavn(msg.text),
        searchYouTube(msg.text, { type: 'music', limit: 10 })  // ✅ YouTube Music search
      ]);

      // Map Saavn API results (limit to 10)
      const mappedSaavnResults = saavnApiResults.slice(0, 10).map((song) => ({
        songId: song.songId,
        title: song.title,
        artist: song.artist,
        duration: song.duration,
        saavnUrl: song.saavnUrl,
        imageUrl: song.imageUrl,
        source: 'saavan_api',
        isFromApi: true
      }));

      // Map YouTube API results (limit to 10)
      const mappedYoutubeResults = youtubeApiResults.slice(0, 10).map((video) => ({
        videoId: video.videoId,
        title: video.title,
        artist: video.channelName,
        duration: video.duration,
        imageUrl: video.imageUrl,
        source: 'youtube_api',
        isFromApi: true
      }));

      // Combine both API results
      combinedResults = [...mappedSaavnResults, ...mappedYoutubeResults];

      if (combinedResults.length === 0) {
        await bot.sendMessage(msg.chat.id, '❌ Koi result nahi mila. Kuch aur search karo.');
        return;
      }
    }

    // Store results with the original message id for reply
    searchCache.set(msg.chat.id, {
      results: combinedResults,
      originalMessageId: msg.message_id
    });

    const sent = await sendSearchResults({
      bot,
      chatId: msg.chat.id,
      results: combinedResults,
      page: 1
    });

    searchMessageMap.set(msg.chat.id, sent.message_id);
  }





  // Handle 'hi' message
  if (msg.text && msg.text.toLowerCase() === 'hi') {
    await bot.sendMessage(chatId, `👋 Hello ${msg.from.first_name || 'there'}! How can I help you today?`, {
      reply_to_message_id: msg.message_id
    });
    return;
  }

});

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;

  // Get cached data
  const cacheData = searchCache.get(chatId);
  if (!cacheData) {
    return bot.answerCallbackQuery(query.id, { text: '❌ Session expired. Search again!' });
  }

  const { results, originalMessageId } = cacheData;

  // Cancel search
  if (data === 'cancel_search') {
    searchCache.delete(chatId);
    searchMessageMap.delete(chatId);
    await bot.deleteMessage(chatId, messageId).catch(() => {});
    return bot.answerCallbackQuery(query.id, { text: '🗑️ Search cancelled' });
  }

  // Pagination
  if (data.startsWith('page|')) {
    const page = Number(data.split('|')[1]);
    await sendSearchResults({ bot, chatId, messageId, results, page });
    return bot.answerCallbackQuery(query.id);
  }

  // Play selected song
  if (data.startsWith('play|')) {
    const parts = data.split('|');
    const source = parts[1];
    const id = parts[2];

    // ============ DB YouTube ============
    if (source === 'youtube') {
      const song = await Youtube.findById(id);
      if (!song) {
        return bot.answerCallbackQuery(query.id, { text: '❌ Song not found!' });
      }

      await bot.copyMessage(chatId, channelId, song.messageId, {
        caption: `🎵 ${song.title}\n👤 ${song.artist}\n\nSupport @LuneMusic_Bot`,
        reply_to_message_id: originalMessageId
      });

      searchCache.delete(chatId);
      searchMessageMap.delete(chatId);
      await bot.deleteMessage(chatId, messageId).catch(() => {});
      return bot.answerCallbackQuery(query.id, { text: '▶️ Playing...' });
    }

    // ============ DB Saavn ============
    if (source === 'saavan') {
      const song = await Saavan.findById(id);
      if (!song) {
        return bot.answerCallbackQuery(query.id, { text: '❌ Song not found!' });
      }

      await bot.copyMessage(chatId, channelId, song.messageId, {
        caption: `🎵 ${song.title}\n👤 ${song.artist}\n\nSupport @LuneMusic_Bot`,
        reply_to_message_id: originalMessageId
      });

      searchCache.delete(chatId);
      searchMessageMap.delete(chatId);
      await bot.deleteMessage(chatId, messageId).catch(() => {});
      return bot.answerCallbackQuery(query.id, { text: '▶️ Playing...' });
    }

    // ============ API Saavn ============
    if (source === 'saavan_api') {
      const songId = id;
      await saavnQueryhandler(query, chatId, messageId, originalMessageId, songId, { bot, Saavan, channelId, searchCache, searchMessageMap } )
    }

    // ============ API YouTube ============
    if (source === 'youtube_api') {
      const videoId = id;
      await youtubeQueryhandler(query, chatId, messageId, originalMessageId, videoId, { bot, Youtube, channelId, searchCache, searchMessageMap } );

  }

  }
});


// ============ Error Handling ============

bot.on('polling_error', (error) => {
  console.error('Polling error:', error.message);
});

bot.on('error', (error) => {
  console.error('Bot error:', error.message);
});

// ============ Graceful Shutdown ============

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await bot.stopPolling();
  await dbConnection.close();
  console.log('👋 Goodbye!');
  process.exit(0);
});

console.log('LuneMusic🤖 Bot is running...');

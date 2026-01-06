const { downloadYoutubeSong } = require('../services/youtubedown');

async function youtubeQueryhandler(query, chatId, messageId, originalMessageId, videoId, { bot, Youtube, channelId, searchCache, searchMessageMap } ) {

  if (!videoId || videoId === 'undefined') {
    return bot.answerCallbackQuery(query.id, { text: '❌ Invalid video ID!' });
  }

  // Check if already exists in DB
  const existingVideo = await Youtube.findOne({ videoId: videoId });

  if (existingVideo) {
    await bot.copyMessage(chatId, channelId, existingVideo.messageId, {
      caption: `🎵 ${existingVideo.title}\n👤 ${existingVideo.artist}\n\nSupport @LuneMusic_Bot`,
      reply_to_message_id: originalMessageId
    });

    searchCache.delete(chatId);
    searchMessageMap.delete(chatId);
    await bot.deleteMessage(chatId, messageId).catch(() => {});
    return bot.answerCallbackQuery(query.id, { text: '▶️ Playing...' });
  }

  // Not in DB, need to download
  await bot.answerCallbackQuery(query.id, { text: '⏳ Downloading... Please wait!' });
  await bot.deleteMessage(chatId, messageId).catch(() => {});

  const downloadingMsg = await bot.sendMessage(chatId, '⏳ Downloading from YouTube... Please wait!', {
    reply_to_message_id: originalMessageId
  });

  // Call your YouTube download function
  const result = await downloadYoutubeSong(videoId, chatId, originalMessageId, { bot, Youtube, channelId });

  // For now, send the YouTube link
/*  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  await bot.sendMessage(chatId, `🔗 YouTube Link: ${youtubeUrl}\n\n⏳ YouTube download coming soon!`, {
    reply_to_message_id: originalMessageId
  }); */
  if (!result.success) {
    console.error(`❌ Saavn download failed for ${songId}: ${result.error}`);
  }
  await bot.deleteMessage(chatId, downloadingMsg.message_id).catch(() => {});
  searchCache.delete(chatId);
  searchMessageMap.delete(chatId);
  return;
  
}

module.exports = { youtubeQueryhandler };


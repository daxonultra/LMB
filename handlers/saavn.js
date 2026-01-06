const { searchSaavnUrl } = require('../services/search');
const { downloadSaavnSong } = require('../services/saavndown');

async function saavnUrlhandler(msg, { bot, Saavan, channelId } ) {
  const chatId = msg.chat.id;

  // Extract the video id from the link https://www.jiosaavn.com/song/sahiba/Bzc5ei0BZHg
    const saavnUrl = msg.text;
  

    const existvid = await Saavan.findOne({ saavnUrl });

    if (existvid) {
      bot.copyMessage(chatId, channelId, existvid.messageId, {
        caption: `🎵 ${existvid.title}\n👤 ${existvid.artist}\n\nSupport @LuneMusic_Bot`,
        reply_to_message_id: msg.message_id
      });
    } else {

      const downloadingMsg = await bot.sendMessage(chatId, '⏳ Downloading from Saavn... Please wait!', {
        reply_to_message_id: msg.message_id
      });

      const response = await searchSaavnUrl(saavnUrl);
      const songId = response.songId;
      console.log(songId);

      // Call your YouTube download function
      const result = await downloadSaavnSong(songId, chatId, msg.message_id, { bot, Saavan, channelId });

      if (!result.success) {
        console.error(`❌ Song download failed for ${songId}: ${result.error}`);
      }

      await bot.deleteMessage(chatId, downloadingMsg.message_id).catch(() => {});
      return;
    }

}

async function saavnQueryhandler(query, chatId, messageId, originalMessageId, songId, { bot, Saavan, channelId, searchCache, searchMessageMap } ) {


  if (!songId || songId === 'undefined') {
    return bot.answerCallbackQuery(query.id, { text: '❌ Invalid song ID!' });
  }

  // Check if already exists in DB
  const existingSong = await Saavan.findOne({ songId: songId });

  if (existingSong) {
    await bot.copyMessage(chatId, channelId, existingSong.messageId, {
      caption: `🎵 ${existingSong.title}\n👤 ${existingSong.artist}\n\nSupport @LuneMusic_Bot`,
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

  const downloadingMsg = await bot.sendMessage(chatId, '⏳ Downloading song... Please wait!', {
    reply_to_message_id: originalMessageId
  });

  const result = await downloadSaavnSong(songId, chatId, originalMessageId, {
    bot,
    Saavan,
    channelId
  });

  await bot.deleteMessage(chatId, downloadingMsg.message_id).catch(() => {});
  searchCache.delete(chatId);
  searchMessageMap.delete(chatId);

  if (!result.success) {
    console.error(`❌ Saavn download failed for ${songId}: ${result.error}`);
  }
  return;
  
}

module.exports = { saavnUrlhandler, saavnQueryhandler };

const fetch = require('node-fetch');
const { getData } = require('spotify-url-info')(fetch);
const { downloadSpotifySong } = require('../services/spotifydown');
const { downloadSaavnSong } = require('../services/saavndown');

// Get Spotify Track Details
async function spotifyUrlhandler(msg, spotifyUrl, trackId, { bot, Saavan, Spotify, channelId }) {

  const chatId = msg.chat.id;

  const existvid = await Spotify.findOne({ songId: trackId });

  if (existvid) {
    bot.copyMessage(chatId, channelId, existvid.messageId, {
      caption: `🎵 ${existvid.title}\n👤 ${existvid.artist}\n\nSupport @LuneMusic_Bot`,
      reply_to_message_id: msg.message_id
    });
    return;
  }
  
  try {
    const data = await getData(spotifyUrl);

  // Log full data to see structure
    console.log('\n===== SPOTIFY TRACK DETAILS =====');
    console.log('Name:', data.name);
    console.log('Artist:', data.artists?.[0]?.name || data.artist);
    console.log('Duration:', data.duration, 'ms');
    console.log('Type:', data.type);
    //console.log('Image:', data.image[0]?.url || data.image);

    // Full data dekho
    console.log('\n===== FULL DATA =====');
    //console.log(JSON.stringify(data, null, 2));
    

   // const details = await getSongByTitle(data.name);

  
      // 1. Search API
      const title = data.name;
      const searchUrl = `https://saavn.sumit.co/api/search/songs?query=${encodeURIComponent(title)}`;
      const searchRes = await fetch(searchUrl);
      const searchData = await searchRes.json();

      if (!searchData.success || !searchData.data.results.length) {
        throw new Error("No search results found");
      }

      // 2. Find exact title match (case-insensitive)
      const exactSong = searchData.data.results.find(
        song => song.name.toLowerCase() === title.toLowerCase() && song.artists.primary[0].name.toLowerCase() === data.artists[0].name.toLowerCase());

      if (!exactSong) {
       
        const downloadingMsg = await bot.sendMessage(chatId, '⏳ Downloading from Spotify... Please wait!', {
          reply_to_message_id: msg.message_id
        });

        // Call your YouTube download function
        const result = await downloadSpotifySong(trackId, chatId, msg.message_id, { bot, Spotify, channelId });

        if (!result.success) {
          console.error(`❌ Song download failed for ${trackId}: ${result.error}`);
        }

        await bot.deleteMessage(chatId, downloadingMsg.message_id).catch(() => {});

return;
      }

      const songId = exactSong.id;
      const existsong = await Saavan.findOne({ songId });

      if (existsong) {
        bot.copyMessage(chatId, channelId, existsong.messageId, {
          caption: `🎵 ${existsong.title}\n👤 ${existsong.artist}\n\nSupport @LuneMusic_Bot`,
          reply_to_message_id: msg.message_id
        });
      } else {
        const downloadingMsg = await bot.sendMessage(chatId, '⏳ Downloading from Spotify... Please wait!', {
          reply_to_message_id: msg.message_id
        });

        // Call your YouTube download function
        const result = await downloadSaavnSong(songId, chatId, msg.message_id, { bot, Saavan, channelId });

        if (!result.success) {
          console.error(`❌ Song download failed for ${songId}: ${result.error}`);
        }

        await bot.deleteMessage(chatId, downloadingMsg.message_id).catch(() => {});
        
      }

      return;

    
    //console.log(details);
    //return data;
  } catch (error) {
    console.log('Error in Handler:', error.message);
  }
}

async function getSongByTitle(title) {
  try {
    // 1. Search API
    const searchUrl = `https://saavn.sumit.co/api/search/songs?query=${encodeURIComponent(title)}`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();

    if (!searchData.success || !searchData.data.results.length) {
      throw new Error("No search results found");
    }

    // 2. Find exact title match (case-insensitive)
    const exactSong = searchData.data.results.find(
      song => song.name.toLowerCase() === title.toLowerCase()
    );

    if (!exactSong) {

      console.log('https://spotdown.org/api/direct-download?url=https://open.spotify.com/track/0U1TeVxM67Qig7YBdiAosz');
      throw new Error("Exact song title not found");

    }

    const songId = exactSong.id;
    const existsong = await Saavan.findOne({ songId });

    if (existsong) {
      bot.copyMessage(chatId, channelId, existsong.messageId, {
        caption: `🎵 ${existsong.title}\n👤 ${existsong.artist}\n\nSupport @LuneMusic_Bot`,
        reply_to_message_id: msg.message_id
      });
    } else {
      bot.sendMessage(chatId, ``, {
        reply_to_message_id: msg.message_id
      })
    }

    return;

  } catch (error) {
    return {
      error: true,
      message: error.message
    };
  }
}



// ============ USE IT ============

// const link = 'https://open.spotify.com/track/23p1uP74XiVYCXjPP23Kz7?si=9a5ea0170d984057';

module.exports = { spotifyUrlhandler }

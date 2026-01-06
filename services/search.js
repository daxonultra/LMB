const SAAVN_API_BASE = 'https://saavn.sumit.co';

async function searchSaavnUrl(saavnUrl) {
      try {
        const response = await fetch(
          `https://saavn.sumit.co/api/songs?link=${encodeURIComponent(saavnUrl)}`
        );
        const data = await response.json();
          return {
            songId: data.data[0]?.id
          };
      } catch (error) {
        console.error('Error searching Saavn:', error);
        return [];
      }
}

async function searchSaavn(query) {
  try {
    const response = await fetch(
      `${SAAVN_API_BASE}/api/search/songs?query=${encodeURIComponent(query)}&page=0&limit=5`
    );
    const data = await response.json();

    if (!data?.data?.results) {
      return [];
    }

    // Map results to extract only required fields
    const simplifiedResults = data.data.results.map((song) => {
      // Get primary artists names joined by comma
      const artists = song.artists?.primary
        ?.map((artist) => artist.name)
        .join(', ') || 'Unknown Artist';

      // Get highest quality image (500x500) or fallback to first available
      const imageUrl = song.image?.find((img) => img.quality === '500x500')?.url 
        || song.image?.[0]?.url 
        || '';

      return {
        songId: song.id,
        title: song.name,
        artist: artists,
        duration: song.duration, // in seconds
        saavnUrl: song.url,
        imageUrl: imageUrl
      };
    });

    return simplifiedResults;
  } catch (error) {
    console.error('Error searching Saavn:', error);
    return [];
  }
}


const { Innertube } = require('youtubei.js');

// Cache YouTube instance globally
let youtubeInstance = null;
let instancePromise = null;

/**
 * Get or create cached YouTube instance
 * @returns {Promise<Innertube>}
 */
async function getYouTubeInstance() {
    if (youtubeInstance) {
        return youtubeInstance;
    }

    // Prevent multiple simultaneous initializations
    if (!instancePromise) {
        instancePromise = Innertube.create({
            cache: new Map(), // In-memory cache
            generate_session_locally: true // Faster session generation
        });
    }

    youtubeInstance = await instancePromise;
    return youtubeInstance;
}

async function initYouTube() {
  await getYouTubeInstance();
  console.log('YouTube instance ready!');
}

(async () => {
await initYouTube();
})();
/**
 * Fast YouTube/YouTube Music Search
 * @param {string} query - Search query
 * @param {object} options - { type: 'youtube'|'music', limit: number }
 * @returns {Promise<Array>} Results array
 */
async function searchYouTube(query, options = {}) {
    const { type = 'youtube', limit = 10 } = options;

    try {
        // Use cached instance - MUCH FASTER!
        const youtube = await getYouTubeInstance();

        if (type === 'music') {
            const searchResults = await youtube.music.search(query, { type: 'song' });
            const songs = searchResults.contents?.[0]?.contents || searchResults.results || [];

            return songs.slice(0, limit).map(item => {
                const song = item.item || item;
                return {
                    videoId: song.id || song.video_id || null,
                    title: song.title?.text || song.title || 'Unknown',
                    channelName: song.artists?.[0]?.name || song.author?.name || 'Unknown',
                    duration: song.duration?.text || song.duration_text || null,
                    imageUrl: song.thumbnail?.contents?.[0]?.url || song.thumbnails?.[0]?.url || null
                };
            }).filter(item => item.videoId);
        }

        // Regular YouTube search
        const searchResults = await youtube.search(query, { type: 'video' });
        const videos = searchResults.results || searchResults.videos || [];

        return videos
            .filter(item => item.type === 'Video' || item.id)
            .slice(0, limit)
            .map(video => ({
                videoId: video.id || null,
                title: video.title?.text || video.title || 'Unknown',
                channelName: video.author?.name || video.channel?.name || 'Unknown',
                duration: video.duration?.text || video.duration_text || null,
                imageUrl: video.thumbnails?.[0]?.url || null
            }))
            .filter(item => item.videoId);

    } catch (error) {
        // Reset instance on error for fresh retry
        youtubeInstance = null;
        instancePromise = null;
        throw new Error(`Search failed: ${error.message}`);
    }
}

/**
 * Get YouTube video details by video ID
 * @param {string} videoId - YouTube video ID
 * @returns {Promise<object>} Video details
 */
/**
 * Get YouTube video details by video ID
 * @param {string} videoId - YouTube video ID
 * @returns {Promise<object>} Video details
 */
async function getVideoDetails(videoId) {
    try {
        const youtube = await getYouTubeInstance();

        // Use getBasicInfo instead of getInfo (more stable, less parsing errors)
        const info = await youtube.getBasicInfo(videoId);

        const basicInfo = info.basic_info;

        // Get duration in seconds
        const durationSeconds = basicInfo.duration || 0;

        // Format duration to MM:SS
        const formatDuration = (seconds) => {
            if (!seconds) return '0:00';
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return `${mins}:${secs.toString().padStart(2, '0')}`;
        };

        // Get best thumbnail
        const thumbnail = basicInfo.thumbnail?.[0]?.url ||
                         `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

        return {
            videoId: videoId,
            title: basicInfo.title || 'Unknown Title',
            artist: basicInfo.author || 'Unknown Artist',
            channelName: basicInfo.channel?.name || basicInfo.author || 'Unknown Channel',
            duration: durationSeconds,
            durationFormatted: formatDuration(durationSeconds),
            thumbnail: thumbnail
        };

    } catch (error) {
        // Reset instance on error
        youtubeInstance = null;
        instancePromise = null;

        console.error(`Failed to get video details for ${videoId}:`, error.message);

        // Return fallback with basic info
        return {
            videoId: videoId,
            title: 'Unknown Title',
            artist: 'Unknown Artist',
            channelName: 'Unknown Channel',
            duration: 0,
            durationFormatted: '0:00',
            thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
        };
    }
}
/**
 * Pre-initialize instance (call on app start)
 */

module.exports = { searchSaavnUrl, searchSaavn, searchYouTube, initYouTube, getVideoDetails };

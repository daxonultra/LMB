        const fs = require('fs');
        const path = require('path');
        const https = require('https');
        const http = require('http');
        const { exec } = require('child_process');
        const util = require('util');
        const { getVideoDetails } = require('./search');
        const axios = require('axios');

        const execPromise = util.promisify(exec);

        const DOWNLOAD_DIR = './downloads';
        const TEMP_DIR = './temp';

        // Create directories if they don't exist
        if (!fs.existsSync(DOWNLOAD_DIR)) {
            fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
        }
        if (!fs.existsSync(TEMP_DIR)) {
            fs.mkdirSync(TEMP_DIR, { recursive: true });
        }

        /**
         * Download YouTube song and save to database
         * @param {string} videoId - YouTube video ID
         * @param {number} chatId - Telegram chat ID
         * @param {number} replyToMessageId - Message ID to reply to
         * @param {object} deps - { bot, Youtube, channelId }
         */
        async function downloadYoutubeSong(videoId, chatId, replyToMessageId, { bot, Youtube, channelId }) {
            console.log(`\n🎵 Processing YouTube Video ID: ${videoId}`);

            // Temp file paths
            const tempAudioPath = path.join(TEMP_DIR, `${videoId}_temp.mp3`);
            const tempThumbnailPath = path.join(TEMP_DIR, `${videoId}_thumb.jpg`);

            try {
                // Step 1: Get video details
                console.log('📋 Getting video info...');
                const videoDetails = await getVideoDetails(videoId);

                const title = videoDetails.title || 'Unknown Title';
                const artist = videoDetails.artist || 'Unknown Artist';
                const duration = videoDetails.duration || 0;
                const thumbnail = videoDetails.thumbnail;

                console.log(`   Title: ${title}`);
                console.log(`   Artist: ${artist}`);
                console.log(`   Duration: ${videoDetails.durationFormatted}`);

                // Step 2: Get MP3 download link from API
                console.log('🔗 Getting download link...');

                const options = {
                    method: "GET",
                    url: "https://youtube-mp36.p.rapidapi.com/dl",
                    params: {
                        id: videoId  // Use actual videoId, not hardcoded!
                    },
                    headers: {
                        "x-rapidapi-key": process.env.RAPIDAPI_KEY || "43db6998cdmsh2ebabcbb7bfe84ep1865b9jsn0406325a9b5c",
                        "x-rapidapi-host": "youtube-mp36.p.rapidapi.com",
                        "accept": "*/*"
                    }
                };

                const response = await axios.request(options);

                if (!response.data || !response.data.link) {
                    throw new Error('Failed to get download link from API');
                }

                const downloadUrl = response.data.link;
                console.log('✅ Got download link');

                // Step 3: Download the audio file
                console.log('⬇️ Downloading audio...');
                await downloadFile(downloadUrl, tempAudioPath);

                if (!fs.existsSync(tempAudioPath)) {
                    throw new Error('Audio download failed');
                }

                console.log('✅ Audio downloaded');

                // Step 4: Download thumbnail
                let thumbnailDownloaded = false;
                if (thumbnail) {
                    console.log('🖼️ Downloading thumbnail...');
                    try {
                        await downloadFile(thumbnail, tempThumbnailPath);
                        thumbnailDownloaded = fs.existsSync(tempThumbnailPath);
                    } catch (err) {
                        console.log('   ⚠️ Thumbnail download failed, continuing without it...');
                    }
                }

                // Step 5: Use FFmpeg to embed metadata and thumbnail
                console.log('🔧 Embedding metadata with FFmpeg...');

                // Clean filename
                const safeTitle = title.replace(/[<>:"/\\|?*]/g, '').trim().substring(0, 100);
                const safeArtist = artist.replace(/[<>:"/\\|?*]/g, '').trim().substring(0, 50);
                const filename = `${safeTitle} - ${safeArtist}.mp3`;
                const filepath = path.join(DOWNLOAD_DIR, filename);

                // Escape special characters for FFmpeg
                const escapedTitle = escapeFFmpegMetadata(title);
                const escapedArtist = escapeFFmpegMetadata(artist);

                let ffmpegCommand;

                if (thumbnailDownloaded) {
                    // With thumbnail embedding
                    ffmpegCommand = `ffmpeg -y -i "${tempAudioPath}" -i "${tempThumbnailPath}" \
                        -map 0:a -map 1:0 \
                        -c:a libmp3lame -b:a 320k \
                        -c:v mjpeg \
                        -id3v2_version 3 \
                        -metadata:s:v title="Album cover" \
                        -metadata:s:v comment="Cover (front)" \
                        -metadata title="${escapedTitle}" \
                        -metadata artist="${escapedArtist}" \
                        -metadata comment="Downloaded from YouTube" \
                        "${filepath}"`;
                } else {
                    // Without thumbnail
                    ffmpegCommand = `ffmpeg -y -i "${tempAudioPath}" \
                        -c:a libmp3lame -b:a 320k \
                        -id3v2_version 3 \
                        -metadata title="${escapedTitle}" \
                        -metadata artist="${escapedArtist}" \
                        -metadata comment="Downloaded from YouTube" \
                        "${filepath}"`;
                }

                await execPromise(ffmpegCommand);

                // Check if file exists
                if (!fs.existsSync(filepath)) {
                    throw new Error('FFmpeg conversion failed - file not created');
                }

                const stats = fs.statSync(filepath);

                // Step 6: Cleanup temp files
                console.log('🧹 Cleaning up temp files...');
                cleanupTempFiles([tempAudioPath, tempThumbnailPath]);

                console.log(`✅ Downloaded: ${filename}`);
                console.log(`📁 Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

                const caption = `🎵 ${title}\n👤 ${artist}\n\nSupport @LuneMusic_Bot`;

                // Step 7: Send to user
                console.log('📤 Sending to user...');
                await bot.sendAudio(
                    chatId,
                    filepath,
                    {
                        caption: caption,
                        title: title,
                        performer: artist,
                        duration: duration,
                        reply_to_message_id: replyToMessageId
                    }
                );

                // Step 8: Send to channel and save to DB
                console.log('📤 Sending to channel...');
                const sent = await bot.sendAudio(
                    channelId,
                    filepath,
                    {
                        caption: caption,
                        title: title,
                        performer: artist,
                        duration: duration
                    }
                );

                console.log(`✅ Sent to channel, message ID: ${sent.message_id}`);

                // Step 9: Save to database
                await Youtube.create({
                    videoId: videoId,
                    title: title,
                    artist: artist,
                    messageId: sent.message_id,
                    duration: duration
                });
                console.log('💾 Saved to database');

                // Step 10: Delete local file
                if (fs.existsSync(filepath)) {
                    fs.unlinkSync(filepath);
                    console.log('🗑️ Deleted local file');
                }

                return {
                    success: true,
                    title: title,
                    artist: artist
                };

            } catch (error) {
                console.error(`❌ Error: ${error.message}`);

                // Cleanup temp files on error
                cleanupTempFiles([tempAudioPath, tempThumbnailPath]);

                // Send error message to user
                await bot.sendMessage(chatId, `❌ Error downloading song: ${error.message}`);

                return {
                    success: false,
                    videoId: videoId,
                    error: error.message
                };
            }
        }

        // Helper function to download file
        function downloadFile(url, filepath) {
            return new Promise((resolve, reject) => {
                const file = fs.createWriteStream(filepath);
                const protocol = url.startsWith('https') ? https : http;

                const request = protocol.get(url, (response) => {
                    // Handle redirects
                    if (response.statusCode === 301 || response.statusCode === 302) {
                        file.close();
                        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
                        downloadFile(response.headers.location, filepath)
                            .then(resolve)
                            .catch(reject);
                        return;
                    }

                    if (response.statusCode !== 200) {
                        file.close();
                        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
                        reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
                        return;
                    }

                    response.pipe(file);

                    file.on('finish', () => {
                        file.close();
                        resolve();
                    });

                    file.on('error', (err) => {
                        file.close();
                        if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
                        reject(err);
                    });

                });

                request.on('error', (err) => {
                    file.close();
                    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
                    reject(err);
                });

                request.setTimeout(60000, () => {  // 60 second timeout for larger files
                    request.destroy();
                    file.close();
                    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
                    reject(new Error('Download timeout'));
                });
            });
        }

        // Escape special characters for FFmpeg metadata
        function escapeFFmpegMetadata(str) {
            if (!str) return '';
            return str
                .replace(/\\/g, '\\\\')
                .replace(/"/g, '\\"')
                .replace(/'/g, "'")
                .replace(/\n/g, ' ')
                .replace(/\r/g, ' ');
        }

        // Cleanup temp files
        function cleanupTempFiles(files) {
            files.forEach(file => {
                try {
                    if (fs.existsSync(file)) {
                        fs.unlinkSync(file);
                    }
                } catch (err) {
                    console.log(`   ⚠️ Could not delete temp file: ${file}`);
                }
            });
        }

        module.exports = { downloadYoutubeSong };

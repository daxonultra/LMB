const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

const API_BASE = 'https://saavn.sumit.co';
const DOWNLOAD_DIR = './downloads';
const TEMP_DIR = './temp';

// Create directories if they don't exist
if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Pass bot, Saavan, channelId as parameters to avoid circular dependency
async function downloadSaavnSong(songId, chatId, replyToMessageId, { bot, Saavan, channelId }) {
    console.log(`\n🎵 Processing Song ID: ${songId}`);

    // Temp file paths
    const tempAudioPath = path.join(TEMP_DIR, `${songId}_temp.mp4`);
    const tempThumbnailPath = path.join(TEMP_DIR, `${songId}_thumb.jpg`);

    try {
        // Step 1: Get song info from Saavn API
        console.log('📋 Getting song info...');
        const response = await fetch(`${API_BASE}/api/songs/${songId}`);
        const data = await response.json();

        if (!data?.success || !data?.data?.[0]) {
            throw new Error('Song not found');
        }

        const song = data.data[0];

        // Extract metadata
        const title = decodeHTMLEntities(song.name) || 'Unknown Song';
        const artists = song.artists?.primary?.map(a => a.name).join(', ') || 'Unknown Artist';
        const album = decodeHTMLEntities(song.album?.name) || 'Unknown Album';
        const duration = song.duration || 0;
        const year = song.year || '';
        const language = song.language || '';
        const label = song.label || '';
        const copyright = song.copyright || '';
        const url = song.url || '';

        // Get thumbnail URL (highest quality - 500x500)
        const thumbnail = song.image?.[2]?.url || song.image?.[1]?.url || song.image?.[0]?.url || null;

        // Get 320kbps download URL (index 4 is 320kbps)
        const downloadUrl = song.downloadUrl?.[4]?.url || 
                           song.downloadUrl?.[3]?.url || 
                           song.downloadUrl?.[2]?.url || 
                           null;

        if (!downloadUrl) {
            throw new Error('No download URL available');
        }

        console.log(`   Title: ${title}`);
        console.log(`   Artist: ${artists}`);
        console.log(`   Album: ${album}`);
        console.log(`   Year: ${year}`);
        console.log(`   Quality: 320kbps`);

        // Clean filename (remove invalid characters)
        const safeTitle = title.replace(/[<>:"/\\|?*]/g, '').trim().substring(0, 100);
        const safeArtist = artists.replace(/[<>:"/\\|?*]/g, '').trim().substring(0, 50);
        const filename = `${safeTitle} - ${safeArtist}.mp3`;
        const filepath = path.join(DOWNLOAD_DIR, filename);

        // Step 2: Download the audio file (temp)
        console.log('⬇️ Downloading audio...');
        await downloadFile(downloadUrl, tempAudioPath);

        if (!fs.existsSync(tempAudioPath)) {
            throw new Error('Audio download failed');
        }

        // Step 3: Download thumbnail
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

        // Step 4: Use FFmpeg to convert and embed metadata
        console.log('🔧 Embedding metadata with FFmpeg...');

        // Escape special characters for FFmpeg metadata
        const escapedTitle = escapeFFmpegMetadata(title);
        const escapedArtist = escapeFFmpegMetadata(artists);
        const escapedAlbum = escapeFFmpegMetadata(album);
        const escapedYear = escapeFFmpegMetadata(year);
        const escapedLabel = escapeFFmpegMetadata(label);
        const escapedCopyright = escapeFFmpegMetadata(copyright);

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
                -metadata album="${escapedAlbum}" \
                -metadata date="${escapedYear}" \
                -metadata genre="${language}" \
                -metadata publisher="${escapedLabel}" \
                -metadata copyright="${escapedCopyright}" \
                -metadata comment="Downloaded from Saavn" \
                "${filepath}"`;
        } else {
            // Without thumbnail
            ffmpegCommand = `ffmpeg -y -i "${tempAudioPath}" \
                -c:a libmp3lame -b:a 320k \
                -id3v2_version 3 \
                -metadata title="${escapedTitle}" \
                -metadata artist="${escapedArtist}" \
                -metadata album="${escapedAlbum}" \
                -metadata date="${escapedYear}" \
                -metadata genre="${language}" \
                -metadata publisher="${escapedLabel}" \
                -metadata copyright="${escapedCopyright}" \
                -metadata comment="Downloaded from Saavn" \
                "${filepath}"`;
        }

        await execPromise(ffmpegCommand);

        // Check if file exists
        if (!fs.existsSync(filepath)) {
            throw new Error('FFmpeg conversion failed - file not created');
        }

        const stats = fs.statSync(filepath);

        // Step 5: Cleanup temp files
        console.log('🧹 Cleaning up temp files...');
        cleanupTempFiles([tempAudioPath, tempThumbnailPath]);

        console.log(`✅ Downloaded: ${filename}`);
        console.log(`📁 Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

        const caption = `🎵 ${title}\n👤 ${artists}\n\nSupport @LuneMusic_Bot`;

        // Send to user
        await bot.sendAudio(
            chatId,
            filepath,
            {
                caption: caption,
                title: title,
                performer: artists,
                duration: duration,
                reply_to_message_id: replyToMessageId
            }
        );

        // Send to channel and save to DB
        const sent = await bot.sendAudio(
            channelId,
            filepath,
            {
                caption: caption,
                title: title,
                performer: artists,
                duration: duration
            }
        );

        console.log(`✅ Sent to Telegram, message ID: ${sent.message_id}`);

        // Save to database
        await Saavan.create({
            songId: songId,
            title: title,
            artist: artists,
            messageId: sent.message_id,
            duration: duration,
            saavnUrl: url
        });
        console.log('💾 Saved to database');

        // Delete local file
        if (fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
            console.log('🗑️ Deleted local file');
        }

        return {
            success: true,
            title: title,
            artist: artists
        };

    } catch (error) {
        console.error(`❌ Error: ${error.message}`);

        // Cleanup temp files on error
        cleanupTempFiles([tempAudioPath, tempThumbnailPath]);

        // Send error message to user
        await bot.sendMessage(chatId, `❌ Error downloading song: ${error.message}`);

        return {
            success: false,
            songId: songId,
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

        request.setTimeout(30000, () => {
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

// Decode HTML entities
function decodeHTMLEntities(text) {
    if (!text) return '';
    const entities = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&#039;': "'",
        '&#39;': "'",
        '&nbsp;': ' '
    };
    return text.replace(/&[#\w]+;/g, (entity) => entities[entity] || entity);
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

module.exports = { downloadSaavnSong };

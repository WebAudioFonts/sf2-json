
// mp3encoder.js
import { spawnSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static');

/**
 * Encode un buffer WAV en MP3 via ffmpeg-static.
 * Zéro encoder delay, zéro frame Xing, aucun strip nécessaire.
 *
 * @param {Buffer} wavBuffer   - WAV complet (header + PCM16)
 * @param {number} bitrate     - ex. 128
 * @param {number} sampleRate  - sampleRate de sortie (ex. 32000)
 * @returns {Buffer}           - MP3 prêt à base64
 */
export default function encodeMP3(wavBuffer, bitrate = 128, sampleRate = 32000) {
    const result = spawnSync(ffmpegPath, [
        '-hide_banner',
        '-loglevel', 'error',
        '-i', 'pipe:0',              // entrée stdin
        '-ar', String(sampleRate),   // resample sortie
        '-ac', '1',                  // mono
		// '-af', 'compand=attacks=0.01:decays=0.1:points=-80/-90|-40/-30|-20/-20:gain=6',
        '-b:a', `${bitrate}k`,       // bitrate
		'-c:a', 'libopus',
        // '-write_xing', '0',          // pas de frame Xing
        '-id3v2_version', '0',       // pas de tag ID3
        '-f', 'ogg',
        'pipe:1',                    // sortie stdout
    ], {
        input: wavBuffer,
        maxBuffer: 64 * 1024 * 1024,
    });

    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`ffmpeg error: ${result.stderr?.toString()}`);
    }

    return result.stdout;
}







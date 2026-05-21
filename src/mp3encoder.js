
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
		// '-af', 'limiter=limit=0.95',
		// '-af', 'apad,atrim=0:3,loudnorm=I=-16:TP=-1.5',
		// '-af', 'compand=attacks=0.01:decays=0.1:points=-80/-90|-40/-30|-20/-20:gain=6',

		// '-af', [
		// 	'alimiter=level_in=1:level_out=1:limit=0.9:attack=5:release=50:level=disabled',
		// 	'apad=pad_dur=0.5',         // pad 500ms pour que alimiter finisse proprement
		// 	'silenceremove=stop_periods=-1:stop_duration=0.01:stop_threshold=-60dB', // retire le silence à la fin
		// ].join(','),
		// '-af', 'apad=pad_dur=0.5,afftdn=nr=10:nt=w,loudnorm,equalizer=f=3000:t=q:w=1:g=3,silenceremove=stop_periods=-1:stop_duration=0.01:stop_threshold=-60dB',
        // '-af', 'highpass=f=100,lowpass=f=8000,equalizer=f=3000:t=q:w=1:g=3',
        // highpass=f=80,lowpass=f=12000,equalizer=f=300:t=q:w=1:g=-4,equalizer=f=1500:t=q:w=1:g=2,equalizer=f=5000:t=q:w=1:g=3"
        // '-af', "firequalizer=gain='if(lt(f,200),-3,if(lt(f,3000),2,0))':gain_entry='entry(0,-5);entry(200,-3);entry(1000,0);entry(3000,2);entry(8000,0);entry(20000,-10)'",
        // '-af', "adeclick,highpass=f=40,firequalizer=gain='if(lt(f,100),-2,if(lt(f,400),-3,if(lt(f,3000),2,if(lt(f,8000),1,-5))))':gain_entry='entry(0,-10);entry(100,0);entry(400,-2);entry(3000,2);entry(8000,1);entry(20000,-15)'",
        // '-af', "highpass=f=100,lowpass=f=8000,firequalizer=gain='if(gt(f,400),0,-2)'",
        '-af', "highpass=f=100,lowpass=f=8000,firequalizer=gain='if(lt(f,100),-2,if(lt(f,400),-3,if(lt(f,3000),2,if(lt(f,8000),1,-5))))':gain_entry='entry(0,-10);entry(100,0);entry(400,-2);entry(3000,2);entry(8000,1);entry(20000,-15)'",

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







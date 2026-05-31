import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { gunzipSync } from 'zlib';
import path from 'path';
import {
	parse,
	SoundFont,
	createInstrumentGeneratorObject,
	createPresetGeneratorObject,
	convertToInstrumentGeneratorParams,
	DefaultInstrumentZone,
} from '@marmooo/soundfont-parser';


const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static');

const MAX_NORMALIZE_FACTOR = 1.0;
const RESAMPLE_RATE = 48000;
const OPUS_KBPS = 96;
const FFMPEG_THREADS = 32;

const GM_CATEGORIES = [
	'Piano', 'Chromatic Perc', 'Organ', 'Guitar',
	'Bass', 'Strings', 'Ensemble', 'Brass',
	'Reed', 'Pipe', 'Synth Lead', 'Synth Pad',
	'Synth Effects', 'Ethnic', 'Percussive', 'Sound Effects',
];

const GM_INSTRUMENTS = [
	'Acoustic Grand Piano', 'Bright Acoustic Piano', 'Electric Grand Piano', 'Honky-tonk Piano',
	'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
	'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone',
	'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
	'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ',
	'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
	'Acoustic Guitar (nylon)', 'Acoustic Guitar (steel)', 'Electric Guitar (jazz)', 'Electric Guitar (clean)',
	'Electric Guitar (muted)', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
	'Acoustic Bass', 'Electric Bass (finger)', 'Electric Bass (pick)', 'Fretless Bass',
	'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
	'Violin', 'Viola', 'Cello', 'Contrabass',
	'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
	'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2',
	'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit',
	'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet',
	'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
	'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax',
	'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
	'Piccolo', 'Flute', 'Recorder', 'Pan Flute',
	'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
	'Lead 1 (square)', 'Lead 2 (sawtooth)', 'Lead 3 (calliope)', 'Lead 4 (chiff)',
	'Lead 5 (charang)', 'Lead 6 (voice)', 'Lead 7 (fifths)', 'Lead 8 (bass+lead)',
	'Pad 1 (new age)', 'Pad 2 (warm)', 'Pad 3 (polysynth)', 'Pad 4 (choir)',
	'Pad 5 (bowed)', 'Pad 6 (metallic)', 'Pad 7 (halo)', 'Pad 8 (sweep)',
	'FX 1 (rain)', 'FX 2 (soundtrack)', 'FX 3 (crystal)', 'FX 4 (atmosphere)',
	'FX 5 (brightness)', 'FX 6 (goblins)', 'FX 7 (echoes)', 'FX 8 (sci-fi)',
	'Sitar', 'Banjo', 'Shamisen', 'Koto',
	'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
	'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock',
	'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
	'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet',
	'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot',
];


function createSemaphore(limit) {
	let running = 0;
	const queue = [];
	function acquire() {
		return new Promise((res) => {
			if (running < limit) { running++; res(); }
			else queue.push(res);
		});
	}
	function release() {
		running--;
		if (queue.length > 0) { running++; queue.shift()(); }
	}
	return { acquire, release };
}

const ffmpegSemaphore = createSemaphore(FFMPEG_THREADS);

async function encodeOpus(wavBuffer, bitrate = 96, sampleRate = 32000) {
	await ffmpegSemaphore.acquire();
	return new Promise((resolve, reject) => {
		const proc = spawn(ffmpegPath, [
			'-hide_banner',
			'-loglevel', 'error',
			'-i', 'pipe:0',
			'-ar', String(sampleRate),
			'-ac', '1',
			'-af', "highpass=f=20,lowpass=f=20000",
			'-b:a', `${bitrate}k`,
			'-c:a', 'libopus',
			'-id3v2_version', '0',
			'-f', 'ogg',
			'pipe:1',
		], { stdio: ['pipe', 'pipe', 'pipe'] });
		const chunks = [];
		const errChunks = [];
		let released = false;
		function release() {
			if (released) return;
			released = true;
			ffmpegSemaphore.release();
		}
		function cleanup(err) {
			proc.stdout.destroy();
			proc.stderr.destroy();
			if (!proc.killed) proc.kill();
			release();
			if (err) reject(err);
		}
		proc.stdout.on('data', (d) => chunks.push(d));
		proc.stderr.on('data', (d) => errChunks.push(d));
		proc.on('error', cleanup);
		proc.stdin.on('error', cleanup);
		proc.on('close', (code) => {
			if (code !== 0) return cleanup(new Error(`ffmpeg error: ${Buffer.concat(errChunks).toString()}`));
			release();
			resolve(Buffer.concat(chunks));
		});
		proc.stdin.write(wavBuffer, (err) => {
			if (err) return cleanup(err);
			proc.stdin.end();
		});
	});
}


function getGMCategory(bank, program) {
	if (bank === 128) return 'Percussion';
	return GM_CATEGORIES[Math.floor(program / 8)] ?? 'Unknown';
}


function getGMInstrumentName(bank, program, fallback) {
	return fallback ?? GM_INSTRUMENTS[program];
}


function readSf2(sf2Path) {
    const raw = readFileSync(sf2Path);
    if (raw[0] === 0x1F && raw[1] === 0x8B) {
        return new Uint8Array(gunzipSync(raw));
    }
    return new Uint8Array(raw);
}


function pcm24ToPcm16(src) {
	const frameCount = Math.floor(src.byteLength / 3);
	const out = Buffer.allocUnsafe(frameCount * 2);
	for (let i = 0; i < frameCount; i++) {
		const off = i * 3;
		let val = src[off] | (src[off + 1] << 8) | (src[off + 2] << 16);
		if (val & 0x800000) val |= 0xFF000000;
		out.writeInt16LE(val >> 8, i * 2);
	}
	return out;
}


function normalizeBuffer(buffer, targetPeak = 0.9) {
    const samples = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 2);
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
        const abs = Math.abs(samples[i]);
        if (abs > peak) peak = abs;
    }
    const targetPeakInt = targetPeak * 32767;
    const factor = peak > targetPeakInt ? (targetPeakInt / peak) : MAX_NORMALIZE_FACTOR;
    if (factor < MAX_NORMALIZE_FACTOR) {
        for (let i = 0; i < samples.length; i++) {
            samples[i] = Math.round(samples[i] * factor);
        }
    }
    return buffer;
}


function buildWavBuffer(audioData) {
	const { type, data, sampleHeader } = audioData;
	const { sampleRate, loopStart, loopEnd } = sampleHeader;

	let pcm16;
	if (type === 'pcm16') pcm16 = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	else if (type === 'pcm24') pcm16 = pcm24ToPcm16(data);
	else throw new Error(`buildWavBuffer: type '${type}' non supporté (SF3 compressé).`);
	pcm16 = normalizeBuffer(pcm16);

	const numChannels = 1;
	const bitsPerSample = 16;
	const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
	const blockAlign = numChannels * (bitsPerSample / 8);
	const dataSize = pcm16.byteLength;
	const header = Buffer.allocUnsafe(44);

	header.write('RIFF', 0);
	header.writeUInt32LE(36 + dataSize, 4);
	header.write('WAVE', 8);
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(numChannels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(byteRate, 28);
	header.writeUInt16LE(blockAlign, 32);
	header.writeUInt16LE(bitsPerSample, 34);
	header.write('data', 36);
	header.writeUInt32LE(dataSize, 40);

	return Buffer.concat([header, pcm16]);
}


function extractZones(soundFont, parsed, presetHeaderIndex) {
	const presetGeneratorsList = soundFont.getPresetGenerators(presetHeaderIndex);
	const zonesMap = new Map();
	let globalPresetGen = null;

	for (const rawGenList of presetGeneratorsList) {
		const presetGen = createPresetGeneratorObject(rawGenList);
		if (presetGen.instrument === undefined) { globalPresetGen = presetGen; continue; }

		const instrId = presetGen.instrument;
		const instrGeneratorsList = soundFont.getInstrumentGenerators(instrId);
		const defaults = convertToInstrumentGeneratorParams(DefaultInstrumentZone);
		let globalInstrGen = null;

		for (const rawInstrGenList of instrGeneratorsList) {
			const instrGen = createInstrumentGeneratorObject(rawInstrGenList);
			if (instrGen.sampleID === undefined) { globalInstrGen = instrGen; continue; }

			const merged = { ...defaults };
			if (globalInstrGen) Object.assign(merged, globalInstrGen);
			Object.assign(merged, instrGen);

			const applyPresetOffsets = (gen) => {
				if (!gen) return;
				for (const [key, val] of Object.entries(gen)) {
					if (['keyRange', 'velRange', 'instrument', 'sampleID'].includes(key)) continue;
					if (key in merged && typeof val === 'number') merged[key] += val;
				}
			};
			applyPresetOffsets(globalPresetGen);
			applyPresetOffsets(presetGen);

			const lo  = merged.keyRange?.lo ?? 0;
			const hi  = merged.keyRange?.hi ?? 127;
			const vlo = merged.velRange?.lo ?? 0;
			const vhi = merged.velRange?.hi ?? 127;
			const zoneKey = `${lo}-${hi}:${vlo}-${vhi}:${merged.sampleID}`;

			const sampleHeader = parsed.sampleHeaders[merged.sampleID];
			if (!sampleHeader || sampleHeader.isEnd) continue;
			if (!zonesMap.has(zoneKey)) {
				zonesMap.set(zoneKey, { generators: merged, sampleHeader, sample: parsed.samples[merged.sampleID] });
			}
		}
	}
	return Array.from(zonesMap.values());
}


async function buildZone(generators, sampleHeader, sample) {
    const { originalPitch, pitchCorrection, loopStart, loopEnd, sampleRate } = sampleHeader;

    const rootKey = (
        generators.overridingRootKey !== undefined &&
        generators.overridingRootKey !== 255 &&
        generators.overridingRootKey > 0
    ) ? generators.overridingRootKey : originalPitch;

	const sampleModes = generators.sampleModes ?? 0;
	const shouldLoop  = (sampleModes & 1) === 1;
	const loopRatio   = RESAMPLE_RATE / sampleRate;
    const coarseTune  = generators.coarseTune ?? 0;
    const fineTune    = (generators.fineTune ?? 0) + (pitchCorrection ?? 0);

    const SF2_DEF_ATTACK  = -12000;
    const SF2_DEF_HOLD    = -12000;
    const SF2_DEF_DECAY   = -12000;
    const SF2_DEF_SUSTAIN = 0;
    const SF2_DEF_RELEASE = -12000;
    const ahdsr =
        (generators.attackVolEnv  ?? SF2_DEF_ATTACK)  !== SF2_DEF_ATTACK  ||
        (generators.holdVolEnv    ?? SF2_DEF_HOLD)    !== SF2_DEF_HOLD    ||
        (generators.decayVolEnv   ?? SF2_DEF_DECAY)   !== SF2_DEF_DECAY   ||
        (generators.sustainVolEnv ?? SF2_DEF_SUSTAIN) !== SF2_DEF_SUSTAIN ||
        (generators.releaseVolEnv ?? SF2_DEF_RELEASE) !== SF2_DEF_RELEASE;

    const wavBuffer = buildWavBuffer(sample);
    const mp3Buffer = await encodeOpus(wavBuffer, OPUS_KBPS, RESAMPLE_RATE);

    return {
        originalPitch: rootKey * 100,
        keyRangeLow:  generators.keyRange?.lo ?? 0,
        keyRangeHigh: generators.keyRange?.hi ?? 127,
        velRangeLow:  generators.velRange?.lo ?? 0,
        velRangeHigh: generators.velRange?.hi ?? 127,
		loopStart:    shouldLoop ? Math.round(loopStart * loopRatio) : 0,
		loopEnd:      shouldLoop ? Math.round(loopEnd   * loopRatio) : 0,
        coarseTune,
        fineTune,
        sampleRate: RESAMPLE_RATE,
        ahdsr,
        file: mp3Buffer.toString('base64'),
    };
}


export default async function sf2tojson(sf2Path, outputDir, options = {}) {
	const { verbose = true, compress = true } = options;
	if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

	const bankName = path.basename(sf2Path).replace(/\.sf2(\.gz)?$/, '');
	const fileData = readSf2(sf2Path);
	const parsed = parse(fileData);
	const soundFont = new SoundFont(parsed);

	let written = 0;
	let skipped = 0;
	const presetHeaders = parsed.presetHeaders.filter((h) => !h.isEnd);
	const series = new Array(130).fill(0);

	for (let i = 0; i < presetHeaders.length; i++) {
		const header = presetHeaders[i];

		if (verbose) process.stdout.write(`[${i + 1}/${presetHeaders.length}] bank=${header.bank} program=${header.preset} "${header.presetName.trim()}"…\n`);

		const rawZones = extractZones(soundFont, parsed, i);
		if (rawZones.length === 0) {
			if (verbose) process.stdout.write('  ⚠ aucune zone, preset ignoré\n');
			skipped++;
			continue;
		}

		const zones = await Promise.all(
			rawZones.map(({ generators, sampleHeader, sample }) =>
				buildZone(generators, sampleHeader, sample)
			)
		);

		const bank = header.bank;
		const isDrum = bank === 128;
		const isSFX = bank >= 120 && bank < 128;
		let program;
		if (isDrum) program = 128;
		else if (isSFX) program = bank;
		else program = header.preset;
		const presetId = String(program).padStart(3, '0') + String(series[program]);
		const id = `${presetId}_${bankName}`;

		const output = {
			id,
			presetId,
			bank: bankName,
			category: getGMCategory(bank, program),
			instrument: getGMInstrumentName(bank, program, header.presetName.trim()),
			serie: series[program]++,
			program: isDrum ? -1 : program+1,
			zones,
		};

		const filename = `${id}.json`;
		writeFileSync(path.join(outputDir, filename), JSON.stringify(output));
		if (verbose) process.stdout.write(`  ✓ ${filename} (${zones.length} zone(s))\n`);
		written++;
	}

	return { written, skipped };
}
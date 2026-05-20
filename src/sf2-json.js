import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
// import { Lame } from 'node-lame';
import encodeMP3 from './mp3encoder.js';
import path from 'path';
import {
	parse,
	SoundFont,
	createInstrumentGeneratorObject,
	createPresetGeneratorObject,
	convertToInstrumentGeneratorParams,
	DefaultInstrumentZone,
} from '@marmooo/soundfont-parser';

// ─── Tables General MIDI ─────────────────────────────────────────────────────

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

function getGMCategory(bank, program) {
	if (bank === 128) return 'Percussion';
	return GM_CATEGORIES[Math.floor(program / 8)] ?? 'Unknown';
}

function getGMInstrumentName(bank, program, fallback) {
	if (bank === 128) return fallback;
	return GM_INSTRUMENTS[program] ?? fallback;
}


function stripMp3Ms(mp3Buffer, ms) {
    const SAMPLES_PER_FRAME = 1152;

    // Lire le sampleRate directement à pos=0 (pas de recherche de sync)
    const b2 = mp3Buffer[2];
    const srIdx = (b2 >> 2) & 0x3;
    const sampleRate = [44100, 48000, 32000, 0][srIdx];

    const samplesToSkip = Math.ceil((ms / 1000) * sampleRate);
    const framesToSkip  = Math.ceil(samplesToSkip / SAMPLES_PER_FRAME);

    let pos = 0;
    let skipped = 0;

    while (pos < mp3Buffer.length && skipped < framesToSkip) {
        const size = getMp3FrameSize(mp3Buffer, pos);
        if (size <= 0) break;
        pos += size;
        skipped++;
    }

    return mp3Buffer.slice(pos);
}


/**
 * Retire la première frame MP3 (header Xing/INFO de LAME).
 * Cherche le deuxième sync word 0xFF 0xEx pour trouver le début
 * de la première vraie frame audio.
 *
 * @param {Buffer} mp3Buffer
 * @returns {Buffer}
 */
function stripLameHeader(mp3Buffer) {
    let pos = 0;

    // Sauter le tag ID3 s'il est présent
    if (mp3Buffer[0] === 0x49 && mp3Buffer[1] === 0x44 && mp3Buffer[2] === 0x33) {
        const id3Size = 10 + ((mp3Buffer[6] << 21) | (mp3Buffer[7] << 14) | (mp3Buffer[8] << 7) | mp3Buffer[9]);
        pos = id3Size;
    }

    // Sauter la frame Xing/Info
    if (mp3Buffer[pos] === 0xFF && (mp3Buffer[pos + 1] & 0xE0) === 0xE0) {
        const frameSize = getMp3FrameSize(mp3Buffer, pos);
        if (frameSize > 0) pos += frameSize;
    }

    return mp3Buffer.slice(pos);
}

/**
 * Calcule la taille en octets d'une frame MP3 à partir de son header.
 * Retourne 0 si le header est invalide.
 */
function getMp3FrameSize(buf, offset) {
  if (buf[offset] !== 0xFF || (buf[offset + 1] & 0xE0) !== 0xE0) return 0;

  const b1 = buf[offset + 1];
  const b2 = buf[offset + 2];

  // Version MPEG : 00=2.5, 10=2, 11=1
  const versionBits = (b1 >> 3) & 0x3;
  const layer       = (b1 >> 1) & 0x3;  // 01=III, 10=II, 11=I
  const bitrateIdx  = (b2 >> 4) & 0xF;
  const sampleIdx   = (b2 >> 2) & 0x3;
  const padding     = (b2 >> 1) & 0x1;

  // Table des bitrates (kbps) — Layer III, MPEG1 / MPEG2
  const bitratesV1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const bitratesV2 = [0,  8, 16, 24, 32, 40, 48, 56,  64,  80,  96, 112, 128, 144, 160, 0];

  const isV1      = versionBits === 0x3;
  const bitrate   = (isV1 ? bitratesV1 : bitratesV2)[bitrateIdx] * 1000;
  const sampleRates = isV1
    ? [44100, 48000, 32000]
    : [22050, 24000, 16000];

  const sampleRate = sampleRates[sampleIdx];
  if (!bitrate || !sampleRate) return 0;

  // Layer III : frameSize = 144 * bitrate / sampleRate + padding
  if (layer === 0x1) {
    return Math.floor(144 * bitrate / sampleRate) + padding;
  }

  return 0;
}





// ─── WAV header builder ───────────────────────────────────────────────────────
//
// sample.data (AudioData) contient du PCM BRUT — pas de header.
// Layout selon le type :
//   'pcm16'      → Int16 little-endian,  2 octets/sample
//   'pcm24'      → Int24 little-endian,  3 octets/sample  (converti en pcm16 ci-dessous)
//   'compressed' → OGG/Vorbis brut (SF3) — ne passe pas par ce chemin
//
// node-lame attend un fichier WAV complet (header RIFF/WAVE + chunk fmt  + chunk data).

/**
 * Convertit des données PCM24 (3 octets/sample, LE) en PCM16 (2 octets/sample, LE).
 * On supprime l'octet de poids faible (troncature, pas arrondi — suffisant pour l'audio).
 *
 * @param {Uint8Array} src
 * @returns {Buffer}
 */
function pcm24ToPcm16(src) {
	const frameCount = Math.floor(src.byteLength / 3);
	const out        = Buffer.allocUnsafe(frameCount * 2);
	for (let i = 0; i < frameCount; i++) {
		const off = i * 3;
		// Reconstruction du sample signé 24 bits
		let val = src[off] | (src[off + 1] << 8) | (src[off + 2] << 16);
		if (val & 0x800000) val |= 0xFF000000; // extension de signe
		out.writeInt16LE(val >> 8, i * 2);     // réduction à 16 bits
	}
	return out;
}

/**
 * Construit un Buffer WAV (PCM16 mono) prêt à passer à node-lame.
 *
 * @param {import('@marmooo/soundfont-parser').AudioData} audioData
 * @returns {Buffer} WAV complet (header 44 octets + PCM16)
 */
function buildWavBuffer(audioData) {
	const { type, data, sampleHeader } = audioData;
	const { sampleRate, loopStart, loopEnd } = sampleHeader;

	// PCM data normalisée en Buffer 16 bits
	let pcm16;
	if (type === 'pcm16') {
		// Uint8Array → Buffer sans copie supplémentaire
		pcm16 = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	} else if (type === 'pcm24') {
		pcm16 = pcm24ToPcm16(data);
	} else {
		// 'compressed' (SF3/OGG) : impossible de construire un WAV PCM directement.
		// node-lame ne peut pas encoder ce type — utilise un autre encodeur OGG→MP3 si besoin.
		throw new Error(`buildWavBuffer: type '${type}' non supporté (SF3 compressé).`);
	}


    // // Garantir un minimum de 4 frames MP3 après strip (3 retirées + 1 utile)
    // // 4 frames × 1152 samples × (sampleRate/RESAMPLE_RATE) × 2 bytes
    // const minSamples = Math.ceil(4 * 1152 * sampleRate / RESAMPLE_RATE);
    // const minBytes   = minSamples * 2;
    // if (pcm16.byteLength < minBytes) {
    //     const pad = Buffer.alloc(minBytes - pcm16.byteLength);
    //     pcm16 = Buffer.concat([pcm16, pad]);
    // }



    // Si la boucle est trop courte pour survivre au MP3 (< 2 frames),
    // on étire le PCM en répétant la section loop jusqu'à avoir assez de contenu
    const loopLen = loopEnd - loopStart;
    const MIN_LOOP_SAMPLES = Math.ceil(2 * 1152 * sampleRate / RESAMPLE_RATE);

    if (loopLen > 0 && loopLen < MIN_LOOP_SAMPLES) {
        const preLoop  = pcm16.slice(0, loopStart * 2);
        const loopData = pcm16.slice(loopStart * 2, loopEnd * 2);
        const postLoop = pcm16.slice(loopEnd * 2);

        // Répéter le loop assez de fois pour atteindre MIN_LOOP_SAMPLES
        const repeats = Math.ceil(MIN_LOOP_SAMPLES / loopLen);
        const loopRepeated = Buffer.concat(Array(repeats).fill(loopData));

        pcm16 = Buffer.concat([preLoop, loopRepeated, postLoop]);
    }

    // Padding minimum pour LAME (inchangé)
    const minSamples = Math.ceil(4 * 1152 * sampleRate / RESAMPLE_RATE);
    const minBytes   = minSamples * 2;
    if (pcm16.byteLength < minBytes) {
        const pad = Buffer.alloc(minBytes - pcm16.byteLength);
        pcm16 = Buffer.concat([pcm16, pad]);
    }





	const numChannels   = 1;
	const bitsPerSample = 16;
	const byteRate      = sampleRate * numChannels * (bitsPerSample / 8);
	const blockAlign    = numChannels * (bitsPerSample / 8);
	const dataSize      = pcm16.byteLength;

	const header = Buffer.allocUnsafe(44);

	header.write('RIFF', 0);
	header.writeUInt32LE(36 + dataSize, 4);
	header.write('WAVE', 8);
	header.write('fmt ', 12);
	header.writeUInt32LE(16, 16);            // taille chunk fmt  (toujours 16 pour PCM)
	header.writeUInt16LE(1, 20);             // audioFormat = PCM
	header.writeUInt16LE(numChannels, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(byteRate, 28);
	header.writeUInt16LE(blockAlign, 32);
	header.writeUInt16LE(bitsPerSample, 34);
	header.write('data', 36);
	header.writeUInt32LE(dataSize, 40);

	return Buffer.concat([header, pcm16]);
}

// ─── Extraction des zones ─────────────────────────────────────────────────────

function extractZones(soundFont, parsed, presetHeaderIndex) {
	const presetGeneratorsList = soundFont.getPresetGenerators(presetHeaderIndex);
	const zones        = [];
	const seenSampleIds = new Set();
	let globalPresetGen = null;

	for (const rawGenList of presetGeneratorsList) {
		const presetGen = createPresetGeneratorObject(rawGenList);

		if (presetGen.instrument === undefined) {
			globalPresetGen = presetGen;
			continue;
		}

		const instrId = presetGen.instrument;
		const instrGeneratorsList = soundFont.getInstrumentGenerators(instrId);
		const defaults = convertToInstrumentGeneratorParams(DefaultInstrumentZone);
		let globalInstrGen = null;

		for (const rawInstrGenList of instrGeneratorsList) {
			const instrGen = createInstrumentGeneratorObject(rawInstrGenList);

			if (instrGen.sampleID === undefined) {
				globalInstrGen = instrGen;
				continue;
			}

			const merged = { ...defaults };
			if (globalInstrGen) Object.assign(merged, globalInstrGen);
			Object.assign(merged, instrGen);

			const applyPresetOffsets = (gen) => {
				if (!gen) return;
				for (const [key, val] of Object.entries(gen)) {
					if (key === 'keyRange' || key === 'velRange' || key === 'instrument') continue;
					if (key in merged && typeof val === 'number') merged[key] += val;
				}
			};
			applyPresetOffsets(globalPresetGen);
			applyPresetOffsets(presetGen);

			const sampleId = merged.sampleID;
			if (seenSampleIds.has(sampleId)) continue;
			const sampleHeader = parsed.sampleHeaders[sampleId];
			if (!sampleHeader || sampleHeader.isEnd) continue;

			seenSampleIds.add(sampleId);
			zones.push({ generators: merged, sampleHeader, sample: parsed.samples[sampleId] });
		}
	}

	return zones;
}

// ─── Construction d'une zone JSON ────────────────────────────────────────────

const RESAMPLE_RATE = 24000; // pour LAME uniquement

async function buildZone(generators, sampleHeader, sample) {
	// console.log(sampleHeader);
    const { sampleRate, originalPitch, pitchCorrection, loopStart, loopEnd, start } = sampleHeader;
    const fineTune = (generators.fineTune ?? 0) + (pitchCorrection ?? 0);

	const hasAttack  = typeof generators.attackVolEnv !== 'undefined';
    const hasDecay   = typeof generators.decayVolEnv !== 'undefined';
    const hasSustain = typeof generators.sustainVolEnv !== 'undefined';
    const hasRelease = typeof generators.releaseVolEnv !== 'undefined';

    // On considère qu'il y a un AHDSR si au moins un des paramètres est défini
    const ahdsr = hasAttack || hasDecay || hasSustain || hasRelease;


	// const wavBuffer = buildWavBuffer(sample);

	const wavBuffer  = buildWavBuffer(sample);


	const mp3Buffer  = encodeMP3(wavBuffer, 96, RESAMPLE_RATE, true);
	
	
	const audioBase64 = mp3Buffer.toString('base64');


	const midi = (generators.overridingRootKey !== undefined && 
              generators.overridingRootKey !== 255 &&
              generators.overridingRootKey >= 0)        // ← guard contre -1
    ? generators.overridingRootKey
    : originalPitch;

    return {
        originalPitch: midi * 100,
        keyRangeLow:   generators.keyRange?.lo ?? 0,
        keyRangeHigh:  generators.keyRange?.hi ?? 127,
        loopStart,
        loopEnd,
        coarseTune:    generators.coarseTune ?? 0,
        fineTune,
        sampleRate,    // ← sampleRate ORIGINAL du SF2, pas RESAMPLE_RATE
        ahdsr:         ahdsr,
        file:          audioBase64,
    };


// 	const encoder = new Lame({
// 		output: "buffer",
// 		bitrate: 128,
// 		resample: 32,
// 		// sfreq: 32000,
// 		nores: true,
// 	});
// 	// const buf = Buffer.from(sample.data.buffer, sample.data.byteOffset, sample.data.byteLength);

// 	// const audioFileBuffer = readFileSync(path.join(process.cwd(), 'src/ball-paddle.wav'));
// 	encoder.setBuffer(wavBuffer);


// await encoder.encode();
// const raw = encoder.getBuffer();









// const trimmed = stripLameHeader(raw);
// const clean = stripMp3Ms(trimmed, 50);
// const audioBase64 = trimmed.toString('base64');

	// writeFileSync('./raw.mp3', raw);

	// const noXing = stripLameHeader(raw);
	// writeFileSync('./noxing.mp3', noXing);

	// const stripped = stripMp3Ms(noXing, 528 / 32000 * 1000);
	// writeFileSync('./stripped.mp3', stripped);

// 2. Retirer le délai LAME (50ms) sur le MP3 propre
// const audioBase64 = stripped.toString('base64');
// const audioBase64 = (stripped.length < 576 ? noXing : stripped).toString('base64');


// const audioBase64 = stripMp3Ms(encoder.getBuffer(), 50).toString('base64');

	// await encoder.encode();
	// const audioBytes = encoder.getBuffer();
	// const audioBase64 = Buffer.from(stripLameDelay(stripLameHeader(audioBytes), sampleRate)).toString('base64');


	// const audioBytes  = encodeMP3(wavBuffer, sampleRate);
	// console.log(typeof audioBytes);
	// // const audioBase64 = Buffer.from(audioBytes).toString('base64');
	// const audioBase64 = btoa(audioBytes);
	
    // const wavBuffer = buildWavBuffer(sample);
    // const encoder = new Lame({ output: 'buffer', bitrate: 128, resample: RESAMPLE_RATE / 1000 });
    // encoder.setBuffer(wavBuffer);
    // await encoder.encode();
    // const audioBase64 = stripLameHeader(encoder.getBuffer()).toString('base64');
	// const audioBase64 = buildWavBuffer(sample).toString('base64');

    // loopStart/loopEnd relatifs au sample, en samples du sampleRate ORIGINAL
    // const relLoopStart = loopStart - start;
    // const relLoopEnd   = loopEnd   - start;


// const midi =  generators.overridingRootKey !== 255 && generators.overridingRootKey !== undefined
//     ? generators.overridingRootKey
//     : originalPitch;
// // const _originalPitch: midi * 100,


// const midi = (generators.overridingRootKey !== undefined && 
//               generators.overridingRootKey !== 255 &&
//               generators.overridingRootKey >= 0)        // ← guard contre -1
//     ? generators.overridingRootKey
//     : originalPitch;

// const ratio = RESAMPLE_RATE / sampleRate;


// const loopLen = loopEnd - loopStart;
// const MIN_LOOP_SAMPLES = Math.ceil(2 * 1152 * sampleRate / RESAMPLE_RATE);

// const effectiveLoopEnd = (loopLen > 0 && loopLen < MIN_LOOP_SAMPLES)
//     ? loopStart + Math.ceil(MIN_LOOP_SAMPLES / loopLen) * loopLen
//     : loopEnd;



// return {
//     originalPitch: midi * 100,
//     keyRangeLow:   generators.keyRange?.lo ?? 0,
//     keyRangeHigh:  generators.keyRange?.hi ?? 127,
//     loopStart:     Math.round(loopStart * ratio),
//     loopEnd:       Math.round(loopEnd   * ratio),
//     coarseTune:    generators.coarseTune ?? 0,
//     fineTune,
//     sampleRate,                  // ← sampleRate ORIGINAL, pas RESAMPLE_RATE
//     ahdsr:         true,
//     file:          audioBase64,
// };


//     return {
//         originalPitch: midi * 100,
//         keyRangeLow:   generators.keyRange?.lo ?? 0,
//         keyRangeHigh:  generators.keyRange?.hi ?? 127,
//         loopStart,
//         loopEnd,
//         coarseTune:    generators.coarseTune ?? 0,
//         fineTune,
//         sampleRate,    // ← sampleRate ORIGINAL du SF2, pas RESAMPLE_RATE
//         ahdsr:         true,
//         file:          audioBase64,
//     };


// const ratio = RESAMPLE_RATE / sampleRate;
// // const relLoopStart = loopStart - start;
// // const relLoopEnd   = loopEnd   - start;
// const relLoopStart = loopStart;
// const relLoopEnd   = loopEnd;

// return {
//     originalPitch: midi * 100,
//     keyRangeLow:   generators.keyRange?.lo ?? 0,
//     keyRangeHigh:  generators.keyRange?.hi ?? 127,
//     loopStart:     Math.round(relLoopStart * ratio),
//     loopEnd:       Math.round(relLoopEnd   * ratio),
//     coarseTune:    generators.coarseTune ?? 0,
//     fineTune,
//     sampleRate:    RESAMPLE_RATE,   // ← le MP3 est à RESAMPLE_RATE
//     ahdsr:         true,
//     file:          audioBase64,
// };


}


// async function buildZone(generators, sampleHeader, sample) {
// 	const { sampleRate, originalPitch, pitchCorrection, loopStart, loopEnd } = sampleHeader;
// 	const fineTune = (generators.fineTune ?? 0) + (pitchCorrection ?? 0);

// 	// ── Encodage MP3 ────────────────────────────────────────────────────────
// 	// sample.data = PCM BRUT (Int16 LE pour pcm16, Int24 LE pour pcm24).
// 	// node-lame exige un buffer WAV complet → on construit le header ici.
// 	const wavBuffer = buildWavBuffer(sample);

// 	const encoder = new Lame({ output: 'buffer', bitrate: 128, resample: 32 });
// 	encoder.setBuffer(wavBuffer);
// 	await encoder.encode();

// 	// const audioBase64 = encoder.getBuffer().toString('base64');

// 	await encoder.encode();
// 	const audioBase64 = stripLameHeader(encoder.getBuffer()).toString('base64');

// 	return {
// 		originalPitch: originalPitch * 100,
// 		keyRangeLow:   generators.keyRange?.lo ?? 0,
// 		keyRangeHigh:  generators.keyRange?.hi ?? 127,
// 		loopStart,
// 		loopEnd,
// 		coarseTune:    generators.coarseTune ?? 0,
// 		fineTune,
// 		sampleRate: 32000,
// 		ahdsr: true,
// 		file: audioBase64,
// 	};
// }

// ─── Export principal ─────────────────────────────────────────────────────────

export default async function sf2tojson(sf2Path, outputDir, options = {}) {
	const { verbose = true } = options;

	if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

	const bankName   = path.basename(sf2Path, '.sf2');
	const fileData   = readFileSync(sf2Path);
	const parsed     = parse(new Uint8Array(fileData));
	const soundFont  = new SoundFont(parsed);

	let written = 0;
	let skipped = 0;
	const presetHeaders = parsed.presetHeaders.filter((h) => !h.isEnd);

	// Compteur de série par programme (pour différencier plusieurs presets du même program)
	const series = new Array(129).fill(0);

	for (let i = 0; i < presetHeaders.length; i++) {
		const header = presetHeaders[i];

		if (verbose) {
			process.stdout.write(
				`[${i + 1}/${presetHeaders.length}] bank=${header.bank} program=${header.preset} "${header.presetName}"…\n`
			);
		}

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

		const bank    = header.bank;
		const program = bank === 128 || bank === 120 ? 128 : header.preset;
		const presetId = String(program).padStart(3, '0') + String(series[program]);
		const id      = `${presetId}_${bankName}`;

		console.log(bank);
		continue;

		const output = {
			id,
			presetId,
			bank: bankName,
			category:   getGMCategory(bank, program),
			instrument: getGMInstrumentName(bank, program, header.presetName),
			serie:      series[program]++,
			program:    program === 128 ? -1 : program+1,
			zones,
		};

		const filename = `${id}.json`;
		writeFileSync(path.join(outputDir, filename), JSON.stringify(output));
		if (verbose) process.stdout.write(`  ✓ ${filename} (${zones.length} zone(s))\n`);
		written++;
	}

	return { written, skipped };
}
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { Lame } from 'node-lame';
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





/**
 * Retire la première frame MP3 (header Xing/INFO de LAME).
 * Cherche le deuxième sync word 0xFF 0xEx pour trouver le début
 * de la première vraie frame audio.
 *
 * @param {Buffer} mp3Buffer
 * @returns {Buffer}
 */
function stripLameHeader(mp3Buffer) {
  // Cherche le premier sync word (toujours à 0 pour LAME)
  // puis le deuxième — c'est là que commence l'audio réel
  let pos = 0;

  // Sauter le premier sync word
  if (mp3Buffer[pos] === 0xFF && (mp3Buffer[pos + 1] & 0xE0) === 0xE0) {
    // Lire la taille de cette frame pour sauter directement dessus
    const frameSize = getMp3FrameSize(mp3Buffer, pos);
    if (frameSize > 0) pos += frameSize;
  }

  // pos pointe maintenant sur le deuxième sync word = première frame audio
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
	const { sampleRate } = sampleHeader;

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

const RESAMPLE_RATE = 32000; // pour LAME uniquement

async function buildZone(generators, sampleHeader, sample) {
	// console.log(sampleHeader);
    const { sampleRate, originalPitch, pitchCorrection, loopStart, loopEnd, start } = sampleHeader;
    const fineTune = (generators.fineTune ?? 0) + (pitchCorrection ?? 0);



	
    const wavBuffer = buildWavBuffer(sample);
    const encoder = new Lame({ output: 'buffer', bitrate: 128, resample: RESAMPLE_RATE / 1000 });
    encoder.setBuffer(wavBuffer);
    await encoder.encode();
    const audioBase64 = stripLameHeader(encoder.getBuffer()).toString('base64');

    // loopStart/loopEnd relatifs au sample, en samples du sampleRate ORIGINAL
    const relLoopStart = loopStart - start;
    const relLoopEnd   = loopEnd   - start;

    return {
        originalPitch: originalPitch * 100,
        keyRangeLow:   generators.keyRange?.lo ?? 0,
        keyRangeHigh:  generators.keyRange?.hi ?? 127,
        loopStart,
        loopEnd,
        coarseTune:    generators.coarseTune ?? 0,
        fineTune,
        sampleRate,    // ← sampleRate ORIGINAL du SF2, pas RESAMPLE_RATE
        ahdsr:         true,
        file:          audioBase64,
    };
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
		const program = bank === 128 ? 128 : header.preset;
		const presetId = String(program).padStart(3, '0') + String(series[program]);
		const id      = `${presetId}_${bankName}`;

		const output = {
			id,
			presetId,
			bank: bankName,
			category:   getGMCategory(bank, program),
			instrument: getGMInstrumentName(bank, program, header.presetName),
			serie:      series[program]++,
			program:    program === 128 ? -1 : program,
			zones,
		};

		const filename = `${id}.json`;
		writeFileSync(path.join(outputDir, filename), JSON.stringify(output));
		if (verbose) process.stdout.write(`  ✓ ${filename} (${zones.length} zone(s))\n`);
		written++;
	}

	return { written, skipped };
}
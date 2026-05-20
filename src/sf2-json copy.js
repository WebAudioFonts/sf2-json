import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
// import encodeMP3 from './mp3encoder.js';
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


process.env.LAME_FORCE_DOWNLOAD = '1';




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

/** Retourne la catégorie GM (bank 0) ou 'Percussion' (bank 128). */
function getGMCategory(bank, program) {
	if (bank === 128) return 'Percussion';
	return GM_CATEGORIES[Math.floor(program / 8)] ?? 'Unknown';
}

/** Retourne le nom GM (bank 0) ou le nom du preset directement. */
function getGMInstrumentName(bank, program, fallback) {
	if (bank === 128) return fallback; // percussion : nom du preset
	return GM_INSTRUMENTS[program] ?? fallback;
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















function extractZones(soundFont, parsed, presetHeaderIndex) {
	const presetGeneratorsList = soundFont.getPresetGenerators(presetHeaderIndex);

	const zones = [];
	const seenSampleIds = new Set(); // déduplique les samples identiques

	// Générateurs globaux du preset (zone sans `instrument`)
	let globalPresetGen = null;

	for (const rawGenList of presetGeneratorsList) {
		const presetGen = createPresetGeneratorObject(rawGenList);

		if (presetGen.instrument === undefined) {
			globalPresetGen = presetGen; // zone globale du preset
			continue;
		}

		const instrId = presetGen.instrument;
		const instrGeneratorsList = soundFont.getInstrumentGenerators(instrId);

		// Valeurs par défaut SF2
		const defaults = convertToInstrumentGeneratorParams(DefaultInstrumentZone);
		let globalInstrGen = null;

		for (const rawInstrGenList of instrGeneratorsList) {
			const instrGen = createInstrumentGeneratorObject(rawInstrGenList);

			if (instrGen.sampleID === undefined) {
				globalInstrGen = instrGen; // zone globale de l'instrument
				continue;
			}

			// Fusion : defaults → global instrument → zone instrument → preset offsets
			const merged = { ...defaults };
			if (globalInstrGen) Object.assign(merged, globalInstrGen);
			Object.assign(merged, instrGen);

			// Les générateurs du preset s'ajoutent (offset) aux valeurs de l'instrument
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

			// Ignore les samples terminateurs ou déjà traités
			if (seenSampleIds.has(sampleId)) continue;
			const sampleHeader = parsed.sampleHeaders[sampleId];
			if (!sampleHeader || sampleHeader.isEnd) continue;

			seenSampleIds.add(sampleId);

			zones.push({
				generators: merged,
				sampleHeader,
				sample: parsed.samples[sampleId],
			});
		}
	}

	return zones;
}



async function buildZone(generators, sampleHeader, sample) {
	// console.log(sampleHeader);
	const { sampleRate, originalPitch, pitchCorrection, loopStart, loopEnd, start } = sampleHeader;

	// Points de boucle relatifs au début du sample
	// const relLoopStart = loopStart - start;
	// const relLoopEnd = loopEnd - start;

	const relLoopStart = loopStart;
	const relLoopEnd = loopEnd;

	// Nombre total de samples PCM (pour le calcul de l'ancre)
	const bytesPerSample = sample.type === 'pcm24' ? 3 : 2;
	const totalSamples = sample.data.byteLength / bytesPerSample;

	// Ancre = position relative du début de boucle dans le sample total
	// const anchor = totalSamples > 0 ? relLoopStart / totalSamples : 0;

	// fineTune = correction de tuning du générateur + correction native du sample
	const fineTune = (generators.fineTune ?? 0) + (pitchCorrection ?? 0);

	// Données audio en base64
	//   const audioBytes  = encodeMP3(sample.data, sampleRate);
	//   console.log(audioBytes);
	//   const audioBase64 = Buffer.from(audioBytes).toString('base64');
	// const audioBase64 = '';

// console.log(sample.data);
	
	// const encoder = new Lame({
	// 	output: "buffer",
	// 	bitrate: 128,
	// });
	// const buf = Buffer.from(sample.data.buffer, sample.data.byteOffset, sample.data.byteLength);

	// writeFileSync(path.join(process.cwd(), 'test.wav'), sample.data);
	// return;

	// encoder.setBuffer(buf);
	

	const encoder = new Lame({
		output: "buffer",
		bitrate: 128,
	});
	const buf = Buffer.from(sample.data.buffer, sample.data.byteOffset, sample.data.byteLength);

	// const audioFileBuffer = readFileSync(path.join(process.cwd(), 'src/ball-paddle.wav'));
	encoder.setBuffer(buf);


	await encoder.encode();
	const audioBytes = encoder.getBuffer();
	const audioBase64 = Buffer.from(audioBytes).toString('base64');


	return {
		// Note racine du sample (le générateur overridingRootKey prime sur originalPitch)
		// midi: generators.overridingRootKey !== 255 && generators.overridingRootKey !== undefined
		// 	? generators.overridingRootKey
		// 	: originalPitch,

		// Pitch original en centièmes de demi-ton (ex. 6700 = MIDI 67)
		originalPitch: originalPitch * 100,

		keyRangeLow: generators.keyRange?.lo ?? 0,
		keyRangeHigh: generators.keyRange?.hi ?? 127,

		loopStart: relLoopStart,
		loopEnd: relLoopEnd,

		coarseTune: generators.coarseTune ?? 0,
		fineTune,
		sampleRate,

		// AHDSR actif si l'enveloppe de volume n'est pas entièrement à zéro
		ahdsr: (generators.attackVolEnv ?? -12000) !== -12000
			|| (generators.holdVolEnv ?? -12000) !== -12000
			|| (generators.decayVolEnv ?? -12000) !== -12000
			|| (generators.sustainVolEnv ?? 1000) !== 1000
			|| (generators.releaseVolEnv ?? -12000) !== -12000
			|| true, // en pratique tous les presets SF2 ont une enveloppe

		file: audioBase64,
		// anchor,
	};
}



export default async function sf2tojson(sf2Path, outputDir, options = {}) {
	const {
		serie = 0,
		defaultChannel = 0,
		bankFilter = null,
		verbose = true,
	} = options;


	if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });


	const bankName = path.basename(sf2Path, '.sf2');
	console.log(bankName);

	const fileData = readFileSync(sf2Path);
	const parsed = parse(new Uint8Array(fileData));
	const soundFont = new SoundFont(parsed);

	let written = 0;
	let skipped = 0;
	const presetHeaders = parsed.presetHeaders.filter((h) => !h.isEnd);

	let series = new Array(129).fill(0);
	// console.log(series);
	// return;

	for (let i = 0; i < presetHeaders.length; i++) {
		const header = presetHeaders[i];

		// if (bankFilter !== null && header.bank !== bankFilter) {
		// 	skipped++;
		// 	continue;
		// }

		// if (verbose) {
		process.stdout.write(
			`[${i + 1}/${presetHeaders.length}] bank=${header.bank} program=${header.preset} "${header.presetName}"…\n`
		);
		// }


		const rawZones = extractZones(soundFont, parsed, i);
		if (rawZones.length === 0) {
			if (verbose) process.stdout.write('  ⚠ aucune zone, preset ignoré\n');
			skipped++;
			continue;
		}


		const zones = await Promise.all(rawZones.map(async ({ generators, sampleHeader, sample }) =>
			await buildZone(generators, sampleHeader, sample)
		));


		
		const bank = header.bank;
		const program = bank == 128 ? 128 : header.preset;
		const presetId = String(program).padStart(3, '0') + String(series[program]);
		const id = `${presetId}_${bankName}`;
		const category = getGMCategory(bank, program);
		const instrument = getGMInstrumentName(bank, program, header.presetName);

		const output = {
			id,
			presetId,
			bank: bankName,
			category,
			instrument,
			serie: series[program]++,
			program: program == 128 ? -1 : program,
			zones,
		};

		// ── Écriture ──────────────────────────────────────────────────────────
		const filename = `${id}.json`;
		writeFileSync(path.join(outputDir, filename), JSON.stringify(output, null, 2));

		if (verbose) process.stdout.write(`  ✓ ${filename} (${zones.length} zone(s))\n`);
		written++;
	}

}




/*
const inputDir = path.resolve('./soundfonts');
const outputDir = path.resolve('./src/presets');


if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });



async function run() {
	const files = fs.readdirSync(inputDir).filter(f => f.toLowerCase().endsWith('.sf2'));

	for (const file of files) {
		const sf2Name = path.basename(file, '.sf2');

		console.log(path.join(inputDir, file));


		const content = fs.readFileSync(path.join(inputDir, file));
		const parsed = parse(content);
		// const soundFont = new SoundFont(parsed);
		console.log(JSON.stringify(parsed));


	}
}
run();

*/

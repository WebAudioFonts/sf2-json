![WebAudioFonts Logo](https://webaudiofonts.com/images/logo.svg)

# sf2-json

Converts SoundFont 2 (`.sf2`) files into JSON presets consumable by the Web Audio API. Each preset is written as a `.json` file where sample data is base64-encoded Opus audio, ready to be decoded by `AudioContext.decodeAudioData()`.

Designed to generate presets for [`webaudiofontplayer`](https://www.npmjs.com/package/webaudiofontplayer) — a sample-based MIDI instrument player built on the Web Audio API.

---

## Installation

```bash
# As a project dependency (programmatic use)
npm install sf2-json

# Or globally for CLI use
npm install -g sf2-json
```

**Runtime dependency:** [`ffmpeg-static`](https://www.npmjs.com/package/ffmpeg-static) is bundled — no separate FFmpeg installation required.

---

## CLI

```bash
sf2tojson <input.sf2> <output_directory>
```

Accepts `.sf2` and gzip-compressed `.sf2.gz` files. The output directory is created automatically if it does not exist.

```bash
# Convert a full General MIDI soundfont
sf2tojson ./GeneralUser.sf2 ./presets/

# Convert a compressed file
sf2tojson ./piano.sf2.gz ./presets/piano/
```

Progress is logged to stdout per preset:

```
[1/134] bank=0 program=0 "Acoustic Grand Piano"…
  ✓ 0000_GeneralUser.json (12 zones)
[2/134] bank=0 program=1 "Bright Acoustic Piano"…
  ✓ 0010_GeneralUser.json (11 zones)
```

---

## Node.js API

```js
import sf2tojson from 'sf2-json';

const { written, skipped } = await sf2tojson(
  './assets/GeneralUser.sf2',
  './presets/',
  { verbose: true }
);

console.log(`${written} presets written, ${skipped} skipped.`);
```

### `sf2tojson(inputPath, outputDir, options?)`

| Parameter    | Type     | Default | Description |
|-------------|----------|---------|-------------|
| `inputPath`  | `string` | —       | Path to the `.sf2` or `.sf2.gz` source file |
| `outputDir`  | `string` | —       | Output directory (created recursively if absent) |
| `options.verbose` | `boolean` | `true` | Log progress per preset to stdout |

Returns a `Promise<{ written: number, skipped: number }>`. A preset is skipped if it contains no zones after parsing.

---

## Output format

Each preset is written as `<presetId>_<bankName>.json`. Example: `0000_GeneralUser.json`.

```json
{
  "id": "0000_GeneralUser",
  "presetId": "0000",
  "bank": "GeneralUser",
  "category": "Piano",
  "instrument": "Acoustic Grand Piano",
  "serie": 0,
  "program": 1,
  "zones": [
    {
      "originalPitch": 6000,
      "keyRangeLow": 0,
      "keyRangeHigh": 47,
      "velRangeLow": 0,
      "velRangeHigh": 127,
      "loopStart": 14402,
      "loopEnd": 17219,
      "coarseTune": 0,
      "fineTune": -3,
      "sampleRate": 48000,
      "ahdsr": true,
      "file": "T2dnUwAC..."
    }
  ]
}
```

### Top-level fields

| Field        | Type     | Description |
|-------------|----------|-------------|
| `id`         | `string` | Unique identifier: `presetId_bankName` |
| `presetId`   | `string` | Zero-padded program number + series index (e.g. `"0000"`, `"0010"`) |
| `bank`       | `string` | Source `.sf2` filename (without extension) |
| `category`   | `string` | GM family (e.g. `"Piano"`, `"Strings"`, `"Percussion"`) |
| `instrument` | `string` | GM instrument name or SF2 preset name if available |
| `serie`      | `number` | Disambiguates multiple presets on the same program number from different SF2 banks |
| `program`    | `number` | GM program number (1-based). `-1` for drum kits (bank 128). |
| `zones`      | `Zone[]` | Array of sample zones (see below) |

### Zone fields

| Field          | Type              | Description |
|---------------|-------------------|-------------|
| `originalPitch` | `number`         | Root pitch of the sample in cents (MIDI note × 100, e.g. `6000` = middle C) |
| `keyRangeLow`   | `number`         | Lowest MIDI note this zone plays (0–127) |
| `keyRangeHigh`  | `number`         | Highest MIDI note this zone plays (0–127) |
| `velRangeLow`   | `number`         | Minimum velocity this zone responds to (0–127) |
| `velRangeHigh`  | `number`         | Maximum velocity this zone responds to (0–127) |
| `loopStart`     | `number`         | Loop start point in samples, resampled to 48 kHz |
| `loopEnd`       | `number`         | Loop end point in samples, resampled to 48 kHz |
| `coarseTune`    | `number`         | Coarse tuning offset in semitones |
| `fineTune`      | `number`         | Fine tuning offset in cents (includes SF2 `pitchCorrection`) |
| `sampleRate`    | `number`         | Always `48000` — all samples are resampled on export |
| `ahdsr`         | `boolean`        | `true` if the zone has non-default AHDSR envelope parameters in the SF2 |
| `file`          | `string`         | Base64-encoded Opus audio in an Ogg container |

---

## Conversion pipeline

For each zone in each preset:

```
SF2 raw sample (PCM16 or PCM24)
        │
        ▼
  PCM24 → PCM16 conversion (if needed)
        │
        ▼
  Peak normalization (target peak: 0.9 / 32767)
        │
        ▼
  WAV container (44-byte header, mono, 16-bit)
        │
        ▼
  FFmpeg: resample → 48 kHz, highpass 20 Hz, lowpass 20 kHz
          encode → Opus @ 96 kbps, mono, Ogg container
        │
        ▼
  base64 → written to `file` field
```

### Constants

| Constant             | Value    | Description |
|---------------------|----------|-------------|
| `RESAMPLE_RATE`      | `48000`  | Output sample rate for all zones |
| `OPUS_KBPS`          | `96`     | Opus encoding bitrate in kbps |
| `MAX_NORMALIZE_FACTOR` | `1.0`  | Normalization is only applied downward (no upward gain) |
| `FFMPEG_THREADS`     | `32`     | Number of concurrent FFMPEG threads
---

## Opus encoding

Samples are encoded with Opus in an Ogg container via `libopus` through FFmpeg. This is the format's primary compression strategy.

- **Bitrate:** 96 kbps per zone — sufficient for monophonic instrument samples with full harmonic content
- **Resampling:** All samples are normalized to 48 kHz regardless of their original rate in the SF2 file. Loop points are adjusted proportionally (`Math.round(loopPoint × (48000 / originalRate))`)
- **Filtering:** A bandpass filter (highpass 20 Hz / lowpass 20 kHz) is applied before encoding to remove DC offset and ultrasonic content that would waste bits
- **Mono only:** SF2 samples are inherently mono — stereo panning is handled at the synthesizer level
- **Container:** Ogg is used rather than bare `.opus` for broad `AudioContext.decodeAudioData()` compatibility across browsers and runtimes

The resulting base64-encoded Ogg/Opus blobs are decoded natively by the Web Audio API on first playback. No JavaScript audio decoder is needed.

---

## Generator merging

SF2 zones are built by merging four generator layers in order:

1. **SF2 default instrument zone** — baseline values from the spec (`DefaultInstrumentZone`)
2. **Global instrument generators** — zone-less generators defined at instrument scope
3. **Per-zone instrument generators** — the zone's own values
4. **Preset generator offsets** — additive offsets from the preset layer (global and per-zone)

This mirrors the SF2 specification's generator precedence rules. The final merged object drives all zone parameters: key/velocity ranges, tuning, loop points, and AHDSR envelope.

Zones are deduplicated by key `keyLo-keyHi:velLo-velHi:sampleID` — if the same combination appears multiple times (due to preset layering), only the first occurrence is kept.

---

## Preset ID scheme

The `presetId` field is formatted as `PPPS` where:
- `PPP` is the zero-padded GM program number (0–127), or `128` for drum kits and the corresponding bank number for SFX banks (120–127)
- `S` is a series index that increments when multiple presets from the same SF2 map to the same program slot

This ensures unique filenames when converting a multi-bank SF2 that contains several variants of the same instrument.

---

## AHDSR envelopes

The `ahdsr` field in the output is `true` when at least one of the SF2 volume envelope generators (`attackVolEnv`, `holdVolEnv`, `decayVolEnv`, `sustainVolEnv`, `releaseVolEnv`) differs from the SF2 default value of `-12000` timecents (≈ 0 seconds) for time stages and `0` (no attenuation) for sustain.

When `ahdsr` is `true`, the consumer (e.g. `webaudiofontplayer`) reads the actual envelope parameters from the zone and schedules them against the Web Audio API's `GainNode`. When `false`, a simple full-sustain envelope is used.

---

## Supported input formats

| Format        | Support |
|--------------|---------|
| `.sf2`        | ✅ Full support — PCM16 and PCM24 sample data |
| `.sf2.gz`     | ✅ Transparently decompressed via Node.js `zlib.gunzipSync` |
| SF3 (compressed samples) | ❌ Not supported — SF3 zones with pre-compressed audio are skipped |

---

## Integration with webaudiofontplayer

Presets generated by `sf2-json` are the native input format for [`webaudiofontplayer`](https://www.npmjs.com/package/webaudiofontplayer):

```js
import WebAudioFontPlayer from 'webaudiofontplayer';
import preset from './presets/0000_GeneralUser.json' assert { type: 'json' };

const audioCtx = new AudioContext();
const player = new WebAudioFontPlayer(preset, audioCtx);

// Play middle C for 2 seconds
player.queueWaveTable(audioCtx.currentTime, 60, 2.0, 0.8);
```

The `zones[].file` base64 string is decoded by `webaudiofontplayer` on first note hit via `AudioContext.decodeAudioData()` and cached on the zone object as `zone.buffer` for subsequent calls.

---

## License

MIT © Maxime Larrivée-Roy
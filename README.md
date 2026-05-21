# sf2-json

`sf2-json` is a utility designed to parse and convert SoundFont (SF2) files into JSON format. It serves as both a library for Node.js applications and a command-line interface (CLI) tool for automated workflows.

## Installation

To integrate the package into your Node.js project:

```bash
npm install sf2-json

```

## Usage

### Node.js Library

The package exposes the `sf2tojson` function for programmatic use.

```javascript
import { sf2tojson } from 'sf2-json';

async function processSoundFont() {
  try {
    const inputPath = 'path/to/instrument.sf2';
    const outputDir = 'path/to/output/directory';
    
    await sf2tojson(inputPath, outputDir);
    console.log('Conversion successfully completed.');
  } catch (error) {
    console.error('An error occurred during conversion:', error);
  }
}

processSoundFont();

```

### Command-Line Interface (CLI)

When installed globally, the package provides the `sf2tojson` command to facilitate terminal-based conversions.

```bash
npm install -g sf2-json
sf2tojson <input_file.sf2> <output_directory>

```

**Example:**

```bash
sf2tojson ./assets/piano.sf2 ./data/json/

```

## Features

* **Dual-Purpose Architecture**: Fully functional as both a Node.js library and a standalone CLI utility.
* **Seamless Integration**: Provides clear access to SF2 data structures in a JSON format compatible with WebAudio and MIDI synthesizers.
* **Type Safety**: Includes TypeScript declaration files (`index.d.ts`) to ensure robust development environments.
* **Extensibility**: Built upon established parsing standards to ensure reliability.

## License

This project is licensed under the MIT License. See the `LICENSE` file for full details.

## Author

Maxime Larrivée-Roy

---

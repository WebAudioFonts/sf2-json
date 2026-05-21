#!/usr/bin/env node

import { sf2tojson } from "../index.js";

const [,, inputPath, outputDir] = process.argv;

if (!inputPath || !outputDir) {
  console.log('Usage: sf2tojson <input.sf2|.gz> <output_directory>');
  process.exit(1);
}

try {
  await sf2tojson(inputPath, outputDir, { verbose: true });
  console.log('Success!.');
} catch (error) {
  console.error('Conversion error :', error);
  process.exit(1);
}
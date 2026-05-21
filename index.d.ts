// index.d.ts

declare module 'sf2-json' {
  /**
   * Converts an SF2 SoundFont file into JSON format.
   * @param inputPath - The file path to the source .sf2 file.
   * @param outputDir - The directory path where the resulting JSON files will be saved.
   * @returns A promise that resolves when the conversion process is complete.
   */
  export function sf2tojson(
    inputPath: string,
    outputDir: string
  ): Promise<void>;

  export default sf2tojson;
}
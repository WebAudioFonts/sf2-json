// index.d.ts

declare module 'sf2-json' {
  export interface Sf2JsonOptions {
    verbose?: boolean;
  }

  export interface Sf2JsonResult {
    written: number;
    skipped: number;
  }

  /**
   * Converts an SF2 SoundFont file into JSON format.
   * @param inputPath - The file path to the source .sf2 or .sf2.gz file.
   * @param outputDir - The directory path where the resulting JSON files will be saved.
   * @param options - Optional conversion settings.
   * @returns A promise that resolves with the number of written and skipped presets.
   */
  export function sf2tojson(
    inputPath: string,
    outputDir: string,
    options?: Sf2JsonOptions
  ): Promise<Sf2JsonResult>;

  export default sf2tojson;
}

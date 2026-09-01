/**
 * Vite's ?raw suffix, used so fixtures can be the real published package.json
 * bytes and be fed to the parser as text, exactly as fetched at runtime.
 */
declare module "*?raw" {
  const content: string;
  export default content;
}

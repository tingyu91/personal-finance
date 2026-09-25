/** A settings or benchmarks file that cannot be used. The message says which file and how to fix it. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Placeholder for SpacetimeDB generated bindings.
 *
 * This project expects generated bindings at `src/module_bindings` via:
 *   `npm run stdb:generate`
 *
 * During early development (or CI) the bindings may not exist yet; this file
 * keeps TypeScript happy. The real generated file will overwrite this.
 */

export class DbConnection {
  static builder(): any {
    const chain: any = {
      withUri: () => chain,
      withDatabaseName: () => chain,
      withLightMode: () => chain,
      onConnectError: () => chain,
      onDisconnect: () => chain,
      build: () => null,
    };
    console.warn('[SpacetimeDB] Using placeholder bindings. Run `npm run stdb:generate` for real-time features.');
    return chain;
  }
}

'use client';

import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection } from '@/src/module_bindings';

const connectionBuilder = DbConnection.builder()
  .withUri(process.env.NEXT_PUBLIC_SPACETIMEDB_URL ?? 'wss://maincloud.spacetimedb.com')
  .withDatabaseName(process.env.NEXT_PUBLIC_SPACETIMEDB_MODULE ?? 'pulse')
  .withLightMode(true)
  .onConnectError((_ctx, err) => {
    console.error('[SpacetimeDB] connection error', err);
  })
  .onDisconnect((_ctx, err) => {
    if (err) console.warn('[SpacetimeDB] disconnected', err);
  });

export default function SpacetimeProvider({ children }: { children: React.ReactNode }) {
  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      {children}
    </SpacetimeDBProvider>
  );
}

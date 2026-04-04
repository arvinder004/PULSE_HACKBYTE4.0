'use client';

import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection } from '@/src/module_bindings';
import { useMemo } from 'react';

export default function SpacetimeProvider({ children }: { children: React.ReactNode }) {
  const connectionBuilder = useMemo(() => {
    const uri = process.env.NEXT_PUBLIC_SPACETIMEDB_URL || 'wss://maincloud.spacetimedb.com';
    const db  = process.env.NEXT_PUBLIC_SPACETIMEDB_MODULE || 'pulse';
    return DbConnection.builder()
      .withUri(uri)
      .withDatabaseName(db)
      .withLightMode(true)
      .onConnectError((_ctx: unknown, err: unknown) => {
        console.error('[SpacetimeDB] connection error', err);
      })
      .onDisconnect((_ctx: unknown, err: unknown) => {
        if (err) console.warn('[SpacetimeDB] disconnected', err);
      });
  }, []);

  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      {children}
    </SpacetimeDBProvider>
  );
}

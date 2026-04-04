'use client';

import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection } from '@/src/module_bindings';
import { useMemo } from 'react';

export default function SpacetimeProvider({ children }: { children: React.ReactNode }) {
  const connectionBuilder = useMemo(() => {
    try {
      const builder = DbConnection.builder()
        .withUri(process.env.NEXT_PUBLIC_SPACETIMEDB_URL ?? 'wss://maincloud.spacetimedb.com')
        .withDatabaseName(process.env.NEXT_PUBLIC_SPACETIMEDB_MODULE ?? 'pulse')
        .withLightMode(true)
        .onConnectError((_ctx: any, err: any) => {
          console.error('[SpacetimeDB] connection error', err);
        })
        .onDisconnect((_ctx: any, err: any) => {
          if (err) console.warn('[SpacetimeDB] disconnected', err);
        });
      return builder;
    } catch (e) {
      console.warn('[SpacetimeDB] bindings not generated; provider disabled');
      return null;
    }
  }, []);

  if (!connectionBuilder) return <>{children}</>;

  return (
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      {children}
    </SpacetimeDBProvider>
  );
}

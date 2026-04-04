"use client";

import SpacetimeProvider from '@/components/SpacetimeProvider';

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <SpacetimeProvider>
      {children}
    </SpacetimeProvider>
  );
}

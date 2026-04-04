'use client';

import { useState, useEffect } from 'react';

const KEY = 'pulse_theme';

export function useTheme(defaultDark = true) {
  const [dark, setDarkState] = useState(defaultDark);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(KEY);
    if (stored !== null) setDarkState(stored === 'dark');
  }, []);

  function setDark(value: boolean) {
    setDarkState(value);
    localStorage.setItem(KEY, value ? 'dark' : 'light');
  }

  return { dark, setDark };
}

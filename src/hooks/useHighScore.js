import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'wordcollapse:highscore:v1';
const LAST_NAME_KEY = 'wordcollapse:lastname:v1';

// Per-difficulty high score persisted to localStorage. Stored as
// { chill, standard, frenzy } where each entry is { name, score } or null.
function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { chill: null, standard: null, frenzy: null };
    const parsed = JSON.parse(raw);
    return {
      chill: parsed.chill ?? null,
      standard: parsed.standard ?? null,
      frenzy: parsed.frenzy ?? null,
    };
  } catch {
    return { chill: null, standard: null, frenzy: null };
  }
}

function writeStorage(value) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // localStorage may be disabled / full; we silently no-op.
  }
}

function readLastName() {
  try {
    return localStorage.getItem(LAST_NAME_KEY) || '';
  } catch {
    return '';
  }
}

function writeLastName(name) {
  try {
    if (name) localStorage.setItem(LAST_NAME_KEY, name);
  } catch {
    // ignore
  }
}

export function useHighScore() {
  const [scores, setScores] = useState(readStorage);
  const [lastName, setLastName] = useState(readLastName);

  // Re-sync when other tabs update.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) setScores(readStorage());
      if (e.key === LAST_NAME_KEY) setLastName(readLastName());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const isHighScore = useCallback(
    (difficulty, score) => {
      if (score <= 0) return false;
      const current = scores[difficulty];
      return !current || score > current.score;
    },
    [scores],
  );

  const submit = useCallback((difficulty, name, score) => {
    setScores((prev) => {
      const current = prev[difficulty];
      if (current && score <= current.score) return prev;
      const next = { ...prev, [difficulty]: { name, score } };
      writeStorage(next);
      return next;
    });
    if (name) {
      writeLastName(name);
      setLastName(name);
    }
  }, []);

  return { scores, isHighScore, submit, lastName };
}

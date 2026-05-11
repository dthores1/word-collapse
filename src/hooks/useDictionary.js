import { useEffect, useState } from 'react';

// Loads two static word files in parallel:
//
//   /enable-word-list.txt  →  `words` (full ENABLE — used for word
//                              acceptance when the player submits a
//                              candidate)
//   /common-words.txt      →  `common` (curated subset of widely-known
//                              3–7 letter English words — used by the
//                              playability scorer so generated boards
//                              correlate better with what a typical
//                              player can actually spot)
//
// Returns { words, common, loading, error }. `loading` is true until
// both fetches resolve. `common` falls back to `words` if the common
// list fails to load (acceptable degradation — rows might lean a bit
// obscure but everything still works).
function parseLines(text) {
  const set = new Set();
  for (const line of text.split('\n')) {
    const w = line.trim();
    if (w) set.add(w);
  }
  return set;
}

export function useDictionary() {
  const [state, setState] = useState({
    words: null,
    common: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/enable-word-list.txt').then((r) => {
        if (!r.ok) throw new Error(`ENABLE fetch failed: ${r.status}`);
        return r.text();
      }),
      fetch('/common-words.txt').then((r) => {
        if (!r.ok) return null; // tolerate failure of optional list
        return r.text();
      }),
    ])
      .then(([enableText, commonText]) => {
        if (cancelled) return;
        const words = parseLines(enableText);
        const common = commonText ? parseLines(commonText) : words;
        setState({ words, common, loading: false, error: null });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({ words: null, common: null, loading: false, error: err });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

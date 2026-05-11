import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LEADERBOARD_LIMIT,
  fetchLeaderboard,
  submitScore,
} from '../lib/leaderboard.js';

// Loads the top-N leaderboard for a given difficulty, exposes a helper to
// decide whether a score qualifies for the board, and submits new scores.
//
// We avoid auto-submitting from this hook so the GameOverScreen can drive
// the user-facing flow (name input + feedback) explicitly.
export function useLeaderboard(difficulty, { enabled = true } = {}) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submittedEntry, setSubmittedEntry] = useState(null);

  // Guards against stale responses when the difficulty changes mid-flight
  // or the component unmounts before a slow cold-start fetch resolves.
  const reqIdRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!difficulty) return;
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchLeaderboard(difficulty, LEADERBOARD_LIMIT);
      if (!mountedRef.current || reqId !== reqIdRef.current) return;
      setEntries(data);
    } catch (e) {
      if (!mountedRef.current || reqId !== reqIdRef.current) return;
      setError(e);
    } finally {
      if (mountedRef.current && reqId === reqIdRef.current) {
        setLoading(false);
      }
    }
  }, [difficulty]);

  // Auto-fetch when difficulty changes (or on initial enable). The
  // GameOverScreen mounts fresh per game-over, which is when we want this.
  useEffect(() => {
    if (!enabled || !difficulty) return;
    setSubmittedEntry(null);
    setSubmitError(null);
    refresh();
  }, [enabled, difficulty, refresh]);

  // qualifies returns true when score deserves a top-N slot:
  //   - score must be positive
  //   - board has fewer than LIMIT entries, OR score beats the current cutoff
  // While the initial fetch is in-flight we return false so we don't show
  // the name prompt prematurely; once data arrives the prompt appears.
  const qualifies = useCallback(
    (score) => {
      if (!score || score <= 0) return false;
      if (loading || error) return false;
      if (entries.length < LEADERBOARD_LIMIT) return true;
      const cutoff = entries[entries.length - 1]?.score ?? 0;
      return score > cutoff;
    },
    [entries, loading, error],
  );

  const submit = useCallback(
    async ({ playerName, score, words, bestWord }) => {
      if (!difficulty) return null;
      setSubmitting(true);
      setSubmitError(null);
      try {
        await submitScore({
          difficulty,
          playerName,
          score,
          words,
          bestWord,
        });
        if (!mountedRef.current) return null;
        const entry = {
          difficulty,
          player_name: playerName,
          score,
          words,
          best_word: bestWord,
        };
        setSubmittedEntry(entry);
        await refresh();
        return entry;
      } catch (e) {
        if (mountedRef.current) setSubmitError(e);
        return null;
      } finally {
        if (mountedRef.current) setSubmitting(false);
      }
    },
    [difficulty, refresh],
  );

  return {
    entries,
    loading,
    error,
    qualifies,
    submit,
    submitting,
    submitError,
    submittedEntry,
    refresh,
  };
}

// Thin client for the WordCollapse leaderboard API.
//
// The Fly machine auto-stops when idle, so the first request after a quiet
// period takes ~1–2s to wake. We use AbortController-based timeouts so a
// dead network doesn't leave the UI spinning forever.

export const LEADERBOARD_API_BASE = 'https://wordcollapse-api.fly.dev';
export const LEADERBOARD_LIMIT = 10;

const COLD_START_TIMEOUT_MS = 8000;

async function request(path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COLD_START_TIMEOUT_MS);
  try {
    const res = await fetch(`${LEADERBOARD_API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });
    if (!res.ok) {
      throw new Error(`API ${res.status} ${res.statusText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLeaderboard(difficulty, limit = LEADERBOARD_LIMIT) {
  const params = new URLSearchParams({ difficulty, limit: String(limit) });
  const data = await request(`/leaderboard?${params.toString()}`);
  // Tolerate either {leaderboard: [...]} or a bare array — the live API
  // returns a list; normalize so callers always work with one.
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.leaderboard)) return data.leaderboard;
  if (Array.isArray(data?.scores)) return data.scores;
  return [];
}

export async function submitScore({
  difficulty,
  playerName,
  score,
  words,
  bestWord,
}) {
  return request('/submit-score', {
    method: 'POST',
    body: JSON.stringify({
      difficulty,
      player_name: playerName,
      score,
      words,
      best_word: bestWord || '',
    }),
  });
}

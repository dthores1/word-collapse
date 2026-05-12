import { useCallback, useState } from 'react';
import { TitleScreen } from './components/TitleScreen.jsx';
import { PlayScreen } from './components/PlayScreen.jsx';
import { GameOverScreen } from './components/GameOverScreen.jsx';
import { useDictionary } from './hooks/useDictionary.js';
import { useGame } from './hooks/useGame.js';
import { useHighScore } from './hooks/useHighScore.js';
import { useLeaderboard } from './hooks/useLeaderboard.js';

export default function App() {
  const { words, common, loading: dictLoading, error: dictError } = useDictionary();
  const game = useGame(words, common);
  const high = useHighScore();
  const [pendingDifficulty, setPendingDifficulty] = useState('standard');
  // While the player is on the title screen the leaderboard fetches for
  // their currently-selected difficulty so we can show the live top-1
  // entry as the displayed high score. On gameover we switch to
  // `game.difficulty` (which is what the round was actually played at).
  // While playing we disable fetching to avoid background noise.
  const displayDifficulty =
    game.phase === 'gameover' ? game.difficulty : pendingDifficulty;
  const leaderboard = useLeaderboard(displayDifficulty, {
    enabled: game.phase !== 'playing',
  });

  const handleStart = () => {
    game.start(pendingDifficulty);
  };

  // Triggered when the player saves a top-10 score. We post to the API,
  // then mirror the entry into local high-score storage so the title
  // screen's per-difficulty best stays in sync.
  const handleSubmit = useCallback(
    async (name) => {
      const result = await leaderboard.submit({
        playerName: name,
        score: game.score,
        words: game.wordsCount,
        bestWord: game.bestWord,
      });
      if (result) high.submit(game.difficulty, name, game.score);
      return result;
    },
    [leaderboard, high, game.difficulty, game.score, game.wordsCount, game.bestWord],
  );

  const isHighScore = high.isHighScore(game.difficulty, game.score);
  // Title-screen high score: prefer the live global #1 from the
  // leaderboard so a fresh browser session sees real data immediately;
  // fall back to the local personal best (set when the player saves to
  // the leaderboard) so something always renders if the network call is
  // still in flight or has failed.
  const topGlobalEntry = leaderboard.entries[0];
  const titleHighScore = topGlobalEntry
    ? { name: topGlobalEntry.player_name, score: topGlobalEntry.score }
    : high.scores[pendingDifficulty];
  const finalHighScore = high.scores[game.difficulty];

  return (
    <>
      {dictError && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-danger-100 border border-danger-300 text-danger-700 px-4 py-2 text-sm shadow">
          Couldn't load the dictionary. Refresh the page to try again.
        </div>
      )}

      {game.phase === 'idle' && (
        <TitleScreen
          difficulty={pendingDifficulty}
          onSelectDifficulty={setPendingDifficulty}
          onStart={handleStart}
          highScore={titleHighScore}
          highScoreLoading={leaderboard.loading}
          dictionaryLoading={dictLoading}
        />
      )}

      {game.phase === 'playing' && (
        <PlayScreen game={game} dictionary={words} />
      )}

      {game.phase === 'gameover' && (
        <GameOverScreen
          difficulty={game.difficulty}
          score={game.score}
          wordsCount={game.wordsCount}
          bestWord={game.bestWord}
          foundWords={game.foundWords}
          highScore={finalHighScore}
          isHighScore={isHighScore}
          onSubmit={handleSubmit}
          onPlayAgain={() => game.start(game.difficulty)}
          onMainMenu={() => {
            setPendingDifficulty(game.difficulty);
            game.reset();
          }}
          leaderboard={leaderboard}
          lastName={high.lastName}
        />
      )}
    </>
  );
}

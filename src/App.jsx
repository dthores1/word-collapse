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
  const leaderboard = useLeaderboard(game.difficulty, {
    enabled: game.phase === 'gameover',
  });
  const [pendingDifficulty, setPendingDifficulty] = useState('standard');

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
  const currentHighScore = high.scores[pendingDifficulty];
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
          highScore={currentHighScore}
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

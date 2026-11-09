import type { PublicRuntimeState } from '@elsewhere/character-interfaces';
import { Icon } from '../Icon';

export function ControlsPanel({
  runtime,
  fullscreen,
  onEnterWorld,
  onToggleFullscreen,
}: {
  runtime?: PublicRuntimeState;
  fullscreen: boolean;
  onEnterWorld?: () => Promise<void>;
  onToggleFullscreen: () => Promise<void>;
}) {
  return (
    <>
      <p className="panel-intro">Take your own walk. Hubert will keep living his.</p>
      <div className="key-guide">
        <span>
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd>
        </span>
        <p>Walk and sidestep</p>
        <span>
          <kbd>←</kbd>
          <kbd>→</kbd>
        </span>
        <p>Turn your view</p>
        <kbd>E</kbd>
        <p>Meet a nearby resident</p>
        <kbd>M</kbd>
        <p>Open the map</p>
        <kbd>Esc</kbd>
        <p>Release mouse / close panel</p>
      </div>
      <p className="muted-copy">
        Drag to look, or capture the mouse while walking. Opening a panel stops your footsteps.
      </p>
      <button
        className="primary-button full-width"
        disabled={!onEnterWorld}
        onClick={() => void onEnterWorld?.()}
      >
        <Icon name="walk" />
        Enter world
      </button>
      <button className="secondary-button full-width" onClick={() => void onToggleFullscreen()}>
        <Icon name="expand" />
        {fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      </button>
      {runtime && (
        <div className="technical-note">
          <p className="eyebrow">This instance</p>
          <p>
            {runtime?.mode === 'ollama'
              ? 'Ollama · local model'
              : runtime?.mode === 'compatible'
                ? 'Connected model'
                : 'Local deterministic simulation'}{' '}
            · {runtime?.simulationRate ?? 3}× world time
          </p>
          <p>
            {runtime?.costKnown === false
              ? 'Provider cost not reported'
              : '$' + (runtime?.costUsd ?? 0).toFixed(2) + ' paid model spend'}
          </p>
        </div>
      )}
    </>
  );
}

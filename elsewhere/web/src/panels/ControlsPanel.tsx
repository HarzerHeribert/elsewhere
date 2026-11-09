import { Button } from '../ui/Button';
import { Icon } from '../Icon';

export function ControlsPanel({
  fullscreen,
  onEnterWorld,
  onToggleFullscreen,
  onResetCamera,
}: {
  fullscreen: boolean;
  onEnterWorld?: () => Promise<void>;
  onToggleFullscreen: () => Promise<void>;
  onResetCamera: () => void;
}) {
  return (
    <>
      <p className="panel-intro">Move through the world independently of its residents.</p>
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
      <Button className="full-width" disabled={!onEnterWorld} onClick={() => void onEnterWorld?.()}>
        <Icon name="walk" />
        Enter world
      </Button>
      <Button variant="secondary" className="full-width" onClick={onResetCamera}>
        <Icon name="compass" />
        Reset view
      </Button>
      <Button variant="secondary" className="full-width" onClick={() => void onToggleFullscreen()}>
        <Icon name="expand" />
        {fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      </Button>
    </>
  );
}

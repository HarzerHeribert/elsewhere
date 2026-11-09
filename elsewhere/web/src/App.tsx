import { Button } from './ui/Button';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { villageScenery } from './scenery';
import { Scene, type CameraMode, type SceneControls } from './Scene';
import { HubertPortrait } from './HubertPortrait';
import { ElsewhereBrand } from './ElsewhereBrand';
import { productCopy } from './productCopy';
import { StatusBadge } from './ui/StatusBadge';
import { useVisitor } from './useVisitor';
import { AccountDialog } from './AccountDialog';
import { WorldDialog } from './WorldDialog';
import { useWorldSnapshot } from './useWorldSnapshot';
import { useAccountSession } from './useAccountSession';
import { useOwnerActions } from './useOwnerActions';
import { requestJson } from './worldApi';
import type { Position } from './types';
import { Icon } from './Icon';
import { formatTime } from './formatTime';
import type { WorldControlAction, WorldControlCommand } from './sceneControls';
import { ResidentsPanel } from './panels/ResidentsPanel';
import { CharacterPanel } from './panels/CharacterPanel';
import { MapPanel, PlacePanel, ObjectPanel } from './panels/ExplorePanels';
import { MessagesPanel } from './panels/MessagesPanel';
import { ActivityPanel } from './panels/ActivityPanel';
import { WishesPanel } from './panels/WishesPanel';
import { ControlsPanel } from './panels/ControlsPanel';

type Panel =
  | 'residents'
  | 'character'
  | 'map'
  | 'place'
  | 'object'
  | 'messages'
  | 'activity'
  | 'wishes'
  | 'controls';
const nav: Array<{ id: Panel; label: string; icon: string }> = [
  { id: 'residents', label: 'Residents', icon: 'people' },
  { id: 'map', label: 'Map', icon: 'map' },
  { id: 'messages', label: 'Messages', icon: 'mail' },
  { id: 'activity', label: 'Activity', icon: 'activity' },
  { id: 'wishes', label: 'Wishes', icon: 'star' },
  { id: 'controls', label: 'Controls', icon: 'game' },
];

const walkingControls: ReadonlyArray<{
  action: WorldControlAction;
  label: string;
  symbol: string;
}> = [
  { action: 'turn-left', label: 'Turn left', symbol: '↶' },
  { action: 'forward', label: 'Walk forward', symbol: '↑' },
  { action: 'turn-right', label: 'Turn right', symbol: '↷' },
  { action: 'left', label: 'Walk left', symbol: '←' },
  { action: 'back', label: 'Walk backward', symbol: '↓' },
  { action: 'right', label: 'Walk right', symbol: '→' },
];

export function App() {
  const { snapshot, connection, refresh } = useWorldSnapshot();
  const accountSession = useAccountSession(),
    account = accountSession.account;
  const admin = useOwnerActions(refresh, accountSession.refresh);
  const { owner, busy, status: controlStatus, setStatus: setControlStatus, decideWish } = admin;
  const canManageCharacter =
    !!account &&
    !!accountSession.capabilities?.managedCharacterIds.includes(snapshot?.character.id ?? 'hubert');
  const canOpenManagement = Boolean(
    account?.isWorldAdmin || canManageCharacter || (import.meta.env.DEV && owner),
  );
  const [cameraMode, setMode] = useState<CameraMode>('overview'),
    [panel, setPanel] = useState<Panel | null>(null);
  const [selected, setSelected] = useState<string | null>(null),
    [placeId, setPlaceId] = useState<string | null>(null),
    [focus, setFocus] = useState<Position | null>(null),
    [resetKey, setResetKey] = useState(0);
  const [feed, setFeed] = useState<'events' | 'memories'>('events'),
    [message, setMessage] = useState(''),
    [messageStatus, setMessageStatus] = useState(''),
    [sending, setSending] = useState(false);
  const [receipts, setReceipts] = useState<Array<{ at: number; text: string }>>([]),
    [notices, setNotices] = useState<Array<{ id: string; title: string; text: string }>>([]);
  const [settings, setSettings] = useState(false),
    [about, setAbout] = useState(false);
  const [fullscreen, setFullscreen] = useState(false),
    [locked, setLocked] = useState(false),
    [discovered, setDiscovered] = useState<string[]>([]);
  const [accountOpen, setAccountOpen] = useState(false);
  useEffect(() => {
    if (accountSession.operatorSignInToken) setAccountOpen(true);
  }, [accountSession.operatorSignInToken]);
  const [controlCommand, setControlCommand] = useState<WorldControlCommand | null>(null);
  const main = useRef<HTMLElement>(null),
    controls = useRef<SceneControls | null>(null);
  const encounter = useRef({ inside: false, lastAt: 0 }),
    seen = useRef<Set<string> | null>(null);
  const visitor = useVisitor(),
    character = snapshot?.character,
    resident = snapshot?.world.residents.find((r) => r.id === character?.id);
  const mode: CameraMode =
    (cameraMode === 'visitor' && (!visitor.visitor || !snapshot)) ||
    (cameraMode === 'hubert' && !resident)
      ? 'overview'
      : cameraMode;
  const scenery = snapshot?.world ?? villageScenery;
  const entity = snapshot?.world.entities?.find((item) => item.id === selected);
  const object = scenery.objects.find((o) => o.id === selected),
    place = scenery.places.find((p) => p.id === placeId);
  const position = visitor.visitor?.position ?? resident?.position;
  const currentPlace = snapshot?.world.places.find(
    (p) =>
      p.id !== 'meadow' &&
      position &&
      position.x >= p.bounds.minX &&
      position.x <= p.bounds.maxX &&
      position.z >= p.bounds.minZ &&
      position.z <= p.bounds.maxZ,
  );
  const near = Boolean(
    visitor.visitor &&
      resident &&
      Math.hypot(
        visitor.visitor.position.x - resident.position.x,
        visitor.visitor.position.z - resident.position.z,
      ) <= 5,
  );
  const inputPaused = Boolean(panel || settings || about || accountOpen);
  const titles: Record<Panel, string> = {
    residents: 'Residents',
    character: character?.name ?? 'Resident',
    map: 'Map',
    place: place?.name ?? 'A place',
    object: entity?.name ?? object?.name ?? 'An object',
    messages: 'Messages',
    activity: 'Activity',
    wishes: 'Wishes',
    controls: 'Controls',
  };
  useEffect(() => {
    if (!snapshot) return;
    const ids = new Set(snapshot.events.map((e) => e.id));
    if (seen.current) {
      const fresh = snapshot.events.filter(
        (e) =>
          !seen.current!.has(e.id) && ['artifact_created', 'feature_installed'].includes(e.type),
      );
      if (fresh.length)
        setNotices((old) =>
          [
            ...fresh.map((e) => ({
              id: e.id,
              title:
                e.type === 'artifact_created'
                  ? 'Something new, made here'
                  : 'Elsewhere has changed',
              text: e.message,
            })),
            ...old,
          ].slice(0, 20),
        );
    }
    seen.current = ids;
  }, [snapshot]);
  useEffect(() => {
    const id = visitor.visitor?.placeId;
    if (id) setDiscovered((old) => (old.includes(id) ? old : [...old, id]));
  }, [visitor.visitor?.placeId]);
  useEffect(() => {
    if (near && !encounter.current.inside && Date.now() - encounter.current.lastAt > 60000) {
      encounter.current.lastAt = Date.now();
      setNotices((old) =>
        [
          {
            id: 'encounter-' + Date.now(),
            title: 'You came across Hubert',
            text: character?.activity ?? 'Spending time in Elsewhere',
          },
          ...old,
        ].slice(0, 20),
      );
    }
    encounter.current.inside = near;
  }, [near, character?.activity]);
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPanel(null);
        setSettings(false);
        setAbout(false);
        setAccountOpen(false);
        return;
      }
      if ((e.target as HTMLElement)?.closest('input,textarea,[contenteditable="true"]')) return;
      if (e.key.toLowerCase() === 'e' && near && !settings && !about && !accountOpen) {
        e.preventDefault();
        openPanel('character');
      }
      if (e.key.toLowerCase() === 'm' && !settings && !about && !accountOpen) {
        e.preventDefault();
        togglePanel('map');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [near, settings, about, panel, accountOpen]);
  function release() {
    controls.current?.releaseMouse();
    visitor.stop();
  }
  function openPanel(p: Panel) {
    release();
    setPanel(p);
  }
  function togglePanel(p: Panel) {
    if (panel === p) setPanel(null);
    else openPanel(p);
  }
  function pickObject(id: string) {
    setSelected(id);
    openPanel('object');
  }
  function pickCharacter(id: string) {
    if (id === character?.id) openPanel('character');
  }
  function focusPlace(p: Position, id: string) {
    release();
    setMode('overview');
    setFocus(p);
    setPlaceId(id);
    setSelected(null);
    setPanel('place');
  }
  async function enterWorld() {
    if (!snapshot) return;
    release();
    if (await visitor.enter()) {
      setPanel(null);
      setMode('visitor');
      setSelected(null);
    }
  }
  async function walkTo(p: Position) {
    if (!snapshot) return;
    if (await visitor.enter()) {
      setPanel(null);
      setMode('visitor');
      visitor.move(p);
    }
  }
  function camera(m: CameraMode) {
    release();
    if (m === 'visitor') void enterWorld();
    else {
      setMode(m);
      setPanel(null);
    }
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await main.current?.requestFullscreen();
    } catch {
      setControlStatus('Fullscreen is unavailable in this browser. The world fills this window.');
    }
  }
  async function sendMessage(e: FormEvent) {
    e.preventDefault();
    if (!message.trim() || sending) return;
    const text = message.trim();
    setSending(true);
    setMessageStatus('');
    try {
      await requestJson('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      setReceipts((old) => [...old, { at: Date.now(), text }].slice(-10));
      setMessage((current) => (current.trim() === text ? '' : current));
      setMessageStatus('Your note is in his mailbox. He’ll read it in his own time.');
    } catch (error) {
      setMessageStatus(error instanceof Error ? error.message : 'Could not deliver your note.');
    } finally {
      setSending(false);
    }
  }
  const day = snapshot
    ? Math.floor((snapshot.runtime.simulatedAt - snapshot.runtime.startedAt) / 86400000) + 1
    : null;

  return (
    <main
      className={'game-shell ' + (panel ? 'panel-open ' : '') + 'mode-' + mode}
      aria-label="Elsewhere game"
      ref={main}
    >
      <div className="game-scene">
        <Scene
          snapshot={snapshot}
          mode={mode}
          selected={selected}
          onSelect={pickObject}
          resetKey={resetKey}
          visitor={visitor.visitor}
          onMove={visitor.move}
          onLook={visitor.look}
          onStop={visitor.stop}
          focus={focus}
          control={controlCommand}
          paused={inputPaused}
          onSelectCharacter={pickCharacter}
          onPointerLockChange={setLocked}
          controlsRef={controls}
        />
      </div>
      <div className="world-vignette" aria-hidden="true" />
      <header className="game-header">
        <button
          className="brand glass"
          aria-label="About Elsewhere"
          onClick={() => {
            release();
            setAbout(true);
          }}
        >
          <ElsewhereBrand />
        </button>
        <div className="world-clock glass">
          <StatusBadge
            className={'connection ' + connection}
            tone={connection === 'live' ? 'live' : 'waiting'}
          >
            {connection === 'live'
              ? snapshot?.runtime.paused
                ? 'Life, paused'
                : 'Life, unfolding'
              : connection === 'offline'
                ? snapshot
                  ? 'Reconnecting'
                  : 'World preview'
                : 'Arriving'}
          </StatusBadge>
          <span className="clock-divider" />
          <span>
            Day {day === null ? '—' : String(day).padStart(2, '0')}
            <small>{snapshot ? formatTime(snapshot.runtime.simulatedAt) : '—:—'}</small>
          </span>
        </div>
        <div className="header-actions">
          <div className="camera-switch glass" role="group" aria-label="Camera perspective">
            <button onClick={() => camera('overview')} aria-pressed={mode === 'overview'}>
              <Icon name="map" />
              <span>Overview</span>
            </button>
            <button
              onClick={() => camera('visitor')}
              aria-pressed={mode === 'visitor'}
              disabled={visitor.busy || !snapshot}
            >
              <Icon name="walk" />
              <span>Walk</span>
            </button>
            <button
              onClick={() => camera('hubert')}
              aria-pressed={mode === 'hubert'}
              disabled={!resident}
            >
              <Icon name="eye" />
              <span>Hubert’s eyes</span>
            </button>
          </div>
          <button
            className="square-button glass"
            aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            onClick={() => void toggleFullscreen()}
            title="Fullscreen"
          >
            <Icon name="expand" />
          </button>
          <button
            className="account-button glass"
            aria-label={account || (import.meta.env.DEV && owner) ? 'Your account' : 'Sign in'}
            onClick={() => {
              release();
              setAccountOpen(true);
            }}
          >
            <Icon name="people" />
            <span>{account ? account.name : 'Sign in'}</span>
          </button>
        </div>
      </header>
      <nav className="world-rail glass" aria-label="World navigation">
        {nav.map((n) => (
          <button
            key={n.id}
            className={
              panel === n.id || (n.id === 'residents' && panel === 'character') ? 'active' : ''
            }
            aria-label={n.label}
            aria-pressed={panel === n.id}
            onClick={() => togglePanel(n.id)}
            title={n.label}
          >
            <Icon name={n.icon} />
            <span className="rail-label">{n.label}</span>
            {n.id === 'wishes' && snapshot?.wishes?.some((w) => w.status === 'pending') && (
              <i className="rail-dot" />
            )}
          </button>
        ))}
        <span className="rail-spacer" />
      </nav>
      {panel && (
        <aside className="world-panel glass" aria-label="World panel" key={panel}>
          <div className="panel-header">
            <div>
              <p className="eyebrow">
                {panel === 'character' ? 'A life in Elsewhere' : 'Elsewhere'}
              </p>
              <h2>{titles[panel]}</h2>
            </div>
            <button
              className="square-button subtle"
              aria-label="Close panel"
              onClick={() => setPanel(null)}
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="panel-scroll">
            {panel === 'residents' && (
              <ResidentsPanel
                residents={snapshot?.world.residents ?? []}
                awaitingLiveState={!snapshot}
                characterActivity={character?.activity}
                visitorCount={snapshot ? (snapshot.world.visitors?.length ?? 0) : undefined}
                onSelect={pickCharacter}
              />
            )}
            {panel === 'character' && character && (
              <CharacterPanel
                character={character}
                recalledMemory={snapshot?.recalledMemory}
                artifacts={snapshot?.artifacts}
                onMessage={() => openPanel('messages')}
                onViewpoint={() => camera('hubert')}
                onMemories={() => {
                  setFeed('memories');
                  openPanel('activity');
                }}
                onWishes={() => openPanel('wishes')}
              />
            )}
            {panel === 'map' && (
              <MapPanel
                snapshot={snapshot}
                visitor={visitor.visitor}
                discovered={discovered}
                onFocusPlace={focusPlace}
                onWalk={walkTo}
                onSelectObject={pickObject}
              />
            )}
            {panel === 'place' && place && (
              <PlacePanel
                place={place}
                objects={scenery.objects}
                discovered={discovered.includes(place.id)}
                onWalk={snapshot ? walkTo : undefined}
                onSelectObject={pickObject}
                onBack={() => openPanel('map')}
              />
            )}
            {panel === 'object' && (
              <ObjectPanel entity={entity} object={object} onBack={() => openPanel('map')} />
            )}

            {panel === 'messages' && (
              <MessagesPanel
                message={message}
                receipts={receipts}
                sending={sending}
                connected={connection === 'live'}
                messageStatus={messageStatus}
                onMessageChange={setMessage}
                onSubmit={sendMessage}
              />
            )}
            {!snapshot && (panel === 'activity' || panel === 'wishes') && (
              <p className="panel-intro">
                Hubert’s live {panel === 'wishes' ? 'wishes' : 'activity and memories'} will appear
                when the world connects.
              </p>
            )}
            {panel === 'activity' && snapshot && (
              <ActivityPanel
                events={snapshot?.events ?? []}
                memories={snapshot?.memories ?? []}
                notices={notices}
                feed={feed}
                onFeedChange={setFeed}
              />
            )}
            {panel === 'wishes' && snapshot && (
              <WishesPanel
                wishes={snapshot?.wishes ?? []}
                canDecide={Boolean(owner || canManageCharacter)}
                busy={busy}
                status={controlStatus}
                onDecide={decideWish}
              />
            )}
            {panel === 'controls' && (
              <ControlsPanel
                fullscreen={fullscreen}
                onEnterWorld={snapshot ? enterWorld : undefined}
                onToggleFullscreen={toggleFullscreen}
              />
            )}
          </div>
        </aside>
      )}
      {!visitor.visitor && !panel && connection === 'live' && (
        <section className="arrival-card glass" aria-label="Welcome to Elsewhere">
          <p className="eyebrow">{productCopy.strapline}</p>
          <h1>{productCopy.headline}</h1>
          <p>{productCopy.invitation}</p>
          <Button onClick={() => void enterWorld()} disabled={visitor.busy}>
            {visitor.busy ? 'Entering…' : 'Enter world'}
            <Icon name="arrow" />
          </Button>
          <small>Explore freely. Sign in when you want to stay connected.</small>
        </section>
      )}
      {mode === 'visitor' &&
        visitor.visitor &&
        !panel &&
        near &&
        !settings &&
        !about &&
        !accountOpen && (
          <section className="encounter-card glass" aria-label="Nearby resident">
            <HubertPortrait />
            <div>
              <span className="eyebrow">You came across</span>
              <h3>{character?.name}</h3>
              <p>{character?.activity}</p>
            </div>
            <button onClick={() => openPanel('character')}>
              <kbd>E</kbd>
              <span>Meet Hubert</span>
              <Icon name="arrow" />
            </button>
          </section>
        )}
      {mode === 'visitor' && (
        <>
          <span className="crosshair" aria-hidden="true" />
          <div className="walk-controls glass" role="group" aria-label="Walking controls">
            {walkingControls.map((c) => (
              <button
                key={c.action}
                aria-label={c.label}
                disabled={inputPaused}
                onClick={() =>
                  setControlCommand((old) => ({ action: c.action, serial: (old?.serial ?? 0) + 1 }))
                }
              >
                {c.symbol}
              </button>
            ))}
            <button className="stop-walking" onClick={visitor.stop}>
              Stop walking
            </button>
          </div>
        </>
      )}
      <div className="world-bottom">
        <div className="location-chip glass">
          <Icon name="compass" />
          <div>
            <strong>{currentPlace?.name ?? 'The meadow paths'}</strong>
            <small>
              {mode === 'overview'
                ? 'Overview · drag to orbit'
                : mode === 'hubert'
                  ? 'Following Hubert’s viewpoint'
                  : 'WASD to walk · drag to look'}
            </small>
          </div>
        </div>
        <div className="bottom-actions">
          {mode === 'visitor' && !inputPaused && (
            <button
              className="mouse-capture glass"
              onClick={() => {
                if (locked) controls.current?.releaseMouse();
                else void controls.current?.captureMouse();
              }}
            >
              {locked ? 'Release mouse · Esc' : 'Capture mouse'}
              <span>↗</span>
            </button>
          )}
          <button
            className="square-button glass"
            aria-label="Reset camera"
            onClick={() => {
              camera('overview');
              setFocus(null);
              setResetKey((n) => n + 1);
            }}
          >
            <Icon name="compass" />
          </button>
        </div>
      </div>
      {connection === 'offline' && (
        <p className="connection-toast glass" role="status">
          {snapshot
            ? 'Reconnecting to Elsewhere. Showing the last known world.'
            : 'Village preview · Waiting for the live world.'}
        </p>
      )}
      {visitor.status && (
        <p className="sr-only" role="status">
          {visitor.status}
        </p>
      )}
      {((settings && canOpenManagement) || about) && (
        <WorldDialog
          kind={settings ? 'owner' : 'about'}
          snapshot={snapshot}
          admin={admin}
          isWorldAdmin={account?.isWorldAdmin ?? false}
          canManageCharacter={canManageCharacter}
          onClose={() => {
            setSettings(false);
            setAbout(false);
          }}
        />
      )}
      {accountOpen && (
        <AccountDialog
          session={accountSession}
          privateLocalAccess={import.meta.env.DEV && Boolean(owner)}
          onOpenManagement={
            canOpenManagement
              ? () => {
                  release();
                  setAccountOpen(false);
                  setSettings(true);
                }
              : undefined
          }
          onClose={() => {
            accountSession.dismissOperatorSignIn();
            setAccountOpen(false);
          }}
        />
      )}
    </main>
  );
}

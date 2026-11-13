import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
} from 'react';
import { villageScenery } from './scenery';
import { Scene, type CameraMode, type SceneControls } from './Scene';
import { HubertPortrait } from './HubertPortrait';
import { ElsewhereBrand } from './ElsewhereBrand';
import { StatusBadge } from './ui/StatusBadge';
import { useMediaQuery } from './useMediaQuery';
import { useVisitor } from './useVisitor';
import { AccountDialog } from './AccountDialog';
import { SettingsScreen, settingsEntries, type SettingsSection } from './SettingsScreen';
import { useWorldSnapshot } from './useWorldSnapshot';
import { useAccountSession } from './useAccountSession';
import { useOwnerActions } from './useOwnerActions';
import { requestJson } from './worldApi';
import type { Position } from './types';
import { Icon } from './Icon';
import { calendarDay, formatDay, formatTime } from './formatTime';
import { wallTime, WallTimeProvider, type WorldClock } from './worldClock';
import type { WorldControlAction, WorldControlCommand } from './sceneControls';
import { ResidentsPanel } from './panels/ResidentsPanel';
import { CharacterPanel, type CharacterTab } from './panels/CharacterPanel';
import { MapPanel, PlacePanel, ObjectPanel, placeCenter } from './panels/ExplorePanels';
import { MessagesPanel, type OwnMessage } from './panels/MessagesPanel';
import { ActivityPanel } from './panels/ActivityPanel';
import { WishesPanel } from './panels/WishesPanel';
import { ControlsPanel } from './panels/ControlsPanel';
import { MorePanel } from './panels/MorePanel';

type Panel =
  | 'residents'
  | 'character'
  | 'map'
  | 'place'
  | 'object'
  | 'messages'
  | 'activity'
  | 'wishes'
  | 'more';
const nav: Array<{ id: Panel; label: string; icon: string }> = [
  { id: 'residents', label: 'Residents', icon: 'people' },
  { id: 'map', label: 'Map', icon: 'map' },
  { id: 'messages', label: 'Messages', icon: 'mail' },
  { id: 'activity', label: 'Activity', icon: 'activity' },
  { id: 'wishes', label: 'Wishes', icon: 'star' },
];
/** A spot inside the panels, with enough to return to it exactly as it was left. */
interface PanelStop {
  panel: Panel;
  label: string;
  tab: CharacterTab;
  placeId: string | null;
  selected: string | null;
  scroll: number;
}
/** Phones keep four destinations in reach; the rest sits behind More. */
const phoneTabs = ['residents', 'map', 'messages'] as const;
const sidebarPreference = 'elsewhere.sidebar';

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
  const privateLocalAccess = import.meta.env.DEV && Boolean(owner);
  const [cameraMode, setMode] = useState<CameraMode>('overview'),
    [panel, setPanel] = useState<Panel | null>(null);
  const [selected, setSelected] = useState<string | null>(null),
    [placeId, setPlaceId] = useState<string | null>(null),
    [focus, setFocus] = useState<Position | null>(null),
    [resetKey, setResetKey] = useState(0);
  const [characterTab, setCharacterTab] = useState<CharacterTab>('now'),
    // Where the visitor came from, so every jump from one panel to another has a way back.
    [trail, setTrail] = useState<PanelStop[]>([]),
    [message, setMessage] = useState(''),
    [messageStatus, setMessageStatus] = useState(''),
    [sending, setSending] = useState(false);
  const [receipts, setReceipts] = useState<Array<{ at: number; text: string }>>([]),
    [replies, setReplies] = useState<OwnMessage[]>([]),
    [notices, setNotices] = useState<Array<{ id: string; title: string; text: string }>>([]);
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  const [fullscreen, setFullscreen] = useState(false),
    [locked, setLocked] = useState(false),
    [discovered, setDiscovered] = useState<string[]>([]);
  const [accountOpen, setAccountOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(sidebarPreference) === 'collapsed';
    } catch {
      return false;
    }
  });
  const [sheetFull, setSheetFull] = useState(false);
  const panelScroll = useRef<HTMLDivElement>(null),
    scrollNext = useRef<number | null>(null),
    scrollBeforeStory = useRef(0),
    panelBeforeSettings = useRef<Panel | null>(null);
  // Going back lands where the visitor was reading, not at the top.
  useLayoutEffect(() => {
    if (scrollNext.current === null || !panelScroll.current) return;
    panelScroll.current.scrollTop = scrollNext.current;
    scrollNext.current = null;
  });
  const phone = useMediaQuery('(max-width: 800px)'),
    narrow = useMediaQuery('(max-width: 1100px)');
  const collapsed = !phone && (sidebarCollapsed || narrow);
  useEffect(() => {
    if (accountSession.operatorSignInToken || accountSession.returnedFromSocial)
      setAccountOpen(true);
  }, [accountSession.operatorSignInToken, accountSession.returnedFromSocial]);
  // Once someone is signed in, their account lives in Settings rather than in the sign-in dialog.
  useEffect(() => {
    if (!accountOpen || !account || accountSession.operatorSignInToken) return;
    setAccountOpen(false);
    setPanel(null);
    setSettings(accountSession.returnedFromSocial ? 'security' : 'account');
  }, [accountOpen, account, accountSession.operatorSignInToken, accountSession.returnedFromSocial]);
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
  const placeAt = (position?: Position) =>
    snapshot?.world.places.find(
      (p) =>
        p.id !== 'meadow' &&
        position &&
        position.x >= p.bounds.minX &&
        position.x <= p.bounds.maxX &&
        position.z >= p.bounds.minZ &&
        position.z <= p.bounds.maxZ,
    );
  const currentPlace = placeAt(visitor.visitor?.position ?? resident?.position);
  const residentPlace = placeAt(resident?.position);
  const near = Boolean(
    visitor.visitor &&
      resident &&
      Math.hypot(
        visitor.visitor.position.x - resident.position.x,
        visitor.visitor.position.z - resident.position.z,
      ) <= 5,
  );
  const activeSection =
    panel === 'character' ? 'residents' : panel === 'place' || panel === 'object' ? 'map' : panel;
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const panelTrigger = useRef<HTMLElement | null>(null);
  const previousPanel = useRef<Panel | null>(null);
  useEffect(() => {
    if (panel) panelHeading.current?.focus({ preventScroll: true });
    else if (previousPanel.current && panelTrigger.current?.isConnected) {
      panelTrigger.current.focus({ preventScroll: true });
    }
    previousPanel.current = panel;
  }, [panel]);
  // Leaving Settings hands the keyboard back to whatever opened it.
  const settingsTrigger = useRef<HTMLElement | null>(null);
  const hadSettings = useRef(false);
  useEffect(() => {
    if (!settings && hadSettings.current && !panel && settingsTrigger.current?.isConnected)
      settingsTrigger.current.focus({ preventScroll: true });
    hadSettings.current = Boolean(settings);
  }, [settings, panel]);
  const inputPaused = Boolean(panel || settings || accountOpen);
  const titles: Record<Panel, string> = {
    residents: 'Residents',
    character: character?.name ?? 'Resident',
    map: 'Map',
    place: place?.name ?? 'A place',
    object: entity?.name ?? object?.name ?? 'An object',
    messages: 'Messages',
    activity: 'Activity',
    wishes: 'Wishes',
    more: 'More',
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
        closeSettings();
        setAccountOpen(false);
        return;
      }
      if ((e.target as HTMLElement)?.closest('input,textarea,[contenteditable="true"]')) return;
      if (e.key.toLowerCase() === 'e' && near && !settings && !accountOpen) {
        e.preventDefault();
        openPanel('character');
      }
      if (e.key.toLowerCase() === 'm' && !settings && !accountOpen) {
        e.preventDefault();
        togglePanel('map');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [near, settings, panel, accountOpen]);
  function release() {
    controls.current?.releaseMouse();
    visitor.stop();
  }
  /**
   * The menus start a fresh visit to a panel. A link inside a panel remembers the panel it was
   * followed from, so the visitor can step back to it.
   */
  function openPanel(p: Panel, via: 'menu' | 'link' = 'menu') {
    if (!panel || !document.getElementById('world-panel')?.contains(document.activeElement)) {
      panelTrigger.current = document.activeElement as HTMLElement;
    }
    release();
    setTrail(
      via === 'link' && panel
        ? [
            ...trail,
            {
              panel,
              label: titles[panel],
              tab: characterTab,
              placeId,
              selected,
              scroll: panelScroll.current?.scrollTop ?? 0,
            },
          ].slice(-8)
        : [],
    );
    scrollNext.current = 0;
    scrollBeforeStory.current = 0;
    setSettings(null);
    setSheetFull(false);
    if (p === 'character' && panel !== 'character') setCharacterTab('now');
    setPanel(p);
  }
  function goBack() {
    const stop = trail.at(-1);
    if (!stop) return;
    release();
    setTrail(trail.slice(0, -1));
    setSettings(null);
    setCharacterTab(stop.tab);
    setPlaceId(stop.placeId);
    setSelected(stop.selected);
    setPanel(stop.panel);
    scrollNext.current = stop.scroll;
  }
  function togglePanel(p: Panel) {
    if (panel === p && !settings) setPanel(null);
    else openPanel(p);
  }
  function openSettings(section: SettingsSection) {
    if (!settings && !document.querySelector('.settings-screen')?.contains(document.activeElement))
      settingsTrigger.current = document.activeElement as HTMLElement;
    release();
    panelTrigger.current = null;
    if (!settings) panelBeforeSettings.current = panel;
    setPanel(null);
    setSettings(section);
  }
  /** Closing Settings can return to the panel it was opened over. */
  function closeSettings(resume = false) {
    if (resume && settings && panelBeforeSettings.current) setPanel(panelBeforeSettings.current);
    panelBeforeSettings.current = null;
    setSettings(null);
    accountSession.dismissSocialReturn();
  }
  function openAccount() {
    release();
    if (accountSession.operatorSignInToken || !(account || privateLocalAccess))
      setAccountOpen(true);
    else openSettings('account');
  }
  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try {
      localStorage.setItem(sidebarPreference, next ? 'collapsed' : 'open');
    } catch {
      // The preference simply lasts for this visit.
    }
  }
  function pickObject(id: string, via: 'menu' | 'link' = 'menu') {
    openPanel('object', via);
    setSelected(id);
  }
  function pickCharacter(id: string, via: 'menu' | 'link' = 'menu') {
    if (id === character?.id) openPanel('character', via);
  }
  function focusPlace(p: Position, id: string, via: 'menu' | 'link' = 'menu') {
    release();
    setMode('overview');
    setFocus(p);
    openPanel('place', via);
    setPlaceId(id);
    setSelected(null);
  }
  /** A place named inside another panel opens that place, with a way back. */
  function openPlace(id: string) {
    const target = scenery.places.find((p) => p.id === id);
    if (target) focusPlace(placeCenter(target), id, 'link');
  }
  function showPlace(id: string) {
    const target = snapshot?.world.places.find((p) => p.id === id);
    if (!target) return;
    release();
    setMode('overview');
    setFocus(placeCenter(target));
    setSheetFull(false);
  }
  async function enterWorld() {
    if (!snapshot) return;
    release();
    if (await visitor.enter()) {
      panelTrigger.current = null;
      setPanel(null);
      setSettings(null);
      setMode('visitor');
      setSelected(null);
    }
  }
  async function walkTo(p: Position) {
    if (!snapshot) return;
    if (await visitor.enter()) {
      panelTrigger.current = null;
      setPanel(null);
      setMode('visitor');
      visitor.move(p);
    }
  }
  function camera(m: CameraMode) {
    release();
    if (m === 'visitor') void enterWorld();
    else {
      panelTrigger.current = null;
      setMode(m);
      setPanel(null);
      setSettings(null);
    }
  }
  function resetCamera() {
    camera('overview');
    setFocus(null);
    setResetKey((n) => n + 1);
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await main.current?.requestFullscreen();
    } catch {
      setControlStatus('Fullscreen is unavailable in this browser. The world fills this window.');
    }
  }
  // A signed-in visitor's own messages, each with the resident's private answer once given.
  const accountId = account?.id;
  const messagesOpen = panel === 'messages';
  useEffect(() => {
    if (!accountId || !messagesOpen) {
      if (!accountId) setReplies([]);
      return;
    }
    let live = true;
    requestJson<{ messages: OwnMessage[] }>('/api/messages')
      .then((result) => live && setReplies(result.messages))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [accountId, messagesOpen, receipts.length, snapshot?.runtime.simulatedAt]);
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
  // The sheet follows a drag on its handle: up for the full page, down to shrink or dismiss.
  const sheetDrag = useRef<number | null>(null);
  function endSheetDrag(e: PointerEvent<HTMLButtonElement>) {
    const moved = e.clientY - (sheetDrag.current ?? e.clientY);
    sheetDrag.current = null;
    if (moved < -24) setSheetFull(true);
    else if (moved > 24) {
      if (sheetFull) setSheetFull(false);
      else setPanel(null);
    } else setSheetFull((full) => !full);
  }
  // The world keeps its own clock, which stands still while it is paused. Everything shown to
  // a visitor is the real time it happened, in their timezone.
  const clockKey = JSON.stringify({
    clock: snapshot?.runtime.clock,
    simulationRate: snapshot?.runtime.simulationRate,
  });
  const toWall = useMemo(() => {
    const clock = JSON.parse(clockKey) as WorldClock;
    return (at: number) => wallTime(at, clock);
  }, [clockKey]);
  const shownNow = snapshot ? toWall(snapshot.runtime.simulatedAt) : null;
  const dayLabel = shownNow === null ? '—' : formatDay(calendarDay(shownNow));
  const timeLabel = shownNow === null ? '—:—' : formatTime(shownNow);
  const lifeLabel =
    connection === 'live'
      ? snapshot?.runtime.paused
        ? 'Life, paused'
        : 'Life, unfolding'
      : connection === 'offline'
        ? snapshot
          ? 'Reconnecting'
          : 'World preview'
        : 'Arriving';
  const pendingWishes = snapshot?.wishes?.filter((w) => w.status === 'pending').length ?? 0;
  const accountLabel = account || privateLocalAccess ? 'Your account' : 'Sign in';
  const entries = settingsEntries({
    signedIn: !!account,
    privateLocalAccess,
    canManageWorld: canOpenManagement,
  });
  // A section can vanish while it is open (signing out, disconnecting an owner link).
  const settingsSection = settings
    ? entries.some((entry) => entry.id === settings)
      ? settings
      : 'account'
    : null;
  const attention = accountSession.hasCharacterIssue && (
    <span className="attention-mark" role="status" aria-label="Character needs attention">
      !
    </span>
  );
  const railButton = (n: (typeof nav)[number]) => (
    <button
      key={n.id}
      className={activeSection === n.id && !settingsSection ? 'active' : ''}
      aria-label={n.label}
      aria-pressed={activeSection === n.id && !settingsSection}
      aria-expanded={activeSection === n.id && !settingsSection}
      aria-controls={panel ? 'world-panel' : undefined}
      onClick={() => togglePanel(n.id)}
      title={n.label}
    >
      <Icon name={n.icon} />
      <span className="rail-label">{n.label}</span>
      {n.id === 'wishes' && pendingWishes > 0 && (
        <b className="nav-count" aria-label="Pending requests">
          {pendingWishes}
        </b>
      )}
    </button>
  );
  const wide = panel === 'character' || panel === 'activity';
  // One way back from every panel: to the panel a link was followed from, or up to its list.
  const parent: Panel | undefined =
    panel === 'character'
      ? 'residents'
      : panel === 'place' || panel === 'object'
        ? 'map'
        : phone && (panel === 'activity' || panel === 'wishes')
          ? 'more'
          : undefined;
  const back = !panel
    ? null
    : trail.length
      ? { label: trail.at(-1)!.label, go: goBack }
      : parent
        ? { label: titles[parent], go: () => openPanel(parent) }
        : null;

  return (
    <WallTimeProvider value={toWall}>
      <main
        className={
          'game-shell ' +
          (panel ? 'panel-open ' : '') +
          (settingsSection ? 'settings-open ' : '') +
          (collapsed ? 'sidebar-collapsed ' : '') +
          (phone ? 'phone ' : '') +
          'mode-' +
          mode
        }
        aria-label="Elsewhere game"
        ref={main}
      >
        {!phone && (
          <nav className="world-sidebar" aria-label="World navigation">
            <div className="sidebar-top">
              <button
                className="sidebar-brand"
                aria-label="About Elsewhere"
                onClick={() => openSettings('about')}
              >
                <ElsewhereBrand />
              </button>
              {!narrow && (
                <button
                  className="square-button subtle"
                  aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                  onClick={toggleSidebar}
                >
                  <Icon name="sidebar" />
                </button>
              )}
            </div>
            <div className="world-clock" title={lifeLabel + ' · ' + dayLabel + ' ' + timeLabel}>
              <StatusBadge
                className={'connection ' + connection}
                tone={connection === 'live' ? 'live' : 'waiting'}
              >
                {lifeLabel}
              </StatusBadge>
              <span className="world-day">
                {dayLabel}
                <small>{timeLabel}</small>
              </span>
            </div>
            <div className="sidebar-nav">{nav.map(railButton)}</div>
            <div className="sidebar-foot">
              <button
                className={settingsSection ? 'active' : ''}
                aria-label="Settings"
                aria-pressed={!!settingsSection}
                title="Settings"
                onClick={() =>
                  settingsSection
                    ? closeSettings(true)
                    : openSettings(account || privateLocalAccess ? 'account' : 'controls')
                }
              >
                <Icon name="gear" />
                <span className="rail-label">Settings</span>
              </button>
              <button
                className="account-button"
                aria-label={accountLabel}
                title={accountLabel}
                onClick={openAccount}
              >
                <span className="account-avatar">
                  <Icon name="user" />
                </span>
                <span className="rail-label">
                  <strong>{account ? account.name : accountLabel}</strong>
                  <small>
                    {account ? 'Signed in' : privateLocalAccess ? 'Local session' : 'Guest'}
                  </small>
                </span>
                {attention}
              </button>
            </div>
          </nav>
        )}
        {panel && (
          <aside
            id="world-panel"
            className={
              'world-panel' + (wide ? ' wide' : '') + (phone && sheetFull ? ' sheet-full' : '')
            }
            aria-label="World panel"
            key={panel}
          >
            {phone && (
              <button
                className="sheet-handle"
                aria-label={sheetFull ? 'Shrink panel' : 'Expand panel'}
                aria-expanded={sheetFull}
                onPointerDown={(e) => {
                  sheetDrag.current = e.clientY;
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerUp={endSheetDrag}
                onPointerCancel={() => {
                  sheetDrag.current = null;
                }}
                onClick={(e) => {
                  if (e.detail === 0) setSheetFull((full) => !full);
                }}
              >
                <i />
              </button>
            )}
            {back && (
              <button
                className="back-link panel-back"
                aria-label={'Back to ' + back.label}
                onClick={back.go}
              >
                <Icon name="chevron-left" />
                {back.label}
              </button>
            )}
            <div className="panel-header">
              {panel === 'character' && <HubertPortrait />}
              <div>
                <h2 ref={panelHeading} tabIndex={-1}>
                  {titles[panel]}
                </h2>
                {panel === 'character' && character && (
                  <p className="panel-subtitle">
                    {residentPlace && (
                      <>
                        <button className="inline-link" onClick={() => openPlace(residentPlace.id)}>
                          {residentPlace.name}
                        </button>
                        {' · '}
                      </>
                    )}
                    {character.activity}
                  </p>
                )}
              </div>
              <button
                className="square-button subtle"
                aria-label="Close panel"
                onClick={() => setPanel(null)}
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="panel-scroll" ref={panelScroll}>
              {panel === 'residents' && (
                <ResidentsPanel
                  residents={snapshot?.world.residents ?? []}
                  awaitingLiveState={!snapshot}
                  characterActivity={character?.activity}
                  visitorCount={snapshot ? (snapshot.world.visitors?.length ?? 0) : undefined}
                  onSelect={(id) => pickCharacter(id, 'link')}
                />
              )}
              {panel === 'character' && character && (
                <CharacterPanel
                  character={character}
                  tab={characterTab}
                  onTabChange={(tab) => {
                    setCharacterTab(tab);
                  }}
                  mail={snapshot?.mail}
                  accountMail={accountSession.characterMail.find(
                    (mail) => mail.characterId === character.id,
                  )}
                  signedIn={!!account}
                  emailVerified={account?.emailVerified ?? false}
                  mailPending={accountSession.pending}
                  onSignIn={() => setAccountOpen(true)}
                  onMailPreferences={(preferences) =>
                    accountSession.updateMailPreferences(character.id, preferences)
                  }
                  recalledMemory={snapshot?.recalledMemory}
                  artifacts={snapshot?.artifacts}
                  creations={snapshot?.creations}
                  memories={snapshot?.memories}
                  trail={snapshot?.trail}
                  pursuits={snapshot?.pursuits}
                  places={snapshot?.world.places}
                  onShowPlace={showPlace}
                  onMessage={() => openPanel('messages', 'link')}
                  onViewpoint={() => camera('hubert')}
                  onWishes={() => openPanel('wishes', 'link')}
                  onDay={() => openPanel('activity', 'link')}
                />
              )}
              {panel === 'map' && (
                <MapPanel
                  snapshot={snapshot}
                  visitor={visitor.visitor}
                  discovered={discovered}
                  onFocusPlace={(p, id) => focusPlace(p, id, 'link')}
                  onWalk={walkTo}
                  onSelectObject={(id) => pickObject(id, 'link')}
                />
              )}
              {panel === 'place' && place && (
                <PlacePanel
                  place={place}
                  objects={scenery.objects}
                  discovered={discovered.includes(place.id)}
                  onWalk={snapshot ? walkTo : undefined}
                  onSelectObject={(id) => pickObject(id, 'link')}
                  resident={
                    character && residentPlace?.id === place.id ? character.name : undefined
                  }
                  onResident={() => character && pickCharacter(character.id, 'link')}
                />
              )}
              {panel === 'object' && <ObjectPanel entity={entity} object={object} />}

              {panel === 'messages' && (
                <MessagesPanel
                  message={message}
                  receipts={receipts}
                  own={account ? replies : undefined}
                  sending={sending}
                  connected={connection === 'live'}
                  messageStatus={messageStatus}
                  onMessageChange={setMessage}
                  onSubmit={sendMessage}
                />
              )}
              {!snapshot && (panel === 'activity' || panel === 'wishes') && (
                <p className="panel-intro">
                  Hubert’s live {panel === 'wishes' ? 'wishes' : 'activity and memories'} will
                  appear when the world connects.
                </p>
              )}
              {panel === 'activity' && snapshot && (
                <ActivityPanel
                  events={snapshot.events ?? []}
                  memories={snapshot.memories ?? []}
                  trail={snapshot.trail}
                  pursuits={snapshot.pursuits}
                  creations={snapshot.creations}
                  notices={notices}
                  activity={character?.activity}
                  now={snapshot.runtime.simulatedAt}
                  places={snapshot.world.places}
                  onMemories={() => {
                    openPanel('character', 'link');
                    setCharacterTab('memories');
                  }}
                  onPlace={openPlace}
                  onResident={() => openPanel('character', 'link')}
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
              {panel === 'more' && (
                <MorePanel
                  accountName={account?.name ?? (privateLocalAccess ? 'Your account' : undefined)}
                  needsAttention={accountSession.hasCharacterIssue}
                  pendingWishes={pendingWishes}
                  entries={entries}
                  onAccount={openAccount}
                  onActivity={() => openPanel('activity')}
                  onWishes={() => openPanel('wishes')}
                  onSettings={openSettings}
                />
              )}
            </div>
          </aside>
        )}
        <div className="world-stage">
          <div className="game-scene">
            <Scene
              snapshot={snapshot}
              mode={mode}
              selected={selected}
              onSelect={(id) => pickObject(id)}
              resetKey={resetKey}
              visitor={visitor.visitor}
              onMove={visitor.move}
              onLook={visitor.look}
              onStop={visitor.stop}
              focus={focus}
              control={controlCommand}
              paused={inputPaused}
              onSelectCharacter={(id) => pickCharacter(id)}
              onPointerLockChange={setLocked}
              controlsRef={controls}
            />
          </div>
          <div className="world-vignette" aria-hidden="true" />
          {phone && (
            <header className="phone-top">
              <div className="world-clock glass" title={lifeLabel}>
                <StatusBadge
                  className={'connection ' + connection}
                  tone={connection === 'live' ? 'live' : 'waiting'}
                >
                  <span className="sr-only">{lifeLabel}</span>
                </StatusBadge>
                <span className="world-day">
                  {dayLabel}
                  <small>{timeLabel}</small>
                </span>
                <span className="phone-place">{currentPlace?.name ?? 'The meadow paths'}</span>
              </div>
              <button
                className="account-button glass"
                aria-label={accountLabel}
                onClick={openAccount}
              >
                <Icon name="user" />
                {attention}
              </button>
            </header>
          )}
          <div className="view-controls glass">
            <div className="camera-switch" role="group" aria-label="Camera perspective">
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
            <div className="view-tools">
              <button
                className="square-button"
                aria-label="Reset camera"
                title="Reset camera"
                onClick={resetCamera}
              >
                <Icon name="compass" />
              </button>
              <button
                className="square-button"
                aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
                onClick={() => void toggleFullscreen()}
                title="Fullscreen"
              >
                <Icon name="expand" />
              </button>
            </div>
          </div>
          {mode === 'visitor' &&
            visitor.visitor &&
            !panel &&
            near &&
            !settingsSection &&
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
                      setControlCommand((old) => ({
                        action: c.action,
                        serial: (old?.serial ?? 0) + 1,
                      }))
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
            </div>
          </div>
          {connection === 'offline' && (
            <p className="connection-toast glass" role="status">
              {snapshot
                ? 'Reconnecting to Elsewhere. Showing the last known world.'
                : 'Village preview · Waiting for the live world.'}
            </p>
          )}
          {settingsSection && (
            <SettingsScreen
              section={settingsSection}
              entries={entries}
              onSection={setSettings}
              onClose={() => closeSettings(true)}
              onBack={() => {
                closeSettings();
                openPanel('more');
              }}
              session={accountSession}
              snapshot={snapshot}
              admin={admin}
              canManageCharacter={canManageCharacter}
              privateLocalAccess={privateLocalAccess}
              onSignIn={() => setAccountOpen(true)}
              onCreationsChanged={async () => {
                await refresh();
              }}
              controls={
                <ControlsPanel
                  fullscreen={fullscreen}
                  onEnterWorld={snapshot ? enterWorld : undefined}
                  onToggleFullscreen={toggleFullscreen}
                  onResetCamera={resetCamera}
                />
              }
            />
          )}
        </div>
        {phone && (
          <nav className="world-tabbar" aria-label="World navigation">
            <button
              className={!panel && !settingsSection ? 'active' : ''}
              aria-label="World"
              aria-pressed={!panel && !settingsSection}
              onClick={() => {
                setPanel(null);
                closeSettings();
              }}
            >
              <Icon name="compass" />
              <span className="rail-label">World</span>
            </button>
            {nav.filter((n) => phoneTabs.some((id) => id === n.id)).map(railButton)}
            <button
              className={
                settingsSection || panel === 'more' || panel === 'activity' || panel === 'wishes'
                  ? 'active'
                  : ''
              }
              aria-label="More"
              aria-pressed={Boolean(settingsSection) || panel === 'more'}
              aria-controls={panel ? 'world-panel' : undefined}
              onClick={() =>
                panel === 'more' && !settingsSection ? setPanel(null) : openPanel('more')
              }
            >
              <Icon name="more" />
              <span className="rail-label">More</span>
              {pendingWishes > 0 && (
                <b className="nav-count" aria-label="Pending requests">
                  {pendingWishes}
                </b>
              )}
            </button>
          </nav>
        )}
        {visitor.status && (
          <p className="sr-only" role="status">
            {visitor.status}
          </p>
        )}
        {accountOpen && (
          <AccountDialog
            session={accountSession}
            privateLocalAccess={privateLocalAccess}
            onClose={() => {
              accountSession.dismissOperatorSignIn();
              accountSession.dismissSocialReturn();
              setAccountOpen(false);
            }}
          />
        )}
      </main>
    </WallTimeProvider>
  );
}

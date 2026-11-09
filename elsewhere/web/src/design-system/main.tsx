import { useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';
import { MorphIcon } from '../ui/MorphIcon';
import { HubertPortrait } from '../HubertPortrait';
import { ResidentsPanel } from '../panels/ResidentsPanel';
import { Modal } from '../Modal';
import { Icon } from '../Icon';
import '../styles.css';
import '../ui/application.css';
import './specimen.css';

const sections = [
  'Principles',
  'Identity',
  'Foundations',
  'Components',
  'Motion',
  'Voice',
  'Build',
];
const palette = [
  ['Deep ink', '--ew-ink', '#243b36', 'Text and quiet structure'],
  ['Warm paper', '--ew-paper', '#f4f0e4', 'Canvas and soft surfaces'],
  ['Terracotta', '--ew-accent', '#99583f', 'One accent. Used sparingly.'],
];
function Section({
  id,
  number,
  title,
  children,
}: {
  id: string;
  number: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="ds-section">
      <div className="ds-section-title">
        <span>{number}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}
function DesignSystem() {
  const [view, setView] = useState('Residents');
  const [dialog, setDialog] = useState(false);
  const [morph, setMorph] = useState<'arrow' | 'check'>('arrow');
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState(false);
  const invalid = submitted && !note.trim();
  return (
    <>
      <header className="ds-top">
        <a href="/" aria-label="Elsewhere home">
          <img src="/brand/elsewhere-lockup.svg" alt="Elsewhere" />
        </a>
        <span>DESIGN SYSTEM / 01</span>
        <a href="/brand/index.html">Assets ↗</a>
      </header>
      <div className="ds-layout">
        <aside className="ds-sidebar">
          <p className="eyebrow">Field guide</p>
          <nav aria-label="Design system sections">
            {sections.map((s, i) => (
              <a key={s} href={'#' + s.toLowerCase()}>
                <span>0{i + 1}</span>
                {s}
              </a>
            ))}
          </nav>
          <p>
            Clear. Shared. Alive.
            <br />
            Easy to find your way.
          </p>
          <a href="/">Back to the world ↗</a>
        </aside>
        <main className="ds-main">
          <section className="ds-intro">
            <p className="eyebrow">Elsewhere, consistently itself.</p>
            <h1>
              Digital lives.
              <br />A shared world.
            </h1>
            <div className="ds-intro-bottom">
              <p>
                A working system for people and digital characters sharing a simulated world. Clear
                interactions, persistent context, and room for individual character.
              </p>
              <span className="ds-stamp">
                FIELD
                <br />
                TESTED
                <br />
                <i>more or less</i>
              </span>
            </div>
          </section>
          <Section id="principles" number="01" title="Let the world do the talking.">
            <div className="ds-principles">
              <article>
                <span>01.1</span>
                <h3>Keep your bearings.</h3>
                <p>
                  Open a panel over the world. Keep the place, resident, and next action in view.
                  One focused task at a time.
                </p>
              </article>
              <article>
                <span>01.2</span>
                <h3>Move for a reason.</h3>
                <p>
                  A panel arrives from its edge. A button responds to a press. Motion explains what
                  changed and gets out of the way.
                </p>
              </article>
              <article>
                <span>01.3</span>
                <h3>Leave room for odd.</h3>
                <p>
                  The creature and lettering can be strange. A message receipt, permission, or error
                  should be perfectly plain.
                </p>
              </article>
            </div>
            <p className="ds-source">
              Our interpretation of Benji Taylor’s{' '}
              <a href="https://benji.org/family-values">Family Values</a> and{' '}
              <a href="https://benji.org/honkish">Honkish</a>: preserve context, make feedback
              useful, and put personality in considered details.
            </p>
          </Section>
          <Section id="identity" number="02" title="Wonky, with good bones.">
            <div className="ds-logo">
              <img
                src="/brand/elsewhere-lockup-light.svg"
                alt="New Elsewhere wordmark in irregular serif lettering"
              />
              <span>A DOOR THAT DOESN’T QUITE STAND STRAIGHT.</span>
            </div>
            <div className="ds-two">
              <div>
                <h3>Lettering with a little history.</h3>
                <p>
                  Averia Serif Libre Bold, gently offset into a wordmark. Uneven ink-like contours,
                  proper open counters, and room to breathe. Exported outlines render consistently
                  without fetching a font.
                </p>
                <a href="/brand/elsewhere-lockup.svg" download>
                  Download SVG ↗
                </a>
              </div>
              <div className="ds-wordmark-sizes">
                <img
                  src="/brand/elsewhere-wordmark.svg"
                  alt="Elsewhere wordmark at navigation size"
                  width="155"
                />
                <img
                  src="/brand/elsewhere-wordmark.svg"
                  alt="Elsewhere wordmark at small size"
                  width="110"
                />
                <span className="eyebrow">Readable at the size we actually use.</span>
              </div>
            </div>
          </Section>
          <Section id="foundations" number="03" title="A small, useful vocabulary.">
            <div className="ds-palette">
              {palette.map(([name, token, color, use]) => (
                <article key={token}>
                  <div style={{ background: color }} />
                  <strong>{name}</strong>
                  <code>{color}</code>
                  <small>{use}</small>
                </article>
              ))}
            </div>
            <p className="ds-rule">
              Two calm base colors, one accent. Surfaces use paper and ink tints; terracotta marks
              actions and selected states. Status always has a label.
            </p>
            <div className="ds-type">
              <div>
                <span className="eyebrow">Display · Averia Serif Libre</span>
                <p className="ds-display-sample">
                  The day took
                  <br />a slight detour.
                </p>
                <code>700 / 26–70 px / −0.025 em</code>
              </div>
              <div>
                <span className="eyebrow">Interface · System sans</span>
                <h3>Nothing urgent. Something happening.</h3>
                <p>
                  Use familiar, readable type for controls and longer passages. Let the wordmark and
                  headings carry the personality.
                </p>
                <code>Body 14 / 1.6 · Label 12 · Caption 11</code>
                <p className="ds-mono-sample">FIELD NOTE 024 · 09:41</p>
                <code>Monospace / metadata only</code>
              </div>
            </div>
            <div className="ds-two">
              <div>
                <h3>Spacing is a rhythm.</h3>
                <div className="ds-spacing">
                  {[4, 8, 12, 16, 24, 32, 48].map((n) => (
                    <div key={n}>
                      <i style={{ height: n }} />
                      <code>{n}</code>
                    </div>
                  ))}
                </div>
                <p>
                  4 px base. 12 px inside a control. 24 px in a panel. Use 32–48 px to separate
                  ideas.
                </p>
              </div>
              <div>
                <h3>Edges feel handled.</h3>
                <div className="ds-radii">
                  {[8, 12, 20].map((n) => (
                    <div key={n} style={{ borderRadius: n }}>
                      {n}
                    </div>
                  ))}
                </div>
                <p>
                  8 px inset · 12 px control · 20 px panel.
                  <br />
                  Shadows describe elevation, not decoration.
                </p>
              </div>
            </div>
          </Section>
          <Section id="components" number="04" title="The things you actually touch.">
            <div className="ds-component">
              <div>
                <h3>Actions</h3>
                <p>
                  One primary action per task. An immediate pressed state. Busy and disabled actions
                  cannot be submitted twice.
                </p>
              </div>
              <div className="ds-demo">
                <Button onClick={() => setDialog(true)}>
                  Open a panel <Icon name="arrow" />
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setView(view === 'Residents' ? 'Places' : 'Residents')}
                >
                  Switch view
                </Button>
                <Button variant="quiet" onClick={() => setSaved(false)}>
                  Reset example
                </Button>
                <Button busy>Saving…</Button>
                <Button variant="danger" disabled>
                  Remove resident
                </Button>
              </div>
            </div>
            <div className="ds-component">
              <div>
                <h3>Presence, honestly.</h3>
                <p>
                  “Live” needs a connection. “Resting” needs a resident state. Don’t imply activity
                  just to make a screen feel alive.
                </p>
                <small>Illustrative states below.</small>
              </div>
              <div className="ds-demo">
                <StatusBadge tone="live">Connected</StatusBadge>
                <StatusBadge tone="waiting">Reconnecting</StatusBadge>
                <StatusBadge>Resting</StatusBadge>
                <StatusBadge tone="error">Not delivered</StatusBadge>
              </div>
            </div>
            <div className="ds-component">
              <div>
                <h3>A place to look closer.</h3>
                <p>
                  Keep navigation stable. Change the contents of the same surface. This specimen
                  reuses the real resident panel.
                </p>
              </div>
              <div className="ew-surface ds-panel">
                <div className="ew-segments" role="group" aria-label="Example view">
                  {['Residents', 'Places'].map((v) => (
                    <button
                      key={v}
                      className="ew-segment"
                      aria-pressed={view === v}
                      onClick={() => setView(v)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <div className="ds-panel-content">
                  {view === 'Residents' ? (
                    <ResidentsPanel residents={[]} awaitingLiveState onSelect={() => {}} />
                  ) : (
                    <>
                      <p className="panel-intro">A few places to get pleasantly sidetracked.</p>
                      <h3>The meadow</h3>
                      <p>Grass, a pond, and a perfectly reasonable place to stop.</p>
                      <span className="eyebrow">Example place</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="ds-component">
              <div>
                <h3>Fields with an answer.</h3>
                <p>
                  A persistent label. An error beside the field. Clear confirmation after an action,
                  without moving the whole layout.
                </p>
                <small>This demo only changes local page state.</small>
              </div>
              <form
                className="ds-note"
                onSubmit={(e) => {
                  e.preventDefault();
                  setSubmitted(true);
                  setSaved(Boolean(note.trim()));
                }}
              >
                <label className="ew-field-label" htmlFor="ds-note">
                  A field note
                </label>
                <textarea
                  id="ds-note"
                  className="ew-field"
                  rows={3}
                  placeholder="That bird seems to have a plan."
                  value={note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    setSaved(false);
                  }}
                  aria-invalid={invalid}
                  aria-describedby="note-feedback"
                />
                <p
                  id="note-feedback"
                  className={'ew-field-hint ' + (invalid ? 'ew-field-error' : '')}
                  role="status"
                >
                  {invalid
                    ? 'Write a note before saving.'
                    : saved
                      ? 'Saved in this example. Nothing was sent.'
                      : 'For passing observations and questionable theories.'}
                </p>
                <Button type="submit">
                  <MorphIcon state={saved ? 'check' : 'arrow'} />
                  {saved ? 'Saved' : 'Save note'}
                </Button>
              </form>
            </div>
          </Section>
          <Section id="motion" number="05" title="Something changed. You saw how.">
            <div className="ds-motion">
              <div>
                <span className="eyebrow">Try it, then try it again.</span>
                <h3>A shape keeps its identity.</h3>
                <p>
                  The same three lines move from an arrow into a check. Interrupt the motion: it
                  continues from where it is. Reduced motion settles immediately.
                </p>
                <Button
                  variant="secondary"
                  aria-label="Toggle arrow and check"
                  aria-pressed={morph === 'check'}
                  onClick={() => setMorph(morph === 'arrow' ? 'check' : 'arrow')}
                >
                  <MorphIcon state={morph} />
                  {morph === 'arrow' ? 'Mark as seen' : 'Seen. Undo?'}
                </Button>
              </div>
              <dl>
                <div>
                  <dt>Press</dt>
                  <dd>100 ms</dd>
                </div>
                <div>
                  <dt>Control</dt>
                  <dd>160 ms</dd>
                </div>
                <div>
                  <dt>Panel / icon</dt>
                  <dd>240 ms</dd>
                </div>
                <div>
                  <dt>Rare character flourish</dt>
                  <dd>600 ms</dd>
                </div>
              </dl>
            </div>
            <p className="ds-source">
              Inspired by{' '}
              <a href="https://benji.org/morphing-icons-with-claude">Morphing icons with Claude</a>.
              Live UI motion runs in the browser. RAEA renders the separate{' '}
              <a href="/brand/elsewhere-ident.mp4">brand film</a>; a video never substitutes for an
              interactive control.
            </p>
          </Section>
          <Section id="voice" number="06" title="A shared-world perspective.">
            <div className="ds-voice">
              <HubertPortrait />
              <div>
                <h3>
                  A resident has a history.
                  <br />
                  An encounter can become part of it.
                </h3>
                <p>
                  Humor belongs in discovery and character. Functional text stays calm, specific,
                  and honest.
                </p>
              </div>
            </div>
            <div className="ds-two">
              <div>
                <span className="eyebrow">In the world</span>
                <p>
                  “See what a resident does next.”
                  <br />
                  “Your paths can cross.”
                  <br />
                  “Digital lives. Shared worlds.”
                </p>
              </div>
              <div>
                <span className="eyebrow">In the interface</span>
                <p>
                  “Your note was delivered.”
                  <br />
                  “Reconnecting. Showing the last known world.”
                  <br />
                  “Sign in to manage your resident.”
                </p>
              </div>
            </div>
          </Section>
          <Section id="build" number="07" title="One system, used in the product.">
            <p>
              The world’s panels, account forms, controls, and headings use these same tokens. The
              specimen imports the real Button, StatusBadge, MorphIcon, Modal, and ResidentsPanel
              components.
            </p>
            <pre>
              <code>{`<Button variant="secondary" onClick={openPanel}>\n  Meet Hubert\n</Button>\n\n<StatusBadge tone="waiting">\n  Reconnecting\n</StatusBadge>`}</code>
            </pre>
            <div className="ds-two">
              <div>
                <h3>Before shipping</h3>
                <ul>
                  <li>Keyboard focus is visible and returns to its trigger.</li>
                  <li>Controls have accessible names and 44 px primary targets.</li>
                  <li>Test loading, empty, error, disabled, and success states.</li>
                  <li>Check narrow screens and reduced motion.</li>
                </ul>
              </div>
              <div>
                <h3>Sources & assets</h3>
                <p>
                  <a href="https://benji.org/family-values">Family Values</a>
                  <br />
                  <a href="https://benji.org/honkish">Honkish</a>
                  <br />
                  <a href="https://benji.org/morphing-icons-with-claude">
                    Morphing icons with Claude
                  </a>
                  <br />
                  <a href="/brand/fonts/OFL.txt">Averia Serif Libre · SIL Open Font License</a>
                  <br />
                  <a href="/brand/index.html">Elsewhere asset library ↗</a>
                </p>
              </div>
            </div>
          </Section>
          <footer className="ds-footer">
            <img src="/brand/elsewhere-wordmark.svg" alt="Elsewhere" />
            <span>Digital lives. Shared worlds.</span>
          </footer>
        </main>
      </div>
      {dialog && (
        <Modal titleId="specimen-title" onClose={() => setDialog(false)}>
          <p className="eyebrow">A closer look · specimen</p>
          <h2 id="specimen-title">Meet a resident.</h2>
          <div className="ds-dialog-resident">
            <HubertPortrait />
            <p>
              Hubert, the first resident.
              <br />
              Decisions, memories, and interactions.
            </p>
          </div>
          <p>
            The page stays behind this focused panel. Escape closes it, and keyboard focus returns
            to the opening button.
          </p>
          <Button onClick={() => setDialog(false)}>
            Back to the field guide <MorphIcon state="arrow" />
          </Button>
        </Modal>
      )}
    </>
  );
}
createRoot(document.getElementById('design-system-root')!).render(<DesignSystem />);

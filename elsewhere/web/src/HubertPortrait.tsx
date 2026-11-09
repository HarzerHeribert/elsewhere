import { hubertArtwork } from './brandArtwork';

/** The same original drawing appears in the motion ident and character sheet. */
export function HubertPortrait() {
  return (
    <div
      className="avatar hubert-portrait"
      role="img"
      aria-label="Hubert, Elsewhere’s first digital resident"
    >
      <svg
        viewBox="24 0 266 312"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: hubertArtwork }}
      />
    </div>
  );
}

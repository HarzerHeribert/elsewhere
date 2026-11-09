import { doorwayArtwork, wordmarkArtwork } from './brandArtwork';
import { productCopy } from './productCopy';
export function ElsewhereBrand() {
  return (
    <>
      <svg
        className="elsewhere-mark"
        viewBox="0 0 104 104"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: doorwayArtwork }}
      />
      <span className="elsewhere-lockup">
        <svg
          className="elsewhere-wordmark"
          viewBox="0 0 630 112"
          aria-hidden="true"
          fill="currentColor"
          dangerouslySetInnerHTML={{ __html: wordmarkArtwork }}
        />
        <small>{productCopy.strapline}</small>
      </span>
    </>
  );
}

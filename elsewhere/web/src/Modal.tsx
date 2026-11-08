import { useEffect, useRef, type ReactNode } from 'react';

const focusable =
  'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])';

export function Modal({
  titleId,
  onClose,
  closeLabel = 'Close dialog',
  className = '',
  children,
}: {
  titleId: string;
  onClose: () => void;
  closeLabel?: string;
  className?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLElement>(null),
    close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const elements = () =>
      Array.from(element.querySelectorAll<HTMLElement>(focusable)).filter(
        (item) => item.getClientRects().length > 0 && !item.closest('[inert]'),
      );
    (element.querySelector<HTMLElement>('[data-autofocus]') ?? elements()[0] ?? element).focus({
      preventScroll: true,
    });
    const focus = (event: FocusEvent) => {
      if (!element.contains(event.target as Node))
        (elements()[0] ?? element).focus({ preventScroll: true });
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
      if (event.key !== 'Tab') return;
      const items = elements(),
        first = items[0],
        last = items.at(-1);
      if (!first) {
        event.preventDefault();
        element.focus();
        return;
      }
      if (
        !element.contains(document.activeElement) ||
        (event.shiftKey && document.activeElement === first)
      ) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('focusin', focus);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('focusin', focus);
      document.removeEventListener('keydown', key, true);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className={'modal glass ' + className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <button className="square-button modal-close" aria-label={closeLabel} onClick={onClose}>
          ×
        </button>
        {children}
      </section>
    </div>
  );
}

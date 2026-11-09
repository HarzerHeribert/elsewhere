import { Button } from '../ui/Button';
import type { FormEvent } from 'react';
import { HubertPortrait } from '../HubertPortrait';
import { Icon } from '../Icon';
import { formatTime } from '../formatTime';

export function MessagesPanel({
  message,
  receipts,
  sending,
  connected,
  messageStatus,
  onMessageChange,
  onSubmit,
}: {
  message: string;
  receipts: ReadonlyArray<{ at: number; text: string }>;
  sending: boolean;
  connected: boolean;
  messageStatus: string;
  onMessageChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <>
      <div className="recipient">
        <HubertPortrait />
        <div>
          <strong>Hubert</strong>
          <small>Private message</small>
        </div>
        {connected && <i className="presence" />}
      </div>
      <p className="panel-intro">
        {connected
          ? 'Share an observation or ask a question. Hubert can encounter your note as part of his day.'
          : 'You can leave Hubert a note when the live world reconnects. Your draft stays in this window.'}
      </p>
      <div className="delivery-history">
        {receipts.map((r) => (
          <div className="sent-message" key={r.at}>
            <p>{r.text}</p>
            <span>Delivered · {formatTime(r.at)}</span>
          </div>
        ))}
      </div>
      <form className="message-form" onSubmit={onSubmit}>
        <label htmlFor="visitor-note">Your note to Hubert</label>
        <textarea
          id="visitor-note"
          className="ew-field"
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          maxLength={500}
          placeholder="What would you like to share?"
          rows={5}
        />
        <div>
          <span>{message.length} / 500</span>
          <Button type="submit" disabled={sending || !message.trim() || !connected}>
            {sending ? 'Delivering…' : 'Leave a note'}
            <Icon name="arrow" />
          </Button>
        </div>
        <p role="status" className="message-status">
          {messageStatus}
        </p>
      </form>
      <p className="privacy-note">
        Your note is stored privately. If a model is connected, its text may be sent to that
        provider. Other visitors cannot read it.
      </p>
    </>
  );
}

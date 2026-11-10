import { Icon } from '../Icon';
import type { SettingsEntry, SettingsSection } from '../SettingsScreen';

/** Everything that does not fit the phone’s tab bar: the account, two panels and the settings. */
export function MorePanel({
  accountName,
  needsAttention,
  pendingWishes,
  entries,
  onAccount,
  onActivity,
  onWishes,
  onSettings,
}: {
  accountName?: string;
  needsAttention: boolean;
  pendingWishes: number;
  entries: SettingsEntry[];
  onAccount: () => void;
  onActivity: () => void;
  onWishes: () => void;
  onSettings: (section: SettingsSection) => void;
}) {
  return (
    <div className="more-list">
      <div className="more-group">
        <button className="more-account" onClick={onAccount}>
          <span className="account-avatar">
            <Icon name="user" />
          </span>
          <span>
            <strong>{accountName ?? 'Sign in'}</strong>
            <small>
              {accountName ? 'Signed in' : 'Keep your place and hear from residents'}
              {needsAttention && ' · needs attention'}
            </small>
          </span>
          <Icon name="chevron-right" />
        </button>
      </div>
      <div className="more-group">
        <button onClick={onActivity}>
          <Icon name="activity" />
          <span>Activity</span>
          <Icon name="chevron-right" />
        </button>
        <button onClick={onWishes}>
          <Icon name="star" />
          <span>Wishes</span>
          {pendingWishes > 0 && <b className="nav-count">{pendingWishes}</b>}
          <Icon name="chevron-right" />
        </button>
      </div>
      <p className="eyebrow">Settings</p>
      <div className="more-group">
        {entries
          .filter((entry) => entry.id !== 'account')
          .map((entry) => (
            <button key={entry.id} onClick={() => onSettings(entry.id)}>
              <span>{entry.label}</span>
              {entry.badge && <span className="settings-badge">{entry.badge}</span>}
              <Icon name="chevron-right" />
            </button>
          ))}
      </div>
    </div>
  );
}

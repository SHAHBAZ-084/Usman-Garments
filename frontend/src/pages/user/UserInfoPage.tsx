import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import {
  Feedback,
  FieldLabel,
  PageShell,
  Panel,
  PrimaryButton,
  SecondaryButton,
  TextInput,
} from '../../components/ui/PageShell';

export function UserInfoPage() {
  const { user, logout, updateProfile } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('');
  const [username, setUsername] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordVerified, setPasswordVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!user) return;
    setDisplayName(user.displayName || '');
    setRole(user.role || 'Owner');
    setUsername(user.username || '');
  }, [user]);

  async function onVerifyPassword() {
    setVerifying(true);
    setError('');
    setMessage('');
    try {
      await api.verifyPassword(currentPassword);
      setPasswordVerified(true);
      setMessage('Current password verified — you can set a new password now');
    } catch (err) {
      setPasswordVerified(false);
      setNewPassword('');
      setConfirmPassword('');
      setError(err instanceof Error ? err.message : 'Password verification failed');
    } finally {
      setVerifying(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const usernameChanged = username.trim() !== user.username;
      const passwordChanged = Boolean(newPassword.trim());

      if (passwordChanged) {
        if (!passwordVerified) {
          throw new Error('Verify your current password before setting a new one');
        }
        if (newPassword.trim().length < 6) {
          throw new Error('New password must be at least 6 characters');
        }
        if (newPassword !== confirmPassword) {
          throw new Error('New password and confirmation do not match');
        }
      }

      if (usernameChanged && !currentPassword.trim()) {
        throw new Error('Enter your current password to change username');
      }

      await updateProfile({
        displayName: displayName.trim(),
        role: role.trim(),
        username: username.trim(),
        currentPassword:
          usernameChanged || passwordChanged ? currentPassword : undefined,
        newPassword: passwordChanged ? newPassword : undefined,
      });
      setMessage('Profile updated');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordVerified(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageShell title="User Information" subtitle="Edit display name, role, and login credentials">
      <Panel className="max-w-md space-y-4">
        {error ? <Feedback variant="error">{error}</Feedback> : null}
        {message ? <Feedback variant="success">{message}</Feedback> : null}
        <form className="space-y-3" onSubmit={(e) => void onSubmit(e)}>
          <div>
            <FieldLabel>Display name</FieldLabel>
            <TextInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div>
            <FieldLabel>Role</FieldLabel>
            <TextInput value={role} onChange={(e) => setRole(e.target.value)} placeholder="Owner" />
          </div>
          <div>
            <FieldLabel>Username</FieldLabel>
            <TextInput
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
          </div>

          <div className="rounded-lg border border-border bg-surface3 p-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-textMuted">
              Change password
            </p>
            <div>
              <FieldLabel>Current password</FieldLabel>
              <TextInput
                type="password"
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  setPasswordVerified(false);
                  setNewPassword('');
                  setConfirmPassword('');
                }}
                autoComplete="current-password"
                placeholder="Enter current password to verify"
              />
            </div>
            <SecondaryButton
              type="button"
              disabled={verifying || !currentPassword.trim()}
              onClick={() => void onVerifyPassword()}
            >
              {verifying ? 'Verifying…' : passwordVerified ? 'Verified ✓' : 'Verify current password'}
            </SecondaryButton>
            <div>
              <FieldLabel>New password</FieldLabel>
              <TextInput
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                disabled={!passwordVerified}
                placeholder={passwordVerified ? 'Enter new password' : 'Verify current password first'}
              />
            </div>
            <div>
              <FieldLabel>Confirm new password</FieldLabel>
              <TextInput
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                disabled={!passwordVerified}
                placeholder={passwordVerified ? 'Confirm new password' : 'Verify current password first'}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <PrimaryButton type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </PrimaryButton>
            <SecondaryButton type="button" onClick={() => void logout()}>
              Sign out
            </SecondaryButton>
          </div>
        </form>
      </Panel>
    </PageShell>
  );
}

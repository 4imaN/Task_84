import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decryptJson, encryptJson } from '@ledgerread/crypto';
import { ProfilePortabilityPage } from './ProfilePortabilityPage';
import { apiRequest } from '../../lib/api';
import { createContextValue, createProfile, createSession, renderWithProviders } from '../../test/utils';

vi.mock('../../lib/api', () => ({
  apiRequest: vi.fn(),
  graphQLRequest: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  API_BASE_URL: 'http://localhost:4000',
  GRAPHQL_URL: 'http://localhost:4000/graphql',
}));

vi.mock('@ledgerread/crypto', () => ({
  decryptJson: vi.fn(),
  encryptJson: vi.fn(),
}));

describe('ProfilePortabilityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(encryptJson).mockResolvedValue({
      salt: 'salt',
      iv: 'iv',
      ciphertext: 'ciphertext',
    });
  });

  it('surfaces a wrong-password import error without sending a profile update', async () => {
    const addToast = vi.fn();
    vi.mocked(decryptJson).mockRejectedValue(new Error('bad decrypt'));

    renderWithProviders(<ProfilePortabilityPage />, {
      route: '/app/profile',
      contextValue: createContextValue({
        session: createSession(),
        profile: createProfile(),
        addToast,
      }),
    });

    await userEvent.type(screen.getByPlaceholderText('Create a one-time export password'), 'Wrong!Pass1');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const upload = new File([JSON.stringify({ salt: 'salt', iv: 'iv', ciphertext: 'ciphertext' })], 'profile.json', {
      type: 'application/json',
    });
    Object.defineProperty(upload, 'text', {
      value: async () => JSON.stringify({ salt: 'salt', iv: 'iv', ciphertext: 'ciphertext' }),
    });

    await userEvent.upload(fileInput, upload);

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        'The import password is incorrect or the file is not a valid LedgerRead profile.',
      );
    });
    expect(apiRequest).not.toHaveBeenCalledWith(
      '/profiles/me',
      expect.objectContaining({ method: 'PUT' }),
      expect.anything(),
    );
  });

  it('adopts the server profile when LAN sync returns a newer conflict result', async () => {
    const addToast = vi.fn();
    const setProfile = vi.fn();
    vi.mocked(apiRequest).mockRejectedValue({
      status: 409,
      payload: {
        serverProfile: {
          username: 'reader.ada',
          deviceLabel: 'Server Tablet',
          preferences: {
            ...createProfile().preferences,
            fontSize: 22,
          },
          updatedAt: '2026-03-29T12:00:00.000Z',
        },
      },
    });

    renderWithProviders(<ProfilePortabilityPage />, {
      route: '/app/profile',
      contextValue: createContextValue({
        session: createSession(),
        profile: createProfile(),
        setProfile,
        addToast,
      }),
    });

    await userEvent.click(screen.getByRole('button', { name: 'LAN Sync' }));

    await waitFor(() => {
      expect(setProfile).toHaveBeenCalledWith({
        username: 'reader.ada',
        deviceLabel: 'Server Tablet',
        preferences: expect.objectContaining({
          fontSize: 22,
        }),
        updatedAt: '2026-03-29T12:00:00.000Z',
      });
    });
    expect(addToast).toHaveBeenCalledWith(
      'Server profile was newer, so the local view adopted the server version.',
    );
  });

  it('keeps the current profile when an imported file is older than the active profile', async () => {
    const addToast = vi.fn();
    const setProfile = vi.fn();
    vi.mocked(decryptJson).mockResolvedValue({
      ...createProfile(),
      updatedAt: '2026-03-28T00:00:00.000Z',
    });

    renderWithProviders(<ProfilePortabilityPage />, {
      route: '/app/profile',
      contextValue: createContextValue({
        session: createSession(),
        profile: createProfile({
          updatedAt: '2026-03-29T00:00:00.000Z',
        }),
        setProfile,
        addToast,
      }),
    });

    await userEvent.type(screen.getByPlaceholderText('Create a one-time export password'), 'Reader!2026');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const upload = new File([JSON.stringify({ salt: 'salt', iv: 'iv', ciphertext: 'ciphertext' })], 'profile.json', {
      type: 'application/json',
    });
    Object.defineProperty(upload, 'text', {
      value: async () => JSON.stringify({ salt: 'salt', iv: 'iv', ciphertext: 'ciphertext' }),
    });

    await userEvent.upload(fileInput, upload);

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        'Imported profile was older than the active local profile, so the current settings were kept.',
      );
    });
    expect(apiRequest).not.toHaveBeenCalledWith(
      '/profiles/me',
      expect.objectContaining({ method: 'PUT' }),
      expect.anything(),
    );
    expect(setProfile).not.toHaveBeenCalled();
  });

  it('adopts the server profile when an imported file is newer than local but older than the server', async () => {
    const addToast = vi.fn();
    const setProfile = vi.fn();
    vi.mocked(decryptJson).mockResolvedValue({
      ...createProfile(),
      updatedAt: '2026-03-29T01:00:00.000Z',
    });
    vi.mocked(apiRequest).mockResolvedValue({
      resolution: 'SERVER_WON',
      profile: {
        username: 'reader.ada',
        deviceLabel: 'Server Tablet',
        preferences: {
          ...createProfile().preferences,
          fontSize: 24,
        },
        updatedAt: '2026-03-29T02:00:00.000Z',
      },
    });

    renderWithProviders(<ProfilePortabilityPage />, {
      route: '/app/profile',
      contextValue: createContextValue({
        session: createSession(),
        profile: createProfile({
          updatedAt: '2026-03-29T00:00:00.000Z',
        }),
        setProfile,
        addToast,
      }),
    });

    await userEvent.type(screen.getByPlaceholderText('Create a one-time export password'), 'Reader!2026');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const upload = new File([JSON.stringify({ salt: 'salt', iv: 'iv', ciphertext: 'ciphertext' })], 'profile.json', {
      type: 'application/json',
    });
    Object.defineProperty(upload, 'text', {
      value: async () => JSON.stringify({ salt: 'salt', iv: 'iv', ciphertext: 'ciphertext' }),
    });

    await userEvent.upload(fileInput, upload);

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        '/profiles/me/sync',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"strict":false'),
        }),
        expect.anything(),
      );
    });
    expect(setProfile).toHaveBeenCalledWith({
      username: 'reader.ada',
      deviceLabel: 'Server Tablet',
      preferences: expect.objectContaining({
        fontSize: 24,
      }),
      updatedAt: '2026-03-29T02:00:00.000Z',
    });
    expect(addToast).toHaveBeenCalledWith(
      'A newer server profile already existed, so the imported file was not applied.',
    );
  });

  it('renders a retryable error state when the profile never resolves', async () => {
    const retryProfile = vi.fn();

    renderWithProviders(<ProfilePortabilityPage />, {
      route: '/app/profile',
      contextValue: createContextValue({
        session: createSession(),
        profile: null,
        profileReady: true,
        profileError: 'The reading profile could not be loaded from the local server.',
        retryProfile,
      }),
    });

    expect(screen.getByText('Unable To Load Profile')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retryProfile).toHaveBeenCalledTimes(1);
  });
});

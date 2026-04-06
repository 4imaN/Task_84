import { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AttendancePage } from './AttendancePage';
import { apiRequest } from '../../lib/api';
import { createContextValue, createSession, renderWithProviders } from '../../test/utils';

vi.mock('../../lib/api', () => ({
  apiRequest: vi.fn(),
  graphQLRequest: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  API_BASE_URL: 'http://localhost:4000',
  GRAPHQL_URL: 'http://localhost:4000/graphql',
}));

const VALID_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00,
  0x02, 0x00, 0x01, 0xe5, 0x27, 0xd4, 0xa2, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const CHECKSUM = '01020304';
const DEFAULT_RISK = {
  id: 'risk-1',
  description: 'Missing clock-out after 12 hours',
  username: 'clerk.emma',
  created_at: '2026-03-29T12:00:00.000Z',
};

const createAttendanceQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

const createAttendanceContext = (addToast = vi.fn()) =>
  createContextValue({
    session: createSession({
      user: {
        id: 'clerk-1',
        username: 'clerk.emma',
        role: 'CLERK',
        workspace: 'pos',
      },
      homePath: '/pos/attendance',
    }),
    profile: null,
    addToast,
  });

const uploadEvidenceFile = async (
  fileInput: HTMLInputElement,
  {
    bytes = VALID_PNG,
    filename = 'proof.png',
    type = 'image/png',
  }: {
    bytes?: Uint8Array;
    filename?: string;
    type?: string;
  } = {},
) => {
  const fileBytes = Uint8Array.from(bytes);
  const uploadedFile = new File([fileBytes], filename, { type });
  Object.defineProperty(uploadedFile, 'arrayBuffer', {
    value: async () => fileBytes.buffer.slice(fileBytes.byteOffset, fileBytes.byteOffset + fileBytes.byteLength),
  });
  Object.defineProperty(fileInput, 'files', {
    value: [uploadedFile],
    configurable: true,
  });
  fireEvent.change(fileInput);
  return uploadedFile;
};

describe('AttendancePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiRequest).mockResolvedValue([]);
    vi.spyOn(globalThis.crypto.subtle, 'digest').mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer);
  });

  it('disables attendance submission when the local checksum mismatches the expected value', async () => {
    renderWithProviders(<AttendancePage />, {
      route: '/pos/attendance',
      queryClient: createAttendanceQueryClient(),
      contextValue: createAttendanceContext(),
    });

    await userEvent.type(screen.getByPlaceholderText('Expected checksum'), 'deadbeef');
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await uploadEvidenceFile(fileInput);

    await waitFor(() => {
      expect(screen.getByText('Checksum does not match the expected value.')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Clock In' })).toBeDisabled();
  });

  it('requires an expected checksum before enabling evidence submission', async () => {
    const addToast = vi.fn();

    renderWithProviders(<AttendancePage />, {
      route: '/pos/attendance',
      queryClient: createAttendanceQueryClient(),
      contextValue: createAttendanceContext(addToast),
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await uploadEvidenceFile(fileInput);

    await waitFor(() => {
      expect(screen.getByText('Enter the expected checksum to submit this evidence file.')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Clock In' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clock Out' })).toBeDisabled();
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('submits a successful clock-in with valid evidence and refetches risk alerts', async () => {
    const addToast = vi.fn();
    let riskFetchCount = 0;
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === '/attendance/risks') {
        riskFetchCount += 1;
        return riskFetchCount === 1 ? [DEFAULT_RISK] : [];
      }

      if (path === '/attendance/clock-in' && options?.method === 'POST') {
        return { recordId: 'clock-in-1' };
      }

      throw new Error(`Unexpected request: ${String(path)}`);
    });

    renderWithProviders(<AttendancePage />, {
      route: '/pos/attendance',
      queryClient: createAttendanceQueryClient(),
      contextValue: createAttendanceContext(addToast),
    });

    await screen.findByText(DEFAULT_RISK.description);
    await userEvent.type(screen.getByPlaceholderText('Expected checksum'), CHECKSUM);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const uploadedFile = await uploadEvidenceFile(fileInput);

    await screen.findByText('Checksum matches the expected value.');
    await userEvent.click(screen.getByRole('button', { name: 'Clock In' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        '/attendance/clock-in',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(FormData),
        }),
        expect.anything(),
      );
    });

    const clockInCall = vi
      .mocked(apiRequest)
      .mock.calls.find(([path, options]) => path === '/attendance/clock-in' && options?.method === 'POST');
    const formData = clockInCall?.[1]?.body as FormData;
    expect(formData.get('expectedChecksum')).toBe(CHECKSUM);
    expect(formData.get('evidence')).toBe(uploadedFile);
    expect(riskFetchCount).toBe(2);
    expect(addToast).toHaveBeenCalledWith('Attendance clock-in recorded.');
    await screen.findByText('No Active Alerts');
  });

  it('submits a successful clock-out with valid evidence', async () => {
    const addToast = vi.fn();
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === '/attendance/risks') {
        return [];
      }

      if (path === '/attendance/clock-out' && options?.method === 'POST') {
        return { recordId: 'clock-out-1' };
      }

      throw new Error(`Unexpected request: ${String(path)}`);
    });

    renderWithProviders(<AttendancePage />, {
      route: '/pos/attendance',
      queryClient: createAttendanceQueryClient(),
      contextValue: createAttendanceContext(addToast),
    });

    await userEvent.type(screen.getByPlaceholderText('Expected checksum'), CHECKSUM);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const uploadedFile = await uploadEvidenceFile(fileInput, {
      filename: 'proof.webp',
      type: 'image/webp',
    });

    await screen.findByText('Checksum matches the expected value.');
    await userEvent.click(screen.getByRole('button', { name: 'Clock Out' }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        '/attendance/clock-out',
        expect.objectContaining({
          method: 'POST',
          body: expect.any(FormData),
        }),
        expect.anything(),
      );
    });

    const clockOutCall = vi
      .mocked(apiRequest)
      .mock.calls.find(([path, options]) => path === '/attendance/clock-out' && options?.method === 'POST');
    const formData = clockOutCall?.[1]?.body as FormData;
    expect(formData.get('expectedChecksum')).toBe(CHECKSUM);
    expect(formData.get('evidence')).toBe(uploadedFile);
    expect(addToast).toHaveBeenCalledWith('Attendance clock-out recorded.');
  });

  it('rejects unsupported evidence MIME types before submission', async () => {
    renderWithProviders(<AttendancePage />, {
      route: '/pos/attendance',
      queryClient: createAttendanceQueryClient(),
      contextValue: createAttendanceContext(),
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await uploadEvidenceFile(fileInput, {
      bytes: new Uint8Array([0x74, 0x65, 0x78, 0x74]),
      filename: 'evidence.txt',
      type: 'text/plain',
    });

    await screen.findByText('Unsupported evidence type. Use PNG, JPEG, or WebP.');
    expect(screen.getByRole('button', { name: 'Clock In' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clock Out' })).toBeDisabled();
  });

  it('surfaces backend attendance submission failures to the clerk', async () => {
    const addToast = vi.fn();
    vi.mocked(apiRequest).mockImplementation(async (path, options) => {
      if (path === '/attendance/risks') {
        return [];
      }

      if (path === '/attendance/clock-out' && options?.method === 'POST') {
        throw new Error('Attendance clock-out failed.');
      }

      throw new Error(`Unexpected request: ${String(path)}`);
    });

    renderWithProviders(<AttendancePage />, {
      route: '/pos/attendance',
      queryClient: createAttendanceQueryClient(),
      contextValue: createAttendanceContext(addToast),
    });

    await userEvent.click(screen.getByRole('button', { name: 'Clock Out' }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('Attendance clock-out failed.');
    });
  });
});

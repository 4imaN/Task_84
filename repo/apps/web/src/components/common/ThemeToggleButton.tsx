import clsx from 'clsx';
import { useAppContext } from '../../context/AppContext';

function MoonIcon({ active }: { active: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={clsx('h-4 w-4 transition-transform duration-300', active && 'rotate-12')}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 12.8A8.6 8.6 0 1 1 11.2 3a7.2 7.2 0 0 0 9.8 9.8Z"
      />
    </svg>
  );
}

function SunIcon({ active }: { active: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={clsx('h-4 w-4 transition-transform duration-300', active && 'rotate-90')}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="12" cy="12" r="4" />
      <path
        strokeLinecap="round"
        d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07 6.7 17.3M17.3 6.7l1.77-1.77"
      />
    </svg>
  );
}

export function ThemeToggleButton() {
  const { nightMode, setNightMode } = useAppContext();

  return (
    <button
      aria-label={nightMode ? 'Switch to day mode' : 'Switch to night mode'}
      className="theme-toggle"
      onClick={() => setNightMode(!nightMode)}
      type="button"
    >
      <span className="theme-toggle-icon">{nightMode ? <MoonIcon active /> : <SunIcon active />}</span>
      <span>{nightMode ? 'Night' : 'Day'}</span>
    </button>
  );
}

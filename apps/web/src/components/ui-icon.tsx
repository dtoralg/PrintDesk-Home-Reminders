type IconName =
  | "home"
  | "plus"
  | "history"
  | "printer"
  | "settings"
  | "task"
  | "idea"
  | "reminder"
  | "note"
  | "check"
  | "clock"
  | "arrow"
  | "user"
  | "calendar"
  | "bell"
  | "logout";

interface UiIconProps {
  name: IconName;
  size?: number;
}

const paths: Record<IconName, React.ReactNode> = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5M9 21v-7h6v7" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  printer: <><path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v7H6zM18 12h.01" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  task: <><rect x="4" y="3" width="16" height="18" rx="1" /><path d="m8 12 2 2 5-5" /></>,
  idea: <><path d="M9 18h6M10 22h4M8.2 14.5a7 7 0 1 1 7.6 0c-.9.6-.8 1.5-.8 2.5H9c0-1 .1-1.9-.8-2.5Z" /></>,
  reminder: <><circle cx="12" cy="13" r="8" /><path d="M12 9v5l3 2M9 2h6" /></>,
  note: <><path d="M5 3h10l4 4v14H5zM15 3v5h4M8 12h8M8 16h8" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5h5" /></>,
  arrow: <path d="M5 12h14M14 7l5 5-5 5" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="1" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
  logout: <><path d="M10 4H5v16h5M14 8l4 4-4 4M8 12h10" /></>,
};

export function UiIcon({ name, size = 20 }: UiIconProps) {
  return (
    <svg aria-hidden="true" className="ui-icon" fill="none" height={size} viewBox="0 0 24 24" width={size}>
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7">{paths[name]}</g>
    </svg>
  );
}

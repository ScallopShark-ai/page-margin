export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="logo-mark"
    >
      <rect x="1.5" y="1.5" width="29" height="29" rx="8.5" fill="currentColor" />
      <path
        d="M9 7.5h10.5a5 5 0 0 1 5 5v12H14a5 5 0 0 1-5-5v-12Z"
        fill="#F6F2EA"
      />
      <path
        d="M14 7.5h5.5a5 5 0 0 1 5 5v7H19a5 5 0 0 1-5-5v-7Z"
        fill="#E65B3A"
      />
      <path
        d="M16.5 12h5M16.5 15.5h5M16.5 19h3"
        stroke="#201E1A"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`logo ${compact ? 'logo--compact' : ''}`}>
      <LogoMark size={compact ? 25 : 29} />
      <span className="logo-type">
        <span className="logo-cn">页边</span>
        {!compact && <span className="logo-en">PageMargin</span>}
      </span>
    </span>
  );
}

type Props = {
  size?: number;
  className?: string;
  title?: string;
};

/**
 * Minimal "connected nodes" icon (matches Wykra's logo vibe).
 */
export function NetworkIcon({ size = 16, className, title = 'Network' }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <path
        className="netLine"
        d="M7 12L12 7L17 12L12 17L7 12Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity="0.9"
      />
      <path
        className="netLine netLine2"
        d="M7 12H17"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.55"
      />
      <circle className="netDot netDot1" cx="12" cy="7" r="1.6" fill="currentColor" />
      <circle className="netDot netDot2" cx="7" cy="12" r="1.6" fill="currentColor" />
      <circle className="netDot netDot3" cx="17" cy="12" r="1.6" fill="currentColor" />
      <circle className="netDot netDot4" cx="12" cy="17" r="1.6" fill="currentColor" />
    </svg>
  );
}



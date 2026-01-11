export function NetworkBackdrop() {
  return (
    <div className="bgNetwork" aria-hidden="true">
      <svg
        className="bgNetworkSvg"
        viewBox="0 0 800 520"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="xMidYMid slice"
      >
        <path
          className="bgLine"
          d="M120 120C220 70 280 210 360 180C460 140 520 40 650 120"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.18"
        />
        <path
          className="bgLine bgLine2"
          d="M110 330C230 260 310 420 420 360C520 310 560 210 690 260"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.14"
        />
        <path
          className="bgLine bgLine3"
          d="M250 70C310 120 300 220 380 260C480 310 560 250 620 320"
          stroke="currentColor"
          strokeWidth="2"
          opacity="0.12"
        />

        {[
          [120, 120],
          [360, 180],
          [650, 120],
          [110, 330],
          [420, 360],
          [690, 260],
          [250, 70],
          [380, 260],
          [620, 320],
        ].map(([cx, cy]) => (
          <circle
            key={`${cx}-${cy}`}
            className="bgDot"
            cx={cx}
            cy={cy}
            r="5"
            fill="currentColor"
            opacity="0.22"
          />
        ))}
      </svg>
    </div>
  );
}



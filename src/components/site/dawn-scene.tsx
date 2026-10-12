/**
 * The mountain at first light, drawn rather than photographed: sky, the far
 * peaks, the moorland, the forest line. Stands behind a heading wherever
 * there is no photograph. The peaks sit to the right, clear of the heading,
 * and a narrow screen is shown the right-hand side of the drawing.
 */
export function DawnScene({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMaxYMax slice"
      aria-hidden="true"
      className={`block size-full ${className}`}
    >
      <defs>
        <linearGradient id="dawn-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0a141a" />
          <stop offset="0.45" stopColor="#172a36" />
          <stop offset="0.72" stopColor="#33505f" />
          <stop offset="0.9" stopColor="#8a7f6c" />
          <stop offset="1" stopColor="#e5a23a" />
        </linearGradient>
        <radialGradient id="dawn-glow" cx="0.9" cy="0.8" r="0.55">
          <stop offset="0" stopColor="#f6c877" stopOpacity="0.6" />
          <stop offset="0.45" stopColor="#e5a23a" stopOpacity="0.18" />
          <stop offset="1" stopColor="#e5a23a" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="dawn-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#456675" />
          <stop offset="1" stopColor="#2a4352" />
        </linearGradient>
      </defs>

      <rect width="1600" height="900" fill="url(#dawn-sky)" />
      <rect width="1600" height="900" fill="url(#dawn-glow)" />

      {/* A few last stars. */}
      <g fill="#f6f8f5">
        <circle cx="210" cy="120" r="1.4" opacity="0.7" />
        <circle cx="520" cy="70" r="1.1" opacity="0.5" />
        <circle cx="770" cy="190" r="1.2" opacity="0.45" />
        <circle cx="1010" cy="95" r="1.5" opacity="0.6" />
        <circle cx="1470" cy="150" r="1" opacity="0.4" />
        <circle cx="1540" cy="60" r="1.3" opacity="0.55" />
        <circle cx="360" cy="250" r="1" opacity="0.35" />
      </g>

      {/* The peaks: Batian and Nelion, with Lenana to the right. */}
      <path
        d="M0 650 L260 624 L520 596 L760 560 L940 508 L1080 440 L1168 392 L1212 316 L1240 350 L1262 300 L1300 374 L1344 404 L1392 384 L1440 436 L1510 470 L1600 500 L1600 900 L0 900Z"
        fill="url(#dawn-far)"
      />
      {/* Snow in the gullies, catching the light. */}
      <path
        d="M1212 316 L1224 352 L1214 380 L1205 350Z M1262 300 L1278 346 L1268 378 L1257 344Z"
        fill="#f6f8f5"
        opacity="0.28"
      />

      {/* Moorland. */}
      <path
        d="M0 700 L140 672 L320 690 L520 640 L700 668 L880 632 L1080 672 L1270 644 L1460 676 L1600 660 L1600 900 L0 900Z"
        fill="#1d3441"
      />
      {/* The forest edge, nearest. */}
      <path
        d="M0 780 L60 768 L96 740 L130 770 L190 758 L226 722 L262 760 L330 772 L372 738 L410 774 L500 764 L540 730 L580 770 L690 780 L730 746 L772 782 L880 770 L920 736 L960 776 L1070 782 L1110 744 L1150 780 L1260 772 L1300 738 L1340 776 L1450 782 L1490 748 L1530 780 L1600 772 L1600 900 L0 900Z"
        fill="#0d1920"
      />
    </svg>
  );
}

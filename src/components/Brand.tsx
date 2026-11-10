/** The QuickSlot app icon (same drawing as public/favicon.svg): a calendar with a gold marked day, on True Blue. */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="6" fill="#0062E3" />
      <rect x="6" y="9" width="20" height="18" rx="3" fill="none" stroke="#FFFFFF" strokeWidth="2" />
      <line x1="6" y1="15" x2="26" y2="15" stroke="#FFFFFF" strokeWidth="2" />
      <rect x="10" y="6" width="3" height="5" rx="1" fill="#FFFFFF" />
      <rect x="19" y="6" width="3" height="5" rx="1" fill="#FFFFFF" />
      <circle cx="12" cy="21" r="2" fill="#FED141" />
    </svg>
  );
}

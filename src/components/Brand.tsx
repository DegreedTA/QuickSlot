export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#17475a" />
      <rect x="7" y="7" width="4" height="18" rx="2" fill="#6f9fab" />
      <rect x="14" y="12" width="4" height="13" rx="2" fill="#9ed8d2" />
      <rect x="21" y="9" width="4" height="10" rx="2" fill="#9ed8d2" />
    </svg>
  );
}

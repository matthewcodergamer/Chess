export default function BrandMark({ className = 'wordmark-pawn' }: { className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      <img src={`${import.meta.env.BASE_URL}brand-pawn.png`} alt="" width="32" height="32" />
    </span>
  );
}

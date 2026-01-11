type Props = {
  size?: number;
  title?: string;
  className?: string;
};

/**
 * Wykra logo (transparent background PNG).
 */
export function WykraLogo({ size = 56, title = 'Wykra', className }: Props) {
  return (
    <img
      src="/wykra_logo_transparent.png"
      alt={title}
      width={size}
      height={size}
      className={className}
      style={{ objectFit: 'contain' }}
    />
  );
}



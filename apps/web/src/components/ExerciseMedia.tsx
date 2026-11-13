import { useEffect, useState, type ReactNode } from "react";
import type { ExerciseMediaAsset } from "../exercise/media";

/**
 * Exercise media slot.
 *
 * Renders a reviewed photograph when one is registered, and the caller's
 * anatomy figure otherwise — including when a registered file fails to load, so
 * a missing asset degrades to the accurate illustration instead of a broken
 * image box. The box keeps a stable 4:3 aspect ratio so the composition does
 * not jump while the photo decodes.
 */
export function ExerciseMedia({
  asset,
  fallback,
  className,
}: {
  asset: ExerciseMediaAsset | undefined;
  /** Always supplied: the anatomy figure for this exercise. */
  fallback: ReactNode;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [asset?.src]);

  if (!asset || failed) return <>{fallback}</>;

  return (
    <figure className={`fc-media${className ? ` ${className}` : ""}`}>
      <img
        className="fc-media__image"
        src={asset.src}
        alt={asset.alt}
        width={asset.width}
        height={asset.height}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </figure>
  );
}

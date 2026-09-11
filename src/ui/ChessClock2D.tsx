import type { ComponentProps } from 'react';
import PhysicalChessClock from './PhysicalChessClock';

type Props = ComponentProps<typeof PhysicalChessClock>;

/**
 * Compatibility export for older imports. All QQURZ modes now render the same
 * PhysicalChessClock component and therefore the same model/state behavior.
 */
export default function ChessClock2D(props: Props) {
  return <PhysicalChessClock {...props} />;
}

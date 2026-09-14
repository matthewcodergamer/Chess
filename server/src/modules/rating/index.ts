export * from '../../rating';
import { moduleDescriptor } from '../contracts';

export const ratingModule = moduleDescriptor('rating', [
  'Chess960 Rapid, Blitz and Bullet Glicko-2 state',
  'rating updates and provisional-state rules',
  'rating inactivity/deviation handling',
]);

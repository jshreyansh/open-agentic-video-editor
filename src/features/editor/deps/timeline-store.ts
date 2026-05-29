/**
 * Adapter exports for timeline store dependencies.
 * Editor modules should import timeline store types/selectors from here.
 */

export type { TimelineState, TimelineActions } from './timeline-contract'
export {
  importWaveformCache,
  rateStretchItemWithoutHistory,
  useTimelineStore,
  useTimelineSettingsStore,
  useItemsStore,
  useKeyframesStore,
  useCompositionsStore,
  useTimelineCommandStore,
  captureSnapshot,
  restoreSnapshot,
} from './timeline-contract'
export type { TimelineSnapshot } from './timeline-contract'
export { rippleInsertFromMedia } from '@/features/timeline/stores/actions/item-actions'

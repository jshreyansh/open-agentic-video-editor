/**
 * Contract: timeline dependencies consumed by ai-chat feature.
 * This file is the only place in ai-chat/deps/ allowed to import cross-feature from timeline.
 */

// Stores
export {
  useTimelineStore,
  useKeyframesStore,
  captureSnapshot,
  restoreSnapshot,
  findCompatibleTrackForItemType,
  findNearestAvailableSpace,
  linkItems,
} from '@/features/timeline/contracts/editor'
export type { TimelineSnapshot } from '@/features/timeline/contracts/editor'
export { useTransitionsStore } from '@/features/timeline/stores/transitions-store'

// Actions
export {
  addItem,
  removeItems,
  moveItem,
  updateItem,
} from '@/features/timeline/stores/actions/item-actions'
export { splitItem } from '@/features/timeline/stores/actions/edit/split-actions'
export { trimItemStart, trimItemEnd } from '@/features/timeline/stores/actions/edit/trim-actions'
export { addKeyframes, removeKeyframes } from '@/features/timeline/stores/actions/keyframe-actions'
export { addEffect } from '@/features/timeline/stores/actions/effect-actions'
export {
  addTransition,
  removeTransition,
} from '@/features/timeline/stores/actions/transition-actions'

// Utils
export { createClassicTrack } from '@/features/timeline/utils/classic-tracks'
export type { TrackKind } from '@/features/timeline/utils/classic-tracks'

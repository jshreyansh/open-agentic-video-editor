/**
 * Contract: media-library dependencies consumed by ai-chat feature.
 */

export { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
export const importMediaLibraryService = () =>
  import('@/features/media-library/services/media-library-service')

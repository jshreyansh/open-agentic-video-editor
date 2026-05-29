/**
 * Contract: editor feature dependencies consumed by ai-chat.
 * This file is the only place in ai-chat/deps/ allowed to import cross-feature from editor.
 */

export { useSettingsStore } from '@/features/editor/deps/settings'
export { useProjectStore } from '@/features/editor/deps/projects'

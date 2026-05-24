import { createLogger } from '@/shared/logging/logger'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import {
  findCompatibleTrackForItemType,
  findNearestAvailableSpace,
} from '@/features/editor/deps/timeline-utils'
import { removeItems, moveItem, updateItem } from '@/features/timeline/stores/actions/item-actions'
import { splitItem } from '@/features/timeline/stores/actions/edit/split-actions'
import { trimItemStart, trimItemEnd } from '@/features/timeline/stores/actions/edit/trim-actions'
import type { TextItem } from '@/types/timeline'
import type { AiCommand } from './claude-api'

const log = createLogger('ai-chat:command-executor')

export function executeCommands(commands: AiCommand[]): void {
  for (const cmd of commands) {
    try {
      executeOne(cmd)
    } catch (err) {
      log.warn('Command failed:', cmd.type, err)
    }
  }
}

function executeOne(cmd: AiCommand): void {
  switch (cmd.type) {
    case 'delete_items': {
      const ids = cmd.itemIds as string[]
      if (ids.length > 0) removeItems(ids)
      break
    }

    case 'add_text': {
      const { tracks, items } = useTimelineStore.getState()
      const track = findCompatibleTrackForItemType({
        tracks,
        items,
        itemType: 'text',
        preferredTrackId: undefined,
      })
      if (!track) break

      const from = cmd.from as number
      const durationInFrames = cmd.durationInFrames as number
      const finalFrom = findNearestAvailableSpace(from, durationInFrames, track.id, items) ?? from

      const textItem: TextItem = {
        id: crypto.randomUUID(),
        type: 'text',
        trackId: track.id,
        from: finalFrom,
        durationInFrames,
        label: (cmd.text as string).slice(0, 40),
        originId: crypto.randomUUID(),
        text: cmd.text as string,
        color: '#ffffff',
        fontSize: 48,
        fontWeight: 'semibold',
        textAlign: 'center',
        verticalAlign: 'bottom',
        backgroundColor: 'rgba(0,0,0,0.6)',
        backgroundRadius: 8,
        textPadding: 12,
      }

      useTimelineStore.getState().addItem(textItem)
      log.debug('Added text item at frame', finalFrom)
      break
    }

    case 'split_item': {
      splitItem(cmd.itemId as string, cmd.atFrame as number)
      break
    }

    case 'trim_start': {
      trimItemStart(cmd.itemId as string, cmd.trimAmount as number)
      break
    }

    case 'trim_end': {
      trimItemEnd(cmd.itemId as string, cmd.trimAmount as number)
      break
    }

    case 'move_item': {
      moveItem(cmd.itemId as string, cmd.newFrom as number)
      break
    }

    case 'update_speed': {
      updateItem(cmd.itemId as string, { speed: cmd.speed as number })
      break
    }

    default:
      log.warn('Unknown command type:', (cmd as { type: string }).type)
  }
}

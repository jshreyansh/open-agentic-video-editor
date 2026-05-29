import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Film, Image, Music, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useInsertClipDialogStore } from '@/shared/state/insert-clip-dialog/store'
import { useMediaLibraryStore } from '@/features/editor/deps/media-library'
import { rippleInsertFromMedia } from '@/features/editor/deps/timeline-store'
import { createLogger } from '@/shared/logging/logger'
import { cn } from '@/shared/ui/cn'

const log = createLogger('insert-clip-dialog')

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function MediaTypeIcon({ mimeType }: { mimeType: string }) {
  if (mimeType.startsWith('video/')) return <Film className="w-3.5 h-3.5 shrink-0" />
  if (mimeType.startsWith('audio/')) return <Music className="w-3.5 h-3.5 shrink-0" />
  return <Image className="w-3.5 h-3.5 shrink-0" />
}

export const InsertClipDialog = memo(function InsertClipDialog() {
  const { t } = useTranslation()
  const isOpen = useInsertClipDialogStore((s) => s.isOpen)
  const insertFrame = useInsertClipDialogStore((s) => s.insertFrame)
  const targetTrackId = useInsertClipDialogStore((s) => s.targetTrackId)
  const close = useInsertClipDialogStore((s) => s.close)

  const mediaItems = useMediaLibraryStore((s) => s.mediaItems)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isInserting, setIsInserting] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? mediaItems.filter((m) => m.fileName.toLowerCase().includes(q)) : mediaItems
  }, [mediaItems, query])

  const handleInsert = useCallback(async () => {
    if (!selectedId || !targetTrackId) return
    setIsInserting(true)
    try {
      await rippleInsertFromMedia(selectedId, insertFrame, targetTrackId)
      close()
    } catch (err) {
      log.warn('Insert clip failed', err)
    } finally {
      setIsInserting(false)
    }
  }, [selectedId, targetTrackId, insertFrame, close])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        close()
        setQuery('')
        setSelectedId(null)
      }
    },
    [close],
  )

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t('timeline.insertClipDialog.title', 'Insert Clip with Ripple')}
          </DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={t('timeline.insertClipDialog.searchPlaceholder', 'Search clips…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
            autoFocus
          />
        </div>

        <div className="h-64 overflow-y-auto rounded-md border border-border">
          {filtered.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              {t('timeline.insertClipDialog.noResults', 'No clips found')}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((media) => (
                <li
                  key={media.id}
                  role="option"
                  aria-selected={selectedId === media.id}
                  className={cn(
                    'flex items-center gap-2.5 px-3 py-2.5 cursor-pointer select-none text-sm',
                    'hover:bg-accent/50 transition-colors',
                    selectedId === media.id && 'bg-accent',
                  )}
                  onClick={() => setSelectedId(media.id)}
                >
                  <MediaTypeIcon mimeType={media.mimeType} />
                  <span className="flex-1 truncate">{media.fileName}</span>
                  {media.duration > 0 && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatDuration(media.duration)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button onClick={handleInsert} disabled={!selectedId || isInserting}>
            {isInserting
              ? t('timeline.insertClipDialog.inserting', 'Inserting…')
              : t('timeline.insertClipDialog.insert', 'Insert')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})

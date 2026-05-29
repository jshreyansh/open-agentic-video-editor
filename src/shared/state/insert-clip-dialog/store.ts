import { create } from 'zustand'

interface InsertClipDialogState {
  isOpen: boolean
  insertFrame: number
  targetTrackId: string | null
  open: (insertFrame: number, targetTrackId: string) => void
  close: () => void
}

export const useInsertClipDialogStore = create<InsertClipDialogState>((set) => ({
  isOpen: false,
  insertFrame: 0,
  targetTrackId: null,
  open: (insertFrame, targetTrackId) => set({ isOpen: true, insertFrame, targetTrackId }),
  close: () => set({ isOpen: false }),
}))

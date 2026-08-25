import { create } from 'zustand';

interface ModalStackStore {
  /** Ids of every open modal, innermost last. */
  ids: string[];
  push: (id: string) => void;
  pop: (id: string) => void;
}

/**
 * The stack of open modals, innermost last.
 *
 * Two things need it. Escape is listened for on `document`, so without a stack every open
 * modal answers the same keypress and a modal opened from inside another closes both,
 * taking the outer one's unsaved draft with it: only the topmost may respond. And the
 * floating assistant is fixed above every scrim, so the shell hides it while anything is
 * open.
 *
 * A store rather than the module-level array this used to be, because the shell has to
 * re-render when the stack fills or empties, and a plain array cannot say that it did.
 */
export const useModalStackStore = create<ModalStackStore>(set => ({
  ids: [],
  push: id => set(state => ({ ids: [...state.ids, id] })),
  // lastIndexOf, so closing one of two modals sharing an id removes one entry, not both.
  pop: id =>
    set(state => {
      const index = state.ids.lastIndexOf(id);
      if (index === -1) return state;
      return { ids: [...state.ids.slice(0, index), ...state.ids.slice(index + 1)] };
    }),
}));

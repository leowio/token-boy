export type SubtabNavState<T extends string> = {
  activeSubtabs: T[];
  activeSubtab: T;
  isSubtabActive: (subtab: string) => boolean;
  setActiveSubtab: (subtab: string) => void;
  onSubtabKeydown: (event: KeyboardEvent, currentIndex: number) => void;
};

type CreateSubtabNavOptions<T extends string> = {
  subtabs: readonly T[];
  initialSubtab?: T;
  beforeChange?: (nextSubtab: T, previousSubtab: T) => void;
  onChange?: (nextSubtab: T, previousSubtab: T) => void;
};

export function createSubtabNav<T extends string>({
  subtabs,
  initialSubtab,
  beforeChange,
  onChange,
}: CreateSubtabNavOptions<T>): SubtabNavState<T> {
  const activeSubtabs = [...subtabs];
  const activeSubtab = initialSubtab ?? activeSubtabs[0];

  if (!activeSubtab) {
    throw new Error("createSubtabNav requires at least one subtab");
  }

  return {
    activeSubtabs,
    activeSubtab,
    isSubtabActive(this: SubtabNavState<T>, subtab: string) {
      return this.activeSubtab === subtab;
    },
    setActiveSubtab(this: SubtabNavState<T>, subtab: string) {
      if (!activeSubtabs.includes(subtab as T) || this.activeSubtab === subtab) {
        return;
      }

      const nextSubtab = subtab as T;
      const previousSubtab = this.activeSubtab;
      beforeChange?.(nextSubtab, previousSubtab);
      this.activeSubtab = nextSubtab;
      onChange?.(nextSubtab, previousSubtab);
    },
    onSubtabKeydown(this: SubtabNavState<T>, event: KeyboardEvent, currentIndex: number) {
      const lastIndex = activeSubtabs.length - 1;
      let nextIndex = currentIndex;

      if (event.key === "ArrowRight") {
        nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
      } else if (event.key === "ArrowLeft") {
        nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = lastIndex;
      } else {
        return;
      }

      event.preventDefault();
      const nextSubtab = activeSubtabs[nextIndex];
      this.setActiveSubtab(nextSubtab);
      focusSubtabButton(nextSubtab);
    },
  };
}

function focusSubtabButton(subtab: string) {
  requestAnimationFrame(() => {
    document.querySelector<HTMLButtonElement>(`.subtab-button[data-subtab="${subtab}"]`)?.focus();
  });
}

import type { ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Vertical drag-and-drop list.
 *
 * dnd-kit rather than the HTML5 drag API because it is keyboard-accessible out
 * of the box — Tab to the handle, Space to lift, arrows to move, Space to drop,
 * with ARIA live announcements. Curriculum ordering is admin-critical and
 * should not require a mouse.
 *
 * Reordering is optimistic: `onReorder` receives the new order immediately and
 * the caller persists it, rolling back on failure.
 */

interface SortableListProps<T> {
  items: T[];
  getId: (item: T) => string;
  onReorder: (orderedIds: string[]) => void;
  children: (item: T, index: number) => ReactNode;
  disabled?: boolean;
  className?: string;
}

export function SortableList<T>({
  items,
  getId,
  onReorder,
  children,
  disabled = false,
  className,
}: SortableListProps<T>) {
  const sensors = useSensors(
    // A small activation distance keeps a click on a button inside the row from
    // being swallowed as the start of a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const ids = items.map(getId);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;

    onReorder(arrayMove(ids, from, to));
  };

  if (disabled) {
    return <div className={className}>{items.map((item, i) => children(item, i))}</div>;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToVerticalAxis, restrictToParentElement]}
    >
      <SortableContext items={items.map(getId)} strategy={verticalListSortingStrategy}>
        <div className={className}>{items.map((item, i) => children(item, i))}</div>
      </SortableContext>
    </DndContext>
  );
}

/**
 * One draggable row. The handle is a dedicated grip rather than the whole row,
 * so buttons and links inside stay clickable.
 */
export function SortableItem({
  id,
  children,
  className,
  disabled = false,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group relative',
        isDragging && 'z-10 opacity-90 shadow-lg ring-2 ring-primary/30',
        className
      )}
    >
      <div className="flex items-start gap-2">
        {!disabled && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Reorder — press space to lift, then use the arrow keys"
            className="mt-3 cursor-grab touch-none rounded p-1 text-gray-300 transition-colors hover:text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

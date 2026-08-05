import type { Prisma } from '@prisma/client';
import prisma from '../../config/db';
import { CONTENT_SELECT } from './content.service';
import { contentVisibilityWhere, type VisibilityContext } from './visibility.service';

/**
 * Content search and filtering.
 *
 * The visibility rule is NOT reimplemented here — every query is AND-ed with
 * `contentVisibilityWhere`, the same builder the curriculum reads use. Search
 * is the classic place an authorization bypass appears: a filter that forgets
 * the scope clause happily returns another batch's material, and it looks
 * correct in every test that only checks the search term.
 */

export interface ContentSearchFilters {
  /** Free text over title and description. */
  q?: string;
  learningPathId?: string;
  moduleId?: string;
  type?: string;
  status?: string;
  scope?: 'LEARNING_PATH' | 'BATCH';
  batchId?: string;
  page?: number;
  pageSize?: number;
}

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export class SearchService {
  /**
   * Paginated content search within the caller's visibility.
   *
   * Runs the count and the page in a single round trip. `select` is the shared
   * CONTENT_SELECT, so search results carry exactly the shape the curriculum
   * views already render — no second serializer to keep in sync.
   */
  static async searchContent(filters: ContentSearchFilters, context: VisibilityContext) {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));

    const conditions: Prisma.ContentWhereInput[] = [contentVisibilityWhere(context)];

    const term = filters.q?.trim();
    if (term) {
      conditions.push({
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { description: { contains: term, mode: 'insensitive' } },
        ],
      });
    }

    if (filters.learningPathId) conditions.push({ learningPathId: filters.learningPathId });
    if (filters.moduleId) conditions.push({ moduleId: filters.moduleId });
    if (filters.type) conditions.push({ type: filters.type as Prisma.EnumContentTypeFilter['equals'] });
    if (filters.status) conditions.push({ status: filters.status as Prisma.EnumContentStatusFilter['equals'] });
    if (filters.scope) conditions.push({ scope: filters.scope });
    if (filters.batchId) conditions.push({ batchId: filters.batchId });

    const where: Prisma.ContentWhereInput = { AND: conditions };

    const [items, total] = await prisma.$transaction([
      prisma.content.findMany({
        where,
        select: {
          ...CONTENT_SELECT,
          // Search spans modules, so each hit states where it lives. Selected
          // rather than separately fetched — this is the N+1 that a search
          // results list invites.
          module: { select: { id: true, name: true } },
          learningPath: { select: { id: true, name: true, version: true } },
        },
        orderBy: [{ updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.content.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      hasMore: page * pageSize < total,
    };
  }

  /**
   * Facet counts for the filter UI, computed inside the caller's visibility.
   *
   * Two grouped queries rather than one query per filter option — the naive
   * version issues a count per content type and per status on every keystroke.
   */
  static async facets(filters: ContentSearchFilters, context: VisibilityContext) {
    const conditions: Prisma.ContentWhereInput[] = [contentVisibilityWhere(context)];
    if (filters.learningPathId) conditions.push({ learningPathId: filters.learningPathId });
    if (filters.moduleId) conditions.push({ moduleId: filters.moduleId });
    const where: Prisma.ContentWhereInput = { AND: conditions };

    // Promise.all rather than $transaction: these are two independent read-only
    // counts that never need to agree with each other to the row, and
    // $transaction erases groupBy's narrow return type.
    //
    // orderBy is required by Prisma's groupBy typing, and gives the filter
    // dropdown a stable order for free.
    const [byType, byStatus] = await Promise.all([
      prisma.content.groupBy({ by: ['type'], where, _count: { _all: true }, orderBy: { type: 'asc' } }),
      prisma.content.groupBy({ by: ['status'], where, _count: { _all: true }, orderBy: { status: 'asc' } }),
    ]);

    return {
      types: byType.map((r) => ({ value: r.type, count: r._count._all })),
      statuses: byStatus.map((r) => ({ value: r.status, count: r._count._all })),
    };
  }
}

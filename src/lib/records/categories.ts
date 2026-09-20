import { and, asc, eq, isNull } from 'drizzle-orm';
import { recordAudit, type DbTx } from '../audit';
import type { Db } from '../db/client';
import { categories } from '../db/schema';
import { VersionConflictError } from './errors';

/**
 * Category tree domain (SPEC §12): exactly two levels, user-editable,
 * allocations always land on a child (leaf). Retiring a child blocks new
 * assignments but preserves history — nothing is ever deleted.
 *
 * Used by server actions and tests — one code path, no drift. All writes run
 * in a synchronous transaction together with their audit entry (blueprint
 * §3); synchronous transactions on the process's single connection cannot
 * interleave, so the read-check-update version guard below is airtight for
 * this single-writer deployment.
 */

export type Category = typeof categories.$inferSelect;

export interface CategoryNode extends Category {
  children: Category[];
}

export class CategoryNotFoundError extends Error {
  constructor(categoryId: number) {
    super(`No category with id ${categoryId}`);
    this.name = 'CategoryNotFoundError';
  }
}

export class CategoryLevelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CategoryLevelError';
  }
}

export class CategoryAlreadyRetiredError extends Error {
  constructor(categoryId: number) {
    super(`Category ${categoryId} is already retired.`);
    this.name = 'CategoryAlreadyRetiredError';
  }
}

/** Assigning a retired category to a new line — history keeps it, new lines cannot take it. */
export class CategoryRetiredError extends Error {
  constructor(name: string) {
    super(`“${name}” is retired — pick a current category for the new line.`);
    this.name = 'CategoryRetiredError';
  }
}

export class InvalidCategoryNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCategoryNameError';
  }
}

export class DuplicateCategoryNameError extends Error {
  constructor(name: string) {
    super(`There is already a category called “${name}” at this level.`);
    this.name = 'DuplicateCategoryNameError';
  }
}

export const MAX_CATEGORY_NAME_LENGTH = 60;

/** Flat list: parents first, each followed by its children, in sort order. */
export function listCategories(db: Db): Category[] {
  return categoryTree(db).flatMap((parent) => [parent, ...parent.children]);
}

/** The tree: parents in sort order, each with its children in sort order. */
export function categoryTree(db: Db): CategoryNode[] {
  const rows = db
    .select()
    .from(categories)
    .orderBy(asc(categories.sortOrder), asc(categories.name))
    .all();
  const nodes = new Map<number, CategoryNode>();
  const parents: CategoryNode[] = [];
  for (const row of rows) {
    if (row.parentId === null) {
      const node: CategoryNode = { ...row, children: [] };
      nodes.set(row.id, node);
      parents.push(node);
    }
  }
  for (const row of rows) {
    if (row.parentId !== null) {
      nodes.get(row.parentId)?.children.push(row);
    }
  }
  return parents;
}

export function getCategory(db: Db, categoryId: number): Category {
  const row = db.select().from(categories).where(eq(categories.id, categoryId)).get();
  if (row === undefined) {
    throw new CategoryNotFoundError(categoryId);
  }
  return row;
}

/** Exact-name lookup of a parent (used by fixtures and the Settings editor). */
export function findParentCategory(db: Db, name: string): Category | null {
  const row = db
    .select()
    .from(categories)
    .where(and(isNull(categories.parentId), eq(categories.name, name)))
    .get();
  return row ?? null;
}

/** Exact-name lookup of a child within a named parent. */
export function findChildCategory(db: Db, parentName: string, childName: string): Category | null {
  const parent = findParentCategory(db, parentName);
  if (parent === null) return null;
  const row = db
    .select()
    .from(categories)
    .where(and(eq(categories.parentId, parent.id), eq(categories.name, childName)))
    .get();
  return row ?? null;
}

export interface CreateParentCategoryInput {
  name: string;
  actor: string;
  sortOrder?: number;
  now?: Date;
}

export function createParentCategory(db: Db, input: CreateParentCategoryInput): Category {
  const now = input.now ?? new Date();
  const name = checkedName(input.name);
  return db.transaction((tx) => {
    assertSiblingNameFree(
      tx.select().from(categories).where(isNull(categories.parentId)).all(),
      name,
      null,
    );
    const inserted = tx
      .insert(categories)
      .values({
        parentId: null,
        name,
        sortOrder: input.sortOrder ?? nextSortOrder(tx, null),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    if (inserted === undefined) {
      throw new Error('insert category returned no row');
    }
    recordAudit(tx, {
      actor: input.actor,
      action: 'category.create',
      entity: 'category',
      entityId: inserted.id,
      summary: `Created category “${inserted.name}”`,
      after: inserted,
      now,
    });
    return inserted;
  });
}

export interface CreateChildCategoryInput {
  parentId: number;
  name: string;
  actor: string;
  sortOrder?: number;
  now?: Date;
}

export function createChildCategory(db: Db, input: CreateChildCategoryInput): Category {
  const now = input.now ?? new Date();
  const name = checkedName(input.name);
  return db.transaction((tx) => {
    const parent = tx.select().from(categories).where(eq(categories.id, input.parentId)).get();
    if (parent === undefined) {
      throw new CategoryNotFoundError(input.parentId);
    }
    if (parent.parentId !== null) {
      throw new CategoryLevelError(
        `“${parent.name}” is itself a child category — the tree has exactly two levels (SPEC §12).`,
      );
    }
    assertSiblingNameFree(
      tx.select().from(categories).where(eq(categories.parentId, parent.id)).all(),
      name,
      null,
    );
    const inserted = tx
      .insert(categories)
      .values({
        parentId: parent.id,
        name,
        sortOrder: input.sortOrder ?? nextSortOrder(tx, parent.id),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    if (inserted === undefined) {
      throw new Error('insert category returned no row');
    }
    recordAudit(tx, {
      actor: input.actor,
      action: 'category.create',
      entity: 'category',
      entityId: inserted.id,
      summary: `Created category “${parent.name} / ${inserted.name}”`,
      after: inserted,
      now,
    });
    return inserted;
  });
}

export interface RenameCategoryInput {
  id: number;
  expectedVersion: number;
  name: string;
  actor: string;
  now?: Date;
}

export function renameCategory(db: Db, input: RenameCategoryInput): Category {
  const now = input.now ?? new Date();
  const name = checkedName(input.name);
  return db.transaction((tx) => {
    const current = tx.select().from(categories).where(eq(categories.id, input.id)).get();
    if (current === undefined) {
      throw new CategoryNotFoundError(input.id);
    }
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError('category', input.id, input.expectedVersion, current.version);
    }
    const siblings =
      current.parentId === null
        ? tx.select().from(categories).where(isNull(categories.parentId)).all()
        : tx.select().from(categories).where(eq(categories.parentId, current.parentId)).all();
    assertSiblingNameFree(siblings, name, current.id);
    const updated = tx
      .update(categories)
      .set({ name, updatedAt: now, version: current.version + 1 })
      .where(eq(categories.id, input.id))
      .returning()
      .get();
    if (updated === undefined) {
      throw new Error('update category returned no row');
    }
    recordAudit(tx, {
      actor: input.actor,
      action: 'category.rename',
      entity: 'category',
      entityId: input.id,
      summary: `Renamed category “${current.name}” to “${name}”`,
      before: current,
      after: updated,
      now,
    });
    return updated;
  });
}

export interface RetireCategoryInput {
  id: number;
  expectedVersion: number;
  actor: string;
  now?: Date;
}

/**
 * Retire a child category: it can no longer be assigned to new lines, but
 * every existing allocation keeps pointing at it (SPEC §12). Parents cannot
 * be retired in v1 — retire the children instead.
 */
export function retireCategory(db: Db, input: RetireCategoryInput): Category {
  const now = input.now ?? new Date();
  return db.transaction((tx) => {
    const current = tx.select().from(categories).where(eq(categories.id, input.id)).get();
    if (current === undefined) {
      throw new CategoryNotFoundError(input.id);
    }
    if (current.version !== input.expectedVersion) {
      throw new VersionConflictError('category', input.id, input.expectedVersion, current.version);
    }
    if (current.parentId === null) {
      throw new CategoryLevelError(
        `“${current.name}” is a parent category — retire its children instead; parents stay while history points at them.`,
      );
    }
    if (current.retiredAt !== null) {
      throw new CategoryAlreadyRetiredError(input.id);
    }
    const updated = tx
      .update(categories)
      .set({ retiredAt: now, updatedAt: now, version: current.version + 1 })
      .where(eq(categories.id, input.id))
      .returning()
      .get();
    if (updated === undefined) {
      throw new Error('update category returned no row');
    }
    recordAudit(tx, {
      actor: input.actor,
      action: 'category.retire',
      entity: 'category',
      entityId: input.id,
      summary: `Retired category “${current.name}” (history preserved)`,
      before: current,
      after: updated,
      now,
    });
    return updated;
  });
}

function checkedName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name === '') {
    throw new InvalidCategoryNameError('Give the category a name.');
  }
  if (name.length > MAX_CATEGORY_NAME_LENGTH) {
    throw new InvalidCategoryNameError(
      `Keep the category name to ${MAX_CATEGORY_NAME_LENGTH} characters or fewer.`,
    );
  }
  return name;
}

function assertSiblingNameFree(siblings: Category[], name: string, selfId: number | null): void {
  const clash = siblings.some(
    (sibling) => sibling.id !== selfId && sibling.name.toLowerCase() === name.toLowerCase(),
  );
  if (clash) {
    throw new DuplicateCategoryNameError(name);
  }
}

function nextSortOrder(tx: DbTx, parentId: number | null): number {
  const siblings =
    parentId === null
      ? tx.select().from(categories).where(isNull(categories.parentId)).all()
      : tx.select().from(categories).where(eq(categories.parentId, parentId)).all();
  return siblings.reduce((max, sibling) => Math.max(max, sibling.sortOrder), -1) + 1;
}

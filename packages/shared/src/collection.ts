import { z } from 'zod';

/**
 * Collections contract — the pair's own lists, and the things in them.
 *
 * A list is a name + an optional colour. A thing is a title, an optional cover
 * photo, an optional one-line note, an optional link, a status, and a score out
 * of ten. It is a catalogue the pair keeps, so a thing carries state rather than
 * being a line of text.
 */

export const COLLECTION_NAME_MAX = 60;
export const COLLECTION_EMOJI_MAX = 8;
export const COLLECTION_ITEM_TITLE_MAX = 120;
export const COLLECTION_ITEM_NOTE_MAX = 280;
export const COLLECTION_LINK_MAX = 500;
export const COLLECTION_COVER_MAX = 500;

/**
 * The colours a list can carry. A colour is the list's mark — chosen from a
 * small, fixed set so every list reads on every theme and in both modes.
 */
export const COLLECTION_COLORS = ['rose', 'amber', 'sage', 'sky', 'lilac', 'clay'] as const;
export type CollectionColor = (typeof COLLECTION_COLORS)[number];

/**
 * How far along a thing is. Three states, generic on purpose: one list can hold
 * films, another recipes, another places, and "Want / Doing / Done" reads
 * correctly for all of them without the pair configuring anything.
 */
export const COLLECTION_STATUSES = ['want', 'doing', 'done'] as const;
export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];

export const COLLECTION_SCORE_MIN = 1;
export const COLLECTION_SCORE_MAX = 10;

const linkSchema = z.string().trim().max(COLLECTION_LINK_MAX).nullable().optional();
const statusSchema = z.enum(COLLECTION_STATUSES).nullable().optional();
const scoreSchema = z
  .number()
  .int()
  .min(COLLECTION_SCORE_MIN)
  .max(COLLECTION_SCORE_MAX)
  .nullable()
  .optional();
const coverSchema = z.string().trim().max(COLLECTION_COVER_MAX).nullable().optional();

export const collectionSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(COLLECTION_NAME_MAX),
  /** A short glyph the couple chose. Null when they didn't. */
  emoji: z.string().max(COLLECTION_EMOJI_MAX).nullable().optional(),
  /** The list's colour, from the fixed palette. Null when they didn't choose. */
  color: z.enum(COLLECTION_COLORS).nullable().optional(),
  position: z.number().int(),
  itemCount: z.number().int().nonnegative(),
  createdByUserId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Collection = z.infer<typeof collectionSchema>;

export const collectionItemSchema = z.object({
  id: z.string(),
  collectionId: z.string(),
  title: z.string().min(1).max(COLLECTION_ITEM_TITLE_MAX),
  note: z.string().max(COLLECTION_ITEM_NOTE_MAX).nullable().optional(),
  /**
   * One optional link OR place. An `http(s)` string opens externally; anything
   * else is shown as plain text. No extra field decides this — the string does.
   */
  link: linkSchema,
  /** A cover photo's URI. Null when the pair did not give it one. */
  coverUrl: coverSchema,
  /** How far along it is. Null when nobody has said. */
  status: statusSchema,
  /** Out of ten, one score for the pair. Null when unrated. */
  score: scoreSchema,
  position: z.number().int(),
  createdByUserId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CollectionItem = z.infer<typeof collectionItemSchema>;

export const createCollectionRequestSchema = z.object({
  name: z.string().trim().min(1).max(COLLECTION_NAME_MAX),
  emoji: z.string().trim().max(COLLECTION_EMOJI_MAX).nullable().optional(),
  color: z.enum(COLLECTION_COLORS).nullable().optional(),
});

export type CreateCollectionRequest = z.infer<typeof createCollectionRequestSchema>;

export const updateCollectionRequestSchema = z.object({
  name: z.string().trim().min(1).max(COLLECTION_NAME_MAX).optional(),
  emoji: z.string().trim().max(COLLECTION_EMOJI_MAX).nullable().optional(),
  color: z.enum(COLLECTION_COLORS).nullable().optional(),
  position: z.number().int().nonnegative().optional(),
});

export type UpdateCollectionRequest = z.infer<typeof updateCollectionRequestSchema>;

export const createCollectionItemRequestSchema = z.object({
  title: z.string().trim().min(1).max(COLLECTION_ITEM_TITLE_MAX),
  note: z.string().trim().max(COLLECTION_ITEM_NOTE_MAX).nullable().optional(),
  link: linkSchema,
  coverUrl: coverSchema,
  status: statusSchema,
  score: scoreSchema,
});

export type CreateCollectionItemRequest = z.infer<typeof createCollectionItemRequestSchema>;

export const updateCollectionItemRequestSchema = z.object({
  title: z.string().trim().min(1).max(COLLECTION_ITEM_TITLE_MAX).optional(),
  note: z.string().trim().max(COLLECTION_ITEM_NOTE_MAX).nullable().optional(),
  link: linkSchema,
  coverUrl: coverSchema,
  status: statusSchema,
  score: scoreSchema,
  position: z.number().int().nonnegative().optional(),
});

export type UpdateCollectionItemRequest = z.infer<typeof updateCollectionItemRequestSchema>;

export const collectionListResponseSchema = z.object({
  collections: z.array(collectionSchema),
});

export type CollectionListResponse = z.infer<typeof collectionListResponseSchema>;

export const collectionItemListResponseSchema = z.object({
  items: z.array(collectionItemSchema),
});

export type CollectionItemListResponse = z.infer<typeof collectionItemListResponseSchema>;

export const createCollectionResponseSchema = z.object({ collection: collectionSchema });
export const createCollectionItemResponseSchema = z.object({ item: collectionItemSchema });

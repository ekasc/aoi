import { createRoute, type OpenAPIHono } from '@hono/zod-openapi';
import type { Env } from 'hono';
import { z } from 'zod';

import {
  apiErrorSchema,
  calendarEventSchema,
  createCalendarEventRequestSchema,
  createImportedMilestoneRequestSchema,
  createProposalRequestSchema,
  createSomedayItemRequestSchema,
  currentLocationResponseSchema,
  eventProposalSchema,
  importedMilestoneSchema,
  letterSchema,
  locationConsentRequestSchema,
  locationConsentResponseSchema,
  locationShareRequestSchema,
  mediaObjectSchema,
  mediaObjectServeQuerySchema,
  mediaUploadIntentRequestSchema,
  mediaUploadIntentResponseSchema,
  markMomentsReadRequestSchema,
  markMomentsReadResponseSchema,
  momentListResponseSchema,
  momentSchema,
  momentAttachmentSchema,
  momentAttachmentInputSchema,
  timelineQuerySchema,
  timelineResponseSchema,
  proposalListResponseSchema,
  putWeeklyAnswerRequestSchema,
  sealLetterRequestSchema,
  somedayItemSchema,
  somedayListResponseSchema,
  spaceActivityItemSchema,
  spacePlusResponseSchema,
  spaceSchema,
  updateCalendarEventRequestSchema,
  updateSomedayItemRequestSchema,
  updateUserPreferencesRequestSchema,
  userPreferencesSchema,
  weeklyQuestionResponseSchema,
} from '@aoi/shared';

/**
 * OpenAPI wiring: documented routes + shared-schema components.
 *
 * The shared zod schemas are the single contract source — registering them
 * on routes here makes them appear as spec components, and `/docs` serves the
 * generated OpenAPI 3.1 document. Later stages add domain routes the same
 * way (createRoute with a shared request/response schema).
 */

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  at: z.string(),
});

/** Shared schemas surfaced as spec components (client-visible contracts). */
export const SHARED_COMPONENT_SCHEMAS = {
  ApiError: apiErrorSchema,
  Space: spaceSchema,
  Moment: momentSchema,
  MomentAttachment: momentAttachmentSchema,
  MomentAttachmentInput: momentAttachmentInputSchema,
  MomentListResponse: momentListResponseSchema,
  TimelineQuery: timelineQuerySchema,
  TimelineResponse: timelineResponseSchema,
  MarkMomentsReadRequest: markMomentsReadRequestSchema,
  MarkMomentsReadResponse: markMomentsReadResponseSchema,
  SpaceActivityItem: spaceActivityItemSchema,
  MediaObject: mediaObjectSchema,
  MediaUploadIntentRequest: mediaUploadIntentRequestSchema,
  MediaUploadIntentResponse: mediaUploadIntentResponseSchema,
  MediaObjectServeQuery: mediaObjectServeQuerySchema,
  CalendarEvent: calendarEventSchema,
  CreateCalendarEventRequest: createCalendarEventRequestSchema,
  UpdateCalendarEventRequest: updateCalendarEventRequestSchema,
  EventProposal: eventProposalSchema,
  ProposalListResponse: proposalListResponseSchema,
  CreateProposalRequest: createProposalRequestSchema,
  Letter: letterSchema,
  SealLetterRequest: sealLetterRequestSchema,
  WeeklyQuestionResponse: weeklyQuestionResponseSchema,
  PutWeeklyAnswerRequest: putWeeklyAnswerRequestSchema,
  SomedayItem: somedayItemSchema,
  SomedayListResponse: somedayListResponseSchema,
  SpacePlusResponse: spacePlusResponseSchema,
  CreateSomedayItemRequest: createSomedayItemRequestSchema,
  UpdateSomedayItemRequest: updateSomedayItemRequestSchema,
  CurrentLocationResponse: currentLocationResponseSchema,
  LocationConsentRequest: locationConsentRequestSchema,
  LocationConsentResponse: locationConsentResponseSchema,
  LocationShareRequest: locationShareRequestSchema,
  UserPreferences: userPreferencesSchema,
  UpdateUserPreferencesRequest: updateUserPreferencesRequestSchema,
  ImportedMilestone: importedMilestoneSchema,
  CreateImportedMilestoneRequest: createImportedMilestoneRequestSchema,
} as const;

const healthzRoute = createRoute({
  method: 'get',
  path: '/healthz',
  responses: {
    200: {
      description: 'Liveness',
      content: { 'application/json': { schema: healthResponseSchema } },
    },
  },
});

const readyzRoute = createRoute({
  method: 'get',
  path: '/readyz',
  responses: {
    200: {
      description: 'Readiness (D1 binding responds)',
      content: { 'application/json': { schema: healthResponseSchema } },
    },
    503: {
      description: 'Not ready',
      content: { 'application/json': { schema: healthResponseSchema } },
    },
  },
});

export function registerOpenApiRoutes<E extends Env>(app: OpenAPIHono<E>): void {
  // Surface shared contract schemas as spec components (single source of
  // truth: whatever the client validates against is what the server uses).
  // `register` accepts zod schemas directly and emits $ref components.
  for (const [name, schema] of Object.entries(SHARED_COMPONENT_SCHEMAS)) {
    app.openAPIRegistry.register(name, schema);
  }

  app.openapi(healthzRoute, (c) => c.json({ status: 'ok', at: new Date().toISOString() }));
  app.openapi(readyzRoute, (c) => c.json({ status: 'ok', at: new Date().toISOString() }));
}

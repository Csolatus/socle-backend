import { Event } from '#/domain/event.ts'
import { EventId, VenueId } from '#/domain/ids.ts'
import type { events } from '#/infrastructure/schema.ts'
import { Result } from '#/shared-kernel/result.ts'

/** A row in the PostgreSQL events table, as inferred from the Drizzle schema. */
export type EventEntity = typeof events.$inferSelect

export function eventToDomain(entity: EventEntity): Event {
  return Result.getOrThrow(
    Event.create({
      id: EventId.makeUnsafe(entity.id),
      title: entity.title,
      category: entity.category,
      startsAt: entity.startsAt,
      capacity: entity.capacity,
      venueId: VenueId.makeUnsafe(entity.venueId),
    }),
  )
}

export function eventToEntity(event: Event): EventEntity {
  return {
    id: event.data.id,
    title: event.data.title,
    category: event.data.category,
    startsAt: event.data.startsAt,
    capacity: event.data.capacity,
    venueId: event.data.venueId,
  }
}

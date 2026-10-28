import { Event } from '#/domain/event.ts'
import { EventId, VenueId } from '#/domain/ids.ts'
import { Result } from '#/shared-kernel/result.ts'

/** A row in the PostgreSQL events table, using the database's column names. */
export interface EventEntity {
  id: string
  title: string
  category: string
  starts_at: Date
  capacity: number
  venue_id: string
}

export function eventToDomain(entity: EventEntity): Event {
  return Result.getOrThrow(
    Event.create({
      id: EventId.makeUnsafe(entity.id),
      title: entity.title,
      category: entity.category,
      startsAt: entity.starts_at,
      capacity: entity.capacity,
      venueId: VenueId.makeUnsafe(entity.venue_id),
    }),
  )
}

export function eventToEntity(event: Event): EventEntity {
  return {
    id: event.data.id,
    title: event.data.title,
    category: event.data.category,
    starts_at: event.data.startsAt,
    capacity: event.data.capacity,
    venue_id: event.data.venueId,
  }
}

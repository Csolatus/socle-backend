import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
})

export const venues = pgTable('venues', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  address: text('address').notNull(),
})

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey(),
    title: text('title').notNull(),
    category: text('category').notNull(),
    startsAt: timestamp('starts_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    capacity: integer('capacity').notNull(),
    venueId: uuid('venue_id')
      .notNull()
      .references(() => venues.id),
  },
  (table) => [
    check('events_title_check', sql`length(trim(${table.title})) > 0`),
    check('events_category_check', sql`length(trim(${table.category})) > 0`),
    check('events_capacity_check', sql`${table.capacity} > 0`),
    index('events_starts_at_idx').on(table.startsAt),
    index('events_category_starts_at_idx').on(table.category, table.startsAt),
  ],
)

export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    quantity: integer('quantity').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    cancelledAt: timestamp('cancelled_at', {
      withTimezone: true,
      mode: 'date',
    }),
  },
  (table) => [
    check('reservations_quantity_check', sql`${table.quantity} > 0`),
    index('reservations_event_id_idx').on(table.eventId),
    index('reservations_user_id_idx').on(table.userId),
  ],
)

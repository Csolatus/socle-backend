import { Hono } from 'hono'
import type { UserController } from '#/controllers/user-controller.ts'

export function userRoutes(controller: UserController) {
  const routes = new Hono()
  routes.get('/me/reservations', (c) => controller.reservations(c))
  return routes
}

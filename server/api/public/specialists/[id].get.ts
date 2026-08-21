import { createError, defineEventHandler, getRouterParam } from 'h3'
import { getPublicSpecialists } from '../../../utils/specialists/registry'

export default defineEventHandler(async (event) => {
  const specialistId = getRouterParam(event, 'id')
  const specialists = await getPublicSpecialists()
  const specialist = specialists.find((item) => item.id === specialistId)

  if (!specialist) {
    throw createError({ statusCode: 404, statusMessage: 'Specialist not found' })
  }

  return { specialist }
})

import { defineEventHandler } from 'h3'
import { getPublicSpecialists } from '../../utils/specialists/registry'

export default defineEventHandler(async () => {
  return {
    specialists: await getPublicSpecialists()
  }
})

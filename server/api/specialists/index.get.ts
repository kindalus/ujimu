import { defineEventHandler } from 'h3'
import { initializeDatabase } from '../../utils/db'
import { resolveSpecialistAccessSubject } from '../../utils/specialists/access'
import { getPublicSpecialists } from '../../utils/specialists/registry'

export default defineEventHandler(async (event) => {
  const database = await initializeDatabase()
  try {
    return {
      specialists: await getPublicSpecialists({ accessSubject: resolveSpecialistAccessSubject(database, event) })
    }
  } finally {
    database.close()
  }
})

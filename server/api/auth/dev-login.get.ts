import { defineEventHandler } from 'h3'
import { isDevAuthEnabled } from '../../utils/auth/dev-login'

export default defineEventHandler(() => ({
  enabled: isDevAuthEnabled()
}))

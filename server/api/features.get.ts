import { defineEventHandler } from 'h3'
import { resolveLaunchFeatures } from '../utils/features'
import { getOtpDeliveryCapabilities } from '../utils/notifications/provider'

export default defineEventHandler(() => ({
  ...getOtpDeliveryCapabilities(process.env),
  ...resolveLaunchFeatures(process.env)
}))

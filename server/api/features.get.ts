import { defineEventHandler } from 'h3'
import { getOtpDeliveryCapabilities } from '../utils/notifications/provider'

export default defineEventHandler(() => getOtpDeliveryCapabilities(process.env))

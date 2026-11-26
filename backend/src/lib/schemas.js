import { z } from 'zod';
import { HOURS_DAYS } from './hours.js';
export const CONNECTORS = ['DOMESTIC_15A', 'INDUSTRIAL_16A', 'TYPE2_AC', 'BHARAT_AC001', 'LECCS', 'CCS2', 'BHARAT_DC001', 'CHADEMO', 'GBT'];
export const VEHICLE_TYPES = ['two_wheeler', 'three_wheeler', 'car'];
export const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict();
const str = (max, min = 1) => z.string().trim().min(min).max(max);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const hoursSchema = z.object(Object.fromEntries(HOURS_DAYS.map((d) => [d, z.array(z.object({ open: time, close: time }).strict()).max(3).default([])]))).strict();

export const profileSchema = z.object({
  name: str(80),
  vehicle: z.object({ type: z.enum(VEHICLE_TYPES), model: str(80).optional(), connector: z.enum(CONNECTORS) }).strict().optional(),
}).strict();
export const consentSchema = z.object({
  termsVersion: str(20), privacyVersion: str(20), locationConsent: z.boolean(), notificationConsent: z.boolean(),
}).strict();
export const roleSchema = z.object({ role: z.enum(['customer', 'host']) }).strict();

export const hostProfileSchema = z.object({
  displayName: str(60),
  address: str(300),
  location: latLng,
  equipment: z.object({
    chargerType: z.enum(['socket', 'wallbox', 'portable']),
    connectors: z.array(z.enum(CONNECTORS)).min(1).max(6),
    vehicleTypes: z.array(z.enum(VEHICLE_TYPES)).min(1),
    voltageV: z.number().min(100).max(1000),
    currentA: z.number().min(1).max(250),
    phase: z.enum(['single', 'three']),
    powerKw: z.number().min(0.5).max(150),
    capacity: z.number().int().min(1).max(4).default(1),
    notes: str(500, 0).optional(),
  }).strict(),
  hours: hoursSchema,
  selfDeclaration: z.object({
    earthing: z.literal(true), rcdOrElcb: z.literal(true), dedicatedCircuit: z.boolean(),
    ratedCabling: z.literal(true), dryCoveredArea: z.literal(true), accurateInformation: z.literal(true),
  }).strict(),
}).strict().superRefine((v, ctx) => {
  // Sanity check: declared power must be physically consistent with V × A (× √3 for three-phase), ±20 %.
  const e = v.equipment;
  const kw = (e.voltageV * e.currentA * (e.phase === 'three' ? Math.sqrt(3) : 1)) / 1000;
  if (e.powerKw > kw * 1.2) ctx.addIssue({ code: 'custom', path: ['equipment', 'powerKw'], message: `Power exceeds what ${e.voltageV} V × ${e.currentA} A can supply (~${kw.toFixed(1)} kW).` });
});
export const availabilitySchema = z.object({ available: z.boolean(), until: z.iso.datetime().optional() }).strict();
export const uploadSchema = z.object({
  kind: z.enum(['photo', 'document']),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  sizeBytes: z.number().int().min(1).max(10 * 1024 * 1024),
}).strict();

export const nearbyQuery = z.object({
  lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().min(0.5).max(50).default(10),
  connector: z.enum(CONNECTORS).optional(), vehicleType: z.enum(VEHICLE_TYPES).optional(),
  exclude: z.string().max(200).optional(),
});
export const createRequestSchema = z.object({
  hostId: str(128), vehicleType: z.enum(VEHICLE_TYPES), connector: z.enum(CONNECTORS),
  customerLocation: latLng, compatibilityConfirmed: z.literal(true), note: str(300, 0).optional(),
}).strict();
export const transitionSchema = z.object({
  action: z.enum(['accept', 'reject', 'cancel', 'arrive', 'start', 'complete', 'dispute']),
  reason: str(300, 0).optional(),
}).strict();
export const feedbackSchema = z.object({ rating: z.number().int().min(1).max(5), comment: str(500, 0).optional() }).strict();
export const ticketSchema = z.object({
  category: z.enum(['unsafe_charging', 'host_issue', 'customer_issue', 'app_issue', 'account', 'other']),
  message: str(2000, 5), requestId: str(128).optional(),
}).strict();
export const otpSendSchema = z.object({ phone: str(20) }).strict();
export const otpVerifySchema = z.object({ phone: str(20), otp: z.string().regex(/^\d{4,8}$/) }).strict();
export const deviceSchema = z.object({ token: str(4096, 20), platform: z.enum(['android', 'web']) }).strict();
export const sessionSchema = z.object({ method: z.enum(['google', 'email_link', 'phone']) }).strict();
export const deletionRequestSchema = z.object({ contact: str(120, 5), details: str(1000, 0).optional(), website: z.string().max(0).optional() }).strict();
export const listQuery = z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(20), status: z.string().max(30).optional() });

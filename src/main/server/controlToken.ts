import { randomBytes, timingSafeEqual } from 'node:crypto'

const controlToken = randomBytes(32).toString('hex')

export const getControlToken = (): string => controlToken

export const isValidControlToken = (candidate: string | undefined): boolean => {
  if (!candidate) return false
  const expected = Buffer.from(controlToken)
  const received = Buffer.from(candidate)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

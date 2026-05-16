import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  Base64URLString,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  Uint8Array_,
  WebAuthnCredential
} from '@simplewebauthn/server'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from '@simplewebauthn/server'

export interface GeneratePasskeyRegistrationOptionsInput {
  rpName: string
  rpID: string
  rp: { id: string; name: string }
  userName: string
  userID: Uint8Array_
  attestation: 'none'
  excludeCredentials: Array<{ id: Base64URLString; transports?: string[] }>
  authenticatorSelection: {
    residentKey: 'preferred'
    userVerification: 'preferred'
  }
}

export interface VerifyPasskeyRegistrationInput {
  response: RegistrationResponseJSON | Record<string, unknown>
  expectedChallenge: string
  expectedOrigin: string
  expectedRPID: string
}

export interface VerifiedPasskeyRegistration {
  verified: boolean
  credential: {
    credentialId: string
    publicKey: string | Uint8Array_
    counter: number
    transports: string[]
  }
  userVerified?: boolean
}

export interface GeneratePasskeyAuthenticationOptionsInput {
  rpID: string
  rpId: string
  userVerification: 'preferred'
}

export interface VerifyPasskeyAuthenticationInput {
  response: AuthenticationResponseJSON | Record<string, unknown>
  expectedChallenge: string
  expectedOrigin: string
  expectedRPID: string
  credential: {
    id: string
    publicKey: string | Uint8Array_
    counter: number
    transports?: string[]
  }
}

export interface VerifiedPasskeyAuthentication {
  verified: boolean
  credentialId: string
  newCounter: number
  userVerified?: boolean
}

export interface PasskeyWebAuthnAdapter {
  generateRegistrationOptions(input: GeneratePasskeyRegistrationOptionsInput): Promise<{
    challenge: string
    options: PublicKeyCredentialCreationOptionsJSON | Record<string, unknown>
  }>
  verifyRegistrationResponse(input: VerifyPasskeyRegistrationInput): Promise<VerifiedPasskeyRegistration>
  generateAuthenticationOptions(input: GeneratePasskeyAuthenticationOptionsInput): Promise<{
    challenge: string
    options: PublicKeyCredentialRequestOptionsJSON | Record<string, unknown>
  }>
  verifyAuthenticationResponse(input: VerifyPasskeyAuthenticationInput): Promise<VerifiedPasskeyAuthentication>
}

export function createSimpleWebAuthnAdapter(): PasskeyWebAuthnAdapter {
  return {
    async generateRegistrationOptions(input) {
      const options = await generateRegistrationOptions({
        rpName: input.rpName,
        rpID: input.rpID,
        userName: input.userName,
        userID: input.userID,
        attestationType: input.attestation,
        excludeCredentials: input.excludeCredentials as Array<{ id: Base64URLString; transports?: AuthenticatorTransportFuture[] }>,
        authenticatorSelection: input.authenticatorSelection
      })

      return { challenge: options.challenge, options }
    },

    async verifyRegistrationResponse(input) {
      const verification = await verifyRegistrationResponse({
        response: input.response as RegistrationResponseJSON,
        expectedChallenge: input.expectedChallenge,
        expectedOrigin: input.expectedOrigin,
        expectedRPID: input.expectedRPID,
        requireUserVerification: false
      })

      if (!verification.verified) {
        return {
          verified: false,
          credential: {
            credentialId: '',
            publicKey: '',
            counter: 0,
            transports: []
          }
        }
      }

      const credential = verification.registrationInfo.credential
      return {
        verified: true,
        credential: {
          credentialId: credential.id,
          publicKey: credential.publicKey,
          counter: credential.counter,
          transports: credential.transports ?? []
        },
        userVerified: verification.registrationInfo.userVerified
      }
    },

    async generateAuthenticationOptions(input) {
      const options = await generateAuthenticationOptions({
        rpID: input.rpID,
        userVerification: input.userVerification
      })

      return { challenge: options.challenge, options }
    },

    async verifyAuthenticationResponse(input) {
      const credential: WebAuthnCredential = {
        id: input.credential.id,
        publicKey: typeof input.credential.publicKey === 'string'
          ? base64UrlToBytes(input.credential.publicKey)
          : input.credential.publicKey,
        counter: input.credential.counter,
        transports: input.credential.transports as AuthenticatorTransportFuture[] | undefined
      }
      const verification = await verifyAuthenticationResponse({
        response: input.response as AuthenticationResponseJSON,
        expectedChallenge: input.expectedChallenge,
        expectedOrigin: input.expectedOrigin,
        expectedRPID: input.expectedRPID,
        credential,
        requireUserVerification: false,
        advancedFIDOConfig: { userVerification: 'preferred' }
      })

      return {
        verified: verification.verified,
        credentialId: verification.authenticationInfo.credentialID,
        newCounter: verification.authenticationInfo.newCounter,
        userVerified: verification.authenticationInfo.userVerified
      }
    }
  }
}

export function bytesToBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url')
}

export function base64UrlToBytes(value: string): Uint8Array_ {
  return Uint8Array.from(Buffer.from(value, 'base64url'))
}

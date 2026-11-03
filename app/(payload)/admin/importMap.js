import { AdminInviteButton as AdminInviteButton_5a568d0e24198ca3140489e0d330f424 } from 'payload-auth/better-auth/plugin/client'
import { AdminButtons as AdminButtons_5a568d0e24198ca3140489e0d330f424 } from 'payload-auth/better-auth/plugin/client'
import { GenerateUuidButton as GenerateUuidButton_ce3a59fe00f4e2209a6e5804babc005e } from 'payload-auth/shared/payload/fields'
import { FieldCopyButton as FieldCopyButton_ce3a59fe00f4e2209a6e5804babc005e } from 'payload-auth/shared/payload/fields'
import { LogoutButton as LogoutButton_5a568d0e24198ca3140489e0d330f424 } from 'payload-auth/better-auth/plugin/client'
import { RSCRedirect as RSCRedirect_5afe2312a68aef77a0242fe42f239ed0 } from 'payload-auth/better-auth/plugin/rsc'
import { AdminLogin as AdminLogin_5afe2312a68aef77a0242fe42f239ed0 } from 'payload-auth/better-auth/plugin/rsc'
import { AdminSignup as AdminSignup_5afe2312a68aef77a0242fe42f239ed0 } from 'payload-auth/better-auth/plugin/rsc'
import { ForgotPassword as ForgotPassword_5afe2312a68aef77a0242fe42f239ed0 } from 'payload-auth/better-auth/plugin/rsc'
import { ResetPassword as ResetPassword_5afe2312a68aef77a0242fe42f239ed0 } from 'payload-auth/better-auth/plugin/rsc'
import { CollectionCards as CollectionCards_f9c02e79a4aed9a3924487c0cd4cafb1 } from '@payloadcms/next/rsc'
import { S3ClientUploadHandler as S3ClientUploadHandler_f97aa6c64367fa259c5bc0567239ef24 } from '@payloadcms/storage-s3/client'

/** @type import('payload').ImportMap */
export const importMap = {
  "payload-auth/better-auth/plugin/client#AdminInviteButton": AdminInviteButton_5a568d0e24198ca3140489e0d330f424,
  "payload-auth/better-auth/plugin/client#AdminButtons": AdminButtons_5a568d0e24198ca3140489e0d330f424,
  "payload-auth/shared/payload/fields#GenerateUuidButton": GenerateUuidButton_ce3a59fe00f4e2209a6e5804babc005e,
  "payload-auth/shared/payload/fields#FieldCopyButton": FieldCopyButton_ce3a59fe00f4e2209a6e5804babc005e,
  "payload-auth/better-auth/plugin/client#LogoutButton": LogoutButton_5a568d0e24198ca3140489e0d330f424,
  "payload-auth/better-auth/plugin/rsc#RSCRedirect": RSCRedirect_5afe2312a68aef77a0242fe42f239ed0,
  "payload-auth/better-auth/plugin/rsc#AdminLogin": AdminLogin_5afe2312a68aef77a0242fe42f239ed0,
  "payload-auth/better-auth/plugin/rsc#AdminSignup": AdminSignup_5afe2312a68aef77a0242fe42f239ed0,
  "payload-auth/better-auth/plugin/rsc#ForgotPassword": ForgotPassword_5afe2312a68aef77a0242fe42f239ed0,
  "payload-auth/better-auth/plugin/rsc#ResetPassword": ResetPassword_5afe2312a68aef77a0242fe42f239ed0,
  "@payloadcms/next/rsc#CollectionCards": CollectionCards_f9c02e79a4aed9a3924487c0cd4cafb1,
  "@payloadcms/storage-s3/client#S3ClientUploadHandler": S3ClientUploadHandler_f97aa6c64367fa259c5bc0567239ef24
}

export const AFDIAN_PAYMENT_ACTION_CHANNEL = 'afdian-payment:action'
export const AFDIAN_PAYMENT_STATE_CHANNEL = 'afdian-payment:state'

export type AfdianPaymentMethod = 'wechat' | 'alipay'

export type AfdianPaymentStage =
  | 'loading'
  | 'login-required'
  | 'sending-code'
  | 'code-sent'
  | 'logging-in'
  | 'ready'
  | 'submitting'
  | 'qr-ready'
  | 'error'

export interface AfdianPaymentWindowState {
  title: string
  productName: string
  amount: string
  method: AfdianPaymentMethod
  stage: AfdianPaymentStage
  message: string
  phone?: string
  resendSeconds?: number
  qrDataUrl?: string
}

export type AfdianPaymentWindowAction =
  | { type: 'ready' }
  | { type: 'send-login-code'; phone: string }
  | { type: 'submit-login-code'; phone: string; code: string }
  | { type: 'select-method'; method: AfdianPaymentMethod }
  | { type: 'submit' }
  | { type: 'open-original' }
  | { type: 'close' }

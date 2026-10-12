export interface PluginPaymentInput {
  productId: string
  orderNo: string
  ext?: Record<string, unknown>
}
export interface PluginPaymentInfo extends PluginPaymentInput {
  orderId: string
  productName: string
  pluginName: string
  pluginTitle: string
  merchantName: string
  amountCents: number
  currency: 'CNY'
  status: 'pending' | 'paid' | 'expired' | 'abnormal'
  createdAt: number
  expiresAt: number
  paidAt?: number
}
export interface PluginPaymentQuery {
  productId?: string
  orderNo?: string
  status?: PluginPaymentInfo['status']
  cursor?: string
  limit?: number
}
export interface PluginPaymentRecords {
  items: PluginPaymentInfo[]
  nextCursor: string
  hasMore: boolean
}

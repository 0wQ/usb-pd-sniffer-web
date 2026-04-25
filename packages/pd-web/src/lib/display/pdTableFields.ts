import type { MessageHeader, StartOfPacket } from '@usb-pd-sniffer/pd-core'

export function formatCompactSop(sop: StartOfPacket | undefined): string {
  switch (sop) {
    case 'SOP':
      return 'SOP'
    case 'SOP_PRIME':
      return "SOP'"
    case 'SOP_DPRIME':
      return "SOP''"
    case 'SOP_PRIME_DEBUG':
      return "SOP'_Debug"
    case 'SOP_DPRIME_DEBUG':
      return "SOP''_Debug"
    default:
      return ''
  }
}

export function formatCompactPowerRoleOrCable(
  sop: StartOfPacket | undefined,
  header: MessageHeader | null | undefined,
): string {
  if (sop === undefined || header === null || header === undefined) {
    return ''
  }

  const bit = header.portPowerRoleOrCablePlugBit

  if (sop === 'SOP') {
    return bit === 0 ? 'SNK' : 'SRC'
  }

  return bit === 0 ? 'DFP|UFP' : 'CAB|VPD'
}

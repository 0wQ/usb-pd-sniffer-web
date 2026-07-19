import type { MessageTypeInfo, Section, StartOfPacket } from '../types.js'
import { readUint32Le } from '../utils/bits.js'
import { explainAlertDataObjects } from './dataObjects/alertDataObject.js'
import { explainBatteryStatusDataObjects } from './dataObjects/batteryStatusDataObject.js'
import { explainBistDataObjects } from './dataObjects/bistDataObject.js'
import { explainCountryCodeDataObjects } from './dataObjects/countryCodeDataObject.js'
import { explainEnterUsbDataObjects } from './dataObjects/enterUsbDataObject.js'
import { explainEprModeDataObjects } from './dataObjects/eprModeDataObject.js'
import { explainPowerDataObjects } from './dataObjects/powerDataObjects.js'
import {
  explainRequestDataObjects,
  type RdoKind,
} from './dataObjects/requestDataObjects.js'
import { explainRevisionDataObjects } from './dataObjects/revisionMessageDataObject.js'
import { buildGenericDataObject } from './dataObjects/sectionBuilders.js'
import { explainSourceInfoDataObjects } from './dataObjects/sourceInfoDataObjects.js'
import { explainVendorDefinedMessage } from './dataObjects/vendorDefinedMessages/index.js'

export type { RdoKind } from './dataObjects/requestDataObjects.js'
export { classifyRdoKindFromPdo } from './dataObjects/requestDataObjects.js'

function appendTrailingRawPayload(
  sections: Section[],
  payloadBytes: Uint8Array,
  payloadSectionKey: string,
  payloadByteOffset: number,
): Section[] {
  const count = Math.floor(payloadBytes.length / 4)

  if (payloadBytes.length % 4 !== 0) {
    sections.push({
      key: `${payloadSectionKey}:raw-tail`,
      kind: 'raw_payload',
      title: 'Trailing Raw Payload',
      semanticKind: 'trailing_raw_payload',
      byteOffset: payloadByteOffset + count * 4,
      byteLength: payloadBytes.length - count * 4,
      rawBytes: payloadBytes.slice(count * 4),
      fields: [],
      issues: [
        {
          severity: 'warning',
          code: 'PD_PAYLOAD_NOT_32BIT_ALIGNED',
          message:
            'Payload has trailing bytes that do not form a complete 32-bit object.',
        },
      ],
    })
  }

  return sections
}

export function explainDataObjects(
  payloadBytes: Uint8Array,
  sop: StartOfPacket,
  messageType: MessageTypeInfo,
  payloadSectionKey: string,
  payloadByteOffset: number,
  options: {
    requestRdoKind?: RdoKind | null
  } = {},
): Section[] {
  const count = Math.floor(payloadBytes.length / 4)

  if (messageType.name === 'Vendor_Defined') {
    return appendTrailingRawPayload(
      explainVendorDefinedMessage(
        payloadBytes,
        sop,
        payloadSectionKey,
        payloadByteOffset,
      ),
      payloadBytes,
      payloadSectionKey,
      payloadByteOffset,
    )
  }

  if (
    messageType.name === 'Source_Capabilities' ||
    messageType.name === 'Sink_Capabilities' ||
    messageType.name === 'EPR_Source_Capabilities' ||
    messageType.name === 'EPR_Sink_Capabilities'
  ) {
    return appendTrailingRawPayload(
      explainPowerDataObjects(
        payloadBytes.subarray(0, count * 4),
        messageType.name,
        payloadSectionKey,
        payloadByteOffset,
      ),
      payloadBytes,
      payloadSectionKey,
      payloadByteOffset,
    )
  }

  if (messageType.name === 'Request' || messageType.name === 'EPR_Request') {
    return appendTrailingRawPayload(
      explainRequestDataObjects(
        payloadBytes.subarray(0, count * 4),
        messageType.name,
        payloadSectionKey,
        payloadByteOffset,
        options.requestRdoKind ?? null,
      ),
      payloadBytes,
      payloadSectionKey,
      payloadByteOffset,
    )
  }

  if (messageType.name === 'BIST') {
    return appendTrailingRawPayload(
      explainBistDataObjects(
        payloadBytes.subarray(0, count * 4),
        payloadSectionKey,
        payloadByteOffset,
      ),
      payloadBytes,
      payloadSectionKey,
      payloadByteOffset,
    )
  }

  if (messageType.name === 'Battery_Status') {
    return appendTrailingRawPayload(
      explainBatteryStatusDataObjects(
        payloadBytes.subarray(0, count * 4),
        payloadSectionKey,
        payloadByteOffset,
      ),
      payloadBytes,
      payloadSectionKey,
      payloadByteOffset,
    )
  }

  if (messageType.name === 'Alert') {
    return appendTrailingRawPayload(
      explainAlertDataObjects(
        payloadBytes.subarray(0, count * 4),
        payloadSectionKey,
        payloadByteOffset,
      ),
      payloadBytes,
      payloadSectionKey,
      payloadByteOffset,
    )
  }

  if (messageType.name === 'Get_Country_Info') {
    return appendTrailingRawPayload(
      explainCountryCodeDataObjects(
        payloadBytes.subarray(0, count * 4),
        payloadSectionKey,
        payloadByteOffset,
      ),
      payloadBytes,
      payloadSectionKey,
      payloadByteOffset,
    )
  }

  if (messageType.name === 'Enter_USB') {
    return appendTrailingRawPayload(
      explainEnterUsbDataObjects(
        payloadBytes.subarray(0, count * 4),
        payloadSectionKey,
        payloadByteOffset,
      ),
      payloadBytes,
      payloadSectionKey,
      payloadByteOffset,
    )
  }

  if (messageType.name === 'EPR_Mode') {
    return appendTrailingRawPayload(
      explainEprModeDataObjects(
        payloadBytes.subarray(0, count * 4),
        payloadSectionKey,
        payloadByteOffset,
      ),
      payloadBytes,
      payloadSectionKey,
      payloadByteOffset,
    )
  }

  if (messageType.name === 'Source_Info') {
    return appendTrailingRawPayload(
      explainSourceInfoDataObjects(
        payloadBytes.subarray(0, count * 4),
        payloadSectionKey,
        payloadByteOffset,
      ),
      payloadBytes,
      payloadSectionKey,
      payloadByteOffset,
    )
  }

  if (messageType.name === 'Revision') {
    return appendTrailingRawPayload(
      explainRevisionDataObjects(
        payloadBytes.subarray(0, count * 4),
        payloadSectionKey,
        payloadByteOffset,
      ),
      payloadBytes,
      payloadSectionKey,
      payloadByteOffset,
    )
  }

  const sections: Section[] = []

  for (let index = 0; index < count; index += 1) {
    const raw32 = readUint32Le(payloadBytes, index * 4)
    const byteOffset = payloadByteOffset + index * 4

    const built = buildGenericDataObject(
      raw32,
      index,
      payloadSectionKey,
      byteOffset,
    )

    sections.push(built.section)
    if (built.extraSections !== undefined) {
      sections.push(...built.extraSections)
    }
  }

  return appendTrailingRawPayload(
    sections,
    payloadBytes,
    payloadSectionKey,
    payloadByteOffset,
  )
}

import { lookupMessageTypeName } from '../registry/messageTypes.js'
import type {
  BitField,
  DecodeIssue,
  MessageCategory,
  MessageFrame,
  MessageHeader,
  Section,
  SpecificationRevision,
} from '../types.js'
import { extractBits, readUint16Le } from '../utils/bits.js'

function classifyCategory(
  extended: boolean,
  numberOfDataObjects: number,
): MessageCategory {
  if (extended) {
    return 'extended'
  }

  return numberOfDataObjects === 0 ? 'control' : 'data'
}

function decodeSpecificationRevision(
  bits: 0 | 1 | 2 | 3,
): SpecificationRevision {
  switch (bits) {
    case 0:
      return '1.0'
    case 1:
      return '2.0'
    case 2:
      return '3.x'
    default:
      return 'reserved'
  }
}

function powerRoleOrCablePlugMeaning(
  bit: 0 | 1,
  sop: MessageFrame['sop'],
): MessageHeader['portPowerRoleOrCablePlugMeaning'] {
  if (sop === 'SOP') {
    return bit === 0 ? 'Sink' : 'Source'
  }

  return bit === 0 ? 'DFP/UFP Port' : 'Cable Plug / VPD'
}

function portDataRoleMeaning(
  bit: 0 | 1,
  sop: MessageFrame['sop'],
): MessageHeader['portDataRoleMeaning'] {
  if (sop !== 'SOP') {
    return null
  }
  return bit === 0 ? 'UFP' : 'DFP'
}

function field(
  key: string,
  label: string,
  bitStart: number,
  bitLength: number,
  rawValue: number,
  decodedValue: BitField['decodedValue'],
  note?: string,
): BitField {
  return {
    key,
    label,
    bitStart,
    bitLength,
    rawValue,
    decodedValue,
    displayValue: String(decodedValue),
    note,
  }
}

function createIssue(code: string, message: string): DecodeIssue {
  return {
    severity: 'warning',
    code,
    message,
  }
}

export function decodeMessageHeader(frame: MessageFrame): MessageHeader {
  const raw16 = readUint16Le(frame.messageBytes, 0)
  const extended = extractBits(raw16, 15, 1) === 1
  const numberOfDataObjects = extractBits(raw16, 12, 3)
  const messageId = extractBits(raw16, 9, 3)
  const roleBit = extractBits(raw16, 8, 1) as 0 | 1
  const specificationRevisionBits = extractBits(raw16, 6, 2) as 0 | 1 | 2 | 3
  const portDataRoleBit = extractBits(raw16, 5, 1) as 0 | 1
  const messageType = extractBits(raw16, 0, 5)

  return {
    raw16,
    extended,
    numberOfDataObjects,
    messageId,
    portPowerRoleOrCablePlugBit: roleBit,
    portPowerRoleOrCablePlugMeaning: powerRoleOrCablePlugMeaning(
      roleBit,
      frame.sop,
    ),
    specificationRevisionBits,
    specificationRevision: decodeSpecificationRevision(
      specificationRevisionBits,
    ),
    portDataRoleBit,
    portDataRoleMeaning: portDataRoleMeaning(portDataRoleBit, frame.sop),
    messageType,
    category: classifyCategory(extended, numberOfDataObjects),
  }
}

export function explainMessageHeader(
  header: MessageHeader,
  frame: MessageFrame,
): Section {
  const messageTypeName = lookupMessageTypeName(
    header.category,
    header.messageType,
  )
  const issues: DecodeIssue[] = []

  if (frame.sop !== 'SOP' && header.portDataRoleBit !== 0) {
    issues.push(
      createIssue(
        'PD_MESSAGE_HEADER_RESERVED_B5_NONZERO',
        "Message Header B5 is reserved for SOP'/SOP'' but is non-zero.",
      ),
    )
  }

  const fields: BitField[] = [
    field(
      'extended',
      'Extended',
      15,
      1,
      header.extended ? 1 : 0,
      header.extended,
    ),
    field(
      'number_of_data_objects',
      'Number of Data Objects',
      12,
      3,
      header.numberOfDataObjects,
      header.numberOfDataObjects,
    ),
    field('message_id', 'MessageID', 9, 3, header.messageId, header.messageId),
    field(
      'port_power_role_or_cable_plug',
      frame.sop === 'SOP' ? 'Port Power Role' : 'Cable Plug',
      8,
      1,
      header.portPowerRoleOrCablePlugBit,
      header.portPowerRoleOrCablePlugMeaning,
      frame.sop === 'SOP'
        ? 'SOP uses power role semantics.'
        : "SOP'/SOP'' uses cable-plug semantics.",
    ),
    field(
      'specification_revision',
      'Specification Revision',
      6,
      2,
      header.specificationRevisionBits,
      header.specificationRevision,
    ),
    field(
      'port_data_role',
      frame.sop === 'SOP' ? 'Port Data Role' : 'Reserved',
      5,
      1,
      header.portDataRoleBit,
      frame.sop === 'SOP' ? header.portDataRoleMeaning : header.portDataRoleBit,
    ),
    {
      ...field(
        'message_type',
        'Message Type',
        0,
        5,
        header.messageType,
        header.messageType,
      ),
      displayValue: messageTypeName === null ? 'Reserved' : messageTypeName,
    },
  ]

  return {
    key: 'message-header',
    kind: 'message_header',
    title: 'Message Header',
    byteOffset: 0,
    byteLength: 2,
    rawBytes: frame.messageBytes.slice(0, 2),
    fields,
    issues,
  }
}

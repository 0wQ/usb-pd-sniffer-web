import type { DecodeIssue, Section } from '../../../types.js'
import { extractBits, readUint32Le } from '../../../utils/bits.js'
import {
  appendGenericVendorDataObjects,
  type BuiltSection,
  boolDisplay,
  createIssue,
  createVendorDataObjectSection,
  field,
  hex,
} from '../sectionBuilders.js'

export type StructuredVdmCommandContext = {
  readonly svid: number
  readonly objectPosition: number
  readonly commandType: number
  readonly command: number
}

export function vdmCommandTypeDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'REQ'
    case 1:
      return 'ACK'
    case 2:
      return 'NAK'
    case 3:
      return 'BUSY'
    default:
      return String(bits)
  }
}

type BuiltSvidVdoSection = {
  section: Section
  hasTerminator: boolean
  hasOddTerminator: boolean
  hasInvalidZeroPattern: boolean
}

function buildDiscoverSvidVdo(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSvidVdoSection {
  const upperSvid = extractBits(raw32, 16, 16)
  const lowerSvid = extractBits(raw32, 0, 16)
  const hasTerminator = upperSvid === 0 || lowerSvid === 0
  const hasOddTerminator = upperSvid !== 0 && lowerSvid === 0
  const hasInvalidZeroPattern = upperSvid === 0 && lowerSvid !== 0
  const issues: DecodeIssue[] = []

  if (hasInvalidZeroPattern) {
    issues.push(
      createIssue(
        'PD_DISCOVER_SVIDS_INVALID_ZERO_PATTERN',
        'Discover SVIDs VDO uses 0x0000 in the upper SVID slot while the lower SVID slot is non-zero.',
      ),
    )
  }

  return {
    section: createVendorDataObjectSection(
      `${parentSectionKey}:object-${index}:discover-svids-vdo`,
      `Discover SVIDs VDO ${index}`,
      'discover_svids_vdo',
      byteOffset,
      raw32,
      [
        field('svid_upper', 'SVID n', 16, 16, upperSvid, hex(upperSvid, 4), {
          displayValue: upperSvid === 0 ? 'End of list' : hex(upperSvid, 4),
        }),
        field('svid_lower', 'SVID n+1', 0, 16, lowerSvid, hex(lowerSvid, 4), {
          displayValue: lowerSvid === 0 ? 'End of list' : hex(lowerSvid, 4),
        }),
      ],
      issues,
      index,
    ),
    hasTerminator,
    hasOddTerminator,
    hasInvalidZeroPattern,
  }
}

function buildDiscoverModeVdo(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  return {
    section: createVendorDataObjectSection(
      `${parentSectionKey}:object-${index}:discover-mode-vdo`,
      `Mode VDO ${index}`,
      'discover_modes_vdo',
      byteOffset,
      raw32,
      [
        field('raw32', 'Raw 32-bit Value', 0, 32, raw32, hex(raw32, 8), {
          note: 'Mode VDO structure is defined by the corresponding SVID owner.',
        }),
      ],
      [],
      index,
    ),
  }
}

function buildAlternateModeCommandVdo(
  raw32: number,
  index: number,
  title: string,
  semanticKind: string,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  return {
    section: createVendorDataObjectSection(
      `${parentSectionKey}:object-${index}:${semanticKind}`,
      title,
      semanticKind,
      byteOffset,
      raw32,
      [
        field('raw32', 'Raw 32-bit Value', 0, 32, raw32, hex(raw32, 8), {
          note: 'VDO contents are defined by the corresponding Alternate Mode.',
        }),
      ],
      [],
      index,
    ),
  }
}

function dpSignalingDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'DP Gen1'
    case 1:
      return 'DP Gen2'
    case 8:
      return 'DP Gen3'
    default:
      return 'Reserved'
  }
}

function dpConnectedDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'Disconnected'
    case 1:
      return 'DFP_D'
    case 2:
      return 'UFP_D'
    case 3:
      return 'Both'
    default:
      return 'Reserved'
  }
}

function buildDisplayPortModeVdo(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const ufpDPinAssign = extractBits(raw32, 0, 4)
  const receptacle = extractBits(raw32, 6, 1)
  const usb20NotUsed = extractBits(raw32, 7, 1)
  const dfpDPinAssign = extractBits(raw32, 8, 4)
  const dpSignaling = extractBits(raw32, 16, 4)

  return {
    section: createVendorDataObjectSection(
      `${parentSectionKey}:object-${index}:displayport-mode-vdo`,
      `DisplayPort Mode VDO ${index}`,
      'displayport_mode_vdo',
      byteOffset,
      raw32,
      [
        field(
          'ufp_d_pin_assign',
          'UFP_D Pin Assign',
          0,
          4,
          ufpDPinAssign,
          hex(ufpDPinAssign, 1),
          {
            displayValue: hex(ufpDPinAssign, 1),
            note: 'DisplayPort pin assignment bitmask as defined by the DisplayPort Alt Mode standard.',
          },
        ),
        field(
          'receptacle_indication',
          'Receptacle Indication',
          6,
          1,
          receptacle,
          receptacle === 1,
          {
            displayValue: receptacle === 1 ? 'Receptacle' : 'Plug',
          },
        ),
        field(
          'usb_2_signaling_not_used',
          'USB 2.0 Signaling Not Used',
          7,
          1,
          usb20NotUsed,
          usb20NotUsed === 1,
          {
            displayValue: boolDisplay(usb20NotUsed === 1, 'Yes', 'No'),
          },
        ),
        field(
          'dfp_d_pin_assign',
          'DFP_D Pin Assign',
          8,
          4,
          dfpDPinAssign,
          hex(dfpDPinAssign, 1),
          {
            displayValue: hex(dfpDPinAssign, 1),
            note: 'DisplayPort pin assignment bitmask as defined by the DisplayPort Alt Mode standard.',
          },
        ),
        field('dp_signaling', 'DP Signaling', 16, 4, dpSignaling, dpSignaling, {
          displayValue: dpSignalingDisplay(dpSignaling),
        }),
      ],
      [],
      index,
    ),
  }
}

function buildDisplayPortStatusVdo(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const connected = extractBits(raw32, 0, 2)
  const powerDirectionIndication = extractBits(raw32, 2, 1)
  const powerLow = extractBits(raw32, 3, 1)
  const enabled = extractBits(raw32, 4, 1)
  const multiFunctionPreferred = extractBits(raw32, 5, 1)
  const usbConfigRequest = extractBits(raw32, 6, 1)
  const exitDpModeRequest = extractBits(raw32, 7, 1)
  const hpdState = extractBits(raw32, 8, 1)
  const irqHpd = extractBits(raw32, 9, 1)
  const reserved = extractBits(raw32, 10, 22)
  const issues: DecodeIssue[] = []

  if (reserved !== 0) {
    issues.push(
      createIssue(
        'PD_DP_STATUS_VDO_RESERVED_BITS_NONZERO',
        'DisplayPort Status VDO reserved bits 31..10 are non-zero.',
      ),
    )
  }

  return {
    section: createVendorDataObjectSection(
      `${parentSectionKey}:object-${index}:displayport-status-vdo`,
      'DisplayPort Status VDO',
      'displayport_status_vdo',
      byteOffset,
      raw32,
      [
        field('connected', 'Connected', 0, 2, connected, connected, {
          displayValue: dpConnectedDisplay(connected),
        }),
        field(
          'power_direction_indication',
          'Power Direction Indication',
          2,
          1,
          powerDirectionIndication,
          powerDirectionIndication === 1,
          {
            displayValue: boolDisplay(
              powerDirectionIndication === 1,
              'Adaptor',
              'Normal',
            ),
          },
        ),
        field('power_low', 'Power Low', 3, 1, powerLow, powerLow === 1, {
          displayValue: boolDisplay(powerLow === 1, 'Yes', 'No'),
        }),
        field('enabled', 'Enabled', 4, 1, enabled, enabled === 1, {
          displayValue: boolDisplay(enabled === 1, 'Yes', 'No'),
        }),
        field(
          'multi_function_preferred',
          'Multi-Function Preferred',
          5,
          1,
          multiFunctionPreferred,
          multiFunctionPreferred === 1,
          {
            displayValue: boolDisplay(
              multiFunctionPreferred === 1,
              'Yes',
              'No',
            ),
          },
        ),
        field(
          'usb_config_request',
          'USB Config Request',
          6,
          1,
          usbConfigRequest,
          usbConfigRequest === 1,
          {
            displayValue: boolDisplay(
              usbConfigRequest === 1,
              'Requested',
              'Not Requested',
            ),
          },
        ),
        field(
          'exit_dp_mode_request',
          'Exit DP Mode Request',
          7,
          1,
          exitDpModeRequest,
          exitDpModeRequest === 1,
          {
            displayValue: boolDisplay(
              exitDpModeRequest === 1,
              'Requested',
              'Not Requested',
            ),
          },
        ),
        field('hpd_state', 'HPD State', 8, 1, hpdState, hpdState === 1, {
          displayValue: hpdState === 1 ? 'High' : 'Low',
        }),
        field('irq_hpd', 'IRQ HPD', 9, 1, irqHpd, irqHpd === 1, {
          displayValue: boolDisplay(irqHpd === 1, 'Asserted', 'Not Asserted'),
        }),
        field('reserved', 'Reserved', 10, 22, reserved, reserved),
      ],
      issues,
      index,
    ),
  }
}

function explainDiscoverSvidsObjects(
  payloadBytes: Uint8Array,
  payloadSectionKey: string,
  payloadByteOffset: number,
  headerBuilt: BuiltSection,
  structured: StructuredVdmCommandContext,
): Section[] {
  const sections: Section[] = [headerBuilt.section]
  const count = Math.floor(payloadBytes.length / 4)
  const svidVdoCount = Math.max(0, count - 1)

  if (
    structured.commandType === 0 ||
    structured.commandType === 2 ||
    structured.commandType === 3
  ) {
    if (count !== 1) {
      headerBuilt.section.issues.push(
        createIssue(
          'PD_DISCOVER_SVIDS_NON_ACK_OBJECT_COUNT_INVALID',
          `Discover SVIDs ${vdmCommandTypeDisplay(structured.commandType)} shall contain only the VDM Header and no VDOs.`,
        ),
      )
    }
    appendGenericVendorDataObjects(
      sections,
      payloadBytes,
      1,
      payloadSectionKey,
      payloadByteOffset,
    )
    return sections
  }

  if (svidVdoCount === 0) {
    headerBuilt.section.issues.push(
      createIssue(
        'PD_DISCOVER_SVIDS_ACK_TOO_SHORT',
        'Discover SVIDs ACK shall contain at least one SVID VDO.',
      ),
    )
    return sections
  }

  let terminatorIndex = -1

  for (let index = 1; index < count; index += 1) {
    const raw32 = readUint32Le(payloadBytes, index * 4)
    const byteOffset = payloadByteOffset + index * 4
    const built = buildDiscoverSvidVdo(
      raw32,
      index,
      payloadSectionKey,
      byteOffset,
    )
    sections.push(built.section)

    if (built.hasTerminator && terminatorIndex === -1) {
      terminatorIndex = index
    }
  }

  if (terminatorIndex !== -1 && terminatorIndex !== count - 1) {
    headerBuilt.section.issues.push(
      createIssue(
        'PD_DISCOVER_SVIDS_TERMINATOR_NOT_LAST',
        'Discover SVIDs terminator VDO shall appear only in the last VDO of the ACK message.',
      ),
    )
  }

  if (terminatorIndex === -1 && svidVdoCount < 6) {
    headerBuilt.section.issues.push(
      createIssue(
        'PD_DISCOVER_SVIDS_TERMINATOR_MISSING',
        'Final Discover SVIDs ACK messages with fewer than 6 SVID VDOs shall terminate with one or two 0x0000 SVID values.',
      ),
    )
  }

  return sections
}

function explainDiscoverModesObjects(
  payloadBytes: Uint8Array,
  payloadSectionKey: string,
  payloadByteOffset: number,
  headerBuilt: BuiltSection,
  structured: StructuredVdmCommandContext,
): Section[] {
  const sections: Section[] = [headerBuilt.section]
  const count = Math.floor(payloadBytes.length / 4)

  if (
    structured.commandType === 0 ||
    structured.commandType === 2 ||
    structured.commandType === 3
  ) {
    if (count !== 1) {
      headerBuilt.section.issues.push(
        createIssue(
          'PD_DISCOVER_MODES_NON_ACK_OBJECT_COUNT_INVALID',
          `Discover Modes ${vdmCommandTypeDisplay(structured.commandType)} shall contain only the VDM Header and no VDOs.`,
        ),
      )
    }
    appendGenericVendorDataObjects(
      sections,
      payloadBytes,
      1,
      payloadSectionKey,
      payloadByteOffset,
    )
    return sections
  }

  if (count < 2) {
    headerBuilt.section.issues.push(
      createIssue(
        'PD_DISCOVER_MODES_ACK_TOO_SHORT',
        'Discover Modes ACK shall contain at least one Mode VDO.',
      ),
    )
    return sections
  }

  if (count > 7) {
    headerBuilt.section.issues.push(
      createIssue(
        'PD_DISCOVER_MODES_ACK_TOO_LONG',
        `Discover Modes ACK shall contain 2 to 7 objects including the VDM Header; found ${count}.`,
      ),
    )
  }

  for (let index = 1; index < count; index += 1) {
    const raw32 = readUint32Le(payloadBytes, index * 4)
    const byteOffset = payloadByteOffset + index * 4
    if (structured.svid === 0xff01 && index === 1) {
      sections.push(
        buildDisplayPortModeVdo(raw32, index, payloadSectionKey, byteOffset)
          .section,
      )
      continue
    }
    sections.push(
      buildDiscoverModeVdo(raw32, index, payloadSectionKey, byteOffset).section,
    )
  }

  return sections
}

function explainEnterExitAttentionObjects(
  payloadBytes: Uint8Array,
  payloadSectionKey: string,
  payloadByteOffset: number,
  headerBuilt: BuiltSection,
  structured: StructuredVdmCommandContext,
): Section[] {
  const sections: Section[] = [headerBuilt.section]
  const count = Math.floor(payloadBytes.length / 4)
  const command = structured.command
  const objectPosition = structured.objectPosition

  if (command === 4 && objectPosition === 0b111) {
    headerBuilt.section.issues.push(
      createIssue(
        'PD_ENTER_MODE_OBJECT_POSITION_INVALID',
        'Enter Mode Object Position 111b is not defined; use the referenced Mode VDO position from Discover Modes.',
      ),
    )
  }

  if (command === 6 && objectPosition === 0b111) {
    headerBuilt.section.issues.push(
      createIssue(
        'PD_ATTENTION_OBJECT_POSITION_INVALID',
        'Attention shall not use Object Position 111b.',
      ),
    )
  }

  if (command === 4) {
    if (structured.commandType === 3) {
      headerBuilt.section.issues.push(
        createIssue(
          'PD_ENTER_MODE_BUSY_NOT_ALLOWED',
          'Enter Mode responders shall not return BUSY.',
        ),
      )
    }

    if (structured.commandType === 0) {
      if (count < 1 || count > 2) {
        headerBuilt.section.issues.push(
          createIssue(
            'PD_ENTER_MODE_REQ_OBJECT_COUNT_INVALID',
            'Enter Mode REQ shall contain the VDM Header and at most one additional VDO.',
          ),
        )
      }
      if (count === 2) {
        const raw32 = readUint32Le(payloadBytes, 4)
        sections.push(
          structured.svid === 0xff01
            ? buildDisplayPortStatusVdo(
                raw32,
                1,
                payloadSectionKey,
                payloadByteOffset + 4,
              ).section
            : buildAlternateModeCommandVdo(
                raw32,
                1,
                'Enter Mode VDO',
                'enter_mode_vdo',
                payloadSectionKey,
                payloadByteOffset + 4,
              ).section,
        )
      }
      if (count > 2) {
        appendGenericVendorDataObjects(
          sections,
          payloadBytes,
          1,
          payloadSectionKey,
          payloadByteOffset,
        )
      }
      return sections
    }

    if (structured.commandType === 1 || structured.commandType === 2) {
      if (count !== 1) {
        headerBuilt.section.issues.push(
          createIssue(
            'PD_ENTER_MODE_RESPONSE_OBJECT_COUNT_INVALID',
            'Enter Mode ACK and NAK shall contain only the VDM Header and no VDOs.',
          ),
        )
        appendGenericVendorDataObjects(
          sections,
          payloadBytes,
          1,
          payloadSectionKey,
          payloadByteOffset,
        )
      }
      return sections
    }

    appendGenericVendorDataObjects(
      sections,
      payloadBytes,
      1,
      payloadSectionKey,
      payloadByteOffset,
    )
    return sections
  }

  if (command === 5) {
    if (structured.commandType === 3) {
      headerBuilt.section.issues.push(
        createIssue(
          'PD_EXIT_MODE_BUSY_NOT_ALLOWED',
          'Exit Mode responders shall not return BUSY.',
        ),
      )
    }

    if (count !== 1) {
      headerBuilt.section.issues.push(
        createIssue(
          structured.commandType === 0
            ? 'PD_EXIT_MODE_REQ_OBJECT_COUNT_INVALID'
            : 'PD_EXIT_MODE_RESPONSE_OBJECT_COUNT_INVALID',
          structured.commandType === 0
            ? 'Exit Mode REQ shall contain only the VDM Header and no VDOs.'
            : 'Exit Mode ACK and NAK shall contain only the VDM Header and no VDOs.',
        ),
      )
      appendGenericVendorDataObjects(
        sections,
        payloadBytes,
        1,
        payloadSectionKey,
        payloadByteOffset,
      )
    }
    return sections
  }

  if (structured.commandType !== 0) {
    headerBuilt.section.issues.push(
      createIssue(
        'PD_ATTENTION_RESPONSE_NOT_ALLOWED',
        'Attention is a request-only command and shall not have a command response.',
      ),
    )
  }

  if (count < 1 || count > 2) {
    headerBuilt.section.issues.push(
      createIssue(
        'PD_ATTENTION_REQ_OBJECT_COUNT_INVALID',
        'Attention shall contain the VDM Header and at most one additional VDO.',
      ),
    )
  }

  if (count === 2) {
    const raw32 = readUint32Le(payloadBytes, 4)
    sections.push(
      structured.svid === 0xff01
        ? buildDisplayPortStatusVdo(
            raw32,
            1,
            payloadSectionKey,
            payloadByteOffset + 4,
          ).section
        : buildAlternateModeCommandVdo(
            raw32,
            1,
            'Attention VDO',
            'attention_vdo',
            payloadSectionKey,
            payloadByteOffset + 4,
          ).section,
    )
  }

  if (count > 2) {
    appendGenericVendorDataObjects(
      sections,
      payloadBytes,
      1,
      payloadSectionKey,
      payloadByteOffset,
    )
  }

  return sections
}

export function explainStructuredVdmCommandObjects(
  payloadBytes: Uint8Array,
  parentSectionKey: string,
  payloadByteOffset: number,
  headerSection: Section,
  structured: StructuredVdmCommandContext,
): Section[] | null {
  const headerBuilt: BuiltSection = { section: headerSection }

  if (structured.command === 2) {
    return explainDiscoverSvidsObjects(
      payloadBytes,
      parentSectionKey,
      payloadByteOffset,
      headerBuilt,
      structured,
    )
  }
  if (structured.command === 3) {
    return explainDiscoverModesObjects(
      payloadBytes,
      parentSectionKey,
      payloadByteOffset,
      headerBuilt,
      structured,
    )
  }
  if (
    structured.command === 4 ||
    structured.command === 5 ||
    structured.command === 6
  ) {
    return explainEnterExitAttentionObjects(
      payloadBytes,
      parentSectionKey,
      payloadByteOffset,
      headerBuilt,
      structured,
    )
  }

  return null
}

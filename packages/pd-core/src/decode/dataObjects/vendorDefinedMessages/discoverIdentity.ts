import type { DecodeIssue, Section, StartOfPacket } from '../../../types.js'
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
import {
  buildCablePlugAndVpdVdos,
  usbHighestSpeedDisplay,
} from './cablePlugAndVpdVdos.js'

type DiscoverIdentityIdHeaderInfo = {
  readonly usbHostCapable: boolean
  readonly usbDeviceCapable: boolean
  readonly productTypeUfp: number
  readonly modalOperationSupported: boolean
  readonly productTypeDfp: number
  readonly connectorType: number
  readonly reserved: number
  readonly usbVendorId: number
}

type BuiltDiscoverIdentityIdHeaderSection = {
  section: Section
  info: DiscoverIdentityIdHeaderInfo
}

function connectorTypeDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'Unknown (Deprecated)'
    case 1:
      return 'Reserved'
    case 2:
      return 'USB Type-C Receptacle'
    case 3:
      return 'USB Type-C Plug'
    default:
      return 'Reserved'
  }
}

function ufpProductTypeDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'Not a UFP'
    case 1:
      return 'PDUSB Hub'
    case 2:
      return 'PDUSB Peripheral'
    case 3:
      return 'PSD'
    case 5:
      return 'Alternate Mode Adapter (AMA) (Deprecated)'
    default:
      return 'Reserved'
  }
}

function cableProductTypeDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'Not a Cable Plug / VPD'
    case 3:
      return 'Passive Cable'
    case 4:
      return 'Active Cable'
    case 6:
      return 'VCONN Powered USB Device (VPD)'
    default:
      return 'Reserved'
  }
}

function dfpProductTypeDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'Not a DFP'
    case 1:
      return 'PDUSB Hub'
    case 2:
      return 'PDUSB Host'
    case 3:
      return 'Power Brick'
    case 4:
      return 'Alternate Mode Controller (AMC) (Deprecated)'
    default:
      return 'Reserved'
  }
}

function parseDiscoverIdentityIdHeader(
  raw32: number,
): DiscoverIdentityIdHeaderInfo {
  return {
    usbHostCapable: extractBits(raw32, 31, 1) === 1,
    usbDeviceCapable: extractBits(raw32, 30, 1) === 1,
    productTypeUfp: extractBits(raw32, 27, 3),
    modalOperationSupported: extractBits(raw32, 26, 1) === 1,
    productTypeDfp: extractBits(raw32, 23, 3),
    connectorType: extractBits(raw32, 21, 2),
    reserved: extractBits(raw32, 16, 5),
    usbVendorId: extractBits(raw32, 0, 16),
  }
}

function vdoVersionDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'Invalid'
    case 1:
      return 'Version 1.1 (Deprecated)'
    case 2:
      return 'Version 1.2 (Deprecated)'
    case 3:
      return 'Version 1.3'
    default:
      return 'Reserved'
  }
}

function dfpVdoVersionDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'Invalid'
    case 1:
      return 'Version 1.1 (Deprecated)'
    case 2:
      return 'Version 1.2'
    default:
      return 'Reserved'
  }
}

function vconnPowerDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return '1W'
    case 1:
      return '1.5W'
    case 2:
      return '2W'
    case 3:
      return '3W'
    case 4:
      return '4W'
    case 5:
      return '5W'
    case 6:
      return '6W'
    default:
      return 'Reserved'
  }
}

function buildIdHeaderVdo(
  raw32: number,
  sop: StartOfPacket,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltDiscoverIdentityIdHeaderSection {
  const info = parseDiscoverIdentityIdHeader(raw32)
  const issues: DecodeIssue[] = []

  if (info.reserved !== 0) {
    issues.push(
      createIssue(
        'PD_ID_HEADER_RESERVED_BITS_NONZERO',
        'ID Header VDO reserved bits 20..16 are non-zero.',
      ),
    )
  }

  if (sop === 'SOP') {
    if ([4, 6, 7].includes(info.productTypeUfp)) {
      issues.push(
        createIssue(
          'PD_ID_HEADER_UFP_PRODUCT_TYPE_RESERVED',
          'ID Header VDO SOP Product Type (UFP) uses a reserved value.',
        ),
      )
    }
    if (info.productTypeUfp === 5) {
      issues.push(
        createIssue(
          'PD_ID_HEADER_UFP_PRODUCT_TYPE_DEPRECATED',
          'ID Header VDO SOP Product Type (UFP) Alternate Mode Adapter is deprecated.',
        ),
      )
    }
    if (info.productTypeDfp >= 5) {
      issues.push(
        createIssue(
          'PD_ID_HEADER_DFP_PRODUCT_TYPE_RESERVED',
          'ID Header VDO SOP Product Type (DFP) uses a reserved value.',
        ),
      )
    }
    if (info.productTypeDfp === 4) {
      issues.push(
        createIssue(
          'PD_ID_HEADER_DFP_PRODUCT_TYPE_DEPRECATED',
          'ID Header VDO SOP Product Type (DFP) Alternate Mode Controller is deprecated.',
        ),
      )
    }
  } else {
    if (![0, 3, 4, 6].includes(info.productTypeUfp)) {
      issues.push(
        createIssue(
          'PD_ID_HEADER_CABLE_PRODUCT_TYPE_RESERVED',
          "ID Header VDO SOP' Product Type (Cable Plug / VPD) uses a reserved value.",
        ),
      )
    }
    if (info.productTypeDfp !== 0) {
      issues.push(
        createIssue(
          'PD_ID_HEADER_SOP_PRIME_DFP_RESERVED',
          "ID Header VDO bits 25..23 are reserved in SOP' Discover Identity.",
        ),
      )
    }
  }

  if (info.connectorType === 1) {
    issues.push(
      createIssue(
        'PD_ID_HEADER_CONNECTOR_TYPE_RESERVED',
        'ID Header VDO Connector Type value 01b is reserved.',
      ),
    )
  }
  if (info.connectorType === 0) {
    issues.push(
      createIssue(
        'PD_ID_HEADER_CONNECTOR_TYPE_DEPRECATED',
        'ID Header VDO Connector Type Unknown is deprecated.',
      ),
    )
  }

  const productTypeLabel =
    sop === 'SOP' ? 'Product Type (UFP)' : 'Product Type (Cable Plug / VPD)'
  const productTypeDisplay =
    sop === 'SOP'
      ? ufpProductTypeDisplay(info.productTypeUfp)
      : cableProductTypeDisplay(info.productTypeUfp)

  return {
    section: createVendorDataObjectSection(
      `${parentSectionKey}:object-${index}:id-header-vdo`,
      'ID Header VDO',
      'discover_identity_id_header_vdo',
      byteOffset,
      raw32,
      [
        field(
          'usb_host_capable',
          'USB Communications Capable as USB Host',
          31,
          1,
          info.usbHostCapable ? 1 : 0,
          info.usbHostCapable,
          {
            displayValue: boolDisplay(
              info.usbHostCapable,
              'Capable',
              'Not Capable',
            ),
          },
        ),
        field(
          'usb_device_capable',
          'USB Communications Capable as USB Device',
          30,
          1,
          info.usbDeviceCapable ? 1 : 0,
          info.usbDeviceCapable,
          {
            displayValue: boolDisplay(
              info.usbDeviceCapable,
              'Capable',
              'Not Capable',
            ),
          },
        ),
        field(
          'product_type_ufp_or_cable',
          productTypeLabel,
          27,
          3,
          info.productTypeUfp,
          info.productTypeUfp,
          {
            displayValue: productTypeDisplay,
          },
        ),
        field(
          'modal_operation_supported',
          'Modal Operation Supported',
          26,
          1,
          info.modalOperationSupported ? 1 : 0,
          info.modalOperationSupported,
          {
            displayValue: boolDisplay(
              info.modalOperationSupported,
              'Yes',
              'No',
            ),
          },
        ),
        field(
          'product_type_dfp',
          sop === 'SOP' ? 'Product Type (DFP)' : 'Reserved',
          23,
          3,
          info.productTypeDfp,
          info.productTypeDfp,
          {
            displayValue:
              sop === 'SOP'
                ? dfpProductTypeDisplay(info.productTypeDfp)
                : 'Reserved',
            note:
              sop === 'SOP' ? undefined : "Reserved in SOP' Discover Identity.",
          },
        ),
        field(
          'connector_type',
          'Connector Type',
          21,
          2,
          info.connectorType,
          info.connectorType,
          {
            displayValue: connectorTypeDisplay(info.connectorType),
          },
        ),
        field('reserved', 'Reserved', 16, 5, info.reserved, info.reserved),
        field(
          'usb_vendor_id',
          'USB Vendor ID',
          0,
          16,
          info.usbVendorId,
          hex(info.usbVendorId, 4),
        ),
      ],
      issues,
      index,
    ),
    info,
  }
}

function buildCertStatVdo(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  return {
    section: createVendorDataObjectSection(
      `${parentSectionKey}:object-${index}:cert-stat-vdo`,
      'Cert Stat VDO',
      'discover_identity_cert_stat_vdo',
      byteOffset,
      raw32,
      [field('xid', 'XID', 0, 32, raw32, hex(raw32, 8))],
      [],
      index,
    ),
  }
}

function buildProductVdo(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const productId = extractBits(raw32, 16, 16)
  const bcdDevice = extractBits(raw32, 0, 16)

  return {
    section: createVendorDataObjectSection(
      `${parentSectionKey}:object-${index}:product-vdo`,
      'Product VDO',
      'discover_identity_product_vdo',
      byteOffset,
      raw32,
      [
        field(
          'usb_product_id',
          'USB Product ID',
          16,
          16,
          productId,
          hex(productId, 4),
        ),
        field('bcd_device', 'bcdDevice', 0, 16, bcdDevice, hex(bcdDevice, 4)),
      ],
      [],
      index,
    ),
  }
}

function buildUfpVdo(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const version = extractBits(raw32, 29, 3)
  const reserved28 = extractBits(raw32, 28, 1)
  const deviceCapability = extractBits(raw32, 24, 4)
  const connectorTypeLegacy = extractBits(raw32, 22, 2)
  const reserved = extractBits(raw32, 11, 11)
  const vconnPower = extractBits(raw32, 8, 3)
  const vconnRequired = extractBits(raw32, 7, 1)
  const vbusRequired = extractBits(raw32, 6, 1)
  const alternateModes = extractBits(raw32, 3, 3)
  const usbHighestSpeed = extractBits(raw32, 0, 3)
  const issues: DecodeIssue[] = []

  if (version === 0) {
    issues.push(
      createIssue(
        'PD_UFP_VDO_VERSION_INVALID',
        'UFP VDO Version value 000b is invalid.',
      ),
    )
  } else if (version === 1 || version === 2) {
    issues.push(
      createIssue(
        'PD_UFP_VDO_VERSION_DEPRECATED',
        'UFP VDO Version values 001b and 010b are deprecated.',
      ),
    )
  } else if (version >= 4) {
    issues.push(
      createIssue(
        'PD_UFP_VDO_VERSION_RESERVED',
        'UFP VDO Version values 100b..111b are reserved.',
      ),
    )
  }
  if (reserved28 !== 0) {
    issues.push(
      createIssue(
        'PD_UFP_VDO_RESERVED_BIT_NONZERO',
        'UFP VDO reserved bit 28 is non-zero.',
      ),
    )
  }
  if (connectorTypeLegacy !== 0) {
    issues.push(
      createIssue(
        'PD_UFP_VDO_CONNECTOR_TYPE_LEGACY_NONZERO',
        'UFP VDO Connector Type (Legacy) shall be set to 00b.',
      ),
    )
  }
  if (reserved !== 0) {
    issues.push(
      createIssue(
        'PD_UFP_VDO_RESERVED_BITS_NONZERO',
        'UFP VDO reserved bits 21..11 are non-zero.',
      ),
    )
  }
  if ((deviceCapability & 0b0011) === 0b0011) {
    issues.push(
      createIssue(
        'PD_UFP_VDO_USB2_CAPABILITY_CONFLICT',
        'UFP VDO USB 2.0 Device Capable and Billboard-only bits shall not both be set.',
      ),
    )
  }
  if (alternateModes === 0) {
    if (vconnRequired !== 0) {
      issues.push(
        createIssue(
          'PD_UFP_VDO_VCONN_REQUIRED_RESERVED',
          'UFP VDO VCONN Required is reserved when no Alternate Modes are supported.',
        ),
      )
    }
    if (vbusRequired !== 0) {
      issues.push(
        createIssue(
          'PD_UFP_VDO_VBUS_REQUIRED_RESERVED',
          'UFP VDO VBUS Required is reserved when no Alternate Modes are supported.',
        ),
      )
    }
  }
  if (vconnRequired === 0 && vconnPower !== 0) {
    issues.push(
      createIssue(
        'PD_UFP_VDO_VCONN_POWER_RESERVED',
        'UFP VDO VCONN Power is reserved when VCONN Required is zero.',
      ),
    )
  }
  if (usbHighestSpeed >= 5) {
    issues.push(
      createIssue(
        'PD_UFP_VDO_USB_HIGHEST_SPEED_RESERVED',
        'UFP VDO USB Highest Speed values 101b..111b are reserved.',
      ),
    )
  }

  return {
    section: createVendorDataObjectSection(
      `${parentSectionKey}:object-${index}:ufp-vdo`,
      'UFP VDO',
      'discover_identity_ufp_vdo',
      byteOffset,
      raw32,
      [
        field('ufp_vdo_version', 'UFP VDO Version', 29, 3, version, version, {
          displayValue: vdoVersionDisplay(version),
        }),
        field('reserved_28', 'Reserved', 28, 1, reserved28, reserved28),
        field(
          'usb_2_device_capable',
          'USB 2.0 Device Capable',
          24,
          1,
          deviceCapability & 0x1,
          (deviceCapability & 0x1) === 1,
          {
            displayValue: boolDisplay(
              (deviceCapability & 0x1) === 1,
              'Capable',
              'Not Capable',
            ),
          },
        ),
        field(
          'usb_2_billboard_only',
          'USB 2.0 Device Capable (Billboard only)',
          25,
          1,
          (deviceCapability >>> 1) & 0x1,
          ((deviceCapability >>> 1) & 0x1) === 1,
          {
            displayValue: boolDisplay(
              ((deviceCapability >>> 1) & 0x1) === 1,
              'Yes',
              'No',
            ),
          },
        ),
        field(
          'usb_3_device_capable',
          'USB 3.2 Device Capable',
          26,
          1,
          (deviceCapability >>> 2) & 0x1,
          ((deviceCapability >>> 2) & 0x1) === 1,
          {
            displayValue: boolDisplay(
              ((deviceCapability >>> 2) & 0x1) === 1,
              'Capable',
              'Not Capable',
            ),
          },
        ),
        field(
          'usb4_device_capable',
          'USB4 Device Capable',
          27,
          1,
          (deviceCapability >>> 3) & 0x1,
          ((deviceCapability >>> 3) & 0x1) === 1,
          {
            displayValue: boolDisplay(
              ((deviceCapability >>> 3) & 0x1) === 1,
              'Capable',
              'Not Capable',
            ),
          },
        ),
        field(
          'connector_type_legacy',
          'Connector Type (Legacy)',
          22,
          2,
          connectorTypeLegacy,
          connectorTypeLegacy,
          {
            displayValue:
              connectorTypeLegacy === 0
                ? 'Deprecated'
                : 'Deprecated / non-zero',
            note: 'Deprecated. Shall be set to 00b.',
          },
        ),
        field('reserved_21_11', 'Reserved', 11, 11, reserved, reserved),
        field('vconn_power', 'VCONN Power', 8, 3, vconnPower, vconnPower, {
          displayValue:
            vconnRequired === 1 ? vconnPowerDisplay(vconnPower) : 'Reserved',
          note:
            vconnRequired === 1
              ? undefined
              : 'Reserved when VCONN Required is zero.',
        }),
        field(
          'vconn_required',
          'VCONN Required',
          7,
          1,
          vconnRequired,
          vconnRequired === 1,
          {
            displayValue: boolDisplay(vconnRequired === 1, 'Yes', 'No'),
          },
        ),
        field(
          'vbus_required',
          'VBUS Required',
          6,
          1,
          vbusRequired,
          vbusRequired === 0,
          {
            displayValue: vbusRequired === 0 ? 'Yes' : 'No',
          },
        ),
        field(
          'supports_tbt3',
          'Supports TBT3 Alternate Mode',
          3,
          1,
          alternateModes & 0x1,
          (alternateModes & 0x1) === 1,
          {
            displayValue: boolDisplay(
              (alternateModes & 0x1) === 1,
              'Yes',
              'No',
            ),
          },
        ),
        field(
          'supports_typec_reconfig_modes',
          'Supports reconfiguring Alternate Modes',
          4,
          1,
          (alternateModes >>> 1) & 0x1,
          ((alternateModes >>> 1) & 0x1) === 1,
          {
            displayValue: boolDisplay(
              ((alternateModes >>> 1) & 0x1) === 1,
              'Yes',
              'No',
            ),
          },
        ),
        field(
          'supports_typec_nonreconfig_modes',
          'Supports non-reconfiguring Alternate Modes',
          5,
          1,
          (alternateModes >>> 2) & 0x1,
          ((alternateModes >>> 2) & 0x1) === 1,
          {
            displayValue: boolDisplay(
              ((alternateModes >>> 2) & 0x1) === 1,
              'Yes',
              'No',
            ),
          },
        ),
        field(
          'usb_highest_speed',
          'USB Highest Speed',
          0,
          3,
          usbHighestSpeed,
          usbHighestSpeed,
          {
            displayValue: usbHighestSpeedDisplay(usbHighestSpeed),
          },
        ),
      ],
      issues,
      index,
    ),
  }
}

function buildDfpVdo(
  raw32: number,
  dfpProductType: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const version = extractBits(raw32, 29, 3)
  const reserved = extractBits(raw32, 27, 2)
  const hostCapability = extractBits(raw32, 24, 3)
  const connectorTypeLegacy = extractBits(raw32, 22, 2)
  const reservedLow = extractBits(raw32, 5, 17)
  const portNumber = extractBits(raw32, 0, 5)
  const issues: DecodeIssue[] = []

  if (version === 0) {
    issues.push(
      createIssue(
        'PD_DFP_VDO_VERSION_INVALID',
        'DFP VDO Version value 000b is invalid.',
      ),
    )
  } else if (version === 1) {
    issues.push(
      createIssue(
        'PD_DFP_VDO_VERSION_DEPRECATED',
        'DFP VDO Version value 001b is deprecated.',
      ),
    )
  } else if (version >= 3) {
    issues.push(
      createIssue(
        'PD_DFP_VDO_VERSION_RESERVED',
        'DFP VDO Version values 011b..111b are reserved.',
      ),
    )
  }
  if (reserved !== 0) {
    issues.push(
      createIssue(
        'PD_DFP_VDO_RESERVED_BITS_NONZERO',
        'DFP VDO reserved bits 28..27 are non-zero.',
      ),
    )
  }
  if (connectorTypeLegacy !== 0) {
    issues.push(
      createIssue(
        'PD_DFP_VDO_CONNECTOR_TYPE_LEGACY_NONZERO',
        'DFP VDO Connector Type (Legacy) shall be set to 00b.',
      ),
    )
  }
  if (reservedLow !== 0) {
    issues.push(
      createIssue(
        'PD_DFP_VDO_RESERVED_LOW_BITS_NONZERO',
        'DFP VDO reserved bits 21..5 are non-zero.',
      ),
    )
  }
  if ((dfpProductType === 1 || dfpProductType === 3) && hostCapability !== 0) {
    issues.push(
      createIssue(
        'PD_DFP_VDO_HOST_CAPABILITY_NONZERO',
        'DFP VDO Host Capability bits shall be zero for PDUSB Hubs and Power Bricks.',
      ),
    )
  }

  return {
    section: createVendorDataObjectSection(
      `${parentSectionKey}:object-${index}:dfp-vdo`,
      'DFP VDO',
      'discover_identity_dfp_vdo',
      byteOffset,
      raw32,
      [
        field('dfp_vdo_version', 'DFP VDO Version', 29, 3, version, version, {
          displayValue: dfpVdoVersionDisplay(version),
        }),
        field('reserved_28_27', 'Reserved', 27, 2, reserved, reserved),
        field(
          'usb_2_host_capable',
          'USB 2.0 Host Capable',
          24,
          1,
          hostCapability & 0x1,
          (hostCapability & 0x1) === 1,
          {
            displayValue: boolDisplay(
              (hostCapability & 0x1) === 1,
              'Capable',
              'Not Capable',
            ),
          },
        ),
        field(
          'usb_3_host_capable',
          'USB 3.2 Host Capable',
          25,
          1,
          (hostCapability >>> 1) & 0x1,
          ((hostCapability >>> 1) & 0x1) === 1,
          {
            displayValue: boolDisplay(
              ((hostCapability >>> 1) & 0x1) === 1,
              'Capable',
              'Not Capable',
            ),
          },
        ),
        field(
          'usb4_host_capable',
          'USB4 Host Capable',
          26,
          1,
          (hostCapability >>> 2) & 0x1,
          ((hostCapability >>> 2) & 0x1) === 1,
          {
            displayValue: boolDisplay(
              ((hostCapability >>> 2) & 0x1) === 1,
              'Capable',
              'Not Capable',
            ),
          },
        ),
        field(
          'connector_type_legacy',
          'Connector Type (Legacy)',
          22,
          2,
          connectorTypeLegacy,
          connectorTypeLegacy,
          {
            displayValue:
              connectorTypeLegacy === 0
                ? 'Deprecated'
                : 'Deprecated / non-zero',
            note: 'Deprecated. Shall be set to 00b.',
          },
        ),
        field('reserved_21_5', 'Reserved', 5, 17, reservedLow, reservedLow),
        field('port_number', 'Port Number', 0, 5, portNumber, portNumber),
      ],
      issues,
      index,
    ),
  }
}

function buildDrdPadObject(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const issues =
    raw32 === 0
      ? []
      : [
          createIssue(
            'PD_DISCOVER_IDENTITY_DRD_PAD_NONZERO',
            'Discover Identity DRD Pad Object shall be all zeros.',
          ),
        ]

  return {
    section: createVendorDataObjectSection(
      `${parentSectionKey}:object-${index}:drd-pad-object`,
      'DRD Pad Object',
      'discover_identity_drd_pad_object',
      byteOffset,
      raw32,
      [
        field('raw32', 'Raw 32-bit Value', 0, 32, raw32, hex(raw32, 8), {
          note: 'Shall be all zeros.',
        }),
      ],
      issues,
      index,
    ),
  }
}

export function explainDiscoverIdentityObjects(
  payloadBytes: Uint8Array,
  sop: StartOfPacket,
  payloadSectionKey: string,
  payloadByteOffset: number,
  headerSection: Section,
  commandType: number,
): Section[] {
  const sections: Section[] = [headerSection]
  const count = Math.floor(payloadBytes.length / 4)

  if (commandType === 0) {
    if (count !== 1) {
      headerSection.issues.push(
        createIssue(
          'PD_DISCOVER_IDENTITY_REQ_OBJECT_COUNT_INVALID',
          'Discover Identity REQ shall contain only the VDM Header and no VDOs.',
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

  if (commandType === 2 || commandType === 3) {
    if (count !== 1) {
      headerSection.issues.push(
        createIssue(
          'PD_DISCOVER_IDENTITY_NON_ACK_OBJECT_COUNT_INVALID',
          'Discover Identity NAK and BUSY shall contain only the VDM Header and no VDOs.',
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

  if (count < 4) {
    headerSection.issues.push(
      createIssue(
        'PD_DISCOVER_IDENTITY_ACK_TOO_SHORT',
        'Discover Identity ACK shall contain at least ID Header VDO, Cert Stat VDO, and Product VDO.',
      ),
    )
  }

  let idHeaderInfo: DiscoverIdentityIdHeaderInfo | null = null

  if (count >= 2) {
    const built = buildIdHeaderVdo(
      readUint32Le(payloadBytes, 4),
      sop,
      1,
      payloadSectionKey,
      payloadByteOffset + 4,
    )
    sections.push(built.section)
    idHeaderInfo = built.info
  }
  if (count >= 3) {
    sections.push(
      buildCertStatVdo(
        readUint32Le(payloadBytes, 8),
        2,
        payloadSectionKey,
        payloadByteOffset + 8,
      ).section,
    )
  }
  if (count >= 4) {
    sections.push(
      buildProductVdo(
        readUint32Le(payloadBytes, 12),
        3,
        payloadSectionKey,
        payloadByteOffset + 12,
      ).section,
    )
  }

  if (idHeaderInfo === null) {
    appendGenericVendorDataObjects(
      sections,
      payloadBytes,
      4,
      payloadSectionKey,
      payloadByteOffset,
    )
    return sections
  }

  let expectedCount = 4
  let nextIndex = 4

  if (sop === 'SOP') {
    const needsUfpVdo =
      idHeaderInfo.productTypeUfp === 1 || idHeaderInfo.productTypeUfp === 2
    const needsDfpVdo =
      idHeaderInfo.productTypeDfp === 1 ||
      idHeaderInfo.productTypeDfp === 2 ||
      idHeaderInfo.productTypeDfp === 3

    if (needsUfpVdo && needsDfpVdo) {
      expectedCount = 7
      if (count >= 5) {
        sections.push(
          buildUfpVdo(
            readUint32Le(payloadBytes, 16),
            4,
            payloadSectionKey,
            payloadByteOffset + 16,
          ).section,
        )
      }
      if (count >= 6) {
        sections.push(
          buildDrdPadObject(
            readUint32Le(payloadBytes, 20),
            5,
            payloadSectionKey,
            payloadByteOffset + 20,
          ).section,
        )
      }
      if (count >= 7) {
        sections.push(
          buildDfpVdo(
            readUint32Le(payloadBytes, 24),
            idHeaderInfo.productTypeDfp,
            6,
            payloadSectionKey,
            payloadByteOffset + 24,
          ).section,
        )
      }
      nextIndex = 7
    } else if (needsUfpVdo) {
      expectedCount = 5
      if (count >= 5) {
        sections.push(
          buildUfpVdo(
            readUint32Le(payloadBytes, 16),
            4,
            payloadSectionKey,
            payloadByteOffset + 16,
          ).section,
        )
      }
      nextIndex = 5
    } else if (needsDfpVdo) {
      expectedCount = 5
      if (count >= 5) {
        sections.push(
          buildDfpVdo(
            readUint32Le(payloadBytes, 16),
            idHeaderInfo.productTypeDfp,
            4,
            payloadSectionKey,
            payloadByteOffset + 16,
          ).section,
        )
      }
      nextIndex = 5
    }
  } else {
    const cableVdos = buildCablePlugAndVpdVdos(
      idHeaderInfo.productTypeUfp,
      payloadBytes,
      count,
      payloadSectionKey,
      payloadByteOffset,
    )
    sections.push(...cableVdos.sections)
    expectedCount = cableVdos.expectedObjectCount
    nextIndex = cableVdos.nextObjectIndex
  }

  if (count < expectedCount) {
    headerSection.issues.push(
      createIssue(
        'PD_DISCOVER_IDENTITY_ACK_MISSING_VDOS',
        `Discover Identity ACK is missing one or more required Product Type VDOs; expected ${expectedCount} objects including the VDM Header, found ${count}.`,
      ),
    )
  }
  if (count > expectedCount) {
    headerSection.issues.push(
      createIssue(
        'PD_DISCOVER_IDENTITY_ACK_EXTRA_VDOS',
        `Discover Identity ACK contains additional VDOs beyond the defined response shape; expected ${expectedCount} objects including the VDM Header, found ${count}.`,
      ),
    )
  }

  appendGenericVendorDataObjects(
    sections,
    payloadBytes,
    nextIndex,
    payloadSectionKey,
    payloadByteOffset,
  )
  return sections
}

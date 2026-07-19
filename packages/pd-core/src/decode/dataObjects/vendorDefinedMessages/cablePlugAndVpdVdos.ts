import type { DecodeIssue, Section } from '../../../types.js'
import { extractBits, readUint32Le } from '../../../utils/bits.js'
import {
  type BuiltSection,
  boolDisplay,
  createIssue,
  createVendorDataObjectSection,
  field,
} from '../sectionBuilders.js'

export function usbHighestSpeedDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'USB 2.0 only'
    case 1:
      return 'USB 3.2 Gen1'
    case 2:
      return 'USB 3.2 / USB4 Gen2'
    case 3:
      return 'USB4 Gen3'
    case 4:
      return 'USB4 Gen4'
    default:
      return 'Reserved'
  }
}

function cablePlugDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'USB Type-A (Deprecated)'
    case 1:
      return 'USB Type-B (Deprecated)'
    case 2:
      return 'USB Type-C'
    case 3:
      return 'Captive'
    default:
      return 'Reserved'
  }
}

function passiveCableLatencyDisplay(bits: number): string {
  switch (bits) {
    case 1:
      return '<10ns (~1m)'
    case 2:
      return '10ns to 20ns (~2m)'
    case 3:
      return '20ns to 30ns (~3m)'
    case 4:
      return '30ns to 40ns (~4m)'
    case 5:
      return '40ns to 50ns (~5m)'
    case 6:
      return '50ns to 60ns (~6m)'
    case 7:
      return '60ns to 70ns (~7m)'
    case 8:
      return '>70ns (>~7m)'
    default:
      return 'Reserved'
  }
}

function activeCableLatencyDisplay(bits: number): string {
  switch (bits) {
    case 1:
      return '<10ns (~1m)'
    case 2:
      return '10ns to 20ns (~2m)'
    case 3:
      return '20ns to 30ns (~3m)'
    case 4:
      return '30ns to 40ns (~4m)'
    case 5:
      return '40ns to 50ns (~5m)'
    case 6:
      return '50ns to 60ns (~6m)'
    case 7:
      return '60ns to 70ns (~7m)'
    case 8:
      return '1000ns (~100m)'
    case 9:
      return '2000ns (~200m)'
    case 10:
      return '3000ns (~300m)'
    default:
      return 'Reserved'
  }
}

function passiveCableTerminationDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return 'VCONN not required'
    case 1:
      return 'VCONN required'
    default:
      return 'Reserved'
  }
}

function activeCableTerminationDisplay(bits: number): string {
  switch (bits) {
    case 2:
      return 'One end Active, one end passive, VCONN required'
    case 3:
      return 'Both ends Active, VCONN required'
    default:
      return 'Reserved'
  }
}

function cableCurrentDisplay(bits: number): string {
  switch (bits) {
    case 1:
      return '3A'
    case 2:
      return '5A'
    default:
      return 'Reserved'
  }
}

function passiveCableMaxVbusDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return '20V'
    case 1:
      return '30V (Deprecated; treat as 20V)'
    case 2:
      return '40V (Deprecated; treat as 20V)'
    case 3:
      return '50V'
    default:
      return 'Reserved'
  }
}

function vpdMaxVbusDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return '20V'
    case 1:
      return '30V (Deprecated; treat as 20V)'
    case 2:
      return '40V (Deprecated; treat as 20V)'
    case 3:
      return '50V (Deprecated; treat as 20V)'
    default:
      return 'Reserved'
  }
}

function u3CldPowerDisplay(bits: number): string {
  switch (bits) {
    case 0:
      return '>10mW'
    case 1:
      return '5mW to 10mW'
    case 2:
      return '1mW to 5mW'
    case 3:
      return '0.5mW to 1mW'
    case 4:
      return '0.2mW to 0.5mW'
    case 5:
      return '50uW to 200uW'
    case 6:
      return '<50uW'
    default:
      return 'Reserved'
  }
}

function buildPassiveCableVdo(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const version = extractBits(raw32, 21, 3)
  const reserved20 = extractBits(raw32, 20, 1)
  const plug = extractBits(raw32, 18, 2)
  const latency = extractBits(raw32, 13, 4)
  const termination = extractBits(raw32, 11, 2)
  const maxVbus = extractBits(raw32, 9, 2)
  const reserved8_7 = extractBits(raw32, 7, 2)
  const current = extractBits(raw32, 5, 2)
  const reserved4_3 = extractBits(raw32, 3, 2)
  const usbHighestSpeed = extractBits(raw32, 0, 3)
  const issues: DecodeIssue[] = []

  if (version !== 0) {
    issues.push(
      createIssue(
        'PD_PASSIVE_CABLE_VDO_VERSION_RESERVED',
        'Passive Cable VDO Version values 001b..111b are reserved.',
      ),
    )
  }
  if (reserved20 !== 0) {
    issues.push(
      createIssue(
        'PD_PASSIVE_CABLE_VDO_RESERVED_BIT_NONZERO',
        'Passive Cable VDO reserved bit 20 is non-zero.',
      ),
    )
  }
  if (plug < 2) {
    issues.push(
      createIssue(
        'PD_PASSIVE_CABLE_VDO_PLUG_TYPE_DEPRECATED',
        'Passive Cable VDO USB Type-A and USB Type-B plug types are deprecated.',
      ),
    )
  }
  if (latency === 0 || latency >= 9) {
    issues.push(
      createIssue(
        'PD_PASSIVE_CABLE_VDO_LATENCY_RESERVED',
        'Passive Cable VDO cable latency uses a reserved value.',
      ),
    )
  }
  if (termination >= 2) {
    issues.push(
      createIssue(
        'PD_PASSIVE_CABLE_VDO_TERMINATION_RESERVED',
        'Passive Cable VDO cable termination type values 10b and 11b are reserved.',
      ),
    )
  }
  if (maxVbus === 1 || maxVbus === 2) {
    issues.push(
      createIssue(
        'PD_PASSIVE_CABLE_VDO_MAX_VBUS_DEPRECATED',
        'Passive Cable VDO Maximum VBUS Voltage values 01b and 10b are deprecated and treated as 20V.',
      ),
    )
  }
  if (reserved8_7 !== 0) {
    issues.push(
      createIssue(
        'PD_PASSIVE_CABLE_VDO_RESERVED_8_7_NONZERO',
        'Passive Cable VDO reserved bits 8..7 are non-zero.',
      ),
    )
  }
  if (current === 0 || current === 3) {
    issues.push(
      createIssue(
        'PD_PASSIVE_CABLE_VDO_CURRENT_RESERVED',
        'Passive Cable VDO current handling value is reserved.',
      ),
    )
  }
  if (reserved4_3 !== 0) {
    issues.push(
      createIssue(
        'PD_PASSIVE_CABLE_VDO_RESERVED_4_3_NONZERO',
        'Passive Cable VDO reserved bits 4..3 are non-zero.',
      ),
    )
  }
  if (usbHighestSpeed >= 5) {
    issues.push(
      createIssue(
        'PD_PASSIVE_CABLE_VDO_USB_HIGHEST_SPEED_RESERVED',
        'Passive Cable VDO USB Highest Speed values 101b..111b are reserved.',
      ),
    )
  }

  return {
    section: createVendorDataObjectSection(
      `${parentSectionKey}:object-${index}:passive-cable-vdo`,
      'Passive Cable VDO',
      'discover_identity_passive_cable_vdo',
      byteOffset,
      raw32,
      [
        field(
          'hw_version',
          'HW Version',
          28,
          4,
          extractBits(raw32, 28, 4),
          extractBits(raw32, 28, 4),
        ),
        field(
          'firmware_version',
          'Firmware Version',
          24,
          4,
          extractBits(raw32, 24, 4),
          extractBits(raw32, 24, 4),
        ),
        field('vdo_version', 'VDO Version', 21, 3, version, version, {
          displayValue: version === 0 ? 'Version 1.0' : 'Reserved',
        }),
        field('reserved_20', 'Reserved', 20, 1, reserved20, reserved20),
        field(
          'plug_to_plug_or_captive',
          'USB Type-C plug to USB Type-C / Captive',
          18,
          2,
          plug,
          plug,
          {
            displayValue: cablePlugDisplay(plug),
          },
        ),
        field(
          'epr_capable',
          'EPR Capable',
          17,
          1,
          extractBits(raw32, 17, 1),
          extractBits(raw32, 17, 1) === 1,
          {
            displayValue: boolDisplay(
              extractBits(raw32, 17, 1) === 1,
              'Capable',
              'Not Capable',
            ),
          },
        ),
        field('cable_latency', 'Cable Latency', 13, 4, latency, latency, {
          displayValue: passiveCableLatencyDisplay(latency),
        }),
        field(
          'cable_termination_type',
          'Cable Termination Type',
          11,
          2,
          termination,
          termination,
          {
            displayValue: passiveCableTerminationDisplay(termination),
          },
        ),
        field(
          'maximum_vbus_voltage',
          'Maximum VBUS Voltage',
          9,
          2,
          maxVbus,
          maxVbus,
          {
            displayValue: passiveCableMaxVbusDisplay(maxVbus),
          },
        ),
        field('reserved_8_7', 'Reserved', 7, 2, reserved8_7, reserved8_7),
        field(
          'vbus_current_handling_capability',
          'VBUS Current Handling Capability',
          5,
          2,
          current,
          current,
          {
            displayValue: cableCurrentDisplay(current),
          },
        ),
        field('reserved_4_3', 'Reserved', 3, 2, reserved4_3, reserved4_3),
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

function buildActiveCableVdo1(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const version = extractBits(raw32, 21, 3)
  const reserved20 = extractBits(raw32, 20, 1)
  const plug = extractBits(raw32, 18, 2)
  const latency = extractBits(raw32, 13, 4)
  const termination = extractBits(raw32, 11, 2)
  const maxVbus = extractBits(raw32, 9, 2)
  const sbuSupported = extractBits(raw32, 8, 1)
  const sbuType = extractBits(raw32, 7, 1)
  const current = extractBits(raw32, 5, 2)
  const vbusThrough = extractBits(raw32, 4, 1)
  const sopDoublePrimeController = extractBits(raw32, 3, 1)
  const usbHighestSpeed = extractBits(raw32, 0, 3)
  const issues: DecodeIssue[] = []

  if (version === 0 || version === 2) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO1_VERSION_DEPRECATED',
        'Active Cable VDO1 Version values 000b and 010b are deprecated.',
      ),
    )
  } else if (version === 1) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO1_VERSION_INVALID',
        'Active Cable VDO1 Version value 001b is invalid.',
      ),
    )
  } else if (version >= 4) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO1_VERSION_RESERVED',
        'Active Cable VDO1 Version values 100b..111b are reserved.',
      ),
    )
  }
  if (reserved20 !== 0) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO1_RESERVED_BIT_NONZERO',
        'Active Cable VDO1 reserved bit 20 is non-zero.',
      ),
    )
  }
  if (plug < 2) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO1_PLUG_TYPE_DEPRECATED',
        'Active Cable VDO1 USB Type-A and USB Type-B plug types are deprecated.',
      ),
    )
  }
  if (latency === 0 || latency >= 11) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO1_LATENCY_RESERVED',
        'Active Cable VDO1 cable latency uses a reserved value.',
      ),
    )
  }
  if (termination <= 1) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO1_TERMINATION_RESERVED',
        'Active Cable VDO1 cable termination type values 00b and 01b are reserved.',
      ),
    )
  }
  if (maxVbus === 1 || maxVbus === 2) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO1_MAX_VBUS_DEPRECATED',
        'Active Cable VDO1 Maximum VBUS Voltage values 01b and 10b are deprecated and treated as 20V.',
      ),
    )
  }
  if (vbusThrough === 1 && (current === 0 || current === 3)) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO1_CURRENT_RESERVED',
        'Active Cable VDO1 current handling capability uses a reserved value when VBUS Through Cable is set.',
      ),
    )
  }
  if (usbHighestSpeed >= 5) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO1_USB_HIGHEST_SPEED_RESERVED',
        'Active Cable VDO1 USB Highest Speed values 101b..111b are reserved.',
      ),
    )
  }

  return {
    section: createVendorDataObjectSection(
      `${parentSectionKey}:object-${index}:active-cable-vdo1`,
      'Active Cable VDO1',
      'discover_identity_active_cable_vdo1',
      byteOffset,
      raw32,
      [
        field(
          'hw_version',
          'HW Version',
          28,
          4,
          extractBits(raw32, 28, 4),
          extractBits(raw32, 28, 4),
        ),
        field(
          'firmware_version',
          'Firmware Version',
          24,
          4,
          extractBits(raw32, 24, 4),
          extractBits(raw32, 24, 4),
        ),
        field('vdo_version', 'VDO Version', 21, 3, version, version, {
          displayValue:
            version === 0
              ? 'Version 1.0 (Deprecated)'
              : version === 1
                ? 'Invalid'
                : version === 2
                  ? 'Version 1.2 (Deprecated)'
                  : version === 3
                    ? 'Version 1.3'
                    : 'Reserved',
        }),
        field('reserved_20', 'Reserved', 20, 1, reserved20, reserved20),
        field(
          'plug_to_plug_or_captive',
          'USB Type-C plug to USB Type-C / Captive',
          18,
          2,
          plug,
          plug,
          {
            displayValue: cablePlugDisplay(plug),
          },
        ),
        field(
          'epr_capable',
          'EPR Capable',
          17,
          1,
          extractBits(raw32, 17, 1),
          extractBits(raw32, 17, 1) === 1,
          {
            displayValue: boolDisplay(
              extractBits(raw32, 17, 1) === 1,
              'Capable',
              'Not Capable',
            ),
          },
        ),
        field('cable_latency', 'Cable Latency', 13, 4, latency, latency, {
          displayValue: activeCableLatencyDisplay(latency),
        }),
        field(
          'cable_termination_type',
          'Cable Termination Type',
          11,
          2,
          termination,
          termination,
          {
            displayValue: activeCableTerminationDisplay(termination),
          },
        ),
        field(
          'maximum_vbus_voltage',
          'Maximum VBUS Voltage',
          9,
          2,
          maxVbus,
          maxVbus,
          {
            displayValue: passiveCableMaxVbusDisplay(maxVbus),
          },
        ),
        field(
          'sbu_supported',
          'SBU Supported',
          8,
          1,
          sbuSupported,
          sbuSupported === 0,
          {
            displayValue:
              sbuSupported === 0
                ? 'SBU connections supported'
                : 'SBU connections not supported',
          },
        ),
        field(
          'sbu_type',
          'SBU Type',
          7,
          1,
          sbuType,
          sbuType === 1 ? 'Active' : 'Passive',
          {
            displayValue:
              sbuSupported === 0
                ? sbuType === 1
                  ? 'SBU is active'
                  : 'SBU is passive'
                : 'Ignored',
            note:
              sbuSupported === 0
                ? undefined
                : 'Ignored when SBU Supported = 1.',
          },
        ),
        field(
          'vbus_current_handling_capability',
          'VBUS Current Handling Capability',
          5,
          2,
          current,
          current,
          {
            displayValue:
              vbusThrough === 1 ? cableCurrentDisplay(current) : 'Ignored',
            note:
              vbusThrough === 1
                ? undefined
                : 'Ignored when VBUS Through Cable = 0.',
          },
        ),
        field(
          'vbus_through_cable',
          'VBUS Through Cable',
          4,
          1,
          vbusThrough,
          vbusThrough === 1,
          {
            displayValue: boolDisplay(vbusThrough === 1, 'Yes', 'No'),
          },
        ),
        field(
          'sop_dprime_controller_present',
          "SOP'' Controller Present",
          3,
          1,
          sopDoublePrimeController,
          sopDoublePrimeController === 1,
          {
            displayValue: boolDisplay(
              sopDoublePrimeController === 1,
              'Present',
              'Not Present',
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

function buildActiveCableVdo2(
  raw32: number,
  activeCableVdo1Raw32: number | null,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const reserved15 = extractBits(raw32, 15, 1)
  const u3CldPower = extractBits(raw32, 12, 3)
  const usb4SupportedBit = extractBits(raw32, 8, 1)
  const hubHops = extractBits(raw32, 6, 2)
  const usb2SupportedBit = extractBits(raw32, 5, 1)
  const opticallyIsolated = extractBits(raw32, 2, 1)
  const asymmetricModeSupported = extractBits(raw32, 1, 1)
  const issues: DecodeIssue[] = []

  if (reserved15 !== 0) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO2_RESERVED_BIT_NONZERO',
        'Active Cable VDO2 reserved bit 15 is non-zero.',
      ),
    )
  }
  if (u3CldPower === 0b111) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO2_U3_CLD_POWER_RESERVED',
        'Active Cable VDO2 U3/CLd Power value 111b is reserved.',
      ),
    )
  }
  if (usb2SupportedBit === 1 && hubHops !== 0) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO2_HUB_HOPS_NONZERO',
        'Active Cable VDO2 Hub Hops shall be zero when USB 2.0 is not supported.',
      ),
    )
  }
  if (usb4SupportedBit === 1 && asymmetricModeSupported === 1) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO2_ASYMMETRY_WITHOUT_USB4',
        'Active Cable VDO2 USB4 Asymmetric Mode Supported cannot be set when USB4 is not supported.',
      ),
    )
  }
  if (opticallyIsolated === 1 && usb2SupportedBit === 0) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO2_OPTICAL_USB2_CONFLICT',
        'Optically isolated Active Cables do not support USB 2.0.',
      ),
    )
  }
  if (
    activeCableVdo1Raw32 !== null &&
    opticallyIsolated === 1 &&
    extractBits(activeCableVdo1Raw32, 4, 1) === 1
  ) {
    issues.push(
      createIssue(
        'PD_ACTIVE_CABLE_VDO2_OPTICAL_VBUS_CONFLICT',
        'Optically isolated Active Cables do not carry VBUS through the cable.',
      ),
    )
  }

  return {
    section: createVendorDataObjectSection(
      `${parentSectionKey}:object-${index}:active-cable-vdo2`,
      'Active Cable VDO2',
      'discover_identity_active_cable_vdo2',
      byteOffset,
      raw32,
      [
        field(
          'maximum_operating_temperature',
          'Maximum Operating Temperature',
          24,
          8,
          extractBits(raw32, 24, 8),
          extractBits(raw32, 24, 8),
          {
            displayValue: `${extractBits(raw32, 24, 8)} °C`,
            unit: '°C',
          },
        ),
        field(
          'shutdown_temperature',
          'Shutdown Temperature',
          16,
          8,
          extractBits(raw32, 16, 8),
          extractBits(raw32, 16, 8),
          {
            displayValue: `${extractBits(raw32, 16, 8)} °C`,
            unit: '°C',
          },
        ),
        field('reserved_15', 'Reserved', 15, 1, reserved15, reserved15),
        field('u3_cld_power', 'U3 / CLd Power', 12, 3, u3CldPower, u3CldPower, {
          displayValue: u3CldPowerDisplay(u3CldPower),
        }),
        field(
          'u3_to_u0_transition_mode',
          'U3 to U0 transition mode',
          11,
          1,
          extractBits(raw32, 11, 1),
          extractBits(raw32, 11, 1) === 1
            ? 'U3 to U0 through U3S'
            : 'U3 to U0 direct',
          {
            displayValue:
              extractBits(raw32, 11, 1) === 1
                ? 'U3 to U0 through U3S'
                : 'U3 to U0 direct',
          },
        ),
        field(
          'physical_connection',
          'Physical connection',
          10,
          1,
          extractBits(raw32, 10, 1),
          extractBits(raw32, 10, 1) === 1 ? 'Optical' : 'Copper',
          {
            displayValue:
              extractBits(raw32, 10, 1) === 1 ? 'Optical' : 'Copper',
          },
        ),
        field(
          'active_element',
          'Active element',
          9,
          1,
          extractBits(raw32, 9, 1),
          extractBits(raw32, 9, 1) === 1
            ? 'Active Re-timer'
            : 'Active Re-driver',
          {
            displayValue:
              extractBits(raw32, 9, 1) === 1
                ? 'Active Re-timer'
                : 'Active Re-driver',
          },
        ),
        field(
          'usb4_supported',
          'USB4 Supported',
          8,
          1,
          usb4SupportedBit,
          usb4SupportedBit === 0,
          {
            displayValue: usb4SupportedBit === 0 ? 'Yes' : 'No',
          },
        ),
        field(
          'usb_2_hub_hops_consumed',
          'USB 2.0 Hub Hops Consumed',
          6,
          2,
          hubHops,
          hubHops,
        ),
        field(
          'usb_2_supported',
          'USB 2.0 Supported',
          5,
          1,
          usb2SupportedBit,
          usb2SupportedBit === 0,
          {
            displayValue: usb2SupportedBit === 0 ? 'Yes' : 'No',
          },
        ),
        field(
          'usb_3_supported',
          'USB 3.2 Supported',
          4,
          1,
          extractBits(raw32, 4, 1),
          extractBits(raw32, 4, 1) === 0,
          {
            displayValue: extractBits(raw32, 4, 1) === 0 ? 'Yes' : 'No',
          },
        ),
        field(
          'usb_lanes_supported',
          'USB Lanes Supported',
          3,
          1,
          extractBits(raw32, 3, 1),
          extractBits(raw32, 3, 1) === 1 ? 'Two lanes' : 'One lane',
          {
            displayValue:
              extractBits(raw32, 3, 1) === 1 ? 'Two lanes' : 'One lane',
          },
        ),
        field(
          'optically_isolated_active_cable',
          'Optically Isolated Active Cable',
          2,
          1,
          opticallyIsolated,
          opticallyIsolated === 1,
          {
            displayValue: boolDisplay(opticallyIsolated === 1, 'Yes', 'No'),
          },
        ),
        field(
          'usb4_asymmetric_mode_supported',
          'USB4 Asymmetric Mode Supported',
          1,
          1,
          asymmetricModeSupported,
          asymmetricModeSupported === 1,
          {
            displayValue: boolDisplay(
              asymmetricModeSupported === 1,
              'Yes',
              'No',
            ),
          },
        ),
        field(
          'usb_gen',
          'USB Gen',
          0,
          1,
          extractBits(raw32, 0, 1),
          extractBits(raw32, 0, 1) === 1 ? 'Gen 2 or higher' : 'Gen 1',
          {
            displayValue:
              extractBits(raw32, 0, 1) === 1 ? 'Gen 2 or higher' : 'Gen 1',
          },
        ),
      ],
      issues,
      index,
    ),
  }
}

function buildVpdVdo(
  raw32: number,
  index: number,
  parentSectionKey: string,
  byteOffset: number,
): BuiltSection {
  const version = extractBits(raw32, 21, 3)
  const reserved20_17 = extractBits(raw32, 17, 4)
  const maxVbus = extractBits(raw32, 15, 2)
  const chargeThroughCurrentSupport = extractBits(raw32, 14, 1)
  const reserved13 = extractBits(raw32, 13, 1)
  const vbusImpedance = extractBits(raw32, 7, 6)
  const groundImpedance = extractBits(raw32, 1, 6)
  const chargeThroughSupport = extractBits(raw32, 0, 1)
  const issues: DecodeIssue[] = []

  if (version !== 0) {
    issues.push(
      createIssue(
        'PD_VPD_VDO_VERSION_RESERVED',
        'VPD VDO Version values 001b..111b are reserved.',
      ),
    )
  }
  if (reserved20_17 !== 0) {
    issues.push(
      createIssue(
        'PD_VPD_VDO_RESERVED_HIGH_BITS_NONZERO',
        'VPD VDO reserved bits 20..17 are non-zero.',
      ),
    )
  }
  if (reserved13 !== 0) {
    issues.push(
      createIssue(
        'PD_VPD_VDO_RESERVED_13_NONZERO',
        'VPD VDO reserved bit 13 is non-zero.',
      ),
    )
  }
  if (maxVbus !== 0) {
    issues.push(
      createIssue(
        'PD_VPD_VDO_MAX_VBUS_DEPRECATED',
        'VPD VDO Maximum VBUS Voltage non-zero values are deprecated and treated as 20V.',
      ),
    )
  }
  if (chargeThroughSupport === 0) {
    if (
      chargeThroughCurrentSupport !== 0 ||
      vbusImpedance !== 0 ||
      groundImpedance !== 0
    ) {
      issues.push(
        createIssue(
          'PD_VPD_VDO_CHARGE_THROUGH_RESERVED',
          'VPD VDO charge-through dependent fields shall be zero when Charge Through Support is zero.',
        ),
      )
    }
  } else {
    if (vbusImpedance > 0 && vbusImpedance < 5) {
      issues.push(
        createIssue(
          'PD_VPD_VDO_VBUS_IMPEDANCE_RESERVED',
          'VPD VDO VBUS Impedance values below 10mohm are reserved.',
        ),
      )
    }
    if (groundImpedance > 0 && groundImpedance < 10) {
      issues.push(
        createIssue(
          'PD_VPD_VDO_GROUND_IMPEDANCE_RESERVED',
          'VPD VDO Ground Impedance values below 10mohm are reserved.',
        ),
      )
    }
  }

  return {
    section: createVendorDataObjectSection(
      `${parentSectionKey}:object-${index}:vpd-vdo`,
      'VPD VDO',
      'discover_identity_vpd_vdo',
      byteOffset,
      raw32,
      [
        field(
          'hw_version',
          'HW Version',
          28,
          4,
          extractBits(raw32, 28, 4),
          extractBits(raw32, 28, 4),
        ),
        field(
          'firmware_version',
          'Firmware Version',
          24,
          4,
          extractBits(raw32, 24, 4),
          extractBits(raw32, 24, 4),
        ),
        field('vdo_version', 'VDO Version', 21, 3, version, version, {
          displayValue: version === 0 ? 'Version 1.0' : 'Reserved',
        }),
        field(
          'reserved_20_17',
          'Reserved',
          17,
          4,
          reserved20_17,
          reserved20_17,
        ),
        field(
          'maximum_vbus_voltage',
          'Maximum VBUS Voltage',
          15,
          2,
          maxVbus,
          maxVbus,
          {
            displayValue: vpdMaxVbusDisplay(maxVbus),
          },
        ),
        field(
          'charge_through_current_support',
          'Charge Through Current Support',
          14,
          1,
          chargeThroughCurrentSupport,
          chargeThroughCurrentSupport === 1,
          {
            displayValue:
              chargeThroughSupport === 1
                ? chargeThroughCurrentSupport === 1
                  ? '5A capable'
                  : '3A capable'
                : 'Reserved',
            note:
              chargeThroughSupport === 1
                ? undefined
                : 'Reserved when Charge Through Support = 0.',
          },
        ),
        field('reserved_13', 'Reserved', 13, 1, reserved13, reserved13),
        field(
          'vbus_impedance',
          'VBUS Impedance',
          7,
          6,
          vbusImpedance,
          vbusImpedance * 2,
          {
            displayValue:
              chargeThroughSupport === 1
                ? `${vbusImpedance * 2} mohm`
                : 'Reserved',
            unit: 'mohm',
            note:
              chargeThroughSupport === 1
                ? '2mohm increments.'
                : 'Reserved when Charge Through Support = 0.',
          },
        ),
        field(
          'ground_impedance',
          'Ground Impedance',
          1,
          6,
          groundImpedance,
          groundImpedance,
          {
            displayValue:
              chargeThroughSupport === 1
                ? `${groundImpedance} mohm`
                : 'Reserved',
            unit: 'mohm',
            note:
              chargeThroughSupport === 1
                ? '1mohm increments.'
                : 'Reserved when Charge Through Support = 0.',
          },
        ),
        field(
          'charge_through_support',
          'Charge Through Support',
          0,
          1,
          chargeThroughSupport,
          chargeThroughSupport === 1,
          {
            displayValue: boolDisplay(chargeThroughSupport === 1, 'Yes', 'No'),
          },
        ),
      ],
      issues,
      index,
    ),
  }
}

export type CablePlugAndVpdVdos = {
  sections: Section[]
  expectedObjectCount: number
  nextObjectIndex: number
}

export function buildCablePlugAndVpdVdos(
  productType: number,
  payloadBytes: Uint8Array,
  objectCount: number,
  parentSectionKey: string,
  payloadByteOffset: number,
): CablePlugAndVpdVdos {
  const sections: Section[] = []

  if (productType === 3) {
    if (objectCount >= 5) {
      sections.push(
        buildPassiveCableVdo(
          readUint32Le(payloadBytes, 16),
          4,
          parentSectionKey,
          payloadByteOffset + 16,
        ).section,
      )
    }
    return { sections, expectedObjectCount: 5, nextObjectIndex: 5 }
  }

  if (productType === 4) {
    const activeCableVdo1Raw32 =
      objectCount >= 5 ? readUint32Le(payloadBytes, 16) : null
    if (activeCableVdo1Raw32 !== null) {
      sections.push(
        buildActiveCableVdo1(
          activeCableVdo1Raw32,
          4,
          parentSectionKey,
          payloadByteOffset + 16,
        ).section,
      )
    }
    if (objectCount >= 6) {
      sections.push(
        buildActiveCableVdo2(
          readUint32Le(payloadBytes, 20),
          activeCableVdo1Raw32,
          5,
          parentSectionKey,
          payloadByteOffset + 20,
        ).section,
      )
    }
    return { sections, expectedObjectCount: 6, nextObjectIndex: 6 }
  }

  if (productType === 6) {
    if (objectCount >= 5) {
      sections.push(
        buildVpdVdo(
          readUint32Le(payloadBytes, 16),
          4,
          parentSectionKey,
          payloadByteOffset + 16,
        ).section,
      )
    }
    return { sections, expectedObjectCount: 5, nextObjectIndex: 5 }
  }

  return { sections, expectedObjectCount: 4, nextObjectIndex: 4 }
}

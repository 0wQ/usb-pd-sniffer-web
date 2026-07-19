import { describe, expect, test } from 'vitest'
import { decodeMessage, decodePacket } from '../src/index.js'

describe('Vendor Defined Messages', () => {
  test('accepts the USB PD R3.2 v1.2 Active Cable VDO1 Version 1.3', () => {
    const decoded = decodePacket({
      sop: 'SOP_PRIME',
      packetBytes: Uint8Array.from([
        0x8f, 0x61, 0x41, 0xa0, 0x00, 0xff, 0x34, 0x12, 0x60, 0x20, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x30, 0x68, 0x00, 0x00, 0x00,
        0x00, 0x00, 0xe5, 0x53, 0x25, 0x70,
      ]),
    })

    const activeCableVdo1 = decoded.sections.find(
      (section) => section.title === 'Active Cable VDO1',
    )

    expect(
      activeCableVdo1?.fields.find((field) => field.key === 'vdo_version'),
    ).toMatchObject({
      rawValue: 3,
      displayValue: 'Version 1.3',
    })
    expect(
      activeCableVdo1?.issues.some(
        (issue) => issue.code === 'PD_ACTIVE_CABLE_VDO1_VERSION_RESERVED',
      ),
    ).toBe(false)
    expect(
      activeCableVdo1?.fields.find(
        (field) => field.key === 'plug_to_plug_or_captive',
      ),
    ).toMatchObject({
      rawValue: 2,
      displayValue: 'USB Type-C',
    })
    expect(
      activeCableVdo1?.issues.some(
        (issue) => issue.code === 'PD_ACTIVE_CABLE_VDO1_PLUG_TYPE_DEPRECATED',
      ),
    ).toBe(false)
    expect(
      decoded.sections
        .find((section) => section.title === 'Active Cable VDO2')
        ?.fields.find((field) => field.key === 'maximum_operating_temperature'),
    ).toMatchObject({
      displayValue: '0 °C',
      unit: '°C',
    })
    expect(decoded.crc.checkStatus).toBe('valid')
  })

  test('classifies Discover Identity UFP and DFP VDO versions per R3.2 v1.2', () => {
    const decoded = decodeMessage({
      sop: 'SOP',
      messageBytes: Uint8Array.from([
        0x8f, 0x71, 0x41, 0xa0, 0x00, 0xff, 0x34, 0x12, 0x00, 0x11, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x20, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]),
    })

    const ufpVdo = decoded.sections.find(
      (section) => section.title === 'UFP VDO',
    )
    const dfpVdo = decoded.sections.find(
      (section) => section.title === 'DFP VDO',
    )

    expect(
      ufpVdo?.fields.find((field) => field.key === 'ufp_vdo_version'),
    ).toMatchObject({
      rawValue: 1,
      displayValue: 'Version 1.1 (Deprecated)',
    })
    expect(
      ufpVdo?.issues.some(
        (issue) => issue.code === 'PD_UFP_VDO_VERSION_DEPRECATED',
      ),
    ).toBe(true)
    expect(
      dfpVdo?.fields.find((field) => field.key === 'dfp_vdo_version'),
    ).toMatchObject({
      rawValue: 0,
      displayValue: 'Invalid',
    })
    expect(
      dfpVdo?.issues.some(
        (issue) => issue.code === 'PD_DFP_VDO_VERSION_INVALID',
      ),
    ).toBe(true)
  })

  test('covers every affected Discover Identity VDO version encoding', () => {
    const raw32Bytes = (raw32: number) =>
      Array.from({ length: 4 }, (_, index) => (raw32 >>> (index * 8)) & 0xff)
    const decodeSopVersions = (ufpVersion: number, dfpVersion: number) =>
      decodeMessage({
        sop: 'SOP',
        messageBytes: Uint8Array.from([
          0x8f,
          0x71,
          0x41,
          0xa0,
          0x00,
          0xff,
          0x34,
          0x12,
          0x00,
          0x11,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          ...raw32Bytes(ufpVersion * 0x20000000),
          0x00,
          0x00,
          0x00,
          0x00,
          ...raw32Bytes(dfpVersion * 0x20000000),
        ]),
      })
    const ufpCases = [
      ['Invalid', 'PD_UFP_VDO_VERSION_INVALID'],
      ['Version 1.1 (Deprecated)', 'PD_UFP_VDO_VERSION_DEPRECATED'],
      ['Version 1.2 (Deprecated)', 'PD_UFP_VDO_VERSION_DEPRECATED'],
      ['Version 1.3', undefined],
      ['Reserved', 'PD_UFP_VDO_VERSION_RESERVED'],
      ['Reserved', 'PD_UFP_VDO_VERSION_RESERVED'],
      ['Reserved', 'PD_UFP_VDO_VERSION_RESERVED'],
      ['Reserved', 'PD_UFP_VDO_VERSION_RESERVED'],
    ]
    const dfpCases = [
      ['Invalid', 'PD_DFP_VDO_VERSION_INVALID'],
      ['Version 1.1 (Deprecated)', 'PD_DFP_VDO_VERSION_DEPRECATED'],
      ['Version 1.2', undefined],
      ['Reserved', 'PD_DFP_VDO_VERSION_RESERVED'],
      ['Reserved', 'PD_DFP_VDO_VERSION_RESERVED'],
      ['Reserved', 'PD_DFP_VDO_VERSION_RESERVED'],
      ['Reserved', 'PD_DFP_VDO_VERSION_RESERVED'],
      ['Reserved', 'PD_DFP_VDO_VERSION_RESERVED'],
    ]

    for (let version = 0; version < 8; version += 1) {
      const ufpDecoded = decodeSopVersions(version, 2)
      const dfpDecoded = decodeSopVersions(3, version)
      const ufpVdo = ufpDecoded.sections.find(
        (section) => section.title === 'UFP VDO',
      )
      const dfpVdo = dfpDecoded.sections.find(
        (section) => section.title === 'DFP VDO',
      )
      const [ufpDisplay, ufpIssueCode] = ufpCases[version]
      const [dfpDisplay, dfpIssueCode] = dfpCases[version]

      expect(
        ufpVdo?.fields.find((field) => field.key === 'ufp_vdo_version')
          ?.displayValue,
      ).toBe(ufpDisplay)
      expect(ufpVdo?.issues.some((issue) => issue.code === ufpIssueCode)).toBe(
        ufpIssueCode !== undefined,
      )
      expect(
        dfpVdo?.fields.find((field) => field.key === 'dfp_vdo_version')
          ?.displayValue,
      ).toBe(dfpDisplay)
      expect(dfpVdo?.issues.some((issue) => issue.code === dfpIssueCode)).toBe(
        dfpIssueCode !== undefined,
      )
    }

    const activeCableCases = [
      ['Version 1.0 (Deprecated)', 'PD_ACTIVE_CABLE_VDO1_VERSION_DEPRECATED'],
      ['Invalid', 'PD_ACTIVE_CABLE_VDO1_VERSION_INVALID'],
      ['Version 1.2 (Deprecated)', 'PD_ACTIVE_CABLE_VDO1_VERSION_DEPRECATED'],
      ['Version 1.3', undefined],
      ['Reserved', 'PD_ACTIVE_CABLE_VDO1_VERSION_RESERVED'],
      ['Reserved', 'PD_ACTIVE_CABLE_VDO1_VERSION_RESERVED'],
      ['Reserved', 'PD_ACTIVE_CABLE_VDO1_VERSION_RESERVED'],
      ['Reserved', 'PD_ACTIVE_CABLE_VDO1_VERSION_RESERVED'],
    ]

    for (let version = 0; version < 8; version += 1) {
      const decoded = decodeMessage({
        sop: 'SOP_PRIME',
        messageBytes: Uint8Array.from([
          0x8f,
          0x61,
          0x41,
          0xa0,
          0x00,
          0xff,
          0x34,
          0x12,
          0x00,
          0x20,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          0x00,
          ...raw32Bytes(version * 0x200000 + 0x80000),
          0x00,
          0x00,
          0x00,
          0x00,
        ]),
      })
      const activeCableVdo = decoded.sections.find(
        (section) => section.title === 'Active Cable VDO1',
      )
      const [display, issueCode] = activeCableCases[version]

      expect(
        activeCableVdo?.fields.find((field) => field.key === 'vdo_version')
          ?.displayValue,
      ).toBe(display)
      expect(
        activeCableVdo?.issues.some((issue) => issue.code === issueCode),
      ).toBe(issueCode !== undefined)
    }
  })

  test('classifies deprecated Discover Identity ID Header and passive cable values', () => {
    const idHeader = decodeMessage({
      sop: 'SOP',
      messageBytes: Uint8Array.from([
        0x8f, 0x41, 0x41, 0xa0, 0x00, 0xff, 0x34, 0x12, 0x00, 0x2a, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]),
    }).sections.find((section) => section.title === 'ID Header VDO')
    const passiveCable = decodeMessage({
      sop: 'SOP_PRIME',
      messageBytes: Uint8Array.from([
        0x8f, 0x51, 0x41, 0xa0, 0x00, 0xff, 0x34, 0x12, 0x00, 0x18, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00,
      ]),
    }).sections.find((section) => section.title === 'Passive Cable VDO')
    const activeCable = decodeMessage({
      sop: 'SOP_PRIME',
      messageBytes: Uint8Array.from([
        0x8f, 0x61, 0x41, 0xa0, 0x00, 0xff, 0x34, 0x12, 0x00, 0x20, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x60, 0x00, 0x00, 0x00,
        0x00, 0x00,
      ]),
    }).sections.find((section) => section.title === 'Active Cable VDO1')

    expect(
      idHeader?.fields.find(
        (field) => field.key === 'product_type_ufp_or_cable',
      ),
    ).toMatchObject({
      displayValue: 'Alternate Mode Adapter (AMA) (Deprecated)',
    })
    expect(
      idHeader?.fields.find((field) => field.key === 'product_type_dfp'),
    ).toMatchObject({
      displayValue: 'Alternate Mode Controller (AMC) (Deprecated)',
    })
    expect(
      idHeader?.fields.find((field) => field.key === 'connector_type'),
    ).toMatchObject({ displayValue: 'Unknown (Deprecated)' })
    expect(idHeader?.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'PD_ID_HEADER_UFP_PRODUCT_TYPE_DEPRECATED',
        'PD_ID_HEADER_DFP_PRODUCT_TYPE_DEPRECATED',
        'PD_ID_HEADER_CONNECTOR_TYPE_DEPRECATED',
      ]),
    )
    expect(
      passiveCable?.fields.find(
        (field) => field.key === 'plug_to_plug_or_captive',
      ),
    ).toMatchObject({ displayValue: 'USB Type-B (Deprecated)' })
    expect(
      passiveCable?.issues.some(
        (issue) => issue.code === 'PD_PASSIVE_CABLE_VDO_PLUG_TYPE_DEPRECATED',
      ),
    ).toBe(true)
    expect(
      activeCable?.fields.find(
        (field) => field.key === 'plug_to_plug_or_captive',
      ),
    ).toMatchObject({ displayValue: 'USB Type-A (Deprecated)' })
    expect(
      activeCable?.issues.some(
        (issue) => issue.code === 'PD_ACTIVE_CABLE_VDO1_PLUG_TYPE_DEPRECATED',
      ),
    ).toBe(true)
  })
})

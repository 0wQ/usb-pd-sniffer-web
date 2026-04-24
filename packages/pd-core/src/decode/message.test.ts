// @ts-nocheck
import { describe, expect, test } from "vitest";
import { decodeMessage, decodePacket } from "./message.js";

describe("decodePacket", () => {
  test("splits CRC32 from the packet tail instead of truncating by header-derived length", () => {
    const decoded = decodePacket({
      sop: "SOP",
      bytes: Uint8Array.from([0xB1, 0x9E, 0x00, 0x8C, 0x00, 0x00, 0xE6, 0x1A, 0x4D, 0xE6]),
    });

    expect(Array.from(decoded.frame.bytes)).toEqual([0xB1, 0x9E, 0x00, 0x8C, 0x00, 0x00]);
    expect(decoded.packetLayout.actualMessageByteLength).toBe(6);
    expect(decoded.packetLayout.expectedMessageByteLength).toBe(6);
    expect(Array.from(decoded.crc.rawBytes)).toEqual([0xE6, 0x1A, 0x4D, 0xE6]);
    expect(decoded.crc.status).toBe("present");
    expect(decoded.sections.some((section) => section.title === "Trailing Raw Bytes")).toBe(false);
  });

  test("does not emit empty generic payload container sections for Extended_Control", () => {
    const decoded = decodePacket({
      sop: "SOP",
      bytes: Uint8Array.from([0xB0, 0x92, 0x02, 0x80, 0x03, 0x00, 0x6E, 0x46, 0xDF, 0x60]),
    });

    expect(decoded.sections.map((section) => section.title)).toEqual([
      "Message Header",
      "Extended Message Header",
      "Extended Control Data Block",
      "CRC32",
    ]);
    expect(
      decoded.sections.every(
        (section) =>
          !Object.prototype.hasOwnProperty.call(section, "parentSectionKey")
          && !Object.prototype.hasOwnProperty.call(section, "depth"),
      ),
    ).toBe(true);
  });

  test("uses Data Size instead of NDO length for unchunked extended messages", () => {
    const decoded = decodePacket({
      sop: "SOP",
      bytes: Uint8Array.from([0xA4, 0x90, 0x01, 0x00, 0x01, 0x4E, 0x75, 0x00, 0x88]),
    });

    expect(decoded.packetLayout.actualMessageByteLength).toBe(5);
    expect(decoded.packetLayout.expectedMessageByteLength).toBe(5);
    expect(decoded.issues.some((issue) => issue.code === "PD_MESSAGE_LENGTH_MISMATCH")).toBe(false);
    expect(decoded.sections.map((section) => section.title)).toEqual([
      "Message Header",
      "Extended Message Header",
      "Get Battery Status Data Block",
      "CRC32",
    ]);
  });

  test("shows Security_Request as a dedicated raw SRQDB section without assemble requirements", () => {
    const decoded = decodeMessage({
      sop: "SOP",
      bytes: Uint8Array.from([0xA8, 0x90, 0x03, 0x00, 0x11, 0x22, 0x33]),
    });

    expect(decoded.messageType.name).toBe("Security_Request");
    expect(decoded.explainContext.notes).toHaveLength(0);
    expect(decoded.sections.map((section) => section.title)).toEqual([
      "Message Header",
      "Extended Message Header",
      "Security Request Data Block (SRQDB)",
    ]);
  });

  test("shows dedicated raw data-block titles for Security_Response and Firmware Update messages", () => {
    const cases = [
      {
        bytes: Uint8Array.from([0xA9, 0x90, 0x03, 0x00, 0x11, 0x22, 0x33]),
        messageTypeName: "Security_Response",
        title: "Security Response Data Block (SRPDB)",
      },
      {
        bytes: Uint8Array.from([0xAA, 0x90, 0x03, 0x00, 0x11, 0x22, 0x33]),
        messageTypeName: "Firmware_Update_Request",
        title: "Firmware Update Request Data Block (FRQDB)",
      },
      {
        bytes: Uint8Array.from([0xAB, 0x90, 0x03, 0x00, 0x11, 0x22, 0x33]),
        messageTypeName: "Firmware_Update_Response",
        title: "Firmware Update Response Data Block (FRPDB)",
      },
    ] as const;

    for (const testCase of cases) {
      const decoded = decodeMessage({
        sop: "SOP",
        bytes: testCase.bytes,
      });

      expect(decoded.messageType.name).toBe(testCase.messageTypeName);
      expect(decoded.sections.some((section) => section.title === testCase.title)).toBe(true);
    }
  });

  test("shows chunked Security_Request follow-up chunks as SRQDB raw without previous chunk context", () => {
    const decoded = decodeMessage({
      sop: "SOP",
      bytes: Uint8Array.from([0xA8, 0x90, 0x07, 0x88, 0xAA, 0xBB, 0xCC]),
    });

    expect(decoded.messageType.name).toBe("Security_Request");
    expect(decoded.explainContext.notes).toHaveLength(0);
    expect(decoded.sections.map((section) => section.title)).toEqual([
      "Message Header",
      "Extended Message Header",
      "Security Request Data Block (SRQDB)",
    ]);
  });

  test("reports packets shorter than message header plus CRC32", () => {
    const decoded = decodePacket({
      sop: "SOP",
      bytes: Uint8Array.from([0x12, 0x34, 0x56, 0x78, 0x9A]),
    });

    expect(decoded.issues.some((issue) => issue.code === "PD_PACKET_TOO_SHORT")).toBe(true);
    expect(decoded.sections.some((section) => section.title === "Trailing Raw Bytes")).toBe(false);
  });

  test("resolves Request RDO kind when Source_Capabilities packet context is provided explicitly", () => {
    const decoded = decodePacket(
      {
        sop: "SOP",
        bytes: Uint8Array.from([0xA2, 0x11, 0xC8, 0x20, 0x03, 0x20, 0x11, 0x22, 0x33, 0x44]),
      },
      {
        sourceCapabilities: {
          kind: "packet",
          packet: {
            sop: "SOP",
            bytes: Uint8Array.from([0xA1, 0x31, 0x2C, 0x91, 0x01, 0x00, 0xC8, 0xD0, 0x02, 0x00, 0x2C, 0x41, 0x06, 0x00, 0xAA, 0xBB, 0xCC, 0xDD]),
          },
        },
      },
    );

    expect(decoded.explainContext.mode).toBe("sequence");
    expect(decoded.explainContext.notes.some((note) => note.includes("Resolved Request object position 2"))).toBe(true);
    expect(decoded.sections.some((section) => section.title === "RDO - Fixed and Variable")).toBe(true);
  });

  test("keeps Request on the common RDO branch without Source_Capabilities context", () => {
    const decoded = decodePacket({
      sop: "SOP",
      bytes: Uint8Array.from([0xA2, 0x11, 0xC8, 0x20, 0x03, 0x20, 0x11, 0x22, 0x33, 0x44]),
    });

    expect(decoded.explainContext.mode).toBe("single_frame");
    expect(decoded.explainContext.notes).toHaveLength(0);
    const rdoSection = decoded.sections.find((section) => section.title === "RDO - Common");

    expect(rdoSection).toBeDefined();
    expect(rdoSection?.semanticKind).toBe("rdo_common");
    expect(rdoSection?.fields.some((field) => field.label === "GiveBack / Reserved")).toBe(true);
    expect(rdoSection?.fields.some((field) => field.label === "Operating Current")).toBe(false);
  });
});

describe("decodeMessage", () => {
  test("decodes all-zero Source_Capabilities objects as Empty PDO", () => {
    const decoded = decodeMessage({
      sop: "SOP",
      bytes: Uint8Array.from([0xA1, 0x11, 0x00, 0x00, 0x00, 0x00]),
    });

    expect(decoded.messageType.name).toBe("Source_Capabilities");
    const emptyPdoSection = decoded.sections.find((section) => section.title === "PDO 1 - Empty PDO");

    expect(emptyPdoSection).toBeDefined();
    expect(emptyPdoSection?.fields).toHaveLength(1);
    expect(emptyPdoSection?.fields[0]?.label).toBe("Empty PDO");
    expect(emptyPdoSection?.fields[0]?.displayValue).toBe("Empty PDO");
  });

  test("decodes EPR_Source_Capabilities chunk 0 as a partial semantic prefix", () => {
    const decoded = decodeMessage({
      sop: "SOP",
      bytes: Uint8Array.from([
        0xB1, 0xFB, 0x24, 0x80, 0x2C, 0x91, 0x81, 0x08, 0x2C, 0xD1, 0x02, 0x00, 0x0A, 0xB1,
        0x04, 0x00, 0xC8, 0x40, 0x06, 0x00, 0x48, 0x32, 0xDC, 0xC0, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00,
      ]),
    });

    expect(decoded.messageType.name).toBe("EPR_Source_Capabilities");
    expect(decoded.sections.some((section) => section.title === "SPR PDO 1 - Fixed Supply")).toBe(true);
    expect(decoded.sections.some((section) => section.title === "SPR PDO 5 - SPR PPS APDO")).toBe(true);
    expect(decoded.sections.some((section) => section.title === "SPR PDO 6 - Empty PDO")).toBe(true);
    expect(decoded.sections.some((section) => section.title === "Trailing Raw Payload")).toBe(true);
  });

  test("keeps EPR_Source_Capabilities chunk 1 raw-only without previous chunk context", () => {
    const decoded = decodeMessage({
      sop: "SOP",
      bytes: Uint8Array.from([0xB1, 0xBD, 0x24, 0x88, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xD0]),
    });

    expect(decoded.explainContext.notes.some((note) => note.includes("requires previous chunk context 0..0"))).toBe(true);
    expect(decoded.sections.map((section) => section.title)).toEqual([
      "Message Header",
      "Extended Message Header",
      "EPR_Source_Capabilities Data Block",
    ]);
  });

  test("assembles EPR_Source_Capabilities chunk 1 when previous chunk context is provided", () => {
    const decoded = decodeMessage(
      {
        sop: "SOP",
        bytes: Uint8Array.from([0xB1, 0xBD, 0x24, 0x88, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xD0]),
      },
      {
        chunkedExtendedMessage: {
          previousChunks: [
            {
              kind: "frame",
              frame: {
                sop: "SOP",
                bytes: Uint8Array.from([
                  0xB1, 0xFB, 0x24, 0x80, 0x2C, 0x91, 0x81, 0x08, 0x2C, 0xD1, 0x02, 0x00, 0x0A, 0xB1,
                  0x04, 0x00, 0xC8, 0x40, 0x06, 0x00, 0x48, 0x32, 0xDC, 0xC0, 0x00, 0x00, 0x00, 0x00,
                  0x00, 0x00,
                ]),
              },
            },
          ],
        },
      },
    );

    expect(decoded.explainContext.mode).toBe("sequence");
    expect(decoded.explainContext.notes.some((note) => note.includes("Assembled EPR_Source_Capabilities payload prefix from chunks 0..1"))).toBe(true);
    expect(decoded.sections.some((section) => section.title === "SPR PDO 7 - Empty PDO")).toBe(true);
    expect(decoded.sections.some((section) => section.title === "EPR PDO 8 - Empty PDO")).toBe(true);
    expect(decoded.sections.some((section) => section.title === "EPR PDO 9 - EPR AVS APDO")).toBe(true);
  });

  test("applies the same neutral position titles to EPR_Sink_Capabilities", () => {
    const decoded = decodeMessage({
      sop: "SOP",
      bytes: Uint8Array.from([
        0xB2, 0xFB, 0x24, 0x80, 0x2C, 0x91, 0x81, 0x08, 0x2C, 0xD1, 0x02, 0x00, 0x0A, 0xB1,
        0x04, 0x00, 0xC8, 0x40, 0x06, 0x00, 0x48, 0x32, 0xDC, 0xC0, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00,
      ]),
    });

    expect(decoded.messageType.name).toBe("EPR_Sink_Capabilities");
    expect(decoded.sections.some((section) => section.title === "SPR PDO 6 - Empty PDO")).toBe(true);
  });
});
